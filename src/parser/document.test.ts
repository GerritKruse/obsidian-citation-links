import { describe, expect, it } from 'vitest';
import {
	collectCitedKeys,
	groupDocumentRange,
	scanDocumentRange,
} from './document';

describe('collectCitedKeys', () => {
	it('collects citekeys in document order, deduplicated', () => {
		const doc = [
			'[[@A]]',
			'Some text with [[@B]] and [[@A]] again.',
			'[[@C]]; [[@B]]',
		].join('\n');

		expect(collectCitedKeys(doc)).toEqual(['A', 'B', 'C']);
	});

	it('ignores YAML frontmatter at the start of the document', () => {
		const doc = ['---', 'title: [[@NotACitation]]', '---', '[[@A]]'].join(
			'\n',
		);

		expect(collectCitedKeys(doc)).toEqual(['A']);
	});

	it('ignores citations inside a fenced code block delimited by backticks', () => {
		const doc = ['[[@A]]', '```', '[[@B]]', '```', '[[@C]]'].join('\n');

		expect(collectCitedKeys(doc)).toEqual(['A', 'C']);
	});

	it('ignores citations inside a fenced code block delimited by tildes', () => {
		const doc = ['[[@A]]', '~~~', '[[@B]]', '~~~', '[[@C]]'].join('\n');

		expect(collectCitedKeys(doc)).toEqual(['A', 'C']);
	});

	it('treats an unterminated leading --- line as ordinary text, not frontmatter', () => {
		const doc = ['---', '[[@A]]'].join('\n');

		expect(collectCitedKeys(doc)).toEqual(['A']);
	});
});

describe('groupDocumentRange', () => {
	it('returns every group in the range together with its line number', () => {
		const doc = ['[[@A]]', 'text', '[[@B]]; [[@C]]'].join('\n');
		const result = groupDocumentRange(doc, 0, 2);

		expect(result).toHaveLength(2);
		expect(result[0]!.line).toBe(0);
		expect(result[0]!.group.parts.map((p) => p.citekey)).toEqual(['A']);
		expect(result[1]!.line).toBe(2);
		expect(result[1]!.group.parts.map((p) => p.citekey)).toEqual([
			'B',
			'C',
		]);
	});

	it('restricts results to the requested line range', () => {
		const doc = ['[[@A]]', '[[@B]]', '[[@C]]'].join('\n');
		const result = groupDocumentRange(doc, 1, 1);

		expect(result).toHaveLength(1);
		expect(result[0]!.line).toBe(1);
		expect(result[0]!.group.parts.map((p) => p.citekey)).toEqual(['B']);
	});

	it('skips a fenced code block that falls inside the requested range', () => {
		const doc = ['[[@A]]', '```', '[[@B]]', '```', '[[@C]]'].join('\n');
		const result = groupDocumentRange(doc, 0, 4);

		expect(result.map((r) => r.line)).toEqual([0, 4]);
	});
});

describe('scanDocumentRange', () => {
	it('returns every link match with no citation filtering', () => {
		const doc = ['[[@A]]', '[[@B|siehe dort]]', '![[@C]]'].join('\n');
		const result = scanDocumentRange(doc, 0, 2);

		expect(result).toHaveLength(3);
		expect(result[0]).toMatchObject({
			line: 0,
			match: { target: '@A', alias: undefined, embed: false },
		});
		expect(result[1]).toMatchObject({
			line: 1,
			match: { target: '@B', alias: 'siehe dort', embed: false },
		});
		expect(result[2]).toMatchObject({
			line: 2,
			match: { target: '@C', embed: true },
		});
	});

	it('skips fenced code lines just like groupDocumentRange', () => {
		const doc = ['[[@A]]', '```', '[[@B]]', '```', '[[@C]]'].join('\n');
		const result = scanDocumentRange(doc, 0, 4);

		expect(result.map((r) => r.line)).toEqual([0, 4]);
	});

	it('is inclusive of both range boundaries', () => {
		const doc = ['[[@A]]', '[[@B]]', '[[@C]]'].join('\n');
		const result = scanDocumentRange(doc, 1, 1);

		expect(result).toHaveLength(1);
		expect(result[0]!.line).toBe(1);
		expect(result[0]!.match.target).toBe('@B');
	});
});
