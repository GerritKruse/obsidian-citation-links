import { Keymap, setTooltip, type MarkdownPostProcessor, type MarkdownPostProcessorContext } from 'obsidian';
import { UNKNOWN_TOOLTIP, type CitationLinksContext } from '../context';
import { collectCitedKeys, groupDocumentRange, parseLinkTarget, parseModifier, scanDocumentRange } from '../parser';
import type { CitationPart, Modifier } from '../types';

/** A rendered `<a class="internal-link">` whose target is a citekey. */
interface Candidate {
	anchor: HTMLAnchorElement;
	citekey: string;
	linkpath: string;
}

interface GroupPart {
	citekey: string;
	linkpath: string;
	modifier: Modifier;
	anchor: HTMLAnchorElement;
}

/**
 * Reading Mode rendering. Obsidian has already turned every wikilink into an
 * anchor with its own click handler, so anchors are mutated in place and moved
 * into a wrapper, never replaced.
 *
 * The section source text (when available) is parsed with the same parser
 * as Live Preview and aligned with the anchors in DOM order, so both modes
 * agree on aliases, modifiers and grouping. Without section info (PDF export,
 * embedded previews) a DOM-only heuristic is used.
 */
export function createPostProcessor(context: CitationLinksContext): MarkdownPostProcessor {
	return (el, ctx) => {
		if (!context.bibliography.ready) {
			return;
		}
		const candidates = collectCandidates(el);
		if (candidates.length === 0) {
			return;
		}
		const info = ctx.getSectionInfo(el);
		const groups = (info !== null ? groupsFromSource(candidates, info.text, info.lineStart, info.lineEnd, context) : null)
			?? groupsFromDom(candidates, ctx, context);
		for (const group of groups) {
			renderGroup(group, ctx.sourcePath, context);
		}
	};
}

function collectCandidates(el: HTMLElement): Candidate[] {
	const candidates: Candidate[] = [];
	for (const anchor of Array.from(el.querySelectorAll<HTMLAnchorElement>('a.internal-link'))) {
		if (anchor.hasClass('citation-links-part')) {
			continue;
		}
		const target = parseLinkTarget(anchor.getAttribute('data-href') ?? '');
		if (target !== null) {
			candidates.push({ anchor, citekey: target.citekey, linkpath: target.linkpath });
		}
	}
	return candidates;
}

/**
 * Align the section's source links with the anchors. Returns null when the
 * sequences do not match, in which case the caller falls back to the DOM.
 */
function groupsFromSource(
	candidates: Candidate[],
	docText: string,
	lineStart: number,
	lineEnd: number,
	context: CitationLinksContext,
): GroupPart[][] | null {
	const sourceLinks = scanDocumentRange(docText, lineStart, lineEnd)
		.filter((entry) => !entry.match.embed)
		.map((entry) => ({ ...entry, target: parseLinkTarget(entry.match.target) }))
		.filter((entry) => entry.target !== null);
	if (sourceLinks.length !== candidates.length) {
		return null;
	}
	const anchorByPosition = new Map<string, HTMLAnchorElement>();
	for (let i = 0; i < sourceLinks.length; i++) {
		const source = sourceLinks[i];
		const candidate = candidates[i];
		if (source === undefined || candidate === undefined || source.target?.citekey !== candidate.citekey) {
			return null;
		}
		anchorByPosition.set(`${source.line}:${source.match.from}`, candidate.anchor);
	}
	context.formatter.prepare(collectCitedKeys(docText));
	const groups: GroupPart[][] = [];
	for (const { line, group } of groupDocumentRange(docText, lineStart, lineEnd)) {
		const parts: GroupPart[] = [];
		for (const part of group.parts) {
			const anchor = anchorByPosition.get(`${line}:${part.from}`);
			if (anchor === undefined) {
				return null;
			}
			parts.push({ citekey: part.citekey, linkpath: part.linkpath, modifier: part.modifier, anchor });
		}
		groups.push(parts);
	}
	return groups;
}

