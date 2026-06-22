import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {},
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'test/**/*.spec.ts', 'src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },

  },
});
