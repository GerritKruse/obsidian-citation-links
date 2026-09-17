/**
 * Building `zotero://select/...` URLs for a citekey.
 *
 * This mirrors how the Pandoc Reference List plugin locates an item in
 * Zotero: it asks the local Better BibTeX JSON-RPC server which library
 * knows the citekey, then builds a deep link that opens Zotero's item pane
 * directly on that item. When the server is unreachable (Zotero not
 * running, Better BibTeX not installed) it falls back to a link that BBT
 * can still resolve, but only inside the user's own library.
 *
 * Only `import type` is used from 'obsidian' here: vitest aliases the
 * 'obsidian' module to an empty file, so any runtime import would break the
 * unit tests. Runtime behaviour (the actual HTTP request) is injected via
 * `ZoteroLinkDeps` instead - `http.ts` provides the production
 * implementation (Node's `http` module, not Obsidian's `requestUrl`; see
 * that file for why).
 */

import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { CslItem } from '../types';

/** Performs an HTTP request. Pass `nodeHttpRequest` from `http.ts` in production. */
export type RequestFn = (params: RequestUrlParam) => Promise<RequestUrlResponse>;

export interface ZoteroLinkDeps {
	request: RequestFn;
	/** Upper bound for the whole JSON-RPC resolution phase. Default 5000. */
	timeoutMs?: number;
	/** Better BibTeX JSON-RPC endpoint. */
	endpoint?: string;
}

export type ZoteroLinkStatus = 'exact' | 'unreachable' | 'not-found';

