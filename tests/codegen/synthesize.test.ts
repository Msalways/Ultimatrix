// tests/codegen/synthesize.test.ts
//
// Block 9b.2: post-hoc LLM synthesis backstop. Verifies:
// 1. Skip when live spec already has >= minLiveSteps steps
// 2. Call LLM + write output when live spec is sparse
// 3. Validate the LLM output (catch bad / fenced / unbalanced specs)
// 4. Fall back to a stub when LLM call fails
// 5. Aggregate multiple per-node live specs (parallel v3 workers)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LLMClient } from '../../src/llm/client';
import { synthesizeSpecFromTrace, readSynthesizedSpec } from '../../src/codegen/synthesize';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'synth-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const VALID_SPEC = `import { test, expect } from '@playwright/test';

test('reproduces xss in /search', async ({ page }) => {
  await page.goto('https://target.com/search');
  await page.locator('input[name=q]').fill('<script>alert(1)</script>');
  await page.locator('button[type=submit]').click();
  await expect(page.locator('body')).toContainText('<script>');
});
`;

function makeFinding(over: Partial<AppModelFinding> = {}): AppModelFinding {
  return {
    id: 'f-1',
    type: 'xss',
    endpoint: '/search',
    param: 'q',
    method: 'GET',
    payload: '<script>alert(1)</script>',
    description: 'Reflected XSS in search',
    severity: 'high',
    confidence: 0.9,
    evidence: [],
    ...over,
  };
}

function makeLLM(text: string): LLMClient {
  const llm = new LLMClient({ provider: 'mock' });
  llm.call = vi.fn(async () => ({
    text,
    json: null,
    provider: 'mock' as const,
    model: 'mock',
    durationMs: 0,
  }));
  llm.isReal = () => false;
  return llm;
}

describe('synthesizeSpecFromTrace', () => {
  it('skips when live spec already has >= minLiveSteps', async () => {
    // Write a live spec with 4 action lines
    const livePath = join(dir, 'live-abc.spec.ts');
    writeFileSync(livePath, [
      "import { test, expect } from '@playwright/test';",
      "test('x', async ({ page }) => {",
      "  await page.goto('http://x/');",
      "  await page.locator('a').click();",
      "  await page.locator('b').fill('y');",
      "  await expect(page.locator('c')).toBeVisible();",
      "});",
    ].join('\n'));

    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(VALID_SPEC),
      minLiveSteps: 3,
    });

    expect(r.llmCalled).toBe(false);
    expect(r.skippedReason).toMatch(/already has/);
    expect(r.validated).toBe(true);
    // LLM should not have been called
    // (the spec file should NOT have been written)
    expect(existsSync(r.outPath)).toBe(false);
  });

  it('calls LLM and writes a validated spec when live spec is sparse', async () => {
    // Empty live spec (or none at all)
    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(VALID_SPEC),
      minLiveSteps: 3,
    });

    expect(r.llmCalled).toBe(true);
    expect(r.validated).toBe(true);
    expect(existsSync(r.outPath)).toBe(true);
    const content = readFileSync(r.outPath, 'utf-8');
    expect(content).toContain("import { test, expect } from '@playwright/test'");
    expect(content).toMatch(/await\s+page\.goto/);
  });

  it('strips markdown code fences from LLM output before validating', async () => {
    const fenced = '```typescript\n' + VALID_SPEC + '\n```';
    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(fenced),
      minLiveSteps: 3,
    });
    expect(r.validated).toBe(true);
    const content = readFileSync(r.outPath, 'utf-8');
    expect(content).not.toMatch(/^```/m);
  });

  it('writes a fallback stub when LLM output fails validation', async () => {
    const garbage = 'this is not a playwright spec at all, sorry';
    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(garbage),
      minLiveSteps: 3,
    });
    expect(r.llmCalled).toBe(true);
    // Validation failed → fallback stub is written
    expect(existsSync(r.outPath)).toBe(true);
    const content = readFileSync(r.outPath, 'utf-8');
    expect(content).toMatch(/import\s*\{[^}]*test[^}]*\}\s*from\s*['"]@playwright\/test['"]/);
  });

  it('writes a fallback that wraps existing live content when LLM call throws', async () => {
    // Write a sparse live spec first
    const livePath = join(dir, 'live-xyz.spec.ts');
    writeFileSync(livePath, [
      "import { test, expect } from '@playwright/test';",
      "test('x', async ({ page }) => {",
      "  await page.goto('http://x/');",
      "});",
    ].join('\n'));

    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async () => { throw new Error('rate limit'); });
    llm.isReal = () => false;

    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm,
      minLiveSteps: 3,
    });

    expect(r.skippedReason).toMatch(/LLM call failed/);
    expect(existsSync(r.outPath)).toBe(true);
    const content = readFileSync(r.outPath, 'utf-8');
    expect(content).toMatch(/synthesis fallback/);
    expect(content).toMatch(/await page\.goto/);
  });

  it('aggregates multiple per-node live specs (parallel v3 workers)', async () => {
    // Two per-node specs, each sparse on its own
    writeFileSync(join(dir, 'live-aaa.spec.ts'), [
      "import { test, expect } from '@playwright/test';",
      "test('a', async ({ page }) => {",
      "  await page.goto('http://x/a');",
      "  await page.locator('input').fill('aaa');",
      "});",
    ].join('\n'));
    writeFileSync(join(dir, 'live-bbb.spec.ts'), [
      "import { test, expect } from '@playwright/test';",
      "test('b', async ({ page }) => {",
      "  await page.goto('http://x/b');",
      "  await page.locator('input').fill('bbb');",
      "});",
    ].join('\n'));

    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(VALID_SPEC),
      minLiveSteps: 10, // high threshold so we don't skip
    });

    // Aggregated has 4 step lines, but we set threshold to 10 → must call LLM
    expect(r.llmCalled).toBe(true);
    expect(r.validated).toBe(true);
  });

  it('reads findings from app-model.json when not given explicitly', async () => {
    const model = {
      target: 'http://x',
      findings: [makeFinding({ type: 'sqli' })],
    };
    writeFileSync(join(dir, 'app-model.json'), JSON.stringify(model));

    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      target: 'http://x',
      llm: makeLLM(VALID_SPEC),
      minLiveSteps: 3,
    });

    expect(r.llmCalled).toBe(true);
    expect(r.validated).toBe(true);
  });

  it('rejects LLM output with unbalanced braces', async () => {
    const bad = `import { test, expect } from '@playwright/test';\n\ntest('x', async ({ page }) => {\n  await page.goto('http://x/');\n  // missing closing brace`;
    const r = await synthesizeSpecFromTrace({
      outDir: dir,
      findings: [makeFinding()],
      target: 'http://x',
      llm: makeLLM(bad),
      minLiveSteps: 3,
    });
    // Validation failed → fallback
    expect(r.llmCalled).toBe(true);
    expect(r.skippedReason).toMatch(/unbalanced braces/);
  });

  it('readSynthesizedSpec returns empty string for missing file', () => {
    expect(readSynthesizedSpec(join(dir, 'nope.spec.ts'))).toBe('');
  });
});
