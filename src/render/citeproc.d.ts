/**
 * Minimal ambient typings for the `citeproc` package (citeproc-js, packaged
 * as CommonJS). Only the surface actually used by `formatter.ts` is typed;
 * everything else the engine exposes is left untyped on purpose.
 */
declare module 'citeproc' {
	/** Host callbacks the engine uses to fetch locales and bibliography items. */
	export interface CiteprocSys {
		retrieveLocale(lang: string): string;
		retrieveItem(id: string): unknown;
	}

	/** One entry passed to `Engine.makeCitationCluster`. */
	export interface CiteItem {
		id: string;
		locator?: string;
		label?: string;
		'author-only'?: boolean;
		'suppress-author'?: boolean;
		prefix?: string;
		suffix?: string;
	}

	/** The metadata object returned as the first element of `makeBibliography()`. */
	export interface BibliographyMeta {
		entry_ids: string[][];
		bibstart: string;
		bibend: string;
	}

	export class Engine {
		constructor(sys: CiteprocSys, style: string, lang?: string, forceLang?: boolean);
		setOutputFormat(mode: 'html' | 'text' | 'rtf'): void;
		updateItems(ids: string[]): void;
		makeCitationCluster(items: CiteItem[]): string;
		makeBibliography(): [BibliographyMeta, string[]] | false;
	}
}
