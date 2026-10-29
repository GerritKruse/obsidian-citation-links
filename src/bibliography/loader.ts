import { fs, path } from '../platform/node';
import type { CslItem } from '../types';

/** UTF-8 byte order mark, in case an export tool prepends one. */
const BOM = '﻿';

/** One `.json` file of the folder after reading and parsing it. */
export interface ParsedFile {
	/** File name within the folder. */
	name: string;
	/** Items keyed by citekey (within one file the last item wins), or null when the file could not be read or parsed or is not an array. */
	items: Map<string, CslItem> | null;
	/** Citekeys that occur more than once inside this file, unique, in the order their second occurrence appears. */
	sameFileDuplicates: string[];
}

/** The raw outcome of reading a folder, before the files are ranked and merged. */
export interface ReadResult {
	/** Every .json file (case-insensitive extension) of the folder, plain-sorted by name. */
	files: ParsedFile[];
	/** Items skipped because they had no usable string key, summed over all files. */
	skippedItems: number;
}

/** What one file contributed to the merged bibliography, for the settings list. */
export interface FileRank {
	name: string;
	/** Distinct citekeys in this file (0 when skipped). */
	items: number;
	/** Citekeys of this file whose entry is not used because a higher-ranked file has them too. */
	overridden: string[];
	/** Same as ParsedFile.sameFileDuplicates (unique, in the order their second occurrence appears). */
	sameFileDuplicates: string[];
	/** True when the file could not be read or parsed. */
	skipped: boolean;
}

export interface LoadResult {
	/** All items keyed by citekey; the higher-ranked file wins on duplicates. */
	items: Map<string, CslItem>;
	/** Successfully parsed file names, in rank order. */
	files: string[];
	/** File names skipped because of a read/parse error or non-array JSON, in rank order. */
	skippedFiles: string[];
	/** Number of items skipped because they had no usable string key. */
	skippedItems: number;
	/** Citekeys that occurred more than once (across files or inside one file), unique, first seen in rank order. */
	duplicates: string[];
	/** Every .json file, highest priority first, including skipped ones (they keep their place). */
	ranking: FileRank[];
}

/**
 * Orders file names by priority: the names from `priority` that exist in
 * `fileNames`, in the order they are listed there (deduplicated, exact and
 * case-sensitive match), then all remaining file names plain-sorted
 * (`Array.prototype.sort()`, so a file that is new to the saved order lands at
 * the bottom, and without any saved order the file that comes first in plain
 * sort order leads).
 * Names in `priority` that are not in `fileNames` are ignored. Never mutates
 * its inputs.
 */
export function rankFiles(fileNames: readonly string[], priority: readonly string[]): string[] {
	const available = new Set(fileNames);
	const placed = new Set<string>();
	const ranked: string[] = [];
	for (const name of priority) {
		if (available.has(name) && !placed.has(name)) {
			placed.add(name);
			ranked.push(name);
		}
	}
	const rest = fileNames.filter((name) => !placed.has(name)).sort();
	return ranked.concat(rest);
}

/**
 * Returns a copy of `list` with the element at index `from` moved to index
 * `to`. When either index is not an integer within range, the copy is returned
 * unchanged. Never mutates `list`.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
	const copy = list.slice();
	const inRange = (index: number): boolean => Number.isInteger(index) && index >= 0 && index < copy.length;
	if (!inRange(from) || !inRange(to)) {
		return copy;
	}
	copy.splice(to, 0, ...copy.splice(from, 1));
	return copy;
}

/**
 * The saved order after the files in the folder were reordered to
 * `visibleOrder`: the names in `saved` that are not in `visibleOrder` (files
 * that are absent right now) keep their place behind the visible file they
 * followed in `saved`, or stay in front when no visible file preceded them. So
 * an absent file that comes back later gets its old rank again, instead of
 * being treated as new and sent to the bottom. Repeated names in `saved` count
 * once. Never mutates its inputs.
 */
export function keepAbsent(saved: readonly string[], visibleOrder: readonly string[]): string[] {
	const visible = new Set(visibleOrder);
	const behind = new Map<string | null, string[]>();
	let anchor: string | null = null;
	for (const name of new Set(saved)) {
		if (visible.has(name)) {
			anchor = name;
			continue;
		}
		const list = behind.get(anchor) ?? [];
		list.push(name);
		behind.set(anchor, list);
	}
	return [...(behind.get(null) ?? []), ...visibleOrder.flatMap((name) => [name, ...(behind.get(name) ?? [])])];
}

