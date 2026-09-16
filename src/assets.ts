/**
 * Bundled CSL assets. esbuild inlines these files as strings (see the
 * `loader` option in esbuild.config.mjs); the pure render module receives
 * them as plain strings and never imports this file.
 */
import apaCsl from '../resources/apa.csl';
import localeEnUs from '../resources/locales-en-US.xml';

export const STYLE_XML: string = apaCsl;

export const LOCALES: Record<string, string> = {
	'en-US': localeEnUs,
};

export const DEFAULT_LANG = 'en-US';
