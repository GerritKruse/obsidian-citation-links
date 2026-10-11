/**
 * Library priority: every CSL JSON file in the bibliography folder is one
 * library. The user orders them and switches them on or off in the settings;
 * when a citekey occurs in more than one file, the topmost enabled file wins.
 *
 * Pure module (no Obsidian or Node imports) so it can be unit-tested.
 */

/** One entry of the stored priority list, highest priority first. */
export interface LibraryPreference {
	/** File name inside the bibliography folder, e.g. "My Library.json". */
	file: string;
	/** Disabled files are not read at all. */
	enabled: boolean;
}

/** What the last load found out about a library, in priority order. */
export interface LibraryStatus extends LibraryPreference {
	/** False when the file is in the stored list but no longer in the folder. */
	present: boolean;
	/** Number of items read from the file; null when it was disabled, missing or unreadable. */
	items: number | null;
}

/**
 * Merges the stored priority list with the files currently in the folder.
 *
 * Stored entries keep their order and their enabled flag, including entries
 * whose file is gone (so a file that comes back gets its old place).
 * Files not in the stored list are appended, enabled, with the lowest
 * priority, so a new export never silently takes over existing citations.
 * New files are appended in reverse plain-sort order: with an empty stored
 * list this reproduces the winners of the old rule "the file read last, in
 * plain sort order, wins", so upgrading does not change any citation.
 */
export function mergeLibraries(stored: readonly LibraryPreference[], discovered: readonly string[]): LibraryPreference[] {
	const merged: LibraryPreference[] = [];
	const known = new Set<string>();
	for (const entry of stored) {
		if (known.has(entry.file)) {
			continue;
		}
		known.add(entry.file);
		merged.push({ file: entry.file, enabled: entry.enabled });
	}
	const added = discovered
		.filter((file) => !known.has(file))
		.slice()
		.sort()
		.reverse();
	for (const file of added) {
		known.add(file);
		merged.push({ file, enabled: true });
	}
	return merged;
}

/** Reads the stored list from data.json, dropping anything malformed. */
export function parseLibraryPreferences(value: unknown): LibraryPreference[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const result: LibraryPreference[] = [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'object' || entry === null) {
			continue;
		}
		const record = entry as Record<string, unknown>;
		const file = record.file;
		if (typeof file !== 'string' || file === '' || seen.has(file)) {
			continue;
		}
		seen.add(file);
		result.push({ file, enabled: record.enabled !== false });
	}
	return result;
}

/** True when both lists hold the same files in the same order with the same flags. */
export function samePreferences(a: readonly LibraryPreference[], b: readonly LibraryPreference[]): boolean {
	return a.length === b.length && a.every((entry, index) => entry.file === b[index]?.file && entry.enabled === b[index]?.enabled);
}

/**
 * Moves the entry at `from` to `to`, where both indices count only the files
 * that are present in the folder (the ones the settings list shows). Entries
 * for missing files keep their relative order and end up after the present ones.
 */
export function reorderPresent(
	preferences: readonly LibraryPreference[],
	present: ReadonlySet<string>,
	from: number,
	to: number,
): LibraryPreference[] {
	const visible = preferences.filter((entry) => present.has(entry.file));
	const hidden = preferences.filter((entry) => !present.has(entry.file));
	const [moved] = visible.splice(from, 1);
	if (moved === undefined) {
		return preferences.slice();
	}
	visible.splice(Math.max(0, Math.min(to, visible.length)), 0, moved);
	return visible.concat(hidden);
}

/** The display name of a library: its file name without the ".json" extension. */
export function libraryLabel(file: string): string {
	return file.replace(/\.json$/i, '');
}
