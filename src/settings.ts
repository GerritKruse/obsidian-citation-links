import { fs, os, path } from './platform/node';
import { PluginSettingTab, debounce, type App, type SettingDefinition, type SettingDefinitionItem } from 'obsidian';
import { libraryLabel, reorderPresent, type LibraryPreference, type LibraryStatus } from './bibliography/libraries';
import type CitationLinksPlugin from './main';

export interface CitationLinksSettings {
	/** Folder with the CSL JSON files written by Better BibTeX, as typed by the user (may start with `~`). */
	folder: string;
	/** Whether typing `@` suggests citekeys from the bibliography. */
	autocomplete: boolean;
	/** Whether the "References" view is kept open in the right sidebar. */
	showReferenceList: boolean;
	/** Library priority: the CSL JSON files of the folder, highest priority first. */
	libraries: LibraryPreference[];
}

export const DEFAULT_SETTINGS: CitationLinksSettings = {
	folder: '',
	autocomplete: true,
	showReferenceList: true,
	libraries: [],
};

/** Control keys of the per-library toggles are this prefix plus the file name. */
const LIBRARY_KEY_PREFIX = 'library:';

/** The folder field commits on every keystroke; load only once typing pauses, not every intermediate folder. */
const FOLDER_APPLY_DELAY_MS = 800;

/** Expand a leading `~` to the home directory and trim whitespace. */
export function resolveFolder(folder: string): string {
	const trimmed = folder.trim();
	if (trimmed === '~') {
		return os.homedir();
	}
	if (trimmed.startsWith('~/')) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	return trimmed;
}

/** Returns an error message for the settings UI, or undefined when the folder is usable. */
export function validateFolder(folder: string): string | undefined {
	const resolved = resolveFolder(folder);
	if (resolved === '') {
		return 'Required: enter the folder that holds your Better BibTeX CSL JSON exports.';
	}
	if (!fs.existsSync(resolved)) {
		return 'Folder not found';
	}
	if (!fs.statSync(resolved).isDirectory()) {
		return 'Not a folder';
	}
	return undefined;
}

/** Settings tab: the CSL JSON folder, the autocompletion and reference list toggles, and the library priority list. */
export class CitationLinksSettingTab extends PluginSettingTab {
	private readonly applyFolderSoon = debounce(
		() => {
			void this.citationLinks.applyFolder();
		},
		FOLDER_APPLY_DELAY_MS,
		true,
	);

