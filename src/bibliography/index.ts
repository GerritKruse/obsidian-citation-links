import { Notice, debounce } from 'obsidian';
import type { CslItem } from '../types';
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
	private folder = '';
	private watcher: FolderWatcher | null = null;
	private listeners = new Set<BibliographyListener>();
	private loadedOnce = false;
	private disposed = false;
	private pendingRetry: number | null = null;
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
			this.items = new Map();
			this.loadedOnce = false;
			this.version += 1;
			this.notify();
			return null;
		}
		const summary = await this.load(0);
		if (summary !== null) {
			this.startWatching();
		}
		return summary;
	}

	/** Reload all files of the current folder. Safe to call at any time. */
	async reload(): Promise<LoadSummary | null> {
		this.cancelRetry();
		const summary = await this.load(0);
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

	private async load(attempt: number): Promise<LoadSummary | null> {
		if (this.disposed || this.folder === '') {
			return null;
		}
		let result: LoadResult;
		try {
			result = await loadFolder(this.folder);
		} catch (error) {
			console.warn(`${LOG_PREFIX} Could not read the bibliography folder "${this.folder}"`, error);
			if (!this.folderMissingNotified) {
				this.folderMissingNotified = true;
				new Notice(`Citation Links: cannot read the bibliography folder "${this.folder}"`);
			}
			return null;
		}
		if (this.disposed) {
			return null;
		}
		if (result.skippedFiles.length > 0 && attempt < RETRY_DELAYS_MS.length) {
			const delay = RETRY_DELAYS_MS[attempt] ?? 0;
			console.warn(
				`${LOG_PREFIX} ${result.skippedFiles.length} file(s) could not be parsed, retrying in ${delay} ms`,
				result.skippedFiles,
			);
			return new Promise((resolve) => {
				this.pendingRetry = window.setTimeout(() => {
					this.pendingRetry = null;
					void this.load(attempt + 1).then(resolve);
				}, delay);
			});
		}
		return this.apply(result);
	}

	private apply(result: LoadResult): LoadSummary {
		this.items = result.items;
		this.loadedOnce = true;
		this.version += 1;

		const duplicateHash = result.duplicates.slice().sort().join('|');
		if (result.duplicates.length > 0 && duplicateHash !== this.lastDuplicateHash) {
			const shown = result.duplicates.slice(0, 5).join(', ');
			const more = result.duplicates.length > 5 ? ', ...' : '';
			new Notice(`Citation Links: ${result.duplicates.length} duplicate citekey(s) across files: ${shown}${more}`);
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
			window.clearTimeout(this.pendingRetry);
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
