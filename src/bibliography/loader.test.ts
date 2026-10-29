import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CslItem } from '../types';
import { keepAbsent, loadFolder, mergeFiles, moveItem, rankFiles, type ParsedFile, type ReadResult } from './loader';

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

		expect(result.ranking.map((rank) => rank.name)).toEqual(['UPPER.JSON', 'a.json']);
		expect(result.ranking.map((rank) => rank.items)).toEqual([1, 2]);
		expect(result.ranking.map((rank) => rank.overridden)).toEqual([[], []]);
		expect(result.ranking.map((rank) => rank.skipped)).toEqual([false, false]);
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

	it('reports duplicate citekeys across files and lets the first file in plain sort order win by default', async () => {
		const result = await loadFolder(fixture('dup'));

		expect(result.files).toEqual(['a.json', 'b.json']);
		expect(result.duplicates).toEqual(['Dup2020']);
		expect(result.items.size).toBe(1);
		// Without a saved order the ranking is the plain sort, so a.json leads and wins.
		expect(result.items.get('Dup2020')?.title).toBe('Title A');
		expect(result.ranking[0]?.overridden).toEqual([]);
		expect(result.ranking[1]?.overridden).toEqual(['Dup2020']);
	});

	it('lets the higher-ranked file win when a priority is given', async () => {
		const result = await loadFolder(fixture('dup'), ['b.json']);

		expect(result.files).toEqual(['b.json', 'a.json']);
		expect(result.duplicates).toEqual(['Dup2020']);
		expect(result.items.get('Dup2020')?.title).toBe('Title B');
		expect(result.ranking.map((rank) => rank.name)).toEqual(['b.json', 'a.json']);
		expect(result.ranking[0]?.overridden).toEqual([]);
		expect(result.ranking[1]?.overridden).toEqual(['Dup2020']);
	});

	it('ignores names in the priority that are not in the folder', async () => {
		const result = await loadFolder(fixture('dup'), ['gone.json', 'b.json']);

		expect(result.files).toEqual(['b.json', 'a.json']);
		expect(result.items.get('Dup2020')?.title).toBe('Title B');
	});

	it('keeps a skipped file at its place in the ranking', async () => {
		const result = await loadFolder(fixture('broken'), ['x.json']);

		expect(result.ranking.map((rank) => rank.name)).toEqual(['x.json', 'ok.json']);
		expect(result.ranking[0]?.skipped).toBe(true);
		expect(result.ranking[0]?.items).toBe(0);
		expect(result.ranking[1]?.skipped).toBe(false);
		expect(result.ranking[1]?.items).toBe(1);
		expect(result.files).toEqual(['ok.json']);
		expect(result.skippedFiles).toEqual(['x.json']);
	});

	it('lets the last item win inside one file and reports it as a same-file duplicate', async () => {
		const result = await loadFolder(fixture('infile'));

		expect(result.files).toEqual(['x.json']);
		expect(result.items.size).toBe(2);
		expect(result.items.get('Same2020')?.title).toBe('Second title');
		expect(result.duplicates).toEqual(['Same2020']);
		expect(result.ranking).toHaveLength(1);
		expect(result.ranking[0]?.sameFileDuplicates).toEqual(['Same2020']);
		expect(result.ranking[0]?.overridden).toEqual([]);
		expect(result.ranking[0]?.items).toBe(2);
	});

	it('lists each in-file duplicate once, in first-seen order, however often it occurs', async () => {
		const result = await loadFolder(fixture('infile-multi'));

		expect(result.ranking[0]?.sameFileDuplicates).toEqual(['A2020', 'B2020']);
		expect(result.duplicates).toEqual(['A2020', 'B2020']);
		expect(result.items.get('A2020')?.title).toBe('A2');
		expect(result.items.get('B2020')?.title).toBe('B3');
	});

	it('strips a leading byte order mark before parsing', async () => {
		const raw = readFileSync(path.join(fixture('bom'), 'x.json'), 'utf8');
		expect(raw.charCodeAt(0)).toBe(0xfeff); // guards against an editor stripping the BOM from the fixture

		const result = await loadFolder(fixture('bom'));

		expect(result.files).toEqual(['x.json']);
		expect(result.skippedFiles).toEqual([]);
		expect(result.items.get('Bom2020')?.id).toBe('Bom2020');
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

describe('rankFiles', () => {
	it('plain-sorts all names when there is no priority', () => {
		expect(rankFiles(['b.json', 'a.json', 'B.json'], [])).toEqual(['B.json', 'a.json', 'b.json']);
	});

	it('puts the listed names first in the listed order, then the rest sorted', () => {
		expect(rankFiles(['a.json', 'b.json', 'c.json', 'd.json'], ['c.json', 'a.json'])).toEqual([
			'c.json',
			'a.json',
			'b.json',
			'd.json',
		]);
	});

	it('ignores names that are not among the files', () => {
		expect(rankFiles(['a.json', 'b.json'], ['gone.json', 'b.json'])).toEqual(['b.json', 'a.json']);
	});

	it('deduplicates repeated entries of the priority', () => {
		expect(rankFiles(['a.json', 'b.json', 'c.json'], ['b.json', 'b.json', 'c.json', 'b.json'])).toEqual([
			'b.json',
			'c.json',
			'a.json',
		]);
	});

	it('matches names case-sensitively', () => {
		expect(rankFiles(['a.json', 'b.json'], ['B.json'])).toEqual(['a.json', 'b.json']);
		expect(rankFiles(['a.json', 'A.json'], ['A.json'])).toEqual(['A.json', 'a.json']);
	});

	it('does not mutate its inputs', () => {
		const names = ['b.json', 'a.json'];
		const priority = ['b.json', 'x.json'];
		rankFiles(names, priority);
		expect(names).toEqual(['b.json', 'a.json']);
		expect(priority).toEqual(['b.json', 'x.json']);
	});
});

describe('moveItem', () => {
	it('moves an element forward', () => {
		expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
	});

	it('moves an element backward', () => {
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('returns an unchanged copy when both indices are equal', () => {
		const list = ['a', 'b', 'c'];
		const result = moveItem(list, 1, 1);
		expect(result).toEqual(['a', 'b', 'c']);
		expect(result).not.toBe(list);
	});

	it('returns an unchanged copy for out-of-range or non-integer indices', () => {
		const list = ['a', 'b', 'c'];
		for (const [from, to] of [
			[-1, 1],
			[1, -1],
			[3, 0],
			[0, 3],
			[0.5, 1],
			[1, 1.5],
			[Number.NaN, 1],
			[1, Number.POSITIVE_INFINITY],
		] as const) {
			const result = moveItem(list, from, to);
			expect(result).toEqual(['a', 'b', 'c']);
			expect(result).not.toBe(list);
		}
	});

	it('does not mutate its input', () => {
		const list = ['a', 'b', 'c'];
		moveItem(list, 0, 2);
		expect(list).toEqual(['a', 'b', 'c']);
	});
});

describe('keepAbsent', () => {
	it('keeps an absent top-ranked file on top when the visible files are reordered', () => {
		expect(keepAbsent(['LAVA', 'Ctrl', 'Meine'], ['Meine', 'Ctrl'])).toEqual(['LAVA', 'Meine', 'Ctrl']);
	});

	it('keeps an absent file in the middle directly behind its predecessor', () => {
		expect(keepAbsent(['A', 'X', 'B', 'C'], ['C', 'B', 'A'])).toEqual(['C', 'B', 'A', 'X']);
		expect(keepAbsent(['A', 'B', 'X', 'C'], ['C', 'A', 'B'])).toEqual(['C', 'A', 'B', 'X']);
	});

	it('keeps several absent files in their saved relative order', () => {
		expect(keepAbsent(['X', 'A', 'Y', 'Z', 'B'], ['B', 'A'])).toEqual(['X', 'B', 'A', 'Y', 'Z']);
	});

	it('places a visible file that is not in the saved order where the reorder put it', () => {
		expect(keepAbsent(['LAVA', 'Ctrl', 'Meine'], ['Ctrl', 'Neu', 'Meine'])).toEqual(['LAVA', 'Ctrl', 'Neu', 'Meine']);
		expect(keepAbsent(['LAVA', 'Ctrl', 'Meine'], ['Neu', 'Ctrl', 'Meine'])).toEqual(['LAVA', 'Neu', 'Ctrl', 'Meine']);
	});

	it('counts repeated names in the saved order once', () => {
		// Deduplicated, the saved order is X, A, B, Y: X leads, Y follows B.
		expect(keepAbsent(['X', 'A', 'X', 'B', 'A', 'Y', 'Y'], ['B', 'A'])).toEqual(['X', 'B', 'Y', 'A']);
	});

	it('returns the visible order when no saved name is absent, and a copy of the saved order when nothing is visible', () => {
		expect(keepAbsent(['A', 'B'], ['B', 'A'])).toEqual(['B', 'A']);
		expect(keepAbsent([], ['B', 'A'])).toEqual(['B', 'A']);
		expect(keepAbsent(['X', 'Y'], [])).toEqual(['X', 'Y']);
	});

	it('does not mutate its inputs', () => {
		const saved = ['X', 'A', 'B'];
		const visible = ['B', 'A'];
		const result = keepAbsent(saved, visible);
		expect(saved).toEqual(['X', 'A', 'B']);
		expect(visible).toEqual(['B', 'A']);
		expect(result).not.toBe(saved);
		expect(result).not.toBe(visible);
	});
});

describe('mergeFiles', () => {
	function item(id: string, title: string): CslItem {
		return { id, type: 'article-journal', title };
	}

	function file(name: string, items: CslItem[] | null, sameFileDuplicates: string[] = []): ParsedFile {
		return {
			name,
			items: items === null ? null : new Map(items.map((entry) => [entry.id, entry])),
			sameFileDuplicates,
		};
	}

	function read(files: ParsedFile[], skippedItems = 0): ReadResult {
		return { files, skippedItems };
	}

	it('lets the highest-ranked of three files win and lists the key as overridden in the others', () => {
		const a = item('K2020', 'From a');
		const b = item('K2020', 'From b');
		const c = item('K2020', 'From c');
		const result = mergeFiles(read([file('a.json', [a]), file('b.json', [b]), file('c.json', [c])]), [
			'c.json',
			'a.json',
			'b.json',
		]);

		// Reused by identity, not cloned.
		expect(result.items.get('K2020')).toBe(c);
		expect(result.files).toEqual(['c.json', 'a.json', 'b.json']);
		expect(result.duplicates).toEqual(['K2020']);
		expect(result.ranking.map((rank) => rank.name)).toEqual(['c.json', 'a.json', 'b.json']);
		expect(result.ranking.map((rank) => rank.overridden)).toEqual([[], ['K2020'], ['K2020']]);
		expect(result.ranking.map((rank) => rank.items)).toEqual([1, 1, 1]);
	});

	it('handles a key shared by only two files next to keys that are unique', () => {
		const sharedA = item('Shared2020', 'Shared in a');
		const sharedB = item('Shared2020', 'Shared in b');
		const onlyA = item('OnlyA2020', 'Only a');
		const onlyB = item('OnlyB2020', 'Only b');
		const result = mergeFiles(read([file('a.json', [sharedA, onlyA]), file('b.json', [sharedB, onlyB])]), []);

		expect(result.items.size).toBe(3);
		expect(result.items.get('Shared2020')).toBe(sharedA);
		expect(result.items.get('OnlyA2020')).toBe(onlyA);
		expect(result.items.get('OnlyB2020')).toBe(onlyB);
		expect(result.duplicates).toEqual(['Shared2020']);
		expect(result.ranking[0]?.overridden).toEqual([]);
		expect(result.ranking[1]?.overridden).toEqual(['Shared2020']);

		const flipped = mergeFiles(read([file('a.json', [sharedA, onlyA]), file('b.json', [sharedB, onlyB])]), ['b.json']);
		expect(flipped.items.get('Shared2020')).toBe(sharedB);
		expect(flipped.ranking[0]?.overridden).toEqual([]);
		expect(flipped.ranking[1]?.overridden).toEqual(['Shared2020']);
	});

	it('keeps a skipped file at its rank position and reports it in rank order', () => {
		const result = mergeFiles(
			read([file('a.json', [item('A2020', 'A')]), file('b.json', null), file('c.json', [item('C2020', 'C')])], 2),
			['b.json'],
		);

		expect(result.ranking.map((rank) => rank.name)).toEqual(['b.json', 'a.json', 'c.json']);
		expect(result.ranking[0]).toEqual({ name: 'b.json', items: 0, overridden: [], sameFileDuplicates: [], skipped: true });
		expect(result.files).toEqual(['a.json', 'c.json']);
		expect(result.skippedFiles).toEqual(['b.json']);
		expect(result.skippedItems).toBe(2);
		expect(result.items.size).toBe(2);
	});

	it('feeds same-file duplicates into duplicates and the ranking, once per key', () => {
		const result = mergeFiles(
			read([
				file('a.json', [item('Same2020', 'Last in a')], ['Same2020']),
				file('b.json', [item('Same2020', 'In b'), item('Other2020', 'Other')]),
			]),
			[],
		);

		expect(result.duplicates).toEqual(['Same2020']);
		expect(result.ranking[0]?.sameFileDuplicates).toEqual(['Same2020']);
		expect(result.ranking[0]?.overridden).toEqual([]);
		expect(result.ranking[1]?.sameFileDuplicates).toEqual([]);
		expect(result.ranking[1]?.overridden).toEqual(['Same2020']);
	});

	it('keeps a key overridden in a lower file that also has it twice', () => {
		const result = mergeFiles(
			read([
				file('a.json', [item('K2020', 'In a')]),
				file('b.json', [item('K2020', 'Last in b')], ['K2020']),
			]),
			[],
		);

		expect(result.duplicates).toEqual(['K2020']);
		expect(result.ranking[1]?.overridden).toEqual(['K2020']);
		expect(result.ranking[1]?.sameFileDuplicates).toEqual(['K2020']);
	});

	it('does not mutate the read result or the priority', () => {
		const a = file('a.json', [item('K2020', 'A')]);
		const b = file('b.json', [item('K2020', 'B')]);
		const input = read([a, b]);
		const priority = ['b.json'];
		mergeFiles(input, priority);

		expect(input.files).toEqual([a, b]);
		expect(a.items?.get('K2020')?.title).toBe('A');
		expect(priority).toEqual(['b.json']);
	});

	it('returns an empty result for an empty read', () => {
		const result = mergeFiles(read([]), ['a.json']);

		expect(result.items.size).toBe(0);
		expect(result.files).toEqual([]);
		expect(result.skippedFiles).toEqual([]);
		expect(result.duplicates).toEqual([]);
		expect(result.ranking).toEqual([]);
	});
});