	constructor(
		app: App,
		private readonly citationLinks: CitationLinksPlugin,
	) {
		super(app, citationLinks);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'CSL JSON folder',
				desc:
					'Required – nothing is rendered until this points at a folder. Absolute path of the folder that holds the CSL JSON files ' +
					'written by Better BibTeX ("Keep updated" auto-export), for example ~/Zotero/csl-json. ' +
					'Every .json file in the folder is one library; set their order under "Libraries" below.',
				control: {
					type: 'text',
					key: 'folder',
					placeholder: '~/Zotero/csl-json',
					validate: (value: string) => validateFolder(value),
				},
			},
			{
				name: 'Citekey autocompletion',
				desc: 'Suggest citekeys from the bibliography while typing "@" and insert a complete citation link on selection.',
				control: {
					type: 'toggle',
					key: 'autocomplete',
				},
			},
			{
				name: 'Reference list',
				desc: 'Keep the "References" view open in the right sidebar. Turning this off closes the view; the ribbon icon opens it again on demand.',
				control: {
					type: 'toggle',
					key: 'showReferenceList',
				},
			},
			{
				name: 'Library priority',
				desc:
					'Each CSL JSON file in the folder is one library. When a citekey occurs in more than one, the topmost ' +
					'enabled library wins – for the citation, the reference list and autocompletion; the Zotero button opens ' +
					'the matching copy. Drag to reorder; turn a library off to ignore its file.',
			},
			{
				type: 'list',
				heading: 'Libraries',
				emptyState: 'No CSL JSON files found yet. Set the folder above; every .json file in it shows up here as a library.',
				items: this.libraryItems(),
				onReorder: (from: number, to: number) => {
					void this.reorderLibraries(from, to);
				},
			},
		];
	}

	/**
	 * One row per CSL JSON file in the folder, each with an on/off toggle. The
	 * rows follow the stored order - the same list the drag indices are applied
	 * to - and take item counts from the last load.
	 */
	private libraryItems(): SettingDefinition[] {
		const status = this.presentLibraries();
		const shown = this.librariesForEditing().filter((entry) => status.has(entry.file));
		return shown.map((entry, index) => ({
			name: libraryLabel(entry.file),
			desc: describeLibrary(entry, status.get(entry.file), index),
			control: {
				type: 'toggle',
				key: LIBRARY_KEY_PREFIX + entry.file,
			},
		}));
	}

	/** Libraries whose file was in the folder at the last load, by file name. */
	private presentLibraries(): Map<string, LibraryStatus> {
		return new Map(
			this.citationLinks.bibliography.libraries
				.filter((library) => library.present)
				.map((library) => [library.file, library] as const),
		);
	}

	private async reorderLibraries(from: number, to: number): Promise<void> {
		const present = new Set(this.presentLibraries().keys());
		this.citationLinks.settings.libraries = reorderPresent(this.librariesForEditing(), present, from, to);
		// Refresh the rows (rank labels) right away rather than after the reload.
		this.update();
		await this.citationLinks.saveSettings();
		await this.citationLinks.applyLibraries();
	}

	/**
	 * The stored list completed with the files of the last load, so that a
	 * toggle or a reorder never drops a library the list has not stored yet.
	 */
	private librariesForEditing(): LibraryPreference[] {
		const stored = this.citationLinks.settings.libraries;
		const known = new Set(stored.map((entry) => entry.file));
		const missing = this.citationLinks.bibliography.libraries
			.filter((library) => !known.has(library.file))
			.map((library) => ({ file: library.file, enabled: library.enabled }));
		return stored.map((entry) => ({ ...entry })).concat(missing);
	}

	getControlValue(key: string): unknown {
		if (key.startsWith(LIBRARY_KEY_PREFIX)) {
			const file = key.slice(LIBRARY_KEY_PREFIX.length);
			return this.librariesForEditing().find((entry) => entry.file === file)?.enabled ?? true;
		}
		switch (key) {
			case 'folder':
				return this.citationLinks.settings.folder;
			case 'autocomplete':
				return this.citationLinks.settings.autocomplete;
			case 'showReferenceList':
				return this.citationLinks.settings.showReferenceList;
			default:
				return undefined;
		}
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key.startsWith(LIBRARY_KEY_PREFIX)) {
			const file = key.slice(LIBRARY_KEY_PREFIX.length);
			this.citationLinks.settings.libraries = this.librariesForEditing().map((entry) =>
				entry.file === file ? { file, enabled: value === true } : entry,
			);
			this.update();
			await this.citationLinks.saveSettings();
			await this.citationLinks.applyLibraries();
			return;
		}
		switch (key) {
			case 'folder':
				this.citationLinks.settings.folder = typeof value === 'string' ? value.trim() : '';
				await this.citationLinks.saveSettings();
				this.applyFolderSoon();
				return;
			case 'autocomplete':
				this.citationLinks.settings.autocomplete = value === true;
				await this.citationLinks.saveSettings();
				return;
			case 'showReferenceList':
				this.citationLinks.settings.showReferenceList = value === true;
				await this.citationLinks.saveSettings();
				if (value === true) {
					await this.citationLinks.activateReferenceList();
				} else {
					this.citationLinks.closeReferenceList();
				}
				return;
			default:
				return;
		}
	}
}

/** Row description: priority rank and what the last load read from the file. */
function describeLibrary(entry: LibraryPreference, status: LibraryStatus | undefined, index: number): string {
	const rank = index === 0 ? 'Highest priority' : `Priority ${index + 1}`;
	if (!entry.enabled) {
		return `${rank} · off, not loaded`;
	}
	if (status === undefined || !status.enabled) {
		// Switched on a moment ago; the reload that reads it is still running.
		return `${rank} · loading…`;
	}
	if (status.items === null) {
		return `${rank} · could not be read`;
	}
	return `${rank} · ${status.items} ${status.items === 1 ? 'item' : 'items'}`;
}
