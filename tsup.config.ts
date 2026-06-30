import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
  external: [],
  banner: {
    js: '#!/usr/bin/env node',
  },
  esbuildOptions(options) {
    options.logOverride = { 'empty-import-meta': 'silent' };
  },
});
