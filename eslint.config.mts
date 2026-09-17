import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'scratch',
		'test',
		'vitest.config.ts',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		rules: {
			'obsidianmd/ui/sentence-case': [
				'warn',
				{
					brands: ['Citation Links', 'Zotero', 'Better BibTeX', 'My Library'],
					acronyms: ['CSL', 'JSON', 'APA'],
				},
			],
		},
	},
	{
		files: ['src/**/*.ts'],
		ignores: ['src/platform/**', 'src/**/*.test.ts'],
		rules: {
			'no-restricted-imports': [
				'error',
				{
					patterns: [
						{
							regex: '^node:',
							message: 'Import Node APIs through src/platform/* so the plugin type-checks without Node declarations.',
						},
					],
				},
			],
			'no-restricted-globals': [
				'error',
				{
					name: 'Buffer',
					message: 'Use Uint8Array, TextEncoder and TextDecoder instead of the Node Buffer global.',
				},
			],
		},
	},
);
