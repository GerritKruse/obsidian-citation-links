import { describe, expect, it } from 'vitest';
import type { CslItem } from '../types';
import { authorYearLabel, suggestionLabel } from './label';

function item(overrides: Partial<CslItem>): CslItem {
	return { id: 'Fallback2020', ...overrides };
}

describe('authorYearLabel', () => {
	it('formats a single author', () => {
		const result = authorYearLabel(
			item({
				author: [{ family: 'Gartenberg' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('Gartenberg (2026)');
	});

	it('formats two authors with "&"', () => {
		const result = authorYearLabel(
			item({
				author: [{ family: 'Miric' }, { family: 'Ozalp' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('Miric & Ozalp (2026)');
	});

	it('formats three or more authors as "et al."', () => {
		const result = authorYearLabel(
			item({
				author: [{ family: 'Gartenberg' }, { family: 'Miric' }, { family: 'Ozalp' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('Gartenberg et al. (2026)');
	});

	it('falls back to editor when there is no author', () => {
		const result = authorYearLabel(
			item({
				editor: [{ family: 'Gartenberg' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('Gartenberg (2026)');
	});

	it('uses the literal name when a name has no family', () => {
		const result = authorYearLabel(
			item({
				author: [{ literal: 'World Health Organization' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('World Health Organization (2026)');
	});

	it('uses "n.d." when issued is missing', () => {
		const result = authorYearLabel(item({ author: [{ family: 'Gartenberg' }] }));
		expect(result).toBe('Gartenberg (n.d.)');
	});

	it('accepts numeric date-parts', () => {
		const result = authorYearLabel(
			item({
				author: [{ family: 'Gartenberg' }],
				issued: { 'date-parts': [[2026]] },
			}),
		);
		expect(result).toBe('Gartenberg (2026)');
	});

	it('falls back to the title when there are no names at all', () => {
		const result = authorYearLabel(item({ title: 'A Title Without Authors' }));
		expect(result).toBe('A Title Without Authors');
	});

	it('falls back to the citekey when there are no names and no title', () => {
		const result = authorYearLabel(item({ id: 'NoNamesNoTitle2020' }));
		expect(result).toBe('NoNamesNoTitle2020');
	});
});

describe('suggestionLabel', () => {
	it('appends the title-short when present', () => {
		const result = suggestionLabel(
			item({
				author: [{ family: 'Gartenberg' }, { family: 'Miric' }, { family: 'Ozalp' }],
				issued: { 'date-parts': [['2026']] },
				title: 'More Versus Better: The Impact of Ambidexterity',
				'title-short': 'More Versus Better',
			}),
		);
		expect(result).toBe('Gartenberg et al. (2026), More Versus Better');
	});

	it('falls back to the full title when title-short is absent', () => {
		const result = suggestionLabel(
			item({
				author: [{ family: 'Gartenberg' }],
				issued: { 'date-parts': [['2026']] },
				title: 'A Long Title',
			}),
		);
		expect(result).toBe('Gartenberg (2026), A Long Title');
	});

	it('omits the trailing separator when there is no title at all', () => {
		const result = suggestionLabel(
			item({
				author: [{ family: 'Gartenberg' }],
				issued: { 'date-parts': [['2026']] },
			}),
		);
		expect(result).toBe('Gartenberg (2026)');
	});
});
