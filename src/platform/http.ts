/**
 * Minimal, explicitly typed view of `node:http`'s `request`, the only HTTP
 * entry point the plugin uses (see `src/zotero/http.ts` for why Obsidian's
 * `requestUrl` cannot be used for Better BibTeX's JSON-RPC endpoint).
 *
 * `request` is pulled in with a *named* import (`import { request as
 * nodeRequest } from 'node:http'`), not a namespace import followed by a
 * member access (`import * as nodeHttp from 'node:http'; nodeHttp.request`).
 * Under a TypeScript environment without Node's type declarations (the
 * community-directory scanner), `node:http` resolves to an untyped module,
 * so a namespace member access on it (`nodeHttp.request`) is itself an
 * unsafe-member-access before the assertion below ever runs; a named import
 * of the same untyped binding is not flagged the same way. Exactly one
 * asserted export, `httpRequest`, leaves this file.
 *
 * As with `src/platform/node.ts`, the assertion (`nodeRequest as
 * HttpRequestFn`) does not itself prove `node:http`'s `request` matches
 * `HttpRequestFn` - that assignability is verified in `http.test.ts`, via a
 * plain assignment `tsc` checks on every `npm run build`.
 */

import { request as nodeRequest } from 'node:http';

/** The parts of Node's `IncomingMessage` this plugin reads. */
export interface HttpResponse {
	readonly statusCode?: number;
	readonly headers: Record<string, string | string[] | undefined>;
	on(event: 'data', listener: (chunk: Uint8Array) => void): void;
	on(event: 'end', listener: () => void): void;
	on(event: 'error', listener: (error: Error) => void): void;
}

/** The parts of Node's `ClientRequest` this plugin uses. */
export interface HttpClientRequest {
	on(event: 'error', listener: (error: Error) => void): void;
	on(event: 'timeout', listener: () => void): void;
	destroy(): void;
	write(chunk: Uint8Array): void;
	end(): void;
}

export interface HttpRequestOptions {
	method: string;
	headers: Record<string, string>;
	timeout: number;
}

export type HttpRequestFn = (
	url: URL,
	options: HttpRequestOptions,
	callback: (response: HttpResponse) => void,
) => HttpClientRequest;

export const httpRequest = nodeRequest as HttpRequestFn;
