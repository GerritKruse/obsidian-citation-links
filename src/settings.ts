import { fs, os, path } from './platform/node';
import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type CitationLinksPlugin from './main';

export interface CitationLinksSettings {
	/** Folder with the CSL JSON files written by Better BibTeX, as typed by the user (may start with `~`). */
	folder: string;
	/** Whether typing `@` suggests citekeys from the bibliography. */
	autocomplete: boolean;
	/** Whether the "References" view is kept open in the right sidebar. */
	showReferenceList: boolean;
}

export const DEFAULT_SETTINGS: CitationLinksSettings = {
	folder: '',
	autocomplete: true,
	showReferenceList: true,
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

/** Settings tab: the CSL JSON folder, the autocompletion toggle and the reference list toggle. */
export class CitationLinksSettingTab extends PluginSettingTab {
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
					'Every .json file in the folder is merged into one bibliography.',
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
