import { fs, path } from '../platform/node';
import type { CslItem } from '../types';
import { mergeLibraries, type LibraryPreference, type LibraryStatus } from './libraries';

/** UTF-8 byte order mark, in case an export tool prepends one. */
const BOM = '\uFEFF';

export interface LoadResult {
	/** All items keyed by citekey; on duplicates the item from the highest-priority file wins. */
	items: Map<string, CslItem>;
	/** For every citekey in `items`, the file its item was read from. */
	sources: Map<string, string>;
	/** File names that were read and parsed successfully, sorted. */
	files: string[];
	/** File names skipped because of a read/parse error or non-array JSON. */
	skippedFiles: string[];
	/** Number of items skipped because they had no usable string key. */
	skippedItems: number;
	/** Citekeys that occurred more than once in the enabled files, unique. */
	duplicates: string[];
	/** Every library (stored or found in the folder), highest priority first. */
	libraries: LibraryStatus[];
}

/**
 * Loads the `.json` files in `dir` as CSL-JSON bibliographies and merges the
 * items into a single map, keyed by citekey.
 *
 * `preferences` is the user's library priority list (highest priority
 * first, see `mergeLibraries`). Disabled files are not read. When several
 * files share a citekey, the item from the file highest in the list wins;
 * when one file holds a citekey twice, its later item wins. All affected
 * citekeys are reported in `duplicates`.
 *
 * Throws if `dir` cannot be read (e.g. it does not exist); the caller is
 * expected to handle that.
 */
export async function loadFolder(dir: string, preferences: readonly LibraryPreference[] = []): Promise<LoadResult> {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const fileNames = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
		.map((entry) => entry.name);
	const present = new Set(fileNames);
	const order = mergeLibraries(preferences, fileNames);
	const counts = new Map<string, number>();

	const items = new Map<string, CslItem>();
	const sources = new Map<string, string>();
	const files: string[] = [];
	const skippedFiles: string[] = [];
	const duplicates: string[] = [];
	const seenDuplicates = new Set<string>();
	let skippedItems = 0;

	// Read from the lowest to the highest priority so that a later write - the
	// higher-priority file - replaces an earlier one, while within one file the
	// later item still wins as before.
	const readOrder = order.filter((entry) => entry.enabled && present.has(entry.file)).reverse();
	for (const { file: fileName } of readOrder) {
		const filePath = path.join(dir, fileName);

		let raw: string;
		try {
			raw = await fs.promises.readFile(filePath, 'utf8');
		} catch (error) {
			skippedFiles.push(fileName);
			console.warn(`[citation-links] could not read bibliography file "${fileName}":`, error);
			continue;
		}

		if (raw.startsWith(BOM)) {
			raw = raw.slice(BOM.length);
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			skippedFiles.push(fileName);
			console.warn(`[citation-links] could not parse bibliography file "${fileName}":`, error);
			continue;
		}

		if (!Array.isArray(parsed)) {
			skippedFiles.push(fileName);
			console.warn(`[citation-links] expected an array of items in "${fileName}", got ${typeof parsed}`);
			continue;
		}

		let count = 0;
		for (const element of parsed) {
			if (typeof element !== 'object' || element === null) {
				skippedItems++;
				continue;
			}

			const rawItem = element as Record<string, unknown>;
			const key = rawItem['citation-key'] ?? rawItem.id;
			if (typeof key !== 'string' || key.trim().length === 0) {
				skippedItems++;
				continue;
			}

			if (items.has(key) && !seenDuplicates.has(key)) {
				duplicates.push(key);
				seenDuplicates.add(key);
			}

			items.set(key, { ...rawItem, id: key });
			sources.set(key, fileName);
			count++;
		}

		files.push(fileName);
		counts.set(fileName, count);
	}

	files.sort();
	const libraries: LibraryStatus[] = order.map((entry) => ({
		...entry,
		present: present.has(entry.file),
		items: counts.get(entry.file) ?? null,
	}));
	return { items, sources, files, skippedFiles, skippedItems, duplicates, libraries };
}
