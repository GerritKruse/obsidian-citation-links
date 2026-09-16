/**
 * Shared types. This module has no runtime dependencies and is imported by
 * both the pure modules (parser, render) and the Obsidian-facing modules.
 */

/** A personal or institutional name as found in CSL-JSON. */
export interface CslName {
	family?: string;
	given?: string;
	literal?: string;
}

/** A CSL-JSON date. Better BibTeX writes date parts as strings. */
export interface CslDate {
	'date-parts'?: (string | number)[][];
	literal?: string;
	raw?: string;
}

/**
 * A CSL-JSON item as written by Better BibTeX's "Better CSL JSON" exporter.
 * Only the fields the plugin reads directly are typed; everything else is
 * passed through to citeproc-js untouched.
 */
export interface CslItem {
	id: string;
	'citation-key'?: string;
	type?: string;
	title?: string;
	'title-short'?: string;
	author?: CslName[];
	editor?: CslName[];
	issued?: CslDate;
	'container-title'?: string;
	/** Only present when the user configured a Better BibTeX postscript. */
	custom?: { uri?: string; itemID?: number; [key: string]: unknown };
	[key: string]: unknown;
}

/** How a citation is rendered: "(Author, Year)", "Author (Year)" or "(Year)". */
export type CitationForm = 'paren' | 'narrative' | 'year';

/** CSL locator labels the modifier grammar can produce. */
export type LocatorLabel = 'page' | 'chapter' | 'section';

export interface Locator {
	label: LocatorLabel;
	value: string;
}

/** The parsed content of a wikilink alias such as "n p. 797". */
export interface Modifier {
	form: CitationForm;
	locator?: Locator;
}

/** A wikilink found in a piece of source text. Offsets are relative to that text. */
export interface LinkMatch {
	/** Offset of the first "[" (or of the "!" for embeds). */
	from: number;
	/** Offset just past the closing "]]". */
	to: number;
	/** Raw link target, i.e. the text before the first "|". */
	target: string;
	/** Raw alias, i.e. the text after the first "|"; undefined when absent. */
	alias?: string;
	/** True for embeds written as "![[...]]". */
	embed: boolean;
}

/**
 * A wikilink that is a citation: its target normalises to a citekey and its
 * alias, if present, is a valid modifier.
 */
export interface CitationLink extends LinkMatch {
	citekey: string;
	/** The link target without a trailing ".md", used to open the note. */
	linkpath: string;
	modifier: Modifier;
}

/** One or more citation links that render as a single parenthesis. */
export interface CitationGroup {
	from: number;
	to: number;
	parts: CitationLink[];
}

/** Input to the formatter for one citation. */
export interface CitationPart {
	citekey: string;
	modifier: Modifier;
}

/** Formatted text for one citation part, without surrounding parentheses. */
export interface RenderedPart {
	citekey: string;
	text: string;
	/** True when the citekey is not in the bibliography. */
	unknown: boolean;
}

/**
 * A formatted citation group. The full text is
 * `prefix + parts.map(p => p.text).join(separator) + suffix`.
 */
export interface RenderedGroup {
	prefix: string;
	suffix: string;
	separator: string;
	parts: RenderedPart[];
}
