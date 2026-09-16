import { describe, expect, it } from 'vitest';
import { parseModifier } from './modifier';

describe('parseModifier', () => {
	it('defaults to the paren form when the alias is undefined', () => {
		expect(parseModifier(undefined)).toEqual({ form: 'paren' });
	});

	it('defaults to the paren form when the alias is empty', () => {
		expect(parseModifier('')).toEqual({ form: 'paren' });
	});

	it('defaults to the paren form when the alias is whitespace only', () => {
		expect(parseModifier('   ')).toEqual({ form: 'paren' });
	});

	it('parses the narrative form letter', () => {
		expect(parseModifier('n')).toEqual({ form: 'narrative' });
	});

	it('parses the year form letter', () => {
		expect(parseModifier('y')).toEqual({ form: 'year' });
	});

	it('parses a page locator written as "p."', () => {
		expect(parseModifier('p. 797')).toEqual({
			form: 'paren',
			locator: { label: 'page', value: '797' },
		});
	});

	it('parses a page range locator written as "pp."', () => {
		expect(parseModifier('pp. 797-799')).toEqual({
			form: 'paren',
			locator: { label: 'page', value: '797-799' },
		});
	});

	it('parses a page locator written as "S."', () => {
		expect(parseModifier('S. 12')).toEqual({
			form: 'paren',
			locator: { label: 'page', value: '12' },
		});
	});

	it('parses a chapter locator', () => {
		expect(parseModifier('ch. 3')).toEqual({
			form: 'paren',
			locator: { label: 'chapter', value: '3' },
		});
	});

	it('parses a section locator', () => {
		expect(parseModifier('sec. 2.1')).toEqual({
			form: 'paren',
			locator: { label: 'section', value: '2.1' },
		});
	});

	it('combines the narrative form with a page locator', () => {
		expect(parseModifier('n p. 797')).toEqual({
			form: 'narrative',
			locator: { label: 'page', value: '797' },
		});
	});

	it('combines the year form with a page locator', () => {
		expect(parseModifier('y p. 5')).toEqual({
			form: 'year',
			locator: { label: 'page', value: '5' },
		});
	});

	it('tolerates extra surrounding and internal whitespace', () => {
		expect(parseModifier('n  p. 797  ')).toEqual({
			form: 'narrative',
			locator: { label: 'page', value: '797' },
		});
	});

	it('returns null for unstructured free-form text', () => {
		expect(parseModifier('siehe dort')).toBeNull();
	});

	it('returns null when there is no whitespace after the locator label', () => {
		expect(parseModifier('p.797')).toBeNull();
	});

	it('returns null for a locator label without a value', () => {
		expect(parseModifier('p.')).toBeNull();
	});

	it('returns null for a form letter glued to a locator label', () => {
		expect(parseModifier('np. 3')).toBeNull();
	});

	it('returns null for two form letters in a row', () => {
		expect(parseModifier('n y')).toBeNull();
	});

	it('returns null for arbitrary single-letter text', () => {
		expect(parseModifier('x')).toBeNull();
	});

	it('returns null for a plain author-year alias', () => {
		expect(parseModifier('Gartenberg et al., 2026')).toBeNull();
	});

	it('returns null for an uppercase N, which is not a valid form letter', () => {
		expect(parseModifier('N')).toBeNull();
	});
});
