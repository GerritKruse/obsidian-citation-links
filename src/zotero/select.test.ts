import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { CslItem } from '../types';
import {
	clearZoteroLinkCache,
	fallbackSelectUrl,
	resolveZoteroSelectUrl,
	selectUrlFromCustomUri,
} from './select';

afterEach(() => {
	clearZoteroLinkCache();
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
			exact: true,
		});
		expect(request).not.toHaveBeenCalled();
	});

	it('queries every library in parallel and uses the exact hit', async () => {
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
					return makeResponse({
						error: { code: -32602, message: 'not found: ' + citekey },
					});
				}
				throw new Error('unexpected method ' + method);
			},
		);

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: 'zotero://select/groups/6650377/items/EY8PPXZA',
			exact: true,
		});
		// One user.groups call, plus one item.export call per library (3).
		expect(request).toHaveBeenCalledTimes(4);
	});

	it('falls back within timeoutMs when the request never resolves', async () => {
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
			exact: false,
		});
		expect(elapsedMs).toBeLessThan(1000);
	});

	it('falls back when the request throws', async () => {
		const request = vi.fn(async (): Promise<RequestUrlResponse> => {
			throw new Error('network error');
		});
		const citekey = 'throws2020';

		const result = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(result).toEqual({
			url: fallbackSelectUrl(citekey),
			exact: false,
		});
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
			exact: true,
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
			exact: true,
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
		expect(first.exact).toBe(true);
		const callsAfterFirst = request.mock.calls.length;
		expect(callsAfterFirst).toBeGreaterThan(0);

		const second = await resolveZoteroSelectUrl(citekey, undefined, {
			request,
		});

		expect(second).toEqual(first);
		expect(request.mock.calls.length).toBe(callsAfterFirst);
	});
});
