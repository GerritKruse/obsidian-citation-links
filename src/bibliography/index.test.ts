import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LoadResult } from './loader';

vi.mock('obsidian', () => ({
	Notice: class {},
	debounce: (fn: () => void) => fn,
}));
vi.mock('./watcher', () => ({
	watchFolder: () => ({ dispose: () => undefined }),
}));
vi.mock('./loader', () => ({
	loadFolder: vi.fn(),
}));

const { loadFolder } = await import('./loader');
const { Bibliography } = await import('./index');
const mockedLoad = vi.mocked(loadFolder);

function result(items: number, skippedFiles: string[] = []): LoadResult {
	const map = new Map(Array.from({ length: items }, (_, i) => [`Key${i}`, { id: `Key${i}` }]));
	return {
		items: map,
		sources: new Map([...map.keys()].map((key) => [key, 'a.json'])),
		files: ['a.json'],
		skippedFiles,
		skippedItems: 0,
		duplicates: [],
		libraries: [{ file: 'a.json', enabled: true, present: true, items }],
	};
}

/** A loadFolder call that resolves only when the test says so. */
function deferred(): { promise: Promise<LoadResult>; resolve: (value: LoadResult) => void } {
	let resolve!: (value: LoadResult) => void;
	const promise = new Promise<LoadResult>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

afterEach(() => {
	mockedLoad.mockReset();
	vi.useRealTimers();
});

describe('Bibliography reloads', () => {
	it('gives a superseded reload the result of the newer one instead of null', async () => {
		const slow = deferred();
		mockedLoad.mockReturnValueOnce(Promise.resolve(result(1)));
		const bibliography = new Bibliography();
		await bibliography.setFolder('/bib');

		mockedLoad.mockReturnValueOnce(slow.promise).mockReturnValueOnce(Promise.resolve(result(6)));
		const first = bibliography.reload();
		const second = bibliography.reload();
		slow.resolve(result(3));

		expect(await second).toMatchObject({ items: 6 });
		expect(await first).toMatchObject({ items: 6 });
		expect(bibliography.size).toBe(6);
	});

	it('settles a reload whose parse retry is cancelled with the newer result', async () => {
		vi.useFakeTimers();
		mockedLoad.mockResolvedValueOnce(result(1));
		const bibliography = new Bibliography();
		await bibliography.setFolder('/bib');

		mockedLoad.mockResolvedValueOnce(result(0, ['a.json']));
		const first = bibliography.reload();
		// Let the first load finish and schedule its retry.
		await vi.advanceTimersByTimeAsync(0);
		mockedLoad.mockResolvedValueOnce(result(4));
		const second = bibliography.reload();

		expect(await second).toMatchObject({ items: 4 });
		expect(await first).toMatchObject({ items: 4 });
	});

	it('still reports a real failure as null', async () => {
		mockedLoad.mockResolvedValueOnce(result(1));
		const bibliography = new Bibliography();
		await bibliography.setFolder('/bib');

		mockedLoad.mockRejectedValueOnce(new Error('ENOENT'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
		expect(await bibliography.reload()).toBeNull();
		expect(bibliography.size).toBe(1);
		warn.mockRestore();
	});

	it('passes the library preferences to the loader and exposes sources and libraries', async () => {
		mockedLoad.mockResolvedValueOnce(result(2));
		const bibliography = new Bibliography();
		bibliography.setLibraryPreferences([{ file: 'a.json', enabled: true }]);
		await bibliography.setFolder('/bib');

		expect(mockedLoad).toHaveBeenLastCalledWith('/bib', [{ file: 'a.json', enabled: true }]);
		expect(bibliography.sourceOf('Key1')).toBe('a.json');
		expect(bibliography.libraries).toEqual([{ file: 'a.json', enabled: true, present: true, items: 2 }]);
	});
});
