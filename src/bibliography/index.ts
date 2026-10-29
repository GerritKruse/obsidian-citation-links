import { Notice, debounce } from 'obsidian';
import type { CslItem } from '../types';
import { mergeFiles, readFolder, type FileRank, type ReadResult } from './loader';
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
 * merged and indexed by citekey. When several files share a citekey, the
 * entry of the higher-ranked file wins; the ranking comes from the priority
 * getter given to the constructor and is read at every merge. Never persisted.
 * Keeps the last successfully loaded data when a reload fails.
 */
export class Bibliography {
	/** Incremented whenever the index changes (a load, or a re-ranking that changed a winner); editors use it to detect stale decorations. */
	version = 0;

	private items = new Map<string, CslItem>();
	private currentRanking: readonly FileRank[] = [];
	/** The last successful read of the folder, kept so a new priority can be applied without touching the disk. */
	private lastRead: ReadResult | null = null;
	private lastSummary: LoadSummary | null = null;
	private readonly getPriority: () => readonly string[];
	private folder = '';
	private watcher: FolderWatcher | null = null;
	private listeners = new Set<BibliographyListener>();
	private loadedOnce = false;
	private disposed = false;
	private pendingRetry: number | null = null;
	/** Sequence number of the latest read that started, and of the latest one that was applied. */
	private readCounter = 0;
	private appliedRead = 0;
	private lastSameFileHash = '';
	private lastSkippedHash = '';
	private folderMissingNotified = false;

	private readonly scheduleReload = debounce(
		() => {
			void this.reload();
		},
		WATCH_DEBOUNCE_MS,
		true,
	);

	constructor(getPriority: () => readonly string[] = () => []) {
		this.getPriority = getPriority;
	}

	/** True once a load has succeeded at least once. Nothing is rendered before that. */
	get ready(): boolean {
		return this.loadedOnce;
	}

	get size(): number {
		return this.items.size;
	}

	/**
	 * Every `.json` file of the folder in rank order (highest priority first),
	 * with what each contributes. Empty until the first successful load and
	 * after the folder was cleared.
	 */
	get ranking(): readonly FileRank[] {
		return this.currentRanking;
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
			this.lastRead = null;
			this.currentRanking = [];
			this.lastSummary = null;
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

	/**
	 * Re-merge the files read last with the current priority, without touching
	 * the disk. Always refreshes `ranking`; the index is only replaced (and
	 * `version` bumped, listeners notified) when the winning item of some
	 * citekey changed. Does nothing before the first successful load.
	 */
	applyPriority(): void {
		if (this.lastRead === null) {
			return;
		}
		const result = mergeFiles(this.lastRead, this.getPriority());
		this.currentRanking = result.ranking;
		if (!sameWinners(this.items, result.items)) {
			this.items = result.items;
			this.version += 1;
			this.notify();
		}
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
		const folder = this.folder;
		const sequence = ++this.readCounter;
		let read: ReadResult;
		try {
			read = await readFolder(folder);
		} catch (error) {
			console.warn(`${LOG_PREFIX} Could not read the bibliography folder "${folder}"`, error);
			if (!this.folderMissingNotified) {
				this.folderMissingNotified = true;
				new Notice(`Citation Links: cannot read the bibliography folder "${folder}"`);
			}
			return null;
		}
		if (this.disposed || this.folder !== folder) {
			// The folder was switched (or cleared) while this read was in flight.
			return null;
		}
		if (sequence < this.appliedRead) {
			// A newer read finished first. Applying this one would roll the index back,
			// so report the data that is in place instead of a failure.
			return this.lastSummary;
		}
		const skippedFiles = read.files.filter((file) => file.items === null).map((file) => file.name);
		if (skippedFiles.length > 0 && attempt < RETRY_DELAYS_MS.length) {
			const delay = RETRY_DELAYS_MS[attempt] ?? 0;
			console.warn(
				`${LOG_PREFIX} ${skippedFiles.length} file(s) could not be parsed, retrying in ${delay} ms`,
				skippedFiles,
			);
			return new Promise((resolve) => {
				this.pendingRetry = window.setTimeout(() => {
					this.pendingRetry = null;
					void this.load(attempt + 1).then(resolve);
				}, delay);
			});
		}
		return this.apply(read, sequence);
	}

	private apply(read: ReadResult, sequence: number): LoadSummary {
		const result = mergeFiles(read, this.getPriority());
		this.items = result.items;
		this.currentRanking = result.ranking;
		this.lastRead = read;
		this.appliedRead = sequence;
		this.loadedOnce = true;
		this.version += 1;

		// Duplicate citekeys across files are legitimate (the ranking resolves them)
		// and shown in the settings list. Duplicates inside a single file are more
		// likely a mistake: log them, once per changed set.
		const sameFile = result.ranking.filter((rank) => rank.sameFileDuplicates.length > 0);
		const sameFileHash = sameFile
			.map((rank) => `${JSON.stringify(rank.name)}:${JSON.stringify(rank.sameFileDuplicates.slice().sort())}`)
			.sort()
			.join('|');
		if (sameFile.length > 0 && sameFileHash !== this.lastSameFileHash) {
			for (const rank of sameFile) {
				console.warn(
					`${LOG_PREFIX} duplicate citekeys inside "${rank.name}" (the last item of the file wins):`,
					rank.sameFileDuplicates,
				);
			}
		}
		this.lastSameFileHash = sameFileHash;

		const skippedHash = result.skippedFiles.slice().sort().join('|');
		if (result.skippedFiles.length > 0 && skippedHash !== this.lastSkippedHash) {
			new Notice(`Citation Links: could not parse ${result.skippedFiles.join(', ')}`);
		}
		this.lastSkippedHash = skippedHash;

		const summary: LoadSummary = {
			files: result.files.length,
			items: result.items.size,
			duplicates: result.duplicates.length,
			skippedFiles: result.skippedFiles.length,
		};
		this.lastSummary = summary;
		this.notify();
		return summary;
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

/** True when both indexes hold the same citekeys, each mapped to the very same item object. */
function sameWinners(a: ReadonlyMap<string, CslItem>, b: ReadonlyMap<string, CslItem>): boolean {
	if (a.size !== b.size) {
		return false;
	}
	for (const [key, item] of a) {
		if (b.get(key) !== item) {
			return false;
		}
	}
	return true;
}

function matchesAuthor(item: CslItem, needle: string): boolean {
	const names = item.author ?? item.editor ?? [];
	return names.some((name) => (name.family ?? name.literal ?? '').toLowerCase().includes(needle));
}

function matchesTitle(item: CslItem, needle: string): boolean {
	return (item.title ?? '').toLowerCase().includes(needle);
}
