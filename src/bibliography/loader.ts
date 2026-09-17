import { fs, path } from '../platform/node';
import type { CslItem } from '../types';

/** UTF-8 byte order mark, in case an export tool prepends one. */
const BOM = '﻿';

export interface LoadResult {
	/** All items keyed by citekey, last-file-wins on duplicates. */
	items: Map<string, CslItem>;
	/** File names that were read and parsed successfully, sorted. */
	files: string[];
	/** File names skipped because of a read/parse error or non-array JSON. */
	skippedFiles: string[];
	/** Number of items skipped because they had no usable string key. */
	skippedItems: number;
	/** Citekeys that occurred more than once, unique, in first-seen order. */
	duplicates: string[];
}

/**
 * Loads every `.json` file in `dir` as a CSL-JSON bibliography and merges
 * the items into a single map, keyed by citekey.
 *
 * Files are read in a deterministic order (plain `Array.prototype.sort()`
 * on the file name). When several files - or several items within the same
 * file - share a citekey, the item read last wins; all affected citekeys are
 * reported in `duplicates`.
 *
 * Throws if `dir` cannot be read (e.g. it does not exist); the caller is
 * expected to handle that.
 */
export async function loadFolder(dir: string): Promise<LoadResult> {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const fileNames = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
		.map((entry) => entry.name)
		.sort();

	const items = new Map<string, CslItem>();
	const files: string[] = [];
	const skippedFiles: string[] = [];
	const duplicates: string[] = [];
	const seenDuplicates = new Set<string>();
	let skippedItems = 0;

	for (const fileName of fileNames) {
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
		}

		files.push(fileName);
	}

	return { items, files, skippedFiles, skippedItems, duplicates };
}
