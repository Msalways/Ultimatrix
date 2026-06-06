// tests/tui/screenshot.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderScreenshotToAnsi, shouldShowScreenshotInTui, writeTestPng } from '../../src/tui/screenshot';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'shot-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Screenshot rendering', () => {
  it('returns placeholder for missing file', async () => {
    const r = await renderScreenshotToAnsi(join(dir, 'nope.png'), 20, 10);
    expect(r.placeholder).toBe(true);
    expect(r.ansi).toContain('unavailable');
  });

  it('returns placeholder for invalid PNG', async () => {
    const path = join(dir, 'bad.png');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from('not a png'));
    const r = await renderScreenshotToAnsi(path, 20, 10);
    expect(r.placeholder).toBe(true);
  });

  it('returns dimensions matching max', async () => {
    const path = join(dir, 'tiny.png');
    writeTestPng(path);
    const r = await renderScreenshotToAnsi(path, 30, 8);
    expect(r.width).toBe(30);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });

  it('writeTestPng creates a file', () => {
    const path = join(dir, 'test.png');
    writeTestPng(path);
    expect(existsSync(path)).toBe(true);
  });

  it('shouldShowScreenshotInTui filters by size and label', () => {
    expect(shouldShowScreenshotInTui('finding: xss', 5000)).toBe(true);
    expect(shouldShowScreenshotInTui('whatever', 100)).toBe(false);  // too small
    expect(shouldShowScreenshotInTui('before-navigate', 5000)).toBe(false);
  });
});
