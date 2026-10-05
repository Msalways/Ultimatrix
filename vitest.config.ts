import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxImportSource: 'react',
  },
  oxc: {
    jsx: {
      runtime: 'automatic',
      importSource: 'react',
    },
  },
  resolve: {
    alias: { '@': resolve(process.cwd(), 'src') },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'test/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },

  },
});