/** Fallback without source text: alias from the anchor text, grouping from adjacent text nodes. */
function groupsFromDom(candidates: Candidate[], ctx: MarkdownPostProcessorContext, context: CitationLinksContext): GroupPart[][] {
	const file = context.app.vault.getFileByPath(ctx.sourcePath);
	const cache = file !== null ? context.app.metadataCache.getFileCache(file) : null;
	const citedKeys = (cache?.links ?? [])
		.map((link) => parseLinkTarget(link.link)?.citekey)
		.filter((key): key is string => key !== undefined);
	context.formatter.prepare(citedKeys.length > 0 ? citedKeys : candidates.map((candidate) => candidate.citekey));

	const parts: GroupPart[] = [];
	for (const candidate of candidates) {
		const href = (candidate.anchor.getAttribute('data-href') ?? '').trim();
		const text = candidate.anchor.textContent ?? '';
		const alias = text.trim() === href ? undefined : text;
		const modifier = parseModifier(alias);
		if (modifier !== null) {
			parts.push({ ...candidate, modifier });
		}
	}

	const groups: GroupPart[][] = [];
	let current: GroupPart[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === undefined) {
			continue;
		}
		current.push(part);
		const next = parts[i + 1];
		if (next !== undefined && continuesGroup(part, next)) {
			continue;
		}
		groups.push(current);
		current = [];
	}
	return groups;
}

function continuesGroup(part: GroupPart, next: GroupPart): boolean {
	if (part.modifier.form === 'narrative' || next.modifier.form === 'narrative') {
		return false;
	}
	const separator = part.anchor.nextSibling;
	return (
		separator !== null &&
		separator.nodeType === Node.TEXT_NODE &&
		separator.nodeValue === '; ' &&
		separator.nextSibling === next.anchor
	);
}

function renderGroup(group: GroupPart[], sourcePath: string, context: CitationLinksContext): void {
	const first = group[0];
	if (first === undefined || first.anchor.parentNode === null) {
		return;
	}
	const citationParts: CitationPart[] = group.map((part) => ({ citekey: part.citekey, modifier: part.modifier }));
	const rendered = context.formatter.citeGroup(citationParts);

	const wrapper = createSpan({ cls: 'citation-links-cite' });
	first.anchor.parentNode.insertBefore(wrapper, first.anchor);

	for (let i = 0; i < group.length - 1; i++) {
		const separator = group[i]?.anchor.nextSibling;
		if (separator !== null && separator !== undefined && separator.nodeType === Node.TEXT_NODE && separator.nodeValue === '; ') {
			separator.remove();
		}
	}

	wrapper.appendText(rendered.prefix);
	group.forEach((part, index) => {
		if (index > 0) {
			wrapper.appendText(rendered.separator);
		}
		const renderedPart = rendered.parts[index];
		const { anchor } = part;
		wrapper.appendChild(anchor);
		anchor.empty();
		anchor.setText(renderedPart?.text ?? part.citekey);
		anchor.removeClass('is-unresolved');
		anchor.addClass('citation-links-part');
		if (renderedPart?.unknown) {
			anchor.addClass('citation-links-unknown');
			setTooltip(anchor, UNKNOWN_TOOLTIP);
		}
	});
	wrapper.appendText(rendered.suffix);

	// Runs before Obsidian's own anchor handler (ancestor, capture phase). Only
	// intercepts when the note does not exist yet, so the file lands in the
	// vault root instead of Obsidian's default new-note location.
	wrapper.addEventListener(
		'click',
		(evt) => {
			const target = evt.target instanceof Element ? evt.target.closest('a.citation-links-part') : null;
			const part = group.find((candidate) => candidate.anchor === target);
			if (part === undefined) {
				return;
			}
			const existing =
				context.app.metadataCache.getFirstLinkpathDest(part.linkpath, sourcePath) ??
				context.app.metadataCache.getFirstLinkpathDest(`@${part.citekey}`, sourcePath);
			if (existing !== null) {
				return;
			}
			evt.preventDefault();
			evt.stopPropagation();
			void context.openNote(part.citekey, part.linkpath, sourcePath, Keymap.isModEvent(evt));
		},
		{ capture: true },
	);
}
