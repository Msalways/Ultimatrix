import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 60000,
    hookTimeout: 30000,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    globalSetup: ['./tests/setup/demo-target-server.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
