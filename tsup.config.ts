import { defineConfig } from 'tsup';
import * as fs from 'fs';
import * as path from 'path';

const copyStatic = (): void => {
  const src = path.resolve('src/web/static');
  const dest = path.resolve('dist/web/static');
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(src)) {
    fs.copyFileSync(path.join(src, f), path.join(dest, f));
  }
};

export default defineConfig({
  entry: ['src/index.ts', 'src/cli/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  target: 'node20',
  outDir: 'dist',
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: async () => {
    copyStatic();
  },
});
