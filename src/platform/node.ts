/**
 * Minimal, explicitly typed views of the Node built-ins this desktop-only
 * plugin needs (`node:fs`, `node:os`, `node:path`). This is the only module
 * allowed to import them - every other module imports the `fs`/`path`/`os`
 * facades from here instead, so the Node surface the plugin actually uses is
 * described once, in one place, by hand-written interfaces (`FsApi`,
 * `PathApi`, `OsApi`) rather than the full Node type declarations.
 *
 * The three exports below are produced with a type *assertion*
 * (`nodeFs as FsApi`), not an annotated assignment (`const fs: FsApi =
 * nodeFs`). This matters only for a TypeScript environment that type-checks
 * the plugin without Node's type declarations installed - which is what
 * Obsidian's community-directory review does. There, `node:fs` (and the
 * other two modules) resolve to an untyped, effectively `any`-shaped module,
 * and an *annotated assignment* from an `any`-shaped value to a typed
 * variable is flagged as an unsafe assignment; a type *assertion* is not.
 * Since the plugin's own `tsconfig.json` does have `@types/node`, this
 * assertion is exactly as safe here as an assignment would be - the
 * assertion form is chosen purely to read cleanly under both configurations.
 *
 * That means, though, that this file alone does not prove `nodeFs` actually
 * has the shape of `FsApi` (an assertion does not check assignability the
 * way a plain assignment does). Full assignability - that `node:fs` really
 * satisfies `FsApi`, `node:path` really satisfies `PathApi`, and `node:os`
 * really satisfies `OsApi` - is instead verified in `node.test.ts`, via plain
 * assignments the scanner never lints (it does not lint test files) but our
 * own `tsc` does, on every `npm run build`.
 */

import * as nodeFs from 'node:fs';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';

/** One entry of a `readdir(..., { withFileTypes: true })` result. */
export interface DirEntry {
	readonly name: string;
	isFile(): boolean;
}

/** The single `statSync` property the settings validation reads. */
export interface FileStats {
	isDirectory(): boolean;
}

/** A live `fs.watch` handle. */
export interface FileWatcher {
	on(event: 'error', listener: (error: Error) => void): void;
	close(): void;
}

export interface FsApi {
	readonly promises: {
		readdir(dir: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
		readFile(file: string, encoding: 'utf8'): Promise<string>;
	};
	watch(
		dir: string,
		options: { persistent: boolean },
		listener: (eventType: string, fileName: string | null) => void,
	): FileWatcher;
	existsSync(path: string): boolean;
	statSync(path: string): FileStats;
}

export interface PathApi {
	join(...segments: string[]): string;
}

export interface OsApi {
	homedir(): string;
}

export const fs = nodeFs as FsApi;
export const path = nodePath as PathApi;
export const os = nodeOs as OsApi;
