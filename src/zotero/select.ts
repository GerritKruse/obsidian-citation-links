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
 * `ZoteroLinkDeps` instead.
 */

import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { CslItem } from '../types';

export interface ZoteroLinkDeps {
	/** Performs an HTTP request. Pass obsidian's `requestUrl` in production. */
	request: (params: RequestUrlParam) => Promise<RequestUrlResponse>;
	/** Upper bound for the whole JSON-RPC resolution phase. Default 2000. */
	timeoutMs?: number;
	/** Better BibTeX JSON-RPC endpoint. */
	endpoint?: string;
}

export interface ZoteroLink {
	url: string;
	/** True when `url` points at the exact item, false for the fallback link. */
	exact: boolean;
}

const DEFAULT_ENDPOINT = 'http://127.0.0.1:23119/better-bibtex/json-rpc';
const DEFAULT_TIMEOUT_MS = 2000;

/** Better BibTeX's built-in "Better CSL JSON" translator id. */
const BETTER_CSL_JSON_TRANSLATOR_ID = '36a3b0b5-bad0-4a04-b79b-441c7cef77db';

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

/** Calls one Better BibTeX JSON-RPC method and returns its `result`, or throws. */
async function callJsonRpc<T>(
	deps: ZoteroLinkDeps,
	method: string,
	params: unknown[],
): Promise<T> {
	const response = await deps.request({
		url: deps.endpoint ?? DEFAULT_ENDPOINT,
		method: 'POST',
		contentType: 'application/json',
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		throw: false,
	});

	const body: JsonRpcResponseBody<T> =
		response.json !== undefined
			? (response.json as JsonRpcResponseBody<T>)
			: (JSON.parse(response.text) as JsonRpcResponseBody<T>);

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

/** Resolves the select URL for one citekey in one library, or null if unknown there. */
async function trySelectUrlForLibrary(
	citekey: string,
	libraryId: number,
	deps: ZoteroLinkDeps,
): Promise<string | null> {
	try {
		const result = await callJsonRpc<unknown>(deps, 'item.export', [
			[citekey],
			BETTER_CSL_JSON_TRANSLATOR_ID,
			libraryId,
		]);
		const exported = parseExportResult(result);
		const item =
			exported.items.find((i) => i.citationKey === citekey) ??
			exported.items[0];
		return item?.select ?? null;
	} catch {
		// Not found in this library, or this library errored: ignore and let
		// the other libraries decide.
		return null;
	}
}

/** Queries every library the user has access to, in parallel, for the citekey. */
async function resolveViaJsonRpc(
	citekey: string,
	deps: ZoteroLinkDeps,
): Promise<string | null> {
	const groups = await callJsonRpc<UserGroup[]>(deps, 'user.groups', []);
	const results = await Promise.all(
		groups.map((group) => trySelectUrlForLibrary(citekey, group.id, deps)),
	);
	return results.find((url): url is string => url !== null) ?? null;
}

function timeout<T>(ms: number): Promise<T> {
	return new Promise((_resolve, reject) => {
		window.setTimeout(
			() => reject(new Error('Better BibTeX JSON-RPC request timed out')),
			ms,
		);
	});
}

/**
 * Resolve a `zotero://select/...` URL for a citekey.
 *
 * Resolution order:
 * 1. `item.custom.uri`, when present (set by a user-configured Better
 *    BibTeX postscript) - exact, no network request.
 * 2. Better BibTeX JSON-RPC: list the user's libraries, then ask each of
 *    them for the item in parallel; the first hit wins - exact.
 * 3. A fallback link that Better BibTeX can still resolve by citekey, but
 *    only within the user's own library - not exact.
 *
 * The JSON-RPC phase (step 2) is bounded by `deps.timeoutMs` via
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
			const link: ZoteroLink = { url, exact: true };
			cache.set(citekey, link);
			return link;
		}
	}

	const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	try {
		const url = await Promise.race([
			resolveViaJsonRpc(citekey, deps),
			timeout<string | null>(timeoutMs),
		]);
		if (url) {
			const link: ZoteroLink = { url, exact: true };
			cache.set(citekey, link);
			return link;
		}
	} catch {
		// Server unreachable, request failed, or timed out: fall through.
	}

	return { url: fallbackSelectUrl(citekey), exact: false };
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
