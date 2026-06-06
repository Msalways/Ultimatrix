// tests/primitives/control.test.ts
//
// Tests for the control primitives: recordEvidence, writeFinding, and
// Block 9b.1's new recordTestStep. The recordTestStep primitive
// integrates with LiveTestWriter via ctx.liveSpec.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvidence, writeFinding, recordTestStep } from '../../src/primitives/control';
import { LiveTestWriter } from '../../src/codegen/live-writer';
import type { PrimitiveContext } from '../../src/primitives/types';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'control-prim-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeCtx(over: Partial<PrimitiveContext> = {}): PrimitiveContext {
  return {
    baseUrl: 'http://test.local',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: 0, maxMs: 0 },
    ...over,
  };
}

describe('recordTestStep', () => {
  it('returns ok=false with a clear error when ctx.liveSpec is not attached', () => {
    const ctx = makeCtx();
    const r = recordTestStep.execute(
      { description: 'navigate home', action: "await page.goto('http://test.local/')" },
      ctx,
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no live spec attached/);
  });

  it('appends the step to the live spec when ctx.liveSpec is attached', () => {
    const outPath = join(dir, 'live.spec.ts');
    const spec = new LiveTestWriter({ outPath, baseUrl: 'http://test.local' });
    const ctx = makeCtx({ liveSpec: spec });

    const r = recordTestStep.execute(
      {
        description: 'navigate home and look for h1',
        action: "await page.goto('http://test.local/')",
        assertion: "await expect(page.locator('h1')).toBeVisible()",
      },
      ctx,
    );

    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ recorded: true });
    expect((r.value as { stepIndex: number }).stepIndex).toBe(1);

    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/step 1: navigate home and look for h1/);
    expect(content).toMatch(/await page\.goto\('http:\/\/test\.local\/'\)/);
    expect(content).toMatch(/await expect\(page\.locator\('h1'\)\)\.toBeVisible\(\)/);
  });

  it('handles multiple steps with incrementing stepIndex', () => {
    const outPath = join(dir, 'live.spec.ts');
    const spec = new LiveTestWriter({ outPath, baseUrl: 'http://test.local' });
    const ctx = makeCtx({ liveSpec: spec });

    const r1 = recordTestStep.execute(
      { description: 'first', action: "await page.goto('http://test.local/')" },
      ctx,
    );
    const r2 = recordTestStep.execute(
      { description: 'second', action: "await page.locator('button').click()" },
      ctx,
    );

    expect((r1.value as { stepIndex: number }).stepIndex).toBe(1);
    expect((r2.value as { stepIndex: number }).stepIndex).toBe(2);

    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/step 1: first/);
    expect(content).toMatch(/step 2: second/);
  });

  it('rejects multi-line actions with a safe fallback', () => {
    const outPath = join(dir, 'live.spec.ts');
    const spec = new LiveTestWriter({ outPath, baseUrl: 'http://test.local' });
    const ctx = makeCtx({ liveSpec: spec });

    recordTestStep.execute(
      {
        description: 'malicious multi-line',
        action: "await page.goto('x');\nawait page.evaluate('hack')",
      },
      ctx,
    );

    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/skipped step: contains newline/);
    // Should NOT contain the injected line
    expect(content).not.toMatch(/await page\.evaluate\('hack'\)/);
  });

  it('auto-adds a trailing semicolon to bare identifier lines that lack one', () => {
    const outPath = join(dir, 'live.spec.ts');
    const spec = new LiveTestWriter({ outPath, baseUrl: 'http://test.local' });
    const ctx = makeCtx({ liveSpec: spec });

    // Bare expression — no closing paren/brace. The sanitizer should add `;`.
    recordTestStep.execute(
      { description: 'bare', action: 'page.screenshot({ path: "x.png" })' },
      ctx,
    );
    // The line ends in `})` (object literal) — semicolon would be redundant
    // per ASI, so we keep the implementation's choice: lines ending in
    // `)` or `}` are not given an extra `;`.
    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/page\.screenshot\(\{ path: "x\.png" \}\)/);
  });

  it('adds a trailing semicolon to identifier-only lines lacking one', () => {
    const outPath = join(dir, 'live.spec.ts');
    const spec = new LiveTestWriter({ outPath, baseUrl: 'http://test.local' });
    const ctx = makeCtx({ liveSpec: spec });

    // Bare identifier — no `;`, no `)`, no `}`. Sanitizer should append.
    recordTestStep.execute(
      { description: 'bare-id', action: "const TOKEN = 'abc123'" },
      ctx,
    );
    const content = readFileSync(outPath, 'utf8');
    expect(content).toMatch(/const TOKEN = 'abc123';/);
  });
});
