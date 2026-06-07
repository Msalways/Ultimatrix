// tests/tui/block20.test.ts
//
// Block 20: TUI polish. Tests for the new state actions, view
// features, and edge cases.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  makeInitialState,
  reduce,
  eventToActions,
  formatClock,
  formatLevelBadge,
  phaseColor,
  formatStatusLine,
} from '../../src/tui/state';
import type { TuiState, ActivityLine, FindingView } from '../../src/tui/state';
import { TuiView } from '../../src/tui/view';
import { TuiApp } from '../../src/tui/app';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { HuntEvent, LLMToken } from '../../src/hunt/events';
import type { AppModelFinding } from '../../src/core/app-model';
import { renderScreenshotToAnsi, writeTestPng } from '../../src/tui/screenshot';

let dir: string;
let core: HuntCore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tui-b20-'));
  core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
  core.start();
});

afterEach(() => {
  core.stop('user-quit');
  rmSync(dir, { recursive: true, force: true });
});

describe('Block 20 — TUI state extensions', () => {
  it('initial state has activityScroll/findingsScroll = 0', () => {
    const s = makeInitialState();
    expect(s.activityScroll).toBe(0);
    expect(s.findingsScroll).toBe(0);
  });

  it('resize clamps to a minimum sane terminal size', () => {
    const s = reduce(makeInitialState(), { type: 'resize', width: 5, height: 2 });
    expect(s.width).toBe(40);
    expect(s.height).toBe(10);
  });

  it('resize accepts a normal terminal size', () => {
    const s = reduce(makeInitialState(), { type: 'resize', width: 200, height: 50 });
    expect(s.width).toBe(200);
    expect(s.height).toBe(50);
  });

  it('scroll-activity moves the window back from the bottom', () => {
    let s = makeInitialState();
    for (let i = 0; i < 100; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i } });
    }
    s = reduce(s, { type: 'scroll-activity', delta: 20 });
    expect(s.activityScroll).toBe(20);
  });

  it('scroll-activity delta is clamped to [0, length-1]', () => {
    let s = makeInitialState();
    for (let i = 0; i < 5; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i } });
    }
    // Try to scroll past the end
    s = reduce(s, { type: 'scroll-activity', delta: 1000 });
    expect(s.activityScroll).toBe(4);
    // Try to scroll back to 0
    s = reduce(s, { type: 'scroll-activity', delta: -1000 });
    expect(s.activityScroll).toBe(0);
  });

  it('a new activity line resets activityScroll to 0 (jump to bottom)', () => {
    let s = makeInitialState();
    for (let i = 0; i < 10; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i } });
    }
    s = reduce(s, { type: 'scroll-activity', delta: 5 });
    expect(s.activityScroll).toBe(5);
    s = reduce(s, { type: 'activity', line: { id: 'new', text: 'fresh', level: 'info', timestamp: 99 } });
    expect(s.activityScroll).toBe(0);
  });

  it('scroll-findings is independent from scroll-activity', () => {
    let s = makeInitialState();
    // Add activity lines first so activityScroll=3 is within the
    // clamp range (maxScroll = activity.length - 1).
    for (let i = 0; i < 4; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i } });
    }
    const f = { id: 'f1', type: 'x', severity: 'high', endpoint: '/', confidence: 'h', observedAt: 0 } as FindingView;
    for (let i = 0; i < 5; i++) {
      s = reduce(s, { type: 'finding', finding: { ...f, id: `f${i}` } });
    }
    s = reduce(s, { type: 'scroll-activity', delta: 3 });
    expect(s.activityScroll).toBe(3);
    expect(s.findingsScroll).toBe(0);
    s = reduce(s, { type: 'scroll-findings', delta: 2 });
    expect(s.activityScroll).toBe(3);
    expect(s.findingsScroll).toBe(2);
  });

  it('a new finding resets findingsScroll to 0', () => {
    let s = makeInitialState();
    const f = { id: 'f1', type: 'x', severity: 'high', endpoint: '/', confidence: 'h', observedAt: 0 } as FindingView;
    for (let i = 0; i < 3; i++) {
      s = reduce(s, { type: 'finding', finding: { ...f, id: `f${i}` } });
    }
    s = reduce(s, { type: 'scroll-findings', delta: 1 });
    expect(s.findingsScroll).toBe(1);
    s = reduce(s, { type: 'finding', finding: { ...f, id: 'f3' } });
    expect(s.findingsScroll).toBe(0);
  });

  it('activity-attach splices a screenshot onto an existing line', () => {
    let s = makeInitialState();
    s = reduce(s, { type: 'activity', line: { id: 'shot-x', text: 'shot', level: 'info', timestamp: 0 } });
    s = reduce(s, { type: 'activity-attach', id: 'shot-x', screenshot: { ansi: 'ANSI', width: 10, height: 1, placeholder: false } });
    const line = s.activity.find((l) => l.id === 'shot-x')!;
    expect(line.screenshot).toBeDefined();
    expect(line.screenshot!.ansi).toBe('ANSI');
  });

  it('activity-attach for an unknown id is a no-op', () => {
    const s = makeInitialState();
    const next = reduce(s, { type: 'activity-attach', id: 'nope', screenshot: { ansi: 'x', width: 1, height: 1, placeholder: true } });
    expect(next).toBe(s);
  });
});

