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
  onSuccess: async () => {
    copyRuntimeAssets('dist');
  },
});
