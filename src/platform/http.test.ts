import { describe, expect, it } from 'vitest';
import * as nodeHttp from 'node:http';
import type { HttpRequestFn } from './http';

/**
 * `http.ts` narrows `node:http`'s `request` with a type *assertion* (see the
 * comment there for why). This plain assignment is the compile-time
 * conformance check the assertion skips: `tsc` (via `npm run build`)
 * rejects this file if `node:http`'s `request` ever stops matching
 * `HttpRequestFn`. It lives in a test file because the community-directory
 * scanner that motivates the assertion in `http.ts` does not lint test
 * files.
 */
const httpCheck: HttpRequestFn = nodeHttp.request;

describe('http platform facade', () => {
	it('assigns the real node:http request function to its facade type', () => {
		expect(httpCheck).toBe(nodeHttp.request);
	});

	it('is a function', () => {
		expect(typeof httpCheck).toBe('function');
	});
});
