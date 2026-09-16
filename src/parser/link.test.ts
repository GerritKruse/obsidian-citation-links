import { describe, expect, it } from 'vitest';
import { parseLinkTarget } from './link';

describe('parseLinkTarget', () => {
	it('parses a bare citekey', () => {
		expect(parseLinkTarget('@GartenbergEtAl2026')).toEqual({
			citekey: 'GartenbergEtAl2026',
			linkpath: '@GartenbergEtAl2026',
		});
	});

	it('parses a citekey inside a folder path', () => {
		expect(parseLinkTarget('20 - Literature/@GartenbergEtAl2026')).toEqual({
			citekey: 'GartenbergEtAl2026',
			linkpath: '20 - Literature/@GartenbergEtAl2026',
		});
	});

	it('strips a trailing .md extension', () => {
		expect(
			parseLinkTarget('20 - Literature/@GartenbergEtAl2026.md'),
		).toEqual({
			citekey: 'GartenbergEtAl2026',
			linkpath: '20 - Literature/@GartenbergEtAl2026',
		});
	});

	it('returns null when the last path segment does not start with @', () => {
		expect(parseLinkTarget('Notizen zu @Kram')).toBeNull();
	});

	it('returns null when the target has no @ at all', () => {
		expect(parseLinkTarget('AI Text Detection')).toBeNull();
	});

	it('returns null for a heading-anchored link', () => {
		expect(parseLinkTarget('@GartenbergEtAl2026#Konzepte')).toBeNull();
	});

	it('returns null for a block-anchored link', () => {
		expect(parseLinkTarget('@Key^abc')).toBeNull();
	});

	it('returns null for a bare @ with nothing after it', () => {
		expect(parseLinkTarget('@')).toBeNull();
	});

	it('returns null for a bare @ at the end of a folder path', () => {
		expect(parseLinkTarget('folder/@')).toBeNull();
	});
});
