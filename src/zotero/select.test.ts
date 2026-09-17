import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { CslItem } from '../types';
import {
	clearZoteroLinkCache,
	fallbackSelectUrl,
	prefetchZoteroLinks,
	resolveZoteroSelectUrl,
	selectUrlFromCustomUri,
} from './select';

afterEach(() => {
	clearZoteroLinkCache();
	vi.restoreAllMocks();
});

function makeResponse(body: unknown): RequestUrlResponse {
	return {
		status: 200,
		headers: {},
		arrayBuffer: new ArrayBuffer(0),
		json: body,
		text: JSON.stringify(body),
	};
}

/** Parses the JSON-RPC method name out of a mocked request's body. */
function methodOf(params: RequestUrlParam): string {
	const body = JSON.parse(params.body as string) as { method: string };
	return body.method;
}

/** Parses the JSON-RPC params array out of a mocked request's body. */
function paramsOf(params: RequestUrlParam): unknown[] {
	const body = JSON.parse(params.body as string) as { params: unknown[] };
	return body.params;
}

const notFoundError = (citekey: string) => ({
	error: { code: -32602, message: 'not found: ' + citekey },
});

describe('selectUrlFromCustomUri', () => {
	it('converts a group URI', () => {
		expect(
			selectUrlFromCustomUri(
				'http://zotero.org/groups/6650377/items/EY8PPXZA',
			),
		).toBe('zotero://select/groups/6650377/items/EY8PPXZA');
	});

	it('converts a user URI', () => {
		expect(
			selectUrlFromCustomUri('http://zotero.org/users/12345/items/ABCD1234'),
		).toBe('zotero://select/library/items/ABCD1234');
	});

	it('converts a local-user URI', () => {
		expect(
			selectUrlFromCustomUri(
				'http://zotero.org/users/local/xyz/items/ABCD1234',
			),
		).toBe('zotero://select/library/items/ABCD1234');
	});

	it('returns null for anything else', () => {
		expect(selectUrlFromCustomUri('not-a-uri')).toBeNull();
		expect(
			selectUrlFromCustomUri('http://zotero.org/items/ABCD1234'),
		).toBeNull();
		expect(selectUrlFromCustomUri('')).toBeNull();
	});
});

describe('fallbackSelectUrl', () => {
	it('encodes special characters in the citekey', () => {
		expect(fallbackSelectUrl('smith & jones 2020')).toBe(
			'zotero://select/items/@' + encodeURIComponent('smith & jones 2020'),
		);
	});
});

