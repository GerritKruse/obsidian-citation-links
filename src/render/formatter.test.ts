import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { Formatter } from './formatter';
import type { CitationPart, CslItem } from '../types';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const styleXml = readFileSync(path.join(repoRoot, 'resources', 'apa.csl'), 'utf8');
const localeXml = readFileSync(path.join(repoRoot, 'resources', 'locales-en-US.xml'), 'utf8');
const fixtureItems = JSON.parse(readFileSync(path.join(repoRoot, 'test', 'fixtures', 'bibliography.json'), 'utf8')) as CslItem[];

function itemsMap(items: CslItem[]): Map<string, CslItem> {
	return new Map(items.map((item) => [item.id, item]));
}

function paren(citekey: string, locator?: CitationPart['modifier']['locator']): CitationPart {
	return { citekey, modifier: { form: 'paren', locator } };
}

function narrative(citekey: string, locator?: CitationPart['modifier']['locator']): CitationPart {
	return { citekey, modifier: { form: 'narrative', locator } };
}

function year(citekey: string, locator?: CitationPart['modifier']['locator']): CitationPart {
	return { citekey, modifier: { form: 'year', locator } };
}

function createFormatter(): Formatter {
	const formatter = new Formatter({ styleXml, locales: { 'en-US': localeXml } });
	formatter.setItems(itemsMap(fixtureItems));
	return formatter;
}

