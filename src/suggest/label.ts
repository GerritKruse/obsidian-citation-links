import type { CslItem, CslName } from '../types';

/** The family name of a CSL name, falling back to its literal form. */
function familyOrLiteral(name: CslName): string {
	return name.family ?? name.literal ?? '';
}

/** Joins family names per APA 7 (1: "A"; 2: "A & B"; 3+: "A et al."). */
function joinFamilyNames(names: CslName[] | undefined): string | null {
	if (!names || names.length === 0) return null;

	const families = names.map(familyOrLiteral).filter((name) => name.length > 0);
	if (families.length === 0) return null;

	const [first, second] = families;
	if (families.length === 1) return first ?? '';
	if (families.length === 2) return `${first} & ${second}`;
	return `${first} et al.`;
}

/** First date-part of `issued`, as a string, or "n.d." when absent. */
function yearOf(item: CslItem): string {
	const year = item.issued?.['date-parts']?.[0]?.[0];
	if (year === undefined || year === null) return 'n.d.';
	return String(year);
}

/**
 * Builds an APA-style "Author (Year)" label for a CSL item, e.g.
 * "Gartenberg et al. (2026)".
 *
 * Falls back from `author` to `editor`, and within each name from `family`
 * to `literal`. When neither list yields a usable name, the label is the
 * item's title, or its citekey when it has no title (no year is appended
 * in that case, since there is no author to attach it to).
 */
export function authorYearLabel(item: CslItem): string {
	const names = joinFamilyNames(item.author) ?? joinFamilyNames(item.editor);
	if (names === null) {
		return item.title ?? item.id;
	}
	return `${names} (${yearOf(item)})`;
}

/**
 * Builds the label shown in the citation autosuggest, e.g.
 * "Gartenberg et al. (2026), More Versus Better".
 */
export function suggestionLabel(item: CslItem): string {
	const authorYear = authorYearLabel(item).trim();
	const title = (item['title-short'] ?? item.title ?? '').trim();
	if (title.length === 0) return authorYear;
	return `${authorYear}, ${title}`;
}