describe('resolveZoteroSelectUrl', () => {
	it('uses item.custom.uri when present, without making a request', async () => {
		const request = vi.fn();
		const item: CslItem = {
			id: 'smith2020',
			custom: { uri: 'http://zotero.org/groups/6650377/items/EY8PPXZA' },
		};

		const result = await resolveZoteroSelectUrl('smith2020', item, {
			request,
		});

		expect(result).toEqual({
			url: 'zotero://select/groups/6650377/items/EY8PPXZA',
			status: 'exact',
		});
		expect(request).not.toHaveBeenCalled();
	});

	it('queries every library in parallel and uses the exact hit, naming the library', async () => {
		const citekey = 'lava2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [
							{ id: 1, name: 'Meine Bibliothek' },
							{ id: 2, name: 'Ctrl+References' },
							{ id: 4, name: 'LAVA' },
						],
					});
				}
				if (method === 'item.export') {
					const libraryId = paramsOf(params)[2];
					if (libraryId === 4) {
						return makeResponse({
							result: JSON.stringify({
								items: [
									{
										citationKey: citekey,
										select:
											'zotero://select/groups/6650377/items/EY8PPXZA',
									},
								],
							}),
						});
					}
					return makeResponse(notFoundError(citekey));
				}
				throw new Error('unexpected method ' + method);
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: 'zotero://select/groups/6650377/items/EY8PPXZA',
			status: 'exact',
			library: 'LAVA',
		});
		// One user.groups call, plus one item.export call per library (3).
		expect(request).toHaveBeenCalledTimes(4);
	});

	it('falls back within timeoutMs when the request never resolves, with no unhandled rejection', async () => {
		const request = vi.fn(() => new Promise<RequestUrlResponse>(() => {}));
		const citekey = 'neverresolves2020';

		const started = Date.now();
		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
			timeoutMs: 20,
		});
		const elapsedMs = Date.now() - started;

		expect(result).toEqual({
			url: fallbackSelectUrl(citekey),
			status: 'unreachable',
		});
		expect(elapsedMs).toBeLessThan(1000);
	});

	it('falls back when user.groups throws (e.g. ECONNREFUSED), without caching', async () => {
		const request = vi.fn(async (): Promise<RequestUrlResponse> => {
			throw new Error('connect ECONNREFUSED 127.0.0.1:23119');
		});
		const citekey = 'throws2020';

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: fallbackSelectUrl(citekey),
			status: 'unreachable',
		});

		const callsAfterFirst = request.mock.calls.length;
		await resolveZoteroSelectUrl(citekey, undefined, { request });
		expect(request.mock.calls.length).toBeGreaterThan(callsAfterFirst);
	});

	it('is unreachable when every item.export call throws a transport error', async () => {
		const citekey = 'exportthrows2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [
							{ id: 1, name: 'Meine Bibliothek' },
							{ id: 2, name: 'Ctrl+References' },
						],
					});
				}
				throw new Error('socket hang up');
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: fallbackSelectUrl(citekey),
			status: 'unreachable',
		});
	});

	it('is not-found when user.groups succeeds but no library has the key', async () => {
		const citekey = 'missingeverywhere2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [
							{ id: 1, name: 'Meine Bibliothek' },
							{ id: 2, name: 'Ctrl+References' },
						],
					});
				}
				return makeResponse(notFoundError(citekey));
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({ url: null, status: 'not-found' });

		const callsAfterFirst = request.mock.calls.length;
		await resolveZoteroSelectUrl(citekey, undefined, { request });
		expect(request.mock.calls.length).toBeGreaterThan(callsAfterFirst);
	});

	it('accepts item.export result as a plain JSON string', async () => {
		const citekey = 'stringresult2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [{ id: 1, name: 'Meine Bibliothek' }],
					});
				}
				return makeResponse({
					result: JSON.stringify({
						items: [
							{
								citationKey: citekey,
								select: 'zotero://select/library/items/AAAA1111',
							},
						],
					}),
				});
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: 'zotero://select/library/items/AAAA1111',
			status: 'exact',
			library: 'Meine Bibliothek',
		});
	});

	it('accepts item.export result as an array ending in the JSON string', async () => {
		const citekey = 'arrayresult2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [{ id: 1, name: 'Meine Bibliothek' }],
					});
				}
				return makeResponse({
					result: [
						'status',
						0,
						JSON.stringify({
							items: [
								{
									citationKey: citekey,
									select: 'zotero://select/library/items/BBBB2222',
								},
							],
						}),
					],
				});
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: 'zotero://select/library/items/BBBB2222',
			status: 'exact',
			library: 'Meine Bibliothek',
		});
	});

	it('caches an exact result and makes no request on the second call', async () => {
		const citekey = 'cached2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [{ id: 1, name: 'Meine Bibliothek' }],
					});
				}
				return makeResponse({
					result: JSON.stringify({
						items: [
							{
								citationKey: citekey,
								select: 'zotero://select/library/items/CCCC3333',
							},
						],
					}),
				});
			},
		);

		const first = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});
		expect(first.status).toBe('exact');
		const callsAfterFirst = request.mock.calls.length;
		expect(callsAfterFirst).toBeGreaterThan(0);

		const second = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(second).toEqual(first);
		expect(request.mock.calls.length).toBe(callsAfterFirst);
	});

	it('clears the timeout timer after a fast success', async () => {
		const clearTimeoutSpy = vi.spyOn(window, 'clearTimeout');
		const citekey = 'fastsuccess2020';
		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [{ id: 1, name: 'Meine Bibliothek' }],
					});
				}
				return makeResponse(notFoundError(citekey));
			},
		);

		await resolveZoteroSelectUrl(citekey, undefined, { request });

		expect(clearTimeoutSpy).toHaveBeenCalled();
	});
});

describe('prefetchZoteroLinks', () => {
	it('resolves all keys with at most 4 concurrent resolutions in flight', async () => {
		const citekeys = Array.from({ length: 10 }, (_, i) => `key${i}`);
		let inFlight = 0;
		let maxInFlight = 0;

		const request = vi.fn(
			async (params: RequestUrlParam): Promise<RequestUrlResponse> => {
				inFlight++;
				maxInFlight = Math.max(maxInFlight, inFlight);
				// Yield a couple of microtasks so concurrent calls actually overlap.
				await Promise.resolve();
				await Promise.resolve();
				inFlight--;

				const method = methodOf(params);
				if (method === 'user.groups') {
					return makeResponse({
						result: [{ id: 1, name: 'Meine Bibliothek' }],
					});
				}
				const citekey = (paramsOf(params)[0] as string[])[0];
				return makeResponse(notFoundError(citekey ?? ''));
			},
		);

		const results = await prefetchZoteroLinks(
			citekeys,
			() => undefined,
			{ request },
		);

		expect(results.size).toBe(citekeys.length);
		for (const citekey of citekeys) {
			expect(results.get(citekey)).toEqual({ url: null, status: 'not-found' });
		}
		expect(maxInFlight).toBeLessThanOrEqual(4);
		expect(maxInFlight).toBeGreaterThan(1);
	});

	it('stops early once a resolution comes back unreachable', async () => {
		const citekeys = Array.from({ length: 10 }, (_, i) => `key${i}`);
		const request = vi.fn(async (): Promise<RequestUrlResponse> => {
			throw new Error('connect ECONNREFUSED 127.0.0.1:23119');
		});

		const results = await prefetchZoteroLinks(
			citekeys,
			() => undefined,
			{ request },
		);

		expect(results.size).toBe(citekeys.length);
		for (const citekey of citekeys) {
			expect(results.get(citekey)).toEqual({
				url: fallbackSelectUrl(citekey),
				status: 'unreachable',
			});
		}
		// Every key is reported, but the port should not be hammered once:
		// each worker gives up after its own first (unreachable) resolution,
		// so far fewer than 10 resolutions' worth of requests go out.
		expect(request.mock.calls.length).toBeLessThan(citekeys.length);
	});
});
