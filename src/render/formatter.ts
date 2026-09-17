/**
 * Pure APA formatter built on citeproc-js.
 *
 * This module has no dependency on Obsidian or on Node built-ins: it only
 * talks to the `citeproc` engine and to plain data passed in by the caller.
 * All bibliography state lives in-memory (`setItems`) and all disambiguation
 * state is scoped explicitly by the caller via `prepare`.
 */
import * as CSL from 'citeproc';
import type { CitationPart, CslItem, Locator, Modifier, RenderedGroup, RenderedPart } from '../types';

export interface FormatterOptions {
	styleXml: string;
	locales: Record<string, string>;
	/** BCP-47 language tag used to drive the style. Defaults to 'en-US'. */
	lang?: string;
	/** Maximum number of cached rendered parts. Defaults to 5000. */
	cacheSize?: number;
}

/** One rendered bibliography entry. */
export interface BibliographyEntry {
	citekey: string;
	html: string;
}

const DEFAULT_LANG = 'en-US';
const DEFAULT_CACHE_SIZE = 5000;

/** Strips exactly one leading '(' and one trailing ')', if present. */
function stripParens(text: string): string {
	let result = text;
	if (result.startsWith('(')) {
		result = result.slice(1);
	}
	if (result.endsWith(')')) {
		result = result.slice(0, -1);
	}
	return result;
}

/** Resolver prefixes that Zotero records sometimes carry in the DOI field. */
const DOI_RESOLVER_PREFIX = /^https?:\/\/(?:dx\.)?doi\.org\//i;

/**
 * Canonical DOI and URL values for citeproc: the DOI is reduced to its bare
 * form so the style's own "https://doi.org/" prefix applies uniformly, and
 * double quotes are percent-encoded because citeproc's html escaping leaves
 * `"` untouched while placing the value inside an href attribute.
 */