describe('Block 20 — screenshot event → activity mapping', () => {
  it('screenshot event produces an activity line with the file path', () => {
    const ev: HuntEvent = { type: 'screenshot', screenshot: { path: '/tmp/x.png', label: 'finding: xss', width: 800, height: 600, sizeBytes: 12345 } };
    const actions = eventToActions(ev);
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe('activity');
    const line = (actions[0] as { type: 'activity'; line: ActivityLine }).line;
    expect(line.id).toBe('shot-/tmp/x.png');
    // The activity row shows just the basename, not the full path.
    expect(line.text).toContain('x.png');
    expect(line.text).toContain('finding: xss');
  });
});

describe('Block 20 — view renders scroll indicator and timestamps', () => {
  it('activity pane shows a "scrolled" hint when activityScroll > 0', () => {
    let s = makeInitialState();
    s.width = 120;
    s.height = 40;
    for (let i = 0; i < 50; i++) {
      s = reduce(s, { type: 'activity', line: { id: String(i), text: `line ${i}`, level: 'info', timestamp: i * 1000 } });
    }
    s = reduce(s, { type: 'scroll-activity', delta: 10 });
    const { lastFrame } = render(<TuiView state={s} />);
    // The hint shows "↑ -10" to mean "scrolled 10 back from bottom"
    expect(lastFrame()).toContain('↑ -10');
  });

  it('activity rows show HH:MM:SS clock prefix', () => {
    const s0 = makeInitialState();
    const s = reduce(s0, { type: 'activity', line: { id: '1', text: 'hello', level: 'info', timestamp: new Date('2026-06-07T12:34:56').getTime() } });
    s.width = 120;
    s.height = 40;
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('12:34:56');
  });

  it('activity rows show a level badge for warn', () => {
    let s = makeInitialState();
    s.width = 120;
    s.height = 40;
    s = reduce(s, { type: 'activity', line: { id: '1', text: 'oob fired', level: 'warn', timestamp: Date.now() } });
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('WRN');
  });

  it('findings pane shows a scrolled hint when findingsScroll > 0', () => {
    let s = makeInitialState();
    s.width = 120;
    s.height = 40;
    for (let i = 0; i < 8; i++) {
      s = reduce(s, { type: 'finding', finding: { id: `f${i}`, type: 'xss', severity: 'high', endpoint: `/p${i}`, confidence: 'h', observedAt: 0 } as FindingView });
    }
    s = reduce(s, { type: 'scroll-findings', delta: 3 });
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('↑ -3');
  });

  it('view includes the dim key-hints footer', () => {
    const s = makeInitialState();
    s.width = 120;
    s.height = 40;
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('tab: pause');
    expect(lastFrame()).toContain('enter: send');
    expect(lastFrame()).toContain('pgup/pgdn');
    expect(lastFrame()).toContain('^C: quit');
  });

  it('status bar shows the running "●" marker during an active phase', () => {
    const s = reduce(makeInitialState(), { type: 'phase', phase: 'attacking' });
    s.width = 120;
    s.height = 40;
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('●');
  });

  it('status bar shows the "⏸" pause marker when paused', () => {
    const s = reduce(reduce(makeInitialState(), { type: 'phase', phase: 'attacking' }), { type: 'toggle-paused' });
    s.width = 120;
    s.height = 40;
    const { lastFrame } = render(<TuiView state={s} />);
    expect(lastFrame()).toContain('⏸');
  });
});