export interface ZoteroLink {
	/**
	 * Deep link to the item. For 'unreachable' this is the citekey fallback
	 * link; for 'not-found' it is null.
	 */
	url: string | null;
	status: ZoteroLinkStatus;
	/** Which library answered, e.g. 'LAVA' (only ever set for 'exact'). */
	library?: string;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:23119/better-bibtex/json-rpc';
const DEFAULT_TIMEOUT_MS = 5000;

/** How many citekeys `prefetchZoteroLinks` resolves at once. */
const PREFETCH_CONCURRENCY = 4;

/** Better BibTeX's own "BetterBibTeX JSON" translator id. */
const BBT_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

const GROUP_URI_RE = /^http:\/\/zotero\.org\/groups\/(\d+)\/items\/(\w+)$/;
const USER_URI_RE =
	/^http:\/\/zotero\.org\/users\/(?:local\/)?[^/]+\/items\/(\w+)$/;

/** Exact links resolved via JSON-RPC, keyed by citekey. Never holds fallbacks. */
const cache = new Map<string, ZoteroLink>();

/** Clears the module-level resolution cache. Exposed for tests. */
export function clearZoteroLinkCache(): void {
	cache.clear();
}

/**
 * Derive a `zotero://select/...` URL from a CSL item's `custom.uri`, which is
 * only present when the user configured a Better BibTeX postscript that
 * writes it. Returns null for anything that does not look like a Zotero
 * item URI.
 */
export function selectUrlFromCustomUri(uri: string): string | null {
	const groupMatch = GROUP_URI_RE.exec(uri);
	if (groupMatch) {
		return `zotero://select/groups/${groupMatch[1]}/items/${groupMatch[2]}`;
	}

	const userMatch = USER_URI_RE.exec(uri);
	if (userMatch) {
		return `zotero://select/library/items/${userMatch[1]}`;
	}

	return null;
}

/**
 * A link that Better BibTeX resolves by citekey, but only within the user's
 * own (default) library. Used when the exact item location is unknown.
 */
export function fallbackSelectUrl(citekey: string): string {
	return 'zotero://select/items/@' + encodeURIComponent(citekey);
}

interface JsonRpcErrorBody {
	code: number;
	message: string;
}

interface JsonRpcResponseBody<T> {
	result?: T;
	error?: JsonRpcErrorBody;
}

interface UserGroup {
	id: number;
	name: string;
}

interface ExportedItem {
	citationKey?: string;
	select?: string;
}

interface ExportResult {
	items: ExportedItem[];
}

/**
 * Sends one JSON-RPC request and returns its parsed body, without
 * interpreting `result`/`error` - that is left to the caller, since what
 * counts as a mere "not found" versus a real transport failure differs
 * between `user.groups` and `item.export` (see `trySelectUrlForLibrary`).
 * Throws only when the transport itself failed: the request rejected, or
 * the body is not valid JSON.
 */
async function requestJsonRpc(
	deps: ZoteroLinkDeps,
	method: string,
	params: unknown[],
): Promise<JsonRpcResponseBody<unknown>> {
	const response = await deps.request({
		url: deps.endpoint ?? DEFAULT_ENDPOINT,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		throw: false,
	});

	const body: unknown =
		response.json !== undefined ? response.json : JSON.parse(response.text);
	return body as JsonRpcResponseBody<unknown>;
}

/** Calls one Better BibTeX JSON-RPC method and returns its `result`, or throws. */
async function callJsonRpc<T>(
	deps: ZoteroLinkDeps,
	method: string,
	params: unknown[],
): Promise<T> {
	const body = (await requestJsonRpc(deps, method, params)) as JsonRpcResponseBody<T>;

	if (body.error) {
		throw new Error(body.error.message);
	}
	if (body.result === undefined) {
		throw new Error(
			'Better BibTeX JSON-RPC returned no result for ' + method,
		);
	}
	return body.result;
}

/**
 * `item.export`'s result is a JSON string on most Better BibTeX versions,
 * but some versions wrap it in an array whose last element is that string.
 */
function parseExportResult(result: unknown): ExportResult {
	const jsonString: unknown = Array.isArray(result)
		? (result as unknown[])[result.length - 1]
		: result;

	if (typeof jsonString !== 'string') {
		throw new Error('Unexpected item.export result shape');
	}
	return JSON.parse(jsonString) as ExportResult;
}

type LibraryAttempt =
	| { kind: 'found'; url: string }
	| { kind: 'not-found' }
	| { kind: 'error' };

/**
 * Resolves one citekey in one library.
 *
 * A JSON-RPC error such as `{ code: -32602, message: 'not found: <key>' }`
 * means Better BibTeX answered just fine - this library simply does not
 * have the item, which is 'not-found', not a transport failure. Only the
 * request itself failing (connection refused, etc.), or a response body we
 * cannot interpret at all, counts as 'error'.
 */
async function trySelectUrlForLibrary(
	citekey: string,
	libraryId: number,
	deps: ZoteroLinkDeps,
): Promise<LibraryAttempt> {
	let body: JsonRpcResponseBody<unknown>;
	try {
		body = await requestJsonRpc(deps, 'item.export', [
			[citekey],
			BBT_JSON_TRANSLATOR_ID,
			libraryId,
		]);
	} catch {
		return { kind: 'error' };
	}

	if (body.error) {
		return { kind: 'not-found' };
	}

	try {
		const exported = parseExportResult(body.result);
		const item =
			exported.items.find((i) => i.citationKey === citekey) ??
			exported.items[0];
		return item?.select ? { kind: 'found', url: item.select } : { kind: 'not-found' };
	} catch {
		// A response we could not interpret is as good as no response.
		return { kind: 'error' };
	}
}

interface JsonRpcResolution {
	url: string | null;
	library?: string;
	/** True when every queried library failed with a transport error. */
	allErrored: boolean;
}

/** Queries every library the user has access to, in parallel, for the citekey. */
async function resolveViaJsonRpc(
	citekey: string,
	deps: ZoteroLinkDeps,
): Promise<JsonRpcResolution> {
	const groups = await callJsonRpc<UserGroup[]>(deps, 'user.groups', []);
	const attempts = await Promise.all(
		groups.map(async (group) => ({
			group,
			attempt: await trySelectUrlForLibrary(citekey, group.id, deps),
		})),
	);

	for (const { group, attempt } of attempts) {
		if (attempt.kind === 'found') {
			return { url: attempt.url, library: group.name, allErrored: false };
		}
	}

	const allErrored =
		attempts.length > 0 && attempts.every(({ attempt }) => attempt.kind === 'error');
	return { url: null, allErrored };
}

/**
 * Races `promise` against a timeout, built so that neither the setup nor
 * the teardown can throw outside of a promise:
 *
 * - `window` may not exist at all (the desktop live-check script runs the
 *   resolver under plain Node, not inside Obsidian's renderer). Guarding
 *   with `typeof window !== 'undefined'` first means the fallback never
 *   dereferences an undeclared identifier; doing that directly - even
 *   inside a `new Promise` executor - only turns into a rejection, and a
 *   caller relying on a surrounding try/catch to convert "something went
 *   wrong building the race" into the fallback would instead see that
 *   rejection swallow the *real* result once both promises are awaited.
 * - `window.setTimeout` is used (Obsidian always has a window; the test setup shims it).
 * - The timer is always cleared once the race settles, whichever side won,
 *   so a fast success does not leave a dangling timeout around to reject
 *   later.
 */
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	let timerId: number | undefined;

	const timeoutPromise = new Promise<never>((_resolve, reject) => {
		timerId = window.setTimeout(() => {
			reject(new Error('Better BibTeX JSON-RPC request timed out'));
		}, ms);
	});