function normaliseLinkFields(item: CslItem): { DOI?: string; URL?: string } {
	const out: { DOI?: string; URL?: string } = {};
	if (typeof item.DOI === 'string') {
		out.DOI = item.DOI.trim().replace(DOI_RESOLVER_PREFIX, '').replace(/"/g, '%22');
	}
	if (typeof item.URL === 'string') {
		out.URL = item.URL.trim().replace(/"/g, '%22');
	}
	return out;
}

/** Builds the citeproc locator/label pair for a `CiteItem`, when present. */
function locatorParams(locator: Locator | undefined): { locator?: string; label?: string } {
	if (!locator) {
		return {};
	}
	return { locator: locator.value, label: locator.label };
}

export class Formatter {
	private readonly lang: string;
	private readonly cacheSize: number;
	private readonly engine: CSL.Engine;

	private items = new Map<string, CslItem>();

	/** Sorted citekeys last registered via `prepare`; also the cache namespace. */
	private registryKeys: string[] = [];
	private registryHash = '';

	private readonly cache = new Map<string, RenderedPart>();

	constructor(options: FormatterOptions) {
		this.lang = options.lang ?? DEFAULT_LANG;
		this.cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;

		const locales = options.locales;
		const sys: CSL.CiteprocSys = {
			retrieveLocale: (requestedLang: string): string => {
				return locales[requestedLang] ?? locales[DEFAULT_LANG] ?? '';
			},
			retrieveItem: (id: string): unknown => {
				const item = this.items.get(id);
				if (!item) {
					return undefined;
				}
				return { ...item, id, ...normaliseLinkFields(item) };
			},
		};

		this.engine = new CSL.Engine(sys, options.styleXml, this.lang);
		// Documented citeproc-js development extension; affects the html output
		// used for bibliography entries only, wrapping DOIs (as
		// https://doi.org/… links) and URLs in <a> tags. The text output used
		// for in-text citations is unchanged. DOI and URL values are normalised
		// in retrieveItem (see normaliseLinkFields) so the href is always a
		// canonical, quote-free value; the reference list view additionally
		// rebuilds these anchors before inserting them into the DOM.
		this.engine.opt.development_extensions.wrap_url_and_doi = true;
		this.engine.setOutputFormat('text');
	}

	/** Replace the bibliography. Clears the cache and the registry. */
	setItems(items: Map<string, CslItem>): void {
		this.items = items;
		this.cache.clear();
		this.registryKeys = [];
		this.registryHash = '';
		// citeproc keeps its own copy of every item it has ever fetched via
		// retrieveItem; an empty updateItems call drops that internal registry
		// so the next citation re-fetches fresh data instead of a stale copy.
		this.engine.updateItems([]);
	}

	has(citekey: string): boolean {
		return this.items.has(citekey);
	}

	get(citekey: string): CslItem | undefined {
		return this.items.get(citekey);
	}

	/**
	 * Set the disambiguation registry to the given cited keys (unknown keys
	 * are ignored, order irrelevant). Calls `engine.updateItems` only when the
	 * sorted set differs from the current registry. Must be called by every
	 * renderer at the start of a render batch.
	 */
	prepare(citekeys: Iterable<string>): void {
		const known = new Set<string>();
		for (const citekey of citekeys) {
			if (this.items.has(citekey)) {
				known.add(citekey);
			}
		}
		const sorted = Array.from(known).sort();
		const hash = sorted.join('');
		if (hash === this.registryHash) {
			return;
		}
		this.registryKeys = sorted;
		this.registryHash = hash;
		this.engine.updateItems(sorted);
	}

	/** Format one citation without surrounding parentheses. Never throws. */
	citePart(part: CitationPart): RenderedPart {
		const { citekey, modifier } = part;

		if (!this.items.has(citekey)) {
			return { citekey, text: '@' + citekey, unknown: true };
		}

		const label = modifier.locator?.label ?? '';
		const locator = modifier.locator?.value ?? '';
		const cacheKey = `${this.registryHash}|${citekey}|${modifier.form}|${label}|${locator}`;
		const cached = this.cache.get(cacheKey);
		if (cached) {
			return cached;
		}

		let text: string;
		try {
			text = this.renderCluster(citekey, modifier);
		} catch (error) {
			console.error(`[citation-links] Failed to render citation for "${citekey}".`, error);
			return { citekey, text: citekey, unknown: false };
		}

		const rendered: RenderedPart = { citekey, text, unknown: false };
		this.storeInCache(cacheKey, rendered);
		return rendered;
	}

	/** Format a group. Narrative parts are always single-part groups (prefix/suffix ''). */
	citeGroup(parts: CitationPart[]): RenderedGroup {
		if (parts.length === 1 && parts[0] !== undefined && parts[0].modifier.form === 'narrative') {
			return { prefix: '', suffix: '', separator: '; ', parts: [this.citePart(parts[0])] };
		}

		const rendered = parts.map((part) => {
			// Narrative parts only make sense standalone; inside a multi-part
			// group (a caller bug) fall back to rendering them as 'paren'.
			if (part.modifier.form === 'narrative') {
				const asParen: CitationPart = { citekey: part.citekey, modifier: { form: 'paren', locator: part.modifier.locator } };
				return this.citePart(asParen);
			}
			return this.citePart(part);
		});

		return { prefix: '(', suffix: ')', separator: '; ', parts: rendered };
	}

	/** APA bibliography entries (HTML strings from citeproc) for the given keys, in APA order; unknown keys omitted. */
	bibliography(citekeys: Iterable<string>): BibliographyEntry[] {
		const known = Array.from(new Set(citekeys)).filter((citekey) => this.items.has(citekey));
		if (known.length === 0) {
			return [];
		}

		this.prepare(known);
		this.engine.setOutputFormat('html');
		try {
			const result = this.engine.makeBibliography();
			if (!result) {
				return [];
			}
			const [meta, entries] = result;
			const out: BibliographyEntry[] = [];
			for (let i = 0; i < meta.entry_ids.length; i++) {
				const citekey = meta.entry_ids[i]?.[0];
				const html = entries[i];
				if (citekey !== undefined && html !== undefined) {
					out.push({ citekey, html });
				}
			}
			return out;
		} finally {
			this.engine.setOutputFormat('text');
		}
	}

	/** Builds the citeproc citation cluster for one part, per its form. */
	private renderCluster(citekey: string, modifier: Modifier): string {
		switch (modifier.form) {
			case 'paren': {
				const raw = this.engine.makeCitationCluster([{ id: citekey, ...locatorParams(modifier.locator) }]);
				return stripParens(raw);
			}
			case 'year': {
				const raw = this.engine.makeCitationCluster([
					{ id: citekey, 'suppress-author': true, ...locatorParams(modifier.locator) },
				]);
				return stripParens(raw);
			}
			case 'narrative': {
				const authorOnly = this.engine.makeCitationCluster([{ id: citekey, 'author-only': true }]);
				const year = this.engine.makeCitationCluster([
					{ id: citekey, 'suppress-author': true, ...locatorParams(modifier.locator) },
				]);
				return `${authorOnly} ${year}`;
			}
			default: {
				const exhaustive: never = modifier.form;
				throw new Error(`Unknown citation form: ${String(exhaustive)}`);
			}
		}
	}

	private storeInCache(key: string, value: RenderedPart): void {
		this.cache.set(key, value);
		if (this.cache.size > this.cacheSize) {
			const oldestKey = this.cache.keys().next().value;
			if (oldestKey !== undefined) {
				this.cache.delete(oldestKey);
			}
		}
	}
}
