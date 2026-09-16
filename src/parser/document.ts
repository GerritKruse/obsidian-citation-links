import type { CitationGroup, LinkMatch } from '../types';
import { groupLine, scanLine } from './scan';

/** One citation group found on a specific line of a document. */
export interface LineGroup {
	line: number;
	group: CitationGroup;
}

/** One wikilink match found on a specific line of a document. */
export interface LineMatch {
	line: number;
	match: LinkMatch;
}

function isFenceDelimiter(line: string): boolean {
	const trimmed = line.trimStart();
	return trimmed.startsWith('```') || trimmed.startsWith('~~~');
}

function isFrontmatterDelimiter(line: string): boolean {
	return line.trim() === '---';
}

/**
 * Yields `{ line, text }` for every line of `docText` within
 * `fromLine`..`toLine` (inclusive, 0-based) that is not part of YAML
 * frontmatter at the very start of the document or a fenced code block.
 *
 * Frontmatter is only recognised when both an opening "---" on the first
 * line and a matching closing "---" line are present; an unterminated
 * leading "---" is treated as ordinary text. Fenced code blocks are toggled
 * by any line starting with "```" or "~~~" (after leading whitespace); the
 * fence delimiter lines themselves are not yielded.
 */
function* scannableLines(
	docText: string,
	fromLine: number,
	toLine: number,
): Generator<{ line: number; text: string }> {
	const lines = docText.split('\n');

	let start = 0;
	if (lines[0] !== undefined && isFrontmatterDelimiter(lines[0])) {
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			if (line !== undefined && isFrontmatterDelimiter(line)) {
				start = i + 1;
				break;
			}
		}
	}

	let inFence = false;
	for (let index = start; index < lines.length; index++) {
		const line = lines[index];
		if (line === undefined) continue;

		if (isFenceDelimiter(line)) {
			inFence = !inFence;
			continue;
		}
		if (inFence) continue;
		if (index < fromLine || index > toLine) continue;

		yield { line: index, text: line };
	}
}

/**
 * Collects the unique citekeys cited anywhere in `docText`, in the order
 * they first appear, skipping frontmatter and fenced code blocks.
 */
export function collectCitedKeys(docText: string): string[] {
	const keys: string[] = [];
	const seen = new Set<string>();

	for (const { text } of scannableLines(docText, 0, Number.POSITIVE_INFINITY)) {
		for (const group of groupLine(text)) {
			for (const part of group.parts) {
				if (!seen.has(part.citekey)) {
					seen.add(part.citekey);
					keys.push(part.citekey);
				}
			}
		}
	}

	return keys;
}

/**
 * Returns every citation group found on lines `fromLine`..`toLine`
 * (inclusive, 0-based) of `docText`, in order, with the line each group was
 * found on. Applies the same frontmatter/fenced-code-block skipping as
 * {@link collectCitedKeys}. Group offsets remain relative to their own line.
 */
export function groupDocumentRange(
	docText: string,
	fromLine: number,
	toLine: number,
): LineGroup[] {
	const result: LineGroup[] = [];

	for (const { line, text } of scannableLines(docText, fromLine, toLine)) {
		for (const group of groupLine(text)) {
			result.push({ line, group });
		}
	}

	return result;
}

/**
 * Returns every wikilink match found on lines `fromLine`..`toLine`
 * (inclusive, 0-based) of `docText`, in order, with the line each match was
 * found on. Unlike {@link groupDocumentRange}, this applies no citation
 * filtering at all: embeds, anchored links, and links with any kind of
 * alias are all included, exactly as `scanLine` reports them. Applies the
 * same frontmatter/fenced-code-block skipping as {@link collectCitedKeys}.
 * Match offsets remain relative to their own line.
 */
export function scanDocumentRange(
	docText: string,
	fromLine: number,
	toLine: number,
): LineMatch[] {
	const result: LineMatch[] = [];

	for (const { line, text } of scannableLines(docText, fromLine, toLine)) {
		for (const match of scanLine(text)) {
			result.push({ line, match });
		}
	}

	return result;
}
