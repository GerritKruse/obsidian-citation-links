import { describe, expect, it } from 'vitest';
import { groupLine, scanLine, toCitationLink } from './scan';

describe('scanLine', () => {
	it('finds two links and reports their offsets', () => {
		const text = 'See [[@A]] and [[@B]] for details.';
		const matches = scanLine(text);

		expect(matches).toHaveLength(2);
		expect(matches[0]).toMatchObject({
			from: 4,
			to: 10,
			target: '@A',
			alias: undefined,
			embed: false,
		});
		expect(matches[1]).toMatchObject({
			from: 15,
			to: 21,
			target: '@B',
			alias: undefined,
			embed: false,
		});
		expect(text.slice(matches[0]!.from, matches[0]!.to)).toBe('[[@A]]');
		expect(text.slice(matches[1]!.from, matches[1]!.to)).toBe('[[@B]]');
	});

	it('detects an embed and includes the ! in its offset', () => {
		const text = 'x ![[@A]] y';
		const matches = scanLine(text);

		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ from: 2, to: 9, embed: true, target: '@A' });
		expect(text.slice(matches[0]!.from, matches[0]!.to)).toBe('![[@A]]');
	});

	it('ignores a link inside a single-backtick code span', () => {
		expect(scanLine('`[[@A]]`')).toHaveLength(0);
	});

	it('ignores a link inside a double-backtick code span', () => {
		expect(scanLine('``[[@A]]``')).toHaveLength(0);
	});

	it('still finds a link that follows an inline code span on the same line', () => {
		const matches = scanLine('`code` [[@A]]');

		expect(matches).toHaveLength(1);
		expect(matches[0]).toMatchObject({ target: '@A' });
	});

	it('keeps a raw alias containing spaces', () => {
		const matches = scanLine('[[@A|n p. 797]]');
		expect(matches[0]).toMatchObject({ target: '@A', alias: 'n p. 797' });
	});

	it('splits the inner text on the first pipe only', () => {
		const matches = scanLine('[[@A|foo|bar]]');
		expect(matches[0]).toMatchObject({ target: '@A', alias: 'foo|bar' });
	});

	it('returns an empty-string alias for a trailing pipe with nothing after it', () => {
		const matches = scanLine('[[@A|]]');
		expect(matches[0]).toMatchObject({ target: '@A', alias: '' });
	});
});

describe('toCitationLink', () => {
	it('returns null for an embed', () => {
		const [match] = scanLine('![[@A]]');
		expect(toCitationLink(match!)).toBeNull();
	});

	it('returns null when the target is not a citekey', () => {
		const [match] = scanLine('[[Notizen zu @Kram]]');
		expect(toCitationLink(match!)).toBeNull();
	});

	it('returns null when the alias is not a valid modifier', () => {
		const [match] = scanLine('[[@A|siehe dort]]');
		expect(toCitationLink(match!)).toBeNull();
	});

	it('builds a citation link for a plain citekey with no alias', () => {
		const [match] = scanLine('[[@A]]');
		expect(toCitationLink(match!)).toEqual({
			...match,
			citekey: 'A',
			linkpath: '@A',
			modifier: { form: 'paren' },
		});
	});

	it('treats an empty alias as the default paren form', () => {
		const [match] = scanLine('[[@Key|]]');
		expect(toCitationLink(match!)).toMatchObject({
			citekey: 'Key',
			modifier: { form: 'paren' },
		});
	});
});

describe('groupLine', () => {
	it('groups two semicolon-separated links into one group', () => {
		const groups = groupLine('[[@A]]; [[@B]]');

		expect(groups).toHaveLength(1);
		expect(groups[0]!.parts.map((p) => p.citekey)).toEqual(['A', 'B']);
	});

	it('groups three semicolon-separated links into one group', () => {
		const groups = groupLine('[[@A]]; [[@B]]; [[@C]]');

		expect(groups).toHaveLength(1);
		expect(groups[0]!.parts.map((p) => p.citekey)).toEqual(['A', 'B', 'C']);
	});

	it('keeps space-separated links (no semicolon) in separate groups', () => {
		expect(groupLine('[[@A]] [[@B]]')).toHaveLength(2);
	});

	it('keeps links with no space after the semicolon in separate groups', () => {
		expect(groupLine('[[@A]];[[@B]]')).toHaveLength(2);
	});

	it('keeps links separated by other text in separate groups', () => {
		expect(groupLine('[[@A]]; Text; [[@B]]')).toHaveLength(2);
	});

	it('splits off a leading narrative citation from the chain', () => {
		const groups = groupLine('[[@A|n]]; [[@B]]');

		expect(groups).toHaveLength(2);
		expect(groups[0]!.parts[0]!.modifier.form).toBe('narrative');
		expect(groups[1]!.parts[0]!.citekey).toBe('B');
	});

	it('splits off a trailing narrative citation from the chain', () => {
		const groups = groupLine('[[@A]]; [[@B|n]]');

		expect(groups).toHaveLength(2);
		expect(groups[0]!.parts[0]!.citekey).toBe('A');
		expect(groups[1]!.parts[0]!.modifier.form).toBe('narrative');
	});

	it('keeps a locator confined to its own part inside a group', () => {
		const groups = groupLine('[[@A|p. 3]]; [[@B]]');

		expect(groups).toHaveLength(1);
		expect(groups[0]!.parts[0]!.modifier).toEqual({
			form: 'paren',
			locator: { label: 'page', value: '3' },
		});
		expect(groups[0]!.parts[1]!.modifier).toEqual({ form: 'paren' });
	});

	it('breaks the chain at a link that is not a valid citation', () => {
		const groups = groupLine('[[@A]]; [[@B|siehe dort]]; [[@C]]');

		expect(groups).toHaveLength(2);
		expect(groups[0]!.parts.map((p) => p.citekey)).toEqual(['A']);
		expect(groups[1]!.parts.map((p) => p.citekey)).toEqual(['C']);
	});

	it('produces no groups for an embed', () => {
		expect(groupLine('![[@A]]')).toHaveLength(0);
	});

	it('produces no groups for an anchored link', () => {
		expect(groupLine('[[@A#H]]')).toHaveLength(0);
	});

	it('produces no groups when the target is not a citekey', () => {
		expect(groupLine('[[Notizen zu @Kram]]')).toHaveLength(0);
	});

	it('reports offsets covering only the group inside a longer sentence', () => {
		const text = 'As shown in [[@A]]; [[@B]], the effect holds.';
		const groups = groupLine(text);

		expect(groups).toHaveLength(1);
		const group = groups[0]!;
		expect(text.slice(group.from, group.to)).toBe('[[@A]]; [[@B]]');
	});
});