describe('Formatter', () => {
	let formatter: Formatter;
	let consoleErrorSpy: MockInstance<typeof console.error>;

	beforeEach(() => {
		formatter = createFormatter();
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	describe('citePart', () => {
		it('renders the paren form without surrounding parentheses', () => {
			const result = formatter.citePart(paren('GartenbergEtAl2026'));
			expect(result).toEqual({ citekey: 'GartenbergEtAl2026', text: 'Gartenberg et al., 2026', unknown: false });
		});

		it('renders the narrative form as "Author (Year)"', () => {
			const result = formatter.citePart(narrative('GartenbergEtAl2026'));
			expect(result.text).toBe('Gartenberg et al. (2026)');
			expect(result.unknown).toBe(false);
		});

		it('renders the year form as a bare year', () => {
			const result = formatter.citePart(year('GartenbergEtAl2026'));
			expect(result.text).toBe('2026');
		});

		it('renders a page locator in the paren form', () => {
			const result = formatter.citePart(paren('GartenbergEtAl2026', { label: 'page', value: '797' }));
			expect(result.text).toBe('Gartenberg et al., 2026, p. 797');
		});

		it('renders a hyphen-separated page range as an en-dash range', () => {
			const result = formatter.citePart(paren('GartenbergEtAl2026', { label: 'page', value: '797-799' }));
			expect(result.text).toBe('Gartenberg et al., 2026, pp. 797–799');
		});

		it('renders a page locator in the narrative form', () => {
			const result = formatter.citePart(narrative('GartenbergEtAl2026', { label: 'page', value: '797' }));
			expect(result.text).toBe('Gartenberg et al. (2026, p. 797)');
		});

		it('renders a chapter locator', () => {
			const result = formatter.citePart(paren('GartenbergEtAl2026', { label: 'chapter', value: '3' }));
			expect(result.text).toBe('Gartenberg et al., 2026, Chapter 3');
		});

		it('renders a section locator', () => {
			const result = formatter.citePart(paren('GartenbergEtAl2026', { label: 'section', value: '2.1' }));
			expect(result.text).toBe('Gartenberg et al., 2026, Section 2.1');
		});

		it('renders a page locator whose value came from a "S." token in the source text', () => {
			// The parser normalises "S. 12" to { label: 'page', value: '12' } before
			// the formatter ever sees it; this only checks the plain page rendering.
			const result = formatter.citePart(paren('GartenbergEtAl2026', { label: 'page', value: '12' }));
			expect(result.text).toBe('Gartenberg et al., 2026, p. 12');
		});

		it('renders a two-author item with an ampersand', () => {
			const result = formatter.citePart(paren('MiricOzalp2026'));
			expect(result.text).toBe('Miric & Ozalp, 2026');
		});

		it('renders an author-less item using its title', () => {
			const result = formatter.citePart(paren('NoAuthor2025'));
			expect(result.text).toBe('“8 Digital Trends in Healthcare in 2025,” 2025');
		});

		it('returns an "@citekey" placeholder for an unknown key without touching the engine', () => {
			const result = formatter.citePart(paren('TippFehler2026'));
			expect(result).toEqual({ citekey: 'TippFehler2026', text: '@TippFehler2026', unknown: true });
			expect(consoleErrorSpy).not.toHaveBeenCalled();
		});

		it('falls back to the raw citekey and logs when the engine throws', () => {
			// Monkey-patch the private engine to simulate a citeproc failure.
			const internals = formatter as unknown as { engine: { makeCitationCluster: () => string } };
			internals.engine.makeCitationCluster = () => {
				throw new Error('simulated citeproc failure');
			};
			const result = formatter.citePart(paren('GartenbergEtAl2026'));
			expect(result).toEqual({ citekey: 'GartenbergEtAl2026', text: 'GartenbergEtAl2026', unknown: false });
			expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
		});
	});

	describe('citeGroup', () => {
		it('keeps a single narrative part unwrapped (prefix/suffix empty)', () => {
			const group = formatter.citeGroup([narrative('GartenbergEtAl2026')]);
			expect(group.prefix).toBe('');
			expect(group.suffix).toBe('');
			expect(group.separator).toBe('; ');
			expect(group.parts).toHaveLength(1);
			expect(group.parts[0]?.text).toBe('Gartenberg et al. (2026)');
		});

		it('wraps a single non-narrative part in parentheses', () => {
			const group = formatter.citeGroup([year('GartenbergEtAl2026', { label: 'page', value: '5' })]);
			const fullText = group.prefix + group.parts.map((p) => p.text).join(group.separator) + group.suffix;
			expect(fullText).toBe('(2026, p. 5)');
		});

		it('renders multiple known parts in the given order, without re-sorting', () => {
			const group = formatter.citeGroup([paren('MiricEtAl2023'), paren('GartenbergEtAl2026')]);
			expect(group.parts).toHaveLength(2);
			const fullText = group.prefix + group.parts.map((p) => p.text).join(group.separator) + group.suffix;
			expect(fullText).toBe('(Miric et al., 2023; Gartenberg et al., 2026)');
		});

		it('mixes a known and an unknown part in the same group', () => {
			const group = formatter.citeGroup([paren('GartenbergEtAl2026'), paren('TippFehler2026')]);
			const fullText = group.prefix + group.parts.map((p) => p.text).join(group.separator) + group.suffix;
			expect(fullText).toBe('(Gartenberg et al., 2026; @TippFehler2026)');
			expect(group.parts[1]?.unknown).toBe(true);
		});

		it('renders a narrative part inside a multi-part group as if it were paren (caller bug)', () => {
			const group = formatter.citeGroup([narrative('GartenbergEtAl2026'), paren('MiricEtAl2023')]);
			expect(group.prefix).toBe('(');
			expect(group.parts[0]?.text).toBe('Gartenberg et al., 2026');
		});
	});

	describe('bibliography', () => {
		it('returns entries in APA order with unknown keys omitted', () => {
			const entries = formatter.bibliography(['MiricEtAl2023', 'GartenbergEtAl2026', 'TippFehler2026']);
			expect(entries.map((e) => e.citekey)).toEqual(['GartenbergEtAl2026', 'MiricEtAl2023']);
			for (const entry of entries) {
				expect(entry.html).toContain('class="csl-entry"');
			}
			const gartenberg = entries.find((e) => e.citekey === 'GartenbergEtAl2026');
			expect(gartenberg?.html).toContain(
				'Gartenberg, C., Hasan, S., Murray, A., &#38; Pierce, L. (2026). More Versus Better: Artificial Intelligence, Incentives, and the Emerging Crisis in Peer Review. <i>Organization Science</i>, <i>37</i>(3), 795–812. https://doi.org/10.1287/orsc.2026.ed.v37.n3',
			);
		});

		it('returns an empty array when no keys are known', () => {
			expect(formatter.bibliography(['TippFehler2026'])).toEqual([]);
			expect(formatter.bibliography([])).toEqual([]);
		});

		it('restores text output mode afterwards', () => {
			formatter.bibliography(['GartenbergEtAl2026']);
			const result = formatter.citePart(paren('GartenbergEtAl2026'));
			expect(result.text).not.toMatch(/[<>]/);
			expect(result.text).toBe('Gartenberg et al., 2026');
		});
	});

	describe('prepare (disambiguation)', () => {
		it('adds year suffixes only when the ambiguous siblings are in the registry', () => {
			formatter.prepare(['SmithA2020', 'SmithB2020']);
			const a = formatter.citePart(paren('SmithA2020'));
			const b = formatter.citePart(paren('SmithB2020'));
			expect(a.text).toContain('2020a');
			expect(b.text).toContain('2020b');
		});

		it('drops the stale suffix when the registry shrinks, bypassing any cached value', () => {
			formatter.prepare(['SmithA2020', 'SmithB2020']);
			const withSuffix = formatter.citePart(paren('SmithA2020'));
			expect(withSuffix.text).toContain('2020a');

			formatter.prepare(['SmithA2020']);
			const withoutSuffix = formatter.citePart(paren('SmithA2020'));
			expect(withoutSuffix.text).toBe('Smith et al., 2020');
		});

		it('ignores unknown citekeys when building the registry', () => {
			expect(() => formatter.prepare(['SmithA2020', 'DoesNotExist'])).not.toThrow();
		});
	});

	describe('setItems', () => {
		it('invalidates the cache so a changed item re-renders with fresh data', () => {
			const before = formatter.citePart(paren('NoAuthor2025'));
			expect(before.text).toContain('8 Digital Trends');

			const updated = itemsMap(fixtureItems);
			const original = updated.get('NoAuthor2025');
			expect(original).toBeDefined();
			updated.set('NoAuthor2025', { ...original, title: 'Zzz Unique Marker Zzz' } as CslItem);
			formatter.setItems(updated);

			const after = formatter.citePart(paren('NoAuthor2025'));
			expect(after.text).not.toBe(before.text);
			expect(after.text).toContain('Zzz Unique Marker Zzz');
		});

		it('accepts being called with an empty map', () => {
			expect(() => formatter.setItems(new Map())).not.toThrow();
			expect(formatter.has('GartenbergEtAl2026')).toBe(false);
		});
	});

	describe('has / get', () => {
		it('reports known and unknown citekeys', () => {
			expect(formatter.has('GartenbergEtAl2026')).toBe(true);
			expect(formatter.has('TippFehler2026')).toBe(false);
			expect(formatter.get('GartenbergEtAl2026')?.id).toBe('GartenbergEtAl2026');
			expect(formatter.get('TippFehler2026')).toBeUndefined();
		});
	});
});
