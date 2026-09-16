import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts'],
		setupFiles: ['test/setup.ts'],
		alias: {
			obsidian: path.resolve(import.meta.dirname, 'test/mocks/obsidian.ts'),
		},
	},
});
