import { describe, expect, it } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFolder } from './loader';

// import.meta.dirname is not guaranteed across every vitest/Node combination
// this project might run under, so resolve the fixtures directory the safe
// way, from the URL of this file.
const here = fileURLToPath(new URL('.', import.meta.url));
const fixturesRoot = path.join(here, '../../test/fixtures/loader');

function fixture(name: string): string {
	return path.join(fixturesRoot, name);
}

describe('loadFolder', () => {
	it('loads items from all json files, normalises id to the citekey, and ignores non-json files', async () => {
		const result = await loadFolder(fixture('valid'));

		expect(result.files).toEqual(['UPPER.JSON', 'a.json']);
		expect(result.skippedFiles).toEqual([]);
		expect(result.skippedItems).toBe(0);
		expect(result.duplicates).toEqual([]);

		expect(result.items.size).toBe(3);
		expect([...result.items.keys()].sort()).toEqual(['Bar2020', 'Baz2020', 'Foo2020']);

		const foo = result.items.get('Foo2020');
		expect(foo?.id).toBe('Foo2020');
		expect(foo?.title).toBe('Foo Title');

		// The item's own "id" differed from its "citation-key"; the citekey wins
		// and the stored item is normalised so id === citekey.
		const bar = result.items.get('Bar2020');
		expect(bar?.id).toBe('Bar2020');
		expect(bar?.title).toBe('Bar Title');
		expect(result.items.has('internal123')).toBe(false);
	});

	it('sorts file names deterministically with a plain sort', async () => {
		const result = await loadFolder(fixture('valid'));
		// "UPPER.JSON" sorts before "a.json" under a plain, locale-independent sort.
		expect(result.files).toEqual(['UPPER.JSON', 'a.json']);
	});

	it('skips a file whose top-level JSON value is not an array', async () => {
		const result = await loadFolder(fixture('object'));

		expect(result.files).toEqual([]);
		expect(result.skippedFiles).toEqual(['x.json']);
		expect(result.items.size).toBe(0);
	});

	it('skips items without a usable string key', async () => {
		const result = await loadFolder(fixture('noid'));

		expect(result.files).toEqual(['x.json']);
		expect(result.skippedFiles).toEqual([]);
		// One item has neither id nor citation-key, one has a numeric id.
		expect(result.skippedItems).toBe(2);
		expect(result.items.size).toBe(1);
		expect(result.items.has('Valid2020')).toBe(true);
	});

	it('skips a file with invalid JSON but keeps loading the others', async () => {
		const result = await loadFolder(fixture('broken'));

		expect(result.files).toEqual(['ok.json']);
		expect(result.skippedFiles).toEqual(['x.json']);
		expect(result.items.size).toBe(1);
		expect(result.items.has('Ok2020')).toBe(true);
	});

	it('reports duplicate citekeys and lets the later file win', async () => {
		const result = await loadFolder(fixture('dup'));

		expect(result.files).toEqual(['a.json', 'b.json']);
		expect(result.duplicates).toEqual(['Dup2020']);
		expect(result.items.size).toBe(1);
		// b.json is read after a.json (plain sort), so it wins.
		expect(result.items.get('Dup2020')?.title).toBe('Title B');
	});

	it('returns an empty result for a directory with no json files', async () => {
		const result = await loadFolder(fixture('empty'));

		expect(result.files).toEqual([]);
		expect(result.skippedFiles).toEqual([]);
		expect(result.skippedItems).toBe(0);
		expect(result.duplicates).toEqual([]);
		expect(result.items.size).toBe(0);
	});

	it('rejects when the directory does not exist', async () => {
		await expect(loadFolder(fixture('does-not-exist'))).rejects.toThrow();
	});
});