/**
 * Reads and parses every `.json` file in `dir` as a CSL-JSON bibliography,
 * without merging them: each file keeps its own items, so the result can be
 * re-ranked without touching the disk again.
 *
 * Files come back in a deterministic order (plain `Array.prototype.sort()` on
 * the file name). Several items inside one file that share a citekey collapse
 * to the item that comes last in that file and are listed in
 * `sameFileDuplicates`. A file that cannot be read or parsed, or whose JSON is
 * not an array, is still listed, with `items: null`.
 *
 * Throws if `dir` cannot be read (e.g. it does not exist); the caller is
 * expected to handle that.
 */
export async function readFolder(dir: string): Promise<ReadResult> {
	const entries = await fs.promises.readdir(dir, { withFileTypes: true });
	const fileNames = entries
		.filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
		.map((entry) => entry.name)
		.sort();

	const files: ParsedFile[] = [];
	let skippedItems = 0;

	for (const fileName of fileNames) {
		const filePath = path.join(dir, fileName);

		let raw: string;
		try {
			raw = await fs.promises.readFile(filePath, 'utf8');
		} catch (error) {
			files.push({ name: fileName, items: null, sameFileDuplicates: [] });
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
			files.push({ name: fileName, items: null, sameFileDuplicates: [] });
			console.warn(`[citation-links] could not parse bibliography file "${fileName}":`, error);
			continue;
		}

		if (!Array.isArray(parsed)) {
			files.push({ name: fileName, items: null, sameFileDuplicates: [] });
			console.warn(`[citation-links] expected an array of items in "${fileName}", got ${typeof parsed}`);
			continue;
		}

		const items = new Map<string, CslItem>();
		const sameFileDuplicates: string[] = [];
		const seenDuplicates = new Set<string>();

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
				sameFileDuplicates.push(key);
				seenDuplicates.add(key);
			}

			items.set(key, { ...rawItem, id: key });
		}

		files.push({ name: fileName, items, sameFileDuplicates });
	}

	return { files, skippedItems };
}

/**
 * Merges the files of a `ReadResult` into one bibliography, walking them in
 * the order `rankFiles` gives (all file names, skipped ones included, so a
 * skipped file keeps its place). When several files share a citekey, the item
 * of the highest-ranked file wins; the lower-ranked files list that citekey in
 * `overridden`, and it is reported in `duplicates`, as are citekeys that occur
 * more than once inside a single file.
 *
 * Pure: does not touch the disk and reuses the item objects of the
 * `ParsedFile`s by identity (no cloning), so a caller can tell whether the
 * winner of a citekey changed by comparing references.
 */
export function mergeFiles(read: ReadResult, priority: readonly string[]): LoadResult {
	const byName = new Map<string, ParsedFile>();
	for (const file of read.files) {
		byName.set(file.name, file);
	}

	const items = new Map<string, CslItem>();
	const files: string[] = [];
	const skippedFiles: string[] = [];
	const duplicates: string[] = [];
	const seenDuplicates = new Set<string>();
	const ranking: FileRank[] = [];

	const addDuplicate = (key: string): void => {
		if (!seenDuplicates.has(key)) {
			seenDuplicates.add(key);
			duplicates.push(key);
		}
	};

	for (const name of rankFiles(
		read.files.map((file) => file.name),
		priority,
	)) {
		const file = byName.get(name);
		if (file === undefined) {
			continue;
		}

		if (file.items === null) {
			skippedFiles.push(name);
			ranking.push({ name, items: 0, overridden: [], sameFileDuplicates: [], skipped: true });
			continue;
		}

		const sameFile = new Set(file.sameFileDuplicates);
		const overridden: string[] = [];
		for (const [key, item] of file.items) {
			if (sameFile.has(key)) {
				addDuplicate(key);
			}
			if (items.has(key)) {
				overridden.push(key);
				addDuplicate(key);
			} else {
				items.set(key, item);
			}
		}

		files.push(name);
		ranking.push({
			name,
			items: file.items.size,
			overridden,
			sameFileDuplicates: [...file.sameFileDuplicates],
			skipped: false,
		});
	}

	return { items, files, skippedFiles, skippedItems: read.skippedItems, duplicates, ranking };
}

/**
 * Loads every `.json` file in `dir` as a CSL-JSON bibliography and merges
 * the items into a single map, keyed by citekey: `readFolder` followed by
 * `mergeFiles`.
 *
 * `priority` lists file names, highest priority first; when several files
 * share a citekey, the item of the higher-ranked file wins. Files missing from
 * `priority` follow plain-sorted, so by default the file that comes first in
 * plain sort order wins. Several items within the same file that share a
 * citekey collapse to the last one in that file. All affected citekeys are
 * reported in `duplicates`.
 *
 * Throws if `dir` cannot be read (e.g. it does not exist); the caller is
 * expected to handle that.
 */
export async function loadFolder(dir: string, priority: readonly string[] = []): Promise<LoadResult> {
	return mergeFiles(await readFolder(dir), priority);
}
