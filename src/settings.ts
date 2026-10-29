import { fs, os, path } from './platform/node';
import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { keepAbsent, moveItem, type FileRank } from './bibliography/loader';
import type CitationLinksPlugin from './main';

export interface CitationLinksSettings {
	/** Folder with the CSL JSON files written by Better BibTeX, as typed by the user (may start with `~`). */
	folder: string;
	/** Whether typing `@` suggests citekeys from the bibliography. */
	autocomplete: boolean;
	/** Whether the "References" view is kept open in the right sidebar. */
	showReferenceList: boolean;
	/** CSL JSON file names, highest priority first: for a citekey in several files the higher-ranked file wins. */
	fileOrder: string[];
}

export const DEFAULT_SETTINGS: CitationLinksSettings = {
	folder: '',
	autocomplete: true,
	showReferenceList: true,
	fileOrder: [],
};

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

/** Everything the file priority list shows, as one string: when it changes, the list needs a re-render. */
function rankingSignature(ranking: readonly FileRank[]): string {
	return JSON.stringify(
		ranking.map((rank) => [rank.name, rank.items, rank.overridden.length, rank.sameFileDuplicates.length, rank.skipped]),
	);
}

/** Row description of one file in the priority list: item count, overridden citekeys, duplicates inside the file. */
function describeRank(rank: FileRank): string {
	if (rank.skipped) {
		return 'Could not be parsed';
	}
	const parts = [`${rank.items} ${rank.items === 1 ? 'item' : 'items'}`];
	if (rank.overridden.length > 0) {
		parts.push(`${rank.overridden.length} overridden by a file above`);
	}
	if (rank.sameFileDuplicates.length > 0) {
		const count = rank.sameFileDuplicates.length;
		parts.push(`${count} duplicate ${count === 1 ? 'citekey' : 'citekeys'} inside this file`);
	}
	return parts.join(', ');
}

/** Settings tab: the CSL JSON folder, the file priority list, the autocompletion toggle and the reference list toggle. */
export class CitationLinksSettingTab extends PluginSettingTab {
	/** Signature of the list as last handed to Obsidian; null until the tab has been registered. */
	private renderedSignature: string | null = null;

	constructor(
		app: App,
		private readonly citationLinks: CitationLinksPlugin,
	) {
		super(app, citationLinks);
	}

	/** Re-render the file priority list after the bibliography changed, but only if what it shows is different. */
	refresh(): void {
		if (this.renderedSignature === null) {
			return;
		}
		if (rankingSignature(this.citationLinks.bibliography.ranking) !== this.renderedSignature) {
			this.update();
		}
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const ranking = this.citationLinks.bibliography.ranking;
		// Captured per render: Obsidian reports indices into exactly these rows, and a re-render replaces the closure.
		const names = ranking.map((rank) => rank.name);
		this.renderedSignature = rankingSignature(ranking);
		return [
			{
				name: 'CSL JSON folder',
				desc:
					'Required – nothing is rendered until this points at a folder. Absolute path of the folder that holds the CSL JSON files ' +
					'written by Better BibTeX ("Keep updated" auto-export), for example ~/Zotero/csl-json. ' +
					'Every .json file in the folder is merged into one bibliography. ' +
					'If a citekey appears in several files, the file higher up under file priority wins.',
				aliases: ['file priority', 'duplicate citekeys', 'file order'],
				control: {
					type: 'text',
					key: 'folder',
					placeholder: '~/Zotero/csl-json',
					validate: (value: string) => validateFolder(value),
				},
			},
			{
				type: 'list',
				heading: 'File priority',
				emptyState: 'No CSL JSON files loaded',
				// Obsidian does not persist a reorder itself and expects the new order to be rendered synchronously.
				onReorder: (from: number, to: number) => {
					// Files that are absent right now keep their saved rank, so they get it back when they return.
					this.citationLinks.setFileOrder(keepAbsent(this.citationLinks.settings.fileOrder, moveItem(names, from, to)));
					this.update();
				},
				items: ranking.map((rank) => ({
					name: rank.name,
					desc: describeRank(rank),
					searchable: false,
				})),
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
		];
	}

	getControlValue(key: string): unknown {
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
		switch (key) {
			case 'folder':
				this.citationLinks.settings.folder = typeof value === 'string' ? value.trim() : '';
				await this.citationLinks.saveSettings();
				await this.citationLinks.applyFolder();
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
