import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type CitationLinksPlugin from './main';

export interface CitationLinksSettings {
	/** Folder with the CSL JSON files written by Better BibTeX, as typed by the user (may start with `~`). */
	folder: string;
	/** Whether typing `@` suggests citekeys from the bibliography. */
	autocomplete: boolean;
	/** Internal: the reference list has been opened once automatically after installation. */
	referenceListShown: boolean;
}

export const DEFAULT_SETTINGS: CitationLinksSettings = {
	folder: '',
	autocomplete: true,
	referenceListShown: false,
};

/** Expand a leading `~` to the home directory and trim whitespace. */
export function resolveFolder(folder: string): string {
	const trimmed = folder.trim();
	if (trimmed === '~') {
		return homedir();
	}
	if (trimmed.startsWith('~/')) {
		return join(homedir(), trimmed.slice(2));
	}
	return trimmed;
}

/** Returns an error message for the settings UI, or undefined when the folder is usable. */
export function validateFolder(folder: string): string | undefined {
	const resolved = resolveFolder(folder);
	if (resolved === '') {
		return undefined;
	}
	if (!existsSync(resolved)) {
		return 'Folder not found';
	}
	if (!statSync(resolved).isDirectory()) {
		return 'Not a folder';
	}
	return undefined;
}

/** Settings tab: the CSL JSON folder and the autocompletion toggle. */
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
					'Absolute path of the folder that holds the CSL JSON files written by Better BibTeX ("Keep updated" auto-export). ' +
					'Every .json file in the folder is merged into one bibliography. Leave empty to disable rendering.',
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
		];
	}

	getControlValue(key: string): unknown {
		switch (key) {
			case 'folder':
				return this.citationLinks.settings.folder;
			case 'autocomplete':
				return this.citationLinks.settings.autocomplete;
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
			default:
				return;
		}
	}
}
