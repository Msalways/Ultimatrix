// tests/hunt/live-test-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LiveTestWriter, readLiveSpec } from '../../src/codegen/live-writer';
import type { BehavioralStep } from '../../src/hunt/recorder/step-types';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'live-'));
  path = join(dir, 'live.spec.ts');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function navigateStep(url: string): BehavioralStep {
  return { id: '1', type: 'navigate', timestamp: 0, url, tabId: 't', sessionId: 's', data: { url, method: 'hard' }, evidenceRefs: [] };
}

function clickStep(selector: string, text?: string): BehavioralStep {
  return { id: '2', type: 'click', timestamp: 1, url: 'x', tabId: 't', sessionId: 's', data: { selector, text }, evidenceRefs: [] };
}

function fillStep(selector: string, value: string, isPassword = false): BehavioralStep {
  return { id: '3', type: 'fill', timestamp: 2, url: 'x', tabId: 't', sessionId: 's', data: { selector, value, isPassword }, evidenceRefs: [] };
}

describe('LiveTestWriter', () => {
  it('writes a header that imports playwright test', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain("import { test, expect } from '@playwright/test';");
    expect(content).toContain("await page.goto('https://x.com'");
  });

  it('appends navigate steps as page.goto', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(navigateStep('https://x.com/login'));
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain("await page.goto('https://x.com/login'");
  });

  it('appends click steps as page.locator(...).click()', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(clickStep('#submit', 'Submit'));
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain("page.locator('#submit')");
  });

  it('appends fill steps as page.locator(...).fill()', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(fillStep('#email', 'a@b.com'));
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain("fill('a@b.com')");
  });

  it('masks password values', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(fillStep('#pwd', 'supersecret', true));
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('supersecret');
    expect(content).toContain('PASSWORD');
  });

  it('appends findings as expect() assertions', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    const finding: AppModelFinding = {
      id: 'f1',
      type: 'reflected-xss',
      endpoint: 'https://x.com/search',
      param: 'q',
      method: 'GET',
      payload: '<svg/onload=alert(1)>',
      evidence: { diffPct: 0.5, statusBefore: 200, statusAfter: 200, responseContains: '<svg' },
      confidence: 'high',
      confirmed: true,
      severity: 'high',
    };
    w.appendFinding(finding);
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain('reflected-xss');
    expect(content).toContain('https://x.com/search');
  });

  it('file is always valid even if finalise not called', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(clickStep('#a'));
    // do NOT call finalise
    const content = readFileSync(path, 'utf8');
    // lines we appended are complete (each ends in ;)
    expect(content).toContain("page.locator('#a')");
    // but the closing brace is missing — caller must call finalise() to test
    // confirm the file is parseable per line
    for (const line of content.split('\n')) {
      // no line should be syntactically broken (rough check: no unterminated strings)
      if (line.trimStart().startsWith('await ')) {
        expect(line).toMatch(/;$/);
      }
    }
  });

  it('readLiveSpec returns content', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.finalise();
    expect(readLiveSpec(path)).toContain('test(');
  });

  it('readLiveSpec returns empty for missing file', () => {
    expect(readLiveSpec(join(dir, 'nope.spec.ts'))).toBe('');
  });

  it('tracks step and assertion counts', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com' });
    w.appendStep(clickStep('#a'));
    w.appendStep(fillStep('#b', 'v'));
    w.appendFinding({ id: 'f1', type: 'x', endpoint: 'e', param: 'p', evidence: {}, confidence: 'low', confirmed: false, severity: 'low' });
    expect(w.getStepCount()).toBe(2);
    expect(w.getAssertionCount()).toBe(1);
  });

  it('sanitises a raw-URL test name (no literal "..." in output)', () => {
    const longUrl = 'Hunt https://xss-game.appspot.com/level1/frame?query=Enter+query+here...';
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com', testName: longUrl });
    w.finalise();
    const content = readFileSync(path, 'utf8');
    // The literal "..." the user reported is gone — URL was detected and
    // replaced with its short label (host + path, no query string).
    expect(content).not.toContain('Enter+query+here...');
    expect(content).not.toContain('...');
    // The test name should be the derived short label, not the raw URL
    expect(content).toContain("test('Hunt xss-game-appspot-com-level1-frame'");
    // and the cap is respected
    const testLine = content.split('\n').find((l) => l.startsWith('test('))!;
    expect(testLine.length).toBeLessThanOrEqual(80 + 'test(\'\', async ({ page }) => {'.length);
  });

  it('strips control chars from test name', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com', testName: 'foo\nbar\tbaz' });
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('foo\nbar');
    expect(content).toContain('foo bar baz');
  });

  it('falls back to a default name for empty/whitespace test name', () => {
    const w = new LiveTestWriter({ outPath: path, baseUrl: 'https://x.com', testName: '   \t\n  ' });
    w.finalise();
    const content = readFileSync(path, 'utf8');
    expect(content).toContain("test('Generated hunt test'");
  });
});
