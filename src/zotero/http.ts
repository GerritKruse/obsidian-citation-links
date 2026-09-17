/**
 * A `RequestFn` (see `select.ts`) backed by Node's `http` module instead of
 * Obsidian's `requestUrl`.
 *
 * Zotero's local HTTP server (Better BibTeX's JSON-RPC endpoint on port
 * 23119) silently drops POST requests that carry an `Origin` header it does
 * not recognise - `requestUrl` (built on Chromium's fetch/XHR stack) always
 * sends one for a request made from the renderer's `app://obsidian.md`
 * origin, so the request never gets a response at all. It also rejects a
 * request whose `Content-Type` is not `application/json`.
 *
 * Node's `http.request`, called directly from Obsidian's Electron renderer
 * process, sends no `Origin` header and is not subject to CORS, which is
 * the approach used by the Pandoc Reference List and
 * obsidian-zotero-integration plugins to talk to Better BibTeX. Better
 * BibTeX itself answers in a few milliseconds, so this is not a latency
 * workaround.
 */

import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { httpRequest } from '../platform/http';

/** Node's `http` module has no request timeout by default; give it one. */
const SOCKET_TIMEOUT_MS = 10000;

/**
 * `ignoreBOM: true` keeps a leading byte order mark in the decoded text, as
 * Node's `Buffer.toString('utf-8')` did in earlier versions of this module;
 * the default would silently strip it.
 */
const UTF8 = new TextDecoder('utf-8', { ignoreBOM: true });

/** Node may report a response header as a single string or as string[]. */
function flattenHeaderValue(value: string | string[] | undefined): string {
	return Array.isArray(value) ? value.join(', ') : (value ?? '');
}

/** Turns a `RequestUrlParam` body into bytes, or undefined for no body. */
function toBodyBytes(body: string | ArrayBuffer | undefined): Uint8Array | undefined {
	if (body === undefined) {
		return undefined;
	}
	return typeof body === 'string' ? new TextEncoder().encode(body) : new Uint8Array(body);
}

/**
 * Joins the received response chunks into one contiguous `ArrayBuffer`.
 * Allocating the `ArrayBuffer` explicitly (rather than reading `.buffer` off
 * a `Uint8Array`) keeps the type `ArrayBuffer` instead of `ArrayBufferLike`,
 * which is what `RequestUrlResponse.arrayBuffer` requires.
 */
function concatChunks(chunks: Uint8Array[]): ArrayBuffer {
	let total = 0;
	for (const chunk of chunks) {
		total += chunk.byteLength;
	}
	const buffer = new ArrayBuffer(total);
	const merged = new Uint8Array(buffer);
	let offset = 0;
	for (const chunk of chunks) {
		merged.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return buffer;
}

/**
 * Sends the request with Node's `http` module (no `Origin` header, no
 * CORS), for use from Obsidian's desktop renderer.
 */
export function nodeHttpRequest(params: RequestUrlParam): Promise<RequestUrlResponse> {
	return new Promise((resolve, reject) => {
		const url = new URL(params.url);
		const body = toBodyBytes(params.body);

		const headers: Record<string, string> = {
			Accept: 'application/json',
			...params.headers,
		};
		if (params.contentType) {
			headers['Content-Type'] = params.contentType;
		} else if (body !== undefined && headers['Content-Type'] === undefined) {
			headers['Content-Type'] = 'application/json';
		}
		if (body !== undefined && headers['Content-Length'] === undefined) {
			headers['Content-Length'] = String(body.byteLength);
		}

		const req = httpRequest(
			url,
			{
				method: params.method ?? 'GET',
				headers,
				timeout: SOCKET_TIMEOUT_MS,
			},
			(res) => {
				const chunks: Uint8Array[] = [];
				res.on('data', (chunk) => chunks.push(chunk));
				res.on('error', (error) => reject(error));
				res.on('end', () => {
					const arrayBuffer = concatChunks(chunks);
					const status = res.statusCode ?? 0;
					const text = UTF8.decode(arrayBuffer);

					const responseHeaders: Record<string, string> = {};
					for (const [key, value] of Object.entries(res.headers)) {
						responseHeaders[key] = flattenHeaderValue(value);
					}

					const response: RequestUrlResponse = {
						status,
						headers: responseHeaders,
						arrayBuffer,
						text,
						// Lazily parsed so a non-JSON body never throws from a getter.
						get json(): unknown {
							try {
								return JSON.parse(text) as unknown;
							} catch {
								return undefined;
							}
						},
					};

					if (params.throw !== false && status >= 400) {
						reject(new Error(`Request to ${params.url} failed with status ${status}`));
						return;
					}
					resolve(response);
				});
			},
		);

		req.on('error', (error) => reject(error));
		req.on('timeout', () => {
			req.destroy();
			reject(new Error(`Request to ${params.url} timed out`));
		});

		if (body !== undefined) {
			req.write(body);
		}
		req.end();
	});
}
