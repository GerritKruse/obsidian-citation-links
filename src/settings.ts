import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import type CitationLinksPlugin from './main';

export interface CitationLinksSettings {
	/** Folder with the CSL JSON files written by Better BibTeX, as typed by the user (may start with `~`). */
	folder: string;
}

export const DEFAULT_SETTINGS: CitationLinksSettings = {
	folder: '',
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

/** The plugin has exactly one setting: the folder with the CSL JSON exports. */
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
		];
	}

	getControlValue(key: string): unknown {
		return key === 'folder' ? this.citationLinks.settings.folder : undefined;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		if (key !== 'folder') {
			return;
		}
		this.citationLinks.settings.folder = typeof value === 'string' ? value.trim() : '';
		await this.citationLinks.saveSettings();
		await this.citationLinks.applyFolder();
	}
}
