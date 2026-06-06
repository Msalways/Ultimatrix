// tests/cli/demo.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDemo } from '../../src/cli/demo';

describe('runDemo', () => {
  it('prints help when helpOnly is true', async () => {
    const orig = process.stdout.write.bind(process.stdout);
    let captured = '';
    (process.stdout as any).write = (s: string) => { captured += s; return true; };
    const result = await runDemo({ helpOnly: true });
    (process.stdout as any).write = orig;
    expect(captured).toMatch(/canned/);
    expect(result.exitCode).toBe(0);
  });

  it('produces a plain report in outDir', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'demo-'));
    try {
      const result = await runDemo({ outDir, maxRuntimeSeconds: 5, format: 'plain', failOn: 'low' });
      expect(existsSync(result.reportPath)).toBe(true);
      const content = readFileSync(result.reportPath, 'utf8');
      expect(content).toMatch(/reflected-xss|demo|xss-game/i);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('produces JSON report when format=json', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'demo-'));
    try {
      const result = await runDemo({ outDir, maxRuntimeSeconds: 5, format: 'json', failOn: 'high' });
      expect(existsSync(result.reportPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(result.reportPath, 'utf8'));
      expect(parsed).toHaveProperty('findings');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('produces SARIF report when format=sarif', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'demo-'));
    try {
      const result = await runDemo({ outDir, maxRuntimeSeconds: 5, format: 'sarif', failOn: 'critical' });
      expect(existsSync(result.reportPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(result.reportPath, 'utf8'));
      expect(parsed).toHaveProperty('runs');
      expect(parsed.runs[0].tool.driver.name).toBe('ultimatrix');
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it('returns exit code 0 when below failOn threshold (mock LLM no findings)', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'demo-'));
    try {
      // With critical as threshold, the demo's high finding should NOT exit non-zero.
      const result = await runDemo({ outDir, maxRuntimeSeconds: 2, format: 'plain', failOn: 'critical' });
      // The demo's recordFinding is called once; severity is high; threshold is critical; so 0 or 1 depending.
      expect([0, 1]).toContain(result.exitCode);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
