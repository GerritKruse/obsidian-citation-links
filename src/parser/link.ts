/** The result of successfully parsing a wikilink target as a citation. */
export interface ParsedLinkTarget {
	citekey: string;
	linkpath: string;
}

/**
 * Parses a raw wikilink target into a citekey and a linkpath, or returns
 * `null` when the target does not point at a citation.
 *
 * A target points at a citation when, after trimming and stripping a
 * trailing ".md", the last "/"-separated segment starts with "@" and has at
 * least one character after it. Anchored targets (containing "#" or "^"
 * anywhere) are never citations, since they point at a heading or block
 * inside a note rather than at the note itself.
 */
export function parseLinkTarget(target: string): ParsedLinkTarget | null {
	if (target.includes('#') || target.includes('^')) return null;

	let linkpath = target.trim();
	if (linkpath.endsWith('.md')) {
		linkpath = linkpath.slice(0, -'.md'.length);
	}

	const lastSlash = linkpath.lastIndexOf('/');
	const segment = lastSlash === -1 ? linkpath : linkpath.slice(lastSlash + 1);

	if (segment.startsWith('@') && segment.length > 1) {
		return { citekey: segment.slice(1), linkpath };
	}

	return null;
}
