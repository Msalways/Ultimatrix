// scripts/verify-user-flow-gen.ts
//
// Cross-verify the user-flow.spec.ts generator against a real target.
//   1. Reads the most recent app-model.json from a real hunt (no local fake).
//   2. Calls generateFindingTests to emit user-flow.spec.ts.
//   3. Pipes user-flow.spec.ts through tsc --noEmit to confirm it's valid TS.
//   4. Runs `playwright test --list` to confirm the test parses as a test case.
//   5. EXECUTES the generated Playwright test against the real target URL
//      (so the user can see the actual flow run, not just a parse check).
//
// Usage:
//   npx tsx scripts/verify-user-flow-gen.ts                  # uses latest ./output-*/app-model.json
//   MODEL=./output-xss-fresh/app-model.json npx tsx scripts/verify-user-flow-gen.ts

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { generateFindingTests, writeFindingTests } from '../src/tools/finding-test-generator';
import type { AppModel } from '../src/core/app-model';
import { readAppModel } from '../src/core/app-model';

function pickModelPath(): string | null {
  if (process.env.MODEL && fs.existsSync(process.env.MODEL)) {
    return process.env.MODEL;
  }
  // Find the most recent output-*/app-model.json
  const candidates: { path: string; mtime: number }[] = [];
  for (const entry of fs.readdirSync('.', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!entry.name.startsWith('output')) continue;
    const p = path.join(entry.name, 'app-model.json');
    if (!fs.existsSync(p)) continue;
    const st = fs.statSync(p);
    candidates.push({ path: p, mtime: st.mtimeMs });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtime - a.mtime);
  return candidates[0].path;
}

const modelPath = pickModelPath();
if (!modelPath) {
  console.error('No app-model.json found in ./output*/ — run a hunt first:');
  console.error('  npx ultimatrix hunt -t <url> -o ./output-xss-fresh --mode auto --skip tests --max-runtime 60');
  process.exit(1);
}

const tmpDir = path.join('.', 'playwright-tests-verify');
const model = readAppModel(modelPath) as AppModel;
const target = model.target;

console.log(`▸ cross-verify user-flow generator`);
console.log(`  model:   ${modelPath}`);
console.log(`  target:  ${target}`);
console.log(`  outDir:  ${tmpDir}`);

const recording = model.recordedSessions?.['spider-auto'] ?? [];
if (recording.length === 0) {
  console.error(`✗ no spider-auto recording in ${modelPath} — re-run hunt on a target with multiple pages`);
  process.exit(1);
}
console.log(`  recording: ${recording.length} step(s) from spider-auto`);

// 1. Generate
const result = generateFindingTests(model, { outDir: tmpDir });
const userFlow = result.files.find(f => f.path === 'user-flow.spec.ts');
if (!userFlow) {
  console.error('✗ user-flow.spec.ts was NOT generated');
  process.exit(1);
}
console.log(`  ✓ generated user-flow.spec.ts (${userFlow.content.length} bytes)`);

// 2. Write to disk
const written = writeFindingTests(result, tmpDir);
console.log(`  ✓ wrote ${written.length} files to ${tmpDir}`);

// 3. Pipe user-flow.spec.ts through tsc --noEmit
const verifyProjectDir = path.join(tmpDir, 'tsc-verify');
fs.rmSync(verifyProjectDir, { recursive: true, force: true });
fs.mkdirSync(verifyProjectDir, { recursive: true });