	return Promise.race([promise, timeoutPromise]).finally(() => {
		if (timerId !== undefined) {
			window.clearTimeout(timerId);
		}
	});
}

/**
 * Resolve a `zotero://select/...` URL for a citekey.
 *
 * Resolution order:
 * 1. `item.custom.uri`, when present (set by a user-configured Better
 *    BibTeX postscript) - 'exact', no network request.
 * 2. Better BibTeX JSON-RPC: list the user's libraries, then ask each of
 *    them for the item in parallel; the first hit wins - 'exact'.
 * 3. Every library answered but none had the citekey - 'not-found'.
 * 4. The JSON-RPC phase failed outright (server unreachable, request
 *    threw, response unparsable, or timed out) - 'unreachable', with a
 *    fallback link that Better BibTeX can still resolve by citekey, but
 *    only within the user's own library.
 *
 * Only 'exact' results are cached; 'not-found' and 'unreachable' are
 * re-attempted on every call, since either can change the moment Zotero is
 * started or the item is added.
 *
 * The JSON-RPC phase (steps 2-3) is bounded by `deps.timeoutMs` via
 * `Promise.race`; the underlying request itself is not aborted. This
 * function never throws.
 */
export async function resolveZoteroSelectUrl(
	citekey: string,
	item: CslItem | undefined,
	deps: ZoteroLinkDeps,
): Promise<ZoteroLink> {
	const cached = cache.get(citekey);
	if (cached) {
		return cached;
	}

	const customUri = item?.custom?.uri;
	if (customUri) {
		const url = selectUrlFromCustomUri(customUri);
		if (url) {
			const link: ZoteroLink = { url, status: 'exact' };
			cache.set(citekey, link);
			return link;
		}
	}

	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let resolution: JsonRpcResolution;
	try {
		resolution = await raceWithTimeout(resolveViaJsonRpc(citekey, deps), timeoutMs);
	} catch {
		// Server unreachable, request failed, response unparsable, or timed out.
		return { url: fallbackSelectUrl(citekey), status: 'unreachable' };
	}

	if (resolution.url) {
		const link: ZoteroLink =
			resolution.library !== undefined
				? { url: resolution.url, status: 'exact', library: resolution.library }
				: { url: resolution.url, status: 'exact' };
		cache.set(citekey, link);
		return link;
	}

	if (resolution.allErrored) {
		return { url: fallbackSelectUrl(citekey), status: 'unreachable' };
	}

	return { url: null, status: 'not-found' };
}

/**
 * Resolves several citekeys at once, at most `PREFETCH_CONCURRENCY`
 * resolutions in flight at a time (a simple worker-pool pattern: each
 * worker pulls the next citekey off the shared list as soon as it is
 * free). Stops handing out new citekeys as soon as one resolution comes
 * back 'unreachable' - Zotero/Better BibTeX is not answering at all, so
 * there is no point hammering a closed port with one request per
 * remaining citekey - and reports every citekey that was skipped this way
 * as 'unreachable' too.
 */
export async function prefetchZoteroLinks(
	citekeys: string[],
	items: (citekey: string) => CslItem | undefined,
	deps: ZoteroLinkDeps,
): Promise<Map<string, ZoteroLink>> {
	const results = new Map<string, ZoteroLink>();
	let stopped = false;
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (;;) {
			if (stopped) {
				return;
			}
			const index = nextIndex++;
			const citekey = citekeys[index];
			if (citekey === undefined) {
				return;
			}

			const link = await resolveZoteroSelectUrl(citekey, items(citekey), deps);
			results.set(citekey, link);
			if (link.status === 'unreachable') {
				stopped = true;
			}
		}
	}

	const workerCount = Math.min(PREFETCH_CONCURRENCY, citekeys.length);
	await Promise.all(Array.from({ length: workerCount }, () => worker()));

	for (const citekey of citekeys) {
		if (!results.has(citekey)) {
			results.set(citekey, { url: fallbackSelectUrl(citekey), status: 'unreachable' });
		}
	}

	return results;
}

/**
 * Open an external URL from Obsidian's Electron renderer, preferring
 * Electron's shell so it does not spawn a stray browser tab; falls back to
 * `window.open` on platforms without Electron (e.g. mobile).
 */
export function openExternal(url: string): void {
	const electron = (
		window as Window & {
			require?: (module: string) => {
				shell?: { openExternal(u: string): Promise<void> };
			};
		}
	).require?.('electron');

	if (electron?.shell?.openExternal) {
		void electron.shell.openExternal(url);
		return;
	}

	window.open(url);
}
