import { afterEach, describe, expect, it, vi } from 'vitest';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ReadResult } from './loader';

// The empty `obsidian` stub has no Notice or debounce, and the watcher would
// open real file system handles, so both are replaced for these tests.
vi.mock('obsidian', () => ({
	Notice: class {},
	debounce: (cb: () => void) => Object.assign(cb, { cancel: () => undefined }),
}));
vi.mock('./watcher', () => ({
	watchFolder: () => ({ dispose: () => undefined }),
}));

const readFolderMock = vi.hoisted(() => ({ impl: null as null | (() => Promise<unknown>) }));
vi.mock('./loader', async (importOriginal) => {
	const actual = await importOriginal<typeof import('./loader')>();
	return {
		...actual,
		readFolder: (dir: string) => (readFolderMock.impl ? readFolderMock.impl() : actual.readFolder(dir)),
	};
});

import { Bibliography } from './index';

const here = fileURLToPath(new URL('.', import.meta.url));
const dup = path.join(here, '../../test/fixtures/loader/dup');
// Two files without a shared citekey: re-ranking them changes the list, never a winner.
const valid = path.join(here, '../../test/fixtures/loader/valid');

afterEach(() => {
	readFolderMock.impl = null;
});

describe('Bibliography.applyPriority', () => {
	it('is a no-op before the first load', () => {
		const bib = new Bibliography();
		const listener = vi.fn();
		bib.onChanged(listener);
		bib.applyPriority();
		expect(bib.version).toBe(0);
		expect(bib.ranking).toEqual([]);
		expect(listener).not.toHaveBeenCalled();
	});

	it('flips the winner, bumps version once and notifies once when the priority changes it', async () => {
		let order: string[] = [];
		const bib = new Bibliography(() => order);
		await bib.setFolder(dup);
		expect(bib.get('Dup2020')?.title).toBe('Title A');
		const listener = vi.fn();
		bib.onChanged(listener);
		const before = bib.version;

		order = ['b.json', 'a.json'];
		bib.applyPriority();

		expect(bib.get('Dup2020')?.title).toBe('Title B');
		expect(bib.version).toBe(before + 1);
		expect(listener).toHaveBeenCalledTimes(1);
		expect(bib.ranking.map((rank) => rank.name)).toEqual(['b.json', 'a.json']);
		bib.dispose();
	});

	it('refreshes the ranking without a bump or notification when no winner changes', async () => {
		let order: string[] = [];
		const bib = new Bibliography(() => order);
		await bib.setFolder(valid);
		expect(bib.ranking.map((rank) => rank.name)).toEqual(['UPPER.JSON', 'a.json']);
		const listener = vi.fn();
		bib.onChanged(listener);
		const before = bib.version;
		const items = bib.all();

		// Same winners (no shared citekey), but the list is ranked differently.
		order = ['a.json', 'UPPER.JSON'];
		bib.applyPriority();
		bib.applyPriority();

		expect(bib.version).toBe(before);
		expect(listener).not.toHaveBeenCalled();
		expect(bib.all()).toBe(items);
		expect(bib.ranking.map((rank) => rank.name)).toEqual(['a.json', 'UPPER.JSON']);
		bib.dispose();
	});

	it('keeps using the priority getter after reload()', async () => {
		let order = ['b.json'];
		const bib = new Bibliography(() => order);
		await bib.setFolder(dup);
		expect(bib.get('Dup2020')?.title).toBe('Title B');
		order = ['a.json'];
		await bib.reload();
		expect(bib.get('Dup2020')?.title).toBe('Title A');
		bib.dispose();
	});

	it('clears the ranking when the folder is cleared', async () => {
		const bib = new Bibliography();
		await bib.setFolder(dup);
		expect(bib.ranking).toHaveLength(2);
		await bib.setFolder('');
		expect(bib.ranking).toEqual([]);
		const before = bib.version;
		bib.applyPriority();
		expect(bib.version).toBe(before);
		bib.dispose();
	});
});

describe('Bibliography stale reads', () => {
	it('does not let an older read that finishes late roll the index back', async () => {
		const read = (title: string): ReadResult => ({
			files: [{ name: 'x.json', items: new Map([['K', { id: 'K', type: 'book', title }]]), sameFileDuplicates: [] }],
			skippedItems: 0,
		});
		const resolvers: Array<(value: ReadResult) => void> = [];
		readFolderMock.impl = () => new Promise<ReadResult>((resolve) => resolvers.push(resolve));

		const bib = new Bibliography();
		const first = bib.setFolder('/somewhere');
		await Promise.resolve();
		const second = bib.reload();
		await Promise.resolve();
		expect(resolvers).toHaveLength(2);

		resolvers[1]?.(read('new'));
		await second;
		resolvers[0]?.(read('old'));
		const firstSummary = await first;

		expect(bib.get('K')?.title).toBe('new');
		expect(firstSummary).not.toBeNull();
		bib.dispose();
	});
});
