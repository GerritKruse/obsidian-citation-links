import { Notice, debounce } from 'obsidian';
import type { CslItem } from '../types';
import type { LibraryPreference, LibraryStatus } from './libraries';
import { loadFolder, type LoadResult } from './loader';
import { watchFolder, type FolderWatcher } from './watcher';

/** Numbers reported after a successful load, used for the reload command's notice. */
export interface LoadSummary {
	files: number;
	items: number;
	duplicates: number;
	skippedFiles: number;
}

export type BibliographyListener = (bibliography: Bibliography) => void;

/** Delays between parse retries. Better BibTeX rewrites export files in place, so a read may catch a half-written file. */
const RETRY_DELAYS_MS = [300, 600, 1200];

/** Debounce for file system events before a reload starts. */
const WATCH_DEBOUNCE_MS = 500;

const LOG_PREFIX = '[citation-links]';

/**
 * The in-memory bibliography: all CSL-JSON files of the configured folder,
 * merged and indexed by citekey. Never persisted. Keeps the last successfully
 * loaded data when a reload fails.
 */
export class Bibliography {
	/** Incremented on every successful load; editors use it to detect stale decorations. */
	version = 0;

	private items = new Map<string, CslItem>();
	private sources = new Map<string, string>();
	private libraryStatus: LibraryStatus[] = [];
	private preferences: readonly LibraryPreference[] = [];
	/** Incremented per setFolder/reload so a slower, superseded load cannot overwrite a newer one. */
	private loadToken = 0;
	private folder = '';
	private watcher: FolderWatcher | null = null;
	private listeners = new Set<BibliographyListener>();
	private loadedOnce = false;
	private disposed = false;
	/** A scheduled parse retry; cancelling it settles its waiting caller with null. */
	private pendingRetry: { timer: number; settle: (summary: LoadSummary | null) => void } | null = null;
	private lastDuplicateHash = '';
	private lastSkippedHash = '';
	private folderMissingNotified = false;

	private readonly scheduleReload = debounce(
		() => {
			void this.reload();
		},
		WATCH_DEBOUNCE_MS,
		true,
	);

	/** True once a load has succeeded at least once. Nothing is rendered before that. */
	get ready(): boolean {
		return this.loadedOnce;
	}

	get size(): number {
		return this.items.size;
	}

	get(citekey: string): CslItem | undefined {
		return this.items.get(citekey);
	}

	has(citekey: string): boolean {
		return this.items.has(citekey);
	}

	/** The current index. Callers must not mutate it. */
	all(): Map<string, CslItem> {
		return this.items;
	}

	/** The file the winning item for `citekey` was read from. */
	sourceOf(citekey: string): string | undefined {
		return this.sources.get(citekey);
	}

	/** Every library from the last successful load, highest priority first. Callers must not mutate it. */
	get libraries(): readonly LibraryStatus[] {
		return this.libraryStatus;
	}

	/** Set the library priority list used by the next load. Does not reload by itself. */
	setLibraryPreferences(preferences: readonly LibraryPreference[]): void {
		this.preferences = preferences.map((entry) => ({ ...entry }));
	}

