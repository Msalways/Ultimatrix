import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'terminui/jsx-dev-runtime': 'terminui/jsx-runtime',
    },
  },
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
