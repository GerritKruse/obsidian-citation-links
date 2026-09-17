import { describe, expect, it } from 'vitest';
import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import type { FsApi, OsApi, PathApi } from './node';

/**
 * `node.ts` narrows `node:fs`/`node:path`/`node:os` with a type *assertion*
 * rather than an annotated assignment (see the comment there for why). That
 * means the facade file itself never checks that `node:fs` really satisfies
 * `FsApi`, and likewise for `PathApi`/`OsApi`. These plain assignments are
 * that check: `tsc` (via `npm run build`) rejects this file if any of the
 * three ever stops matching its interface. This lives in a test file
 * because the community-directory scanner that motivates the assertion in
 * `node.ts` does not lint test files, so the assignment form here causes it
 * no trouble.
 */
const fsCheck: FsApi = nodeFs;
const pathCheck: PathApi = nodePath;
const osCheck: OsApi = nodeOs;

describe('node platform facade', () => {
	it('assigns the real node:fs/node:path/node:os modules to their facade types', () => {
		expect(fsCheck).toBe(nodeFs);
		expect(pathCheck).toBe(nodePath);
		expect(osCheck).toBe(nodeOs);
	});

	it('path.join joins segments with the platform separator', () => {
		expect(nodePath.join('a', 'b')).toContain('b');
	});

	it('os.homedir returns a string', () => {
		expect(typeof nodeOs.homedir()).toBe('string');
	});

	it('fs.existsSync reports the current working directory as existing', () => {
		expect(nodeFs.existsSync(process.cwd())).toBe(true);
	});
});
