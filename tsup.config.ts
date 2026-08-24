import { defineConfig } from 'tsup';
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Copy static asset dirs that tsup does NOT bundle (they are loaded at
 *  runtime via path resolution, not imported). Without this, the built CLI
 *  crashes: the council persona loader looks for <outDir>/personas/*.md. */
function copyRuntimeAssets(outDir: string) {
  const targets: Array<[string, string]> = [
    ['src/council/personas', 'personas'],
  ];
  for (const [srcRel, destRel] of targets) {
    const src = join(here, srcRel);
    const dest = join(here, outDir, destRel);
    if (!existsSync(src)) continue;
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  }
}

export default defineConfig([
  // SDK — clean library entry (importable as `import { Ultimatrix } from 'ultimatrix'`)
  // Node_modules stay external so consumers install their own copies.
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    splitting: true,
    sourcemap: true,
    target: 'node22',
    outDir: 'dist',
    esbuildOptions(options) {
      options.logOverride = { 'empty-import-meta': 'silent' };
      options.jsx = 'automatic';
      options.jsxImportSource = 'react';
    },
  },
  // CommonJS cannot safely execute split chunks that retain import.meta.
  // Keep the compatibility entry self-contained; ESM remains the lazy path.
  {
    entry: { index: 'src/index.ts' },
    format: ['cjs'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: 'node22',
    outDir: 'dist',
    esbuildOptions(options) {
      options.logOverride = { 'empty-import-meta': 'silent' };
      options.jsx = 'automatic';
      options.jsxImportSource = 'react';
    },
  },
  // CLI — executable entry with shebang (single ESM bundle for `npx ultimatrix`)
  {
    entry: { cli: 'src/cli/index.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: 'node22',
    outDir: 'dist',
    banner: {
      js: '#!/usr/bin/env node',
    },
    esbuildOptions(options) {
      options.logOverride = { 'empty-import-meta': 'silent' };
      options.jsx = 'automatic';
      options.jsxImportSource = 'react';
    },
    onSuccess: async () => {
      copyRuntimeAssets('dist');
    },
  },
]);
