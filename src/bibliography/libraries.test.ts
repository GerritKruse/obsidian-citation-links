import { describe, expect, it } from 'vitest';
import { libraryLabel, mergeLibraries, parseLibraryPreferences, reorderPresent, samePreferences } from './libraries';

describe('mergeLibraries', () => {
	it('orders a fresh folder in reverse plain sort, so the old "last file wins" winners stay', () => {
		expect(mergeLibraries([], ['b.json', 'UPPER.json', 'a.json'])).toEqual([
			{ file: 'b.json', enabled: true },
			{ file: 'a.json', enabled: true },
			{ file: 'UPPER.json', enabled: true },
		]);
	});

	it('keeps the stored order and flags, including files that are gone', () => {
		const stored = [
			{ file: 'gone.json', enabled: true },
			{ file: 'a.json', enabled: false },
			{ file: 'b.json', enabled: true },
		];
		expect(mergeLibraries(stored, ['b.json', 'a.json'])).toEqual(stored);
	});

	it('appends new files with the lowest priority, enabled', () => {
		const stored = [{ file: 'b.json', enabled: true }];
		expect(mergeLibraries(stored, ['a.json', 'b.json', 'c.json'])).toEqual([
			{ file: 'b.json', enabled: true },
			{ file: 'c.json', enabled: true },
			{ file: 'a.json', enabled: true },
		]);
	});

	it('drops repeated stored entries, keeping the first', () => {
		const stored = [
			{ file: 'a.json', enabled: false },
			{ file: 'a.json', enabled: true },
		];
		expect(mergeLibraries(stored, ['a.json'])).toEqual([{ file: 'a.json', enabled: false }]);
	});

	it('does not mutate its input', () => {
		const stored = [{ file: 'a.json', enabled: true }];
		const merged = mergeLibraries(stored, ['a.json']);
		merged[0]!.enabled = false;
		expect(stored[0]!.enabled).toBe(true);
	});
});

describe('parseLibraryPreferences', () => {
	it('returns an empty list for anything that is not an array', () => {
		expect(parseLibraryPreferences(undefined)).toEqual([]);
		expect(parseLibraryPreferences({ file: 'a.json' })).toEqual([]);
	});

	it('keeps valid entries, defaults enabled to true and drops malformed or repeated ones', () => {
		expect(
			parseLibraryPreferences([
				{ file: 'a.json', enabled: false },
				{ file: 'b.json' },
				{ file: '', enabled: true },
				{ file: 3, enabled: true },
				null,
				'c.json',
				{ file: 'a.json', enabled: true },
			]),
		).toEqual([
			{ file: 'a.json', enabled: false },
			{ file: 'b.json', enabled: true },
		]);
	});
});

describe('reorderPresent', () => {
	const preferences = [
		{ file: 'a.json', enabled: true },
		{ file: 'gone.json', enabled: true },
		{ file: 'b.json', enabled: false },
		{ file: 'c.json', enabled: true },
	];
	const present = new Set(['a.json', 'b.json', 'c.json']);

	it('moves an entry by its index among the present files and keeps missing ones at the end', () => {
		expect(reorderPresent(preferences, present, 2, 0)).toEqual([
			{ file: 'c.json', enabled: true },
			{ file: 'a.json', enabled: true },
			{ file: 'b.json', enabled: false },
			{ file: 'gone.json', enabled: true },
		]);
	});

	it('clamps the target index and ignores an unknown source index', () => {
		expect(reorderPresent(preferences, present, 0, 99).map((entry) => entry.file)).toEqual([
			'b.json',
			'c.json',
			'a.json',
			'gone.json',
		]);
		expect(reorderPresent(preferences, present, 7, 0)).toEqual(preferences);
	});
});

describe('samePreferences', () => {
	it('compares files, order and flags', () => {
		const a = [{ file: 'a.json', enabled: true }];
		expect(samePreferences(a, [{ file: 'a.json', enabled: true }])).toBe(true);
		expect(samePreferences(a, [{ file: 'a.json', enabled: false }])).toBe(false);
		expect(samePreferences(a, [])).toBe(false);
	});
});

describe('libraryLabel', () => {
	it('strips the .json extension in any case', () => {
		expect(libraryLabel('My Library.json')).toBe('My Library');
		expect(libraryLabel('UPPER.JSON')).toBe('UPPER');
		expect(libraryLabel('notes')).toBe('notes');
	});
});
