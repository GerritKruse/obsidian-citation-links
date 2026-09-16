import type { CitationGroup, CitationLink, LinkMatch } from '../types';
import { parseLinkTarget } from './link';
import { parseModifier } from './modifier';

interface BacktickRun {
	start: number;
	end: number;
	length: number;
}

function findBacktickRuns(text: string): BacktickRun[] {
	const runs: BacktickRun[] = [];
	const re = /`+/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text)) !== null) {
		runs.push({
			start: match.index,
			end: match.index + match[0].length,
			length: match[0].length,
		});
	}
	return runs;
}

/**
 * Replaces the contents of inline code spans (backtick-delimited, matching
 * backtick count) with spaces, so link-like text inside them is never
 * matched, while every other character keeps its original offset.
 */
function maskInlineCode(text: string): string {
	const runs = findBacktickRuns(text);
	const chars = text.split('');

	let i = 0;
	while (i < runs.length) {
		const open = runs[i];
		if (open === undefined) break;

		let closeIndex = -1;
		for (let j = i + 1; j < runs.length; j++) {
			if (runs[j]?.length === open.length) {
				closeIndex = j;
				break;
			}
		}

		if (closeIndex === -1) {
			i++;
			continue;
		}

		const close = runs[closeIndex];
		if (close !== undefined) {
			for (let k = open.start; k < close.end; k++) chars[k] = ' ';
		}
		i = closeIndex + 1;
	}

	return chars.join('');
}

const LINK_RE = /(!?)\[\[([^[\]]+?)\]\]/g;

/**
 * Finds every wikilink `[[...]]` (or embed `![[...]]`) in a single line of
 * Markdown. Links inside inline code spans are ignored. The inner text is
 * split at the first "|" into a trimmed target and a raw (untrimmed) alias.
 */
export function scanLine(text: string): LinkMatch[] {
	const masked = maskInlineCode(text);
	const matches: LinkMatch[] = [];

	const re = new RegExp(LINK_RE.source, 'g');
	let match: RegExpExecArray | null;
	while ((match = re.exec(masked)) !== null) {
		const embed = match[1] === '!';
		const inner = match[2] ?? '';
		const from = match.index;
		const to = from + match[0].length;

		const pipeIndex = inner.indexOf('|');
		const target =
			pipeIndex === -1 ? inner.trim() : inner.slice(0, pipeIndex).trim();
		const alias = pipeIndex === -1 ? undefined : inner.slice(pipeIndex + 1);

		matches.push({ from, to, target, alias, embed });
	}

	return matches;
}

/**
 * Converts a raw link match into a {@link CitationLink}, or returns `null`
 * when the match is an embed, its target is not a citekey, or its alias is
 * not a valid modifier.
 */
export function toCitationLink(match: LinkMatch): CitationLink | null {
	if (match.embed) return null;

	const parsedTarget = parseLinkTarget(match.target);
	if (parsedTarget === null) return null;

	const modifier = parseModifier(match.alias);
	if (modifier === null) return null;

	return {
		...match,
		citekey: parsedTarget.citekey,
		linkpath: parsedTarget.linkpath,
		modifier,
	};
}

/** Whether two adjacent citation links belong in the same group. */
function chains(previous: CitationLink, next: CitationLink, text: string): boolean {
	if (previous.modifier.form === 'narrative') return false;
	if (next.modifier.form === 'narrative') return false;
	return text.slice(previous.to, next.from) === '; ';
}

/**
 * Finds every citation link on a line and groups consecutive ones into
 * {@link CitationGroup}s. Two citation links chain into the same group when
 * the text strictly between them is exactly "; " and neither is a
 * narrative-form citation; a narrative link is always its own group and
 * breaks the chain, as does any non-citation link (or other text) between
 * two citations.
 */
export function groupLine(text: string): CitationGroup[] {
	const links = scanLine(text)
		.map(toCitationLink)
		.filter((link): link is CitationLink => link !== null);

	const groups: CitationGroup[] = [];

	for (const link of links) {
		const current = groups[groups.length - 1];
		const lastPart = current?.parts[current.parts.length - 1];

		if (current !== undefined && lastPart !== undefined && chains(lastPart, link, text)) {
			current.parts.push(link);
			current.to = link.to;
			continue;
		}

		groups.push({ from: link.from, to: link.to, parts: [link] });
	}

	return groups;
}
