import { describe, expect, it } from 'vitest';
import { isExcludedNodeName } from './viewPlugin';

describe('isExcludedNodeName', () => {
	it.each([
		['inline-code', true],
		['HyperMD-codeblock_HyperMD-codeblock-bg', true],
		['math', true],
		['comment_hmd-comment', true],
		['escape', true],
		['hmd-frontmatter', true],
		['hmd-internal-link', false],
		['hmd-internal-link_link-has-alias', false],
		['Document', false],
		['', false],
	])('%s -> %s', (name, expected) => {
		expect(isExcludedNodeName(name)).toBe(expected);
	});
});