// Copy only user-flow.spec.ts — the fixtures have project-relative imports that
// won't resolve in this temp dir, so we skip them. tsc errors on the fixture
// imports are expected; we only care about user-flow.spec.ts itself.
const tmpSrcDir = path.join(verifyProjectDir, 'src');
fs.mkdirSync(tmpSrcDir, { recursive: true });
fs.copyFileSync(path.join(tmpDir, 'user-flow.spec.ts'), path.join(tmpSrcDir, 'user-flow.spec.ts'));
fs.writeFileSync(path.join(verifyProjectDir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: {
    target: 'ES2022',
    module: 'commonjs',
    moduleResolution: 'node',
    esModuleInterop: true,
    strict: false,
    skipLibCheck: true,
    noEmit: true,
    lib: ['ES2022', 'DOM'],
    types: ['node'],
  },
  include: ['src/**/*'],
}, null, 2));
fs.writeFileSync(path.join(verifyProjectDir, 'package.json'), JSON.stringify({
  name: 'verify-ufg',
  version: '0.0.0',
  dependencies: { '@playwright/test': '1.40.0' },
}, null, 2));

try {
  execSync('npx --no-install tsc --noEmit -p .', { cwd: verifyProjectDir, stdio: 'pipe' });
  console.log(`  ✓ tsc --noEmit clean (valid TypeScript)`);
} catch (e: any) {
  const out = e.stdout?.toString() ?? e.message;
  const userFlowErrors = out.split('\n').filter((l: string) => l.includes('user-flow.spec.ts'));
  if (userFlowErrors.length > 0) {
    console.error(`✗ tsc --noEmit FAILED on user-flow.spec.ts:`);
    console.error(userFlowErrors.join('\n'));
    process.exit(1);
  }
  console.log(`  ✓ tsc --noEmit clean on user-flow.spec.ts`);
}

// 4. Playwright --list
const playwrightDir = path.join(tmpDir, 'playwright-run');
fs.rmSync(playwrightDir, { recursive: true, force: true });
fs.mkdirSync(playwrightDir, { recursive: true });
fs.copyFileSync(path.join(tmpDir, 'user-flow.spec.ts'), path.join(playwrightDir, 'user-flow.spec.ts'));
// Also drop a minimal config so playwright can find the file
fs.writeFileSync(path.join(playwrightDir, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', timeout: 60_000, use: { baseURL: ${JSON.stringify(target)} } });
`);

let listOut: string;
try {
  listOut = execSync('npx --no-install playwright test --list user-flow.spec.ts 2>&1 || true', {
    cwd: playwrightDir,
    stdio: 'pipe',
    timeout: 60_000,
  }).toString();
} catch (e: any) {
  listOut = e.stdout?.toString() ?? e.message;
}
if (!listOut.includes('User Flow') || !listOut.includes('1 test')) {
  console.error(`✗ Playwright --list did not recognize the user-flow test:`);
  console.error(listOut);
  process.exit(1);
}
console.log(`  ✓ Playwright parses user-flow.spec.ts and lists 1 test`);
console.log(listOut.split('\n').slice(0, 5).map((l: string) => '    ' + l).join('\n'));

// 5. Actually run the test against the real target
console.log(`  → executing user-flow.spec.ts against ${target}…`);
let runOut: string;
try {
  runOut = execSync('npx --no-install playwright test user-flow.spec.ts --reporter=list 2>&1 || true', {
    cwd: playwrightDir,
    stdio: 'pipe',
    timeout: 120_000,
  }).toString();
} catch (e: any) {
  runOut = e.stdout?.toString() ?? e.message;
}
console.log(runOut.split('\n').map((l: string) => '    ' + l).join('\n'));
const passed = runOut.match(/(\d+) passed/)?.[1] ?? '0';
const failed = runOut.match(/(\d+) failed/)?.[1] ?? '0';
const timedOut = runOut.match(/(\d+) timed out/)?.[1] ?? '0';
console.log(`  → result: ${passed} passed, ${failed} failed, ${timedOut} timed out`);

console.log(`\n✓ cross-verify complete`);
console.log(`  user-flow.spec.ts: ${tmpDir}${path.sep}user-flow.spec.ts`);
console.log(`  run dir:           ${playwrightDir}`);
console.log(`  manual command:    cd "${playwrightDir}" && npx playwright test user-flow.spec.ts --headed`);
