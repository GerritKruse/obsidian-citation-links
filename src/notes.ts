/**
 * Opening and creating literature notes for citekeys.
 *
 * A "literature note" is a regular Obsidian note whose filename is the
 * citekey prefixed with "@" (e.g. "@smith2020.md"). This module resolves an
 * existing note for a citekey, or creates an empty one when none exists yet.
 */

import { App, Notice, normalizePath, TFile, type PaneType } from 'obsidian';

/** Characters that are not allowed in an Obsidian filename. */
const INVALID_FILENAME_CHARS = /[/\\:#^|[\]?]/;

/**
 * Find the literature note for a citekey, if one exists.
 *
 * Tries the raw linkpath first (as written in the wikilink), then falls back
 * to "@<citekey>" in case the link was written without its file extension
 * stripped or under a different alias.
 */
export function findLiteratureNote(
	app: App,
	citekey: string,
	linkpath: string,
	sourcePath: string,
): TFile | null {
	return (
		app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath) ??
		app.metadataCache.getFirstLinkpathDest('@' + citekey, sourcePath)
	);
}

/**
 * Open the literature note for a citekey, creating an empty one in the vault
 * root when it does not exist yet. Shows a Notice and gives up when the
 * citekey cannot be used as a filename, or when opening/creating fails.
 */
export async function openOrCreateLiteratureNote(
	app: App,
	citekey: string,
	linkpath: string,
	sourcePath: string,
	paneType: PaneType | boolean,
): Promise<void> {
	try {
		const existing = findLiteratureNote(app, citekey, linkpath, sourcePath);
		if (existing) {
			await app.workspace.openLinkText(linkpath, sourcePath, paneType);
			return;
		}

		if (citekey === '' || INVALID_FILENAME_CHARS.test(citekey)) {
			new Notice('Cannot create a note for citekey "' + citekey + '"');
			return;
		}

		const file = await app.vault.create(
			normalizePath('@' + citekey + '.md'),
			'',
		);
		await app.workspace.getLeaf(paneType).openFile(file);
	} catch (e) {
		console.error(
			'[citation-links] Failed to open or create literature note for ' +
				citekey,
			e,
		);
		new Notice(
			'Could not open or create the literature note for ' + citekey,
		);
	}
}
