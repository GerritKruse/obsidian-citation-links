import type { App, PaneType } from 'obsidian';
import type { Bibliography } from './bibliography';
import type { Formatter } from './render/formatter';

/**
 * Everything the Obsidian-facing modules need from the plugin. Passing this
 * object instead of the plugin instance keeps the modules free of circular
 * imports and easy to construct in isolation.
 */
export interface CitationLinksContext {
	app: App;
	formatter: Formatter;
	bibliography: Bibliography;
	/** Open the literature note for a citekey, creating it in the vault root when missing. */
	openNote(citekey: string, linkpath: string, sourcePath: string, paneType: PaneType | boolean): Promise<void>;
	/** Current value of the autocompletion setting. */
	isAutocompleteEnabled(): boolean;
}

/** Identifier used for `registerHoverLinkSource` and the `hover-link` event. */
export const HOVER_SOURCE_ID = 'citation-links';

/** Tooltip shown on citekeys that are not in the bibliography. */
export const UNKNOWN_TOOLTIP = 'Not in bibliography';