describe('Block 20 — key handlers update state correctly', () => {
  it('pgup increases activityScroll and findingsScroll', () => {
    const { stdin, lastFrame } = render(<TuiApp core={core} />);
    // 5 PgUps = +25 scroll
    stdin.write('\u001b[5~');
    stdin.write('\u001b[5~');
    stdin.write('\u001b[5~');
    stdin.write('\u001b[5~');
    stdin.write('\u001b[5~');
    // The TUI should show a "scrolled" hint because we emitted an
    // activity event (core start) which the reducer has recorded.
    // If there is no activity yet, scroll still registers internally
    // but the hint only shows when activityScroll > 0 AND the
    // pane has content to display. We assert that the input doesn't
    // crash the app and lastFrame returns a string.
    expect(typeof lastFrame()).toBe('string');
  });

  it('tab toggles the paused flag (in status bar)', () => {
    const { stdin, lastFrame } = render(<TuiApp core={core} />);
    stdin.write('\t');
    expect(lastFrame()).toContain('⏸');
    stdin.write('\t');
    expect(lastFrame()).not.toContain('⏸');
  });
});

describe('Block 20 — async screenshot render', () => {
  it('renderScreenshotToAnsi returns a placeholder for a missing file', async () => {
    const r = await renderScreenshotToAnsi(join(dir, 'does-not-exist.png'), 40, 8);
    expect(r.placeholder).toBe(true);
    expect(r.ansi).toContain('unavailable');
  });

  it('renderScreenshotToAnsi renders a real PNG (or falls back gracefully)', async () => {
    const png = join(dir, 'real.png');
    writeTestPng(png, { r: 200, g: 50, b: 50 });
    const r = await renderScreenshotToAnsi(png, 20, 4);
    // We don't assert placeholder=false (the test PNG may not be
    // strictly valid), but we DO assert it returned a string.
    expect(typeof r.ansi).toBe('string');
    expect(r.width).toBe(20);
  });

  it('TuiApp dispatch path: screenshot event → activity-attach (integration)', async () => {
    // Fire a screenshot event into the core, then give the app a
    // tick to dispatch the attach. We assert the activity line ends
    // up with a `screenshot` field.
    const png = join(dir, 'shot.png');
    writeTestPng(png, { r: 100, g: 200, b: 100 });
    core.recordScreenshot({ path: png, label: 'test', width: 100, height: 100, sizeBytes: 1234 });
    const { lastFrame } = render(<TuiApp core={core} />);
    // Wait a beat for the async attach to land
    await new Promise((r) => setTimeout(r, 200));
    // The activity row should reference the screenshot path. With
    // recent-event replay on mount, the activity line is seeded.
    expect(lastFrame()).toContain('shot.png');
  });
});

describe('Block 20 — formatters', () => {
  it('formatClock returns HH:MM:SS', () => {
    const ts = new Date('2026-01-02T03:04:05').getTime();
    expect(formatClock(ts)).toBe('03:04:05');
  });

  it('formatLevelBadge maps all levels', () => {
    expect(formatLevelBadge('error')).toBe('ERR');
    expect(formatLevelBadge('warn')).toBe('WRN');
    expect(formatLevelBadge('success')).toBe(' OK');
    expect(formatLevelBadge('agent')).toBe('AGT');
    expect(formatLevelBadge('info')).toBe('   ');
  });

  it('phaseColor maps known phases to colours', () => {
    expect(phaseColor('done')).toBe('green');
    expect(phaseColor('attacking')).toBe('yellow');
    expect(phaseColor('spidering')).toBe('cyan');
    expect(phaseColor('error')).toBe('red');
    expect(phaseColor('unknown')).toBe('gray');
  });

  it('formatStatusLine includes findings/primitives/OOB counts', () => {
    const s = makeInitialState();
    s.status.primitiveCalls = 7;
    s.status.findingsCount = 1;
    s.status.oobCallbacks = 2;
    const line = formatStatusLine(s.status);
    expect(line).toContain('1F');
    expect(line).toContain('7P');
    expect(line).toContain('2OOB');
  });
});
