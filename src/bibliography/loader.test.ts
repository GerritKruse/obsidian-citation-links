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

	describe('library priority', () => {
		const shared = async (preferences: { file: string; enabled: boolean }[] = []) => {
			const result = await loadFolder(fixture('priority'), preferences);
			return { result, winner: result.items.get('Shared2020')?.title, source: result.sources.get('Shared2020') };
		};

		it('without a stored order, keeps the old winner (last file in plain sort order)', async () => {
			const { result, winner, source } = await shared();
			// Plain sort: "LAVA.json" < "My Library.json" < "ctrl.json"; ctrl.json used to be read last.
			expect(result.libraries.map((library) => library.file)).toEqual(['ctrl.json', 'My Library.json', 'LAVA.json']);
			expect(winner).toBe('Ctrl');
			expect(source).toBe('ctrl.json');
			expect(result.files).toEqual(['LAVA.json', 'My Library.json', 'ctrl.json']);
		});

		it('lets the topmost enabled library win and records where each item came from', async () => {
			const { result, winner, source } = await shared([
				{ file: 'LAVA.json', enabled: true },
				{ file: 'My Library.json', enabled: true },
				{ file: 'ctrl.json', enabled: true },
			]);
			expect(winner).toBe('Lava');
			expect(source).toBe('LAVA.json');
			expect(result.sources.get('Personal2020')).toBe('My Library.json');
			expect([...result.duplicates].sort()).toEqual(['Inner2020', 'Shared2020']);
		});

		it('does not read a disabled library at all', async () => {
			const { result, winner } = await shared([
				{ file: 'LAVA.json', enabled: false },
				{ file: 'My Library.json', enabled: true },
				{ file: 'ctrl.json', enabled: true },
			]);
			expect(winner).toBe('Mine');
			expect(result.items.has('Lava2021')).toBe(false);
			expect(result.files).toEqual(['My Library.json', 'ctrl.json']);
			expect(result.libraries[0]).toEqual({ file: 'LAVA.json', enabled: false, present: true, items: null });
		});

		it('appends files missing from the stored list with the lowest priority', async () => {
			const { result, winner } = await shared([
				{ file: 'My Library.json', enabled: true },
				{ file: 'LAVA.json', enabled: true },
			]);
			expect(result.libraries.map((library) => library.file)).toEqual(['My Library.json', 'LAVA.json', 'ctrl.json']);
			expect(winner).toBe('Mine');
		});

		it('keeps stored entries for files that are gone, marked as not present', async () => {
			const { result } = await shared([
				{ file: 'Gone.json', enabled: true },
				{ file: 'LAVA.json', enabled: true },
			]);
			expect(result.libraries[0]).toEqual({ file: 'Gone.json', enabled: true, present: false, items: null });
			expect(result.libraries.find((library) => library.file === 'LAVA.json')?.items).toBe(2);
		});

		it('still lets the later item win when one file holds a citekey twice', async () => {
			const { result } = await shared([{ file: 'ctrl.json', enabled: true }]);
			expect(result.items.get('Inner2020')?.title).toBe('Second');
			expect(result.libraries[0]).toEqual({ file: 'ctrl.json', enabled: true, present: true, items: 3 });
		});
	});

	it('returns an empty result for a directory with no json files', async () => {
		const result = await loadFolder(fixture('empty'));

		expect(result.files).toEqual([]);
		expect(result.skippedFiles).toEqual([]);
		expect(result.skippedItems).toBe(0);
		expect(result.duplicates).toEqual([]);
		expect(result.items.size).toBe(0);
		expect(result.libraries).toEqual([]);
	});

	it('rejects when the directory does not exist', async () => {
		await expect(loadFolder(fixture('does-not-exist'))).rejects.toThrow();
	});
});
