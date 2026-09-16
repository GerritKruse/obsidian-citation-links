import type { CitationForm, LocatorLabel, Modifier } from '../types';

/**
 * Grammar: `modifier := [form] [whitespace] [locator]`, where
 * `form := "n" | "y"` and `locator := label whitespace text`, with `label`
 * one of "p.", "pp.", "S.", "ch.", "sec.".
 *
 * Group 1 captures the form letter, only when followed by whitespace or the
 * end of the string (so "np. 3" does not misread "n" as a form). Group 2
 * captures the locator label, group 3 the locator value: at least one
 * non-whitespace character, captured lazily so trailing whitespace is left
 * for the final `\s*$` rather than swallowed into the value.
 */
const MODIFIER_RE =
	/^\s*(?:(n|y)(?=\s|$))?\s*(?:(p\.|pp\.|S\.|ch\.|sec\.)\s+(\S.*?))?\s*$/;

function labelFor(raw: string): LocatorLabel {
	switch (raw) {
		case 'p.':
		case 'pp.':
		case 'S.':
			return 'page';
		case 'ch.':
			return 'chapter';
		case 'sec.':
			return 'section';
		default:
			// Unreachable: MODIFIER_RE only ever captures these five literals.
			throw new Error(`unexpected locator label: ${raw}`);
	}
}

/**
 * Parses a wikilink alias into a {@link Modifier}, or returns `null` when
 * the alias does not match the modifier grammar.
 *
 * An absent, empty, or whitespace-only alias is the default "paren" form
 * with no locator.
 */
export function parseModifier(alias: string | undefined): Modifier | null {
	const match = MODIFIER_RE.exec(alias ?? '');
	if (match === null) return null;

	const [, formLetter, label, value] = match;

	let form: CitationForm = 'paren';
	if (formLetter === 'n') form = 'narrative';
	else if (formLetter === 'y') form = 'year';

	if (label === undefined || value === undefined) return { form };

	return { form, locator: { label: labelFor(label), value } };
}