	onChanged(listener: BibliographyListener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/**
	 * Citekey prefix matches first, then substring matches on citekey, author
	 * family names and title. An empty query returns the first `limit` items.
	 */
	search(query: string, limit = 20): CslItem[] {
		const needle = query.trim().toLowerCase();
		const prefix: CslItem[] = [];
		const rest: CslItem[] = [];
		for (const [citekey, item] of this.items) {
			const key = citekey.toLowerCase();
			if (needle === '' || key.startsWith(needle)) {
				prefix.push(item);
				if (needle === '' && prefix.length >= limit) {
					break;
				}
				continue;
			}
			if (key.includes(needle) || matchesAuthor(item, needle) || matchesTitle(item, needle)) {
				rest.push(item);
			}
		}
		return prefix.concat(rest).slice(0, limit);
	}

	/**
	 * Switch to a new folder: stop watching the old one, load the new one and
	 * start watching it. An empty folder clears the index.
	 */
	async setFolder(folder: string): Promise<LoadSummary | null> {
		this.stopWatching();
		this.cancelRetry();
		this.folder = folder.trim();
		this.folderMissingNotified = false;
		if (this.folder === '') {
			this.loadToken += 1;
			this.items = new Map();
			this.sources = new Map();
			this.libraryStatus = [];
			this.loadedOnce = false;
			this.version += 1;
			this.notify();
			return null;
		}
		const summary = await this.load(0, ++this.loadToken);
		if (summary !== null) {
			this.startWatching();
		}
		return summary;
	}

	/** Reload all files of the current folder. Safe to call at any time. */
	async reload(): Promise<LoadSummary | null> {
		this.cancelRetry();
		const summary = await this.load(0, ++this.loadToken);
		if (summary !== null && this.watcher === null) {
			this.startWatching();
		}
		return summary;
	}

	dispose(): void {
		this.disposed = true;
		this.stopWatching();
		this.cancelRetry();
		this.listeners.clear();
	}

	private async load(attempt: number, token: number): Promise<LoadSummary | null> {
		if (this.disposed || this.folder === '' || token !== this.loadToken) {
			return null;
		}
		let result: LoadResult;
		try {
			result = await loadFolder(this.folder, this.preferences);
		} catch (error) {
			if (token !== this.loadToken) {
				return null;
			}
			console.warn(`${LOG_PREFIX} Could not read the bibliography folder "${this.folder}"`, error);
			if (!this.folderMissingNotified) {
				this.folderMissingNotified = true;
				new Notice(`Citation Links: cannot read the bibliography folder "${this.folder}"`);
			}
			return null;
		}
		if (this.disposed || token !== this.loadToken) {
			return null;
		}
		if (result.skippedFiles.length > 0 && attempt < RETRY_DELAYS_MS.length) {
			const delay = RETRY_DELAYS_MS[attempt] ?? 0;
			console.warn(
				`${LOG_PREFIX} ${result.skippedFiles.length} file(s) could not be parsed, retrying in ${delay} ms`,
				result.skippedFiles,
			);
			return new Promise((resolve) => {
				const timer = window.setTimeout(() => {
					this.pendingRetry = null;
					void this.load(attempt + 1, token).then(resolve);
				}, delay);
				this.pendingRetry = { timer, settle: resolve };
			});
		}
		return this.apply(result);
	}

	private apply(result: LoadResult): LoadSummary {
		this.items = result.items;
		this.sources = result.sources;
		this.libraryStatus = result.libraries;
		this.loadedOnce = true;
		this.version += 1;

		const duplicateHash = result.duplicates.slice().sort().join('|');
		if (result.duplicates.length > 0 && duplicateHash !== this.lastDuplicateHash) {
			const shown = result.duplicates.slice(0, 5).join(', ');
			const more = result.duplicates.length > 5 ? ', ...' : '';
			new Notice(
				`Citation Links: ${result.duplicates.length} citekey(s) occur more than once, the topmost library in the settings wins: ${shown}${more}`,
			);
		}
		this.lastDuplicateHash = duplicateHash;

		const skippedHash = result.skippedFiles.slice().sort().join('|');
		if (result.skippedFiles.length > 0 && skippedHash !== this.lastSkippedHash) {
			new Notice(`Citation Links: could not parse ${result.skippedFiles.join(', ')}`);
		}
		this.lastSkippedHash = skippedHash;

		this.notify();
		return {
			files: result.files.length,
			items: result.items.size,
			duplicates: result.duplicates.length,
			skippedFiles: result.skippedFiles.length,
		};
	}

	private notify(): void {
		for (const listener of this.listeners) {
			try {
				listener(this);
			} catch (error) {
				console.error(`${LOG_PREFIX} Bibliography listener failed`, error);
			}
		}
	}

	private startWatching(): void {
		if (this.watcher !== null || this.folder === '' || this.disposed) {
			return;
		}
		this.watcher = watchFolder(
			this.folder,
			() => this.scheduleReload(),
			(error) => console.warn(`${LOG_PREFIX} Watching "${this.folder}" failed`, error),
		);
	}

	private stopWatching(): void {
		this.watcher?.dispose();
		this.watcher = null;
	}

	private cancelRetry(): void {
		if (this.pendingRetry !== null) {
			window.clearTimeout(this.pendingRetry.timer);
			this.pendingRetry.settle(null);
			this.pendingRetry = null;
		}
	}
}

function matchesAuthor(item: CslItem, needle: string): boolean {
	const names = item.author ?? item.editor ?? [];
	return names.some((name) => (name.family ?? name.literal ?? '').toLowerCase().includes(needle));
}

function matchesTitle(item: CslItem, needle: string): boolean {
	return (item.title ?? '').toLowerCase().includes(needle);
}
