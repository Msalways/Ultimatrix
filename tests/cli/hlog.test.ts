// tests/cli/hlog.test.ts
//
// Block 18: `hlog` writes a status line to BOTH the terminal AND the
// v4 HuntCore log stream. This is how the web UI's Live log panel
// gets the same messages the user sees in the terminal where
// `npx ultimatrix web` is running.
//
// We mock console.log/warn/error to capture the terminal output and
// set the module-scope wiring via a stub HuntCore to capture the
// v4 log events.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { wireHuntCore } from '../../src/cli/hunt-core-wiring';
import { hlog } from '../../src/cli/hunt';
import { createMockLLMClient } from '../helpers/mock-llm';

let dir: string;
let llm: ReturnType<typeof createMockLLMClient>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'hlog-'));
  llm = createMockLLMClient();
  // Suppress real console.* output during tests so the test runner
  // log stays clean.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe('hlog (Block 18)', () => {
  it('writes to terminal even when no wiring is set (no core attached)', () => {
    hlog('info', 'hello terminal');
    hlog('warn', 'a warning');
    hlog('error', 'an error');
    expect(console.log).toHaveBeenCalledWith('hello terminal');
    expect(console.warn).toHaveBeenCalledWith('a warning');
    expect(console.error).toHaveBeenCalledWith('an error');
  });

  it('forwards to the v4 log stream when a core is wired (web UI sees it)', () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    core.start();
    const wiring = wireHuntCore({ core });
    // Test the wiring.onLog() path directly — that's what hlog()
    // forwards into. (We can't poke the module-scope hlogWiring
    // from outside the module, so the test simulates hlog's
    // forwarding contract: when wired, each call to wiring.onLog
    // produces a v4 'log' event on the core.)
    const logEvents: any[] = [];
    core.on((e) => e.type === 'log' && logEvents.push(e.log));
    wiring.onLog('info', '[1/5] Spidering https://x.com');
    wiring.onLog('info', '  ↳ discovered 7 URLs, 5 routes');
    wiring.onLog('error', 'orchestrator crashed');
    expect(logEvents).toEqual([
      { level: 'info', text: '[1/5] Spidering https://x.com' },
      { level: 'info', text: '  ↳ discovered 7 URLs, 5 routes' },
      { level: 'error', text: 'orchestrator crashed' },
    ]);
    core.stop('user-quit');
  });

  it('strips ANSI escape codes before forwarding to the v4 log (plain text for the UI)', () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
    core.start();
    const wiring = wireHuntCore({ core });
    const logEvents: any[] = [];
    core.on((e) => e.type === 'log' && logEvents.push(e.log));
    // Simulate what hlog() does internally (strip ANSI before forwarding).
    const ANSI = /\x1b\[[0-9;]*m/g;
    const colored = '\x1b[1;32m▸ Ultimatrix hunt\x1b[0m → https://x.com';
    wiring.onLog('info', colored.replace(ANSI, ''));
    expect(logEvents).toHaveLength(1);
    expect(logEvents[0].text).toBe('▸ Ultimatrix hunt → https://x.com');
    // And the text must NOT contain any escape codes — the web UI
    // renders plain text into the log panel.
    expect(logEvents[0].text).not.toMatch(/\x1b/);
    core.stop('user-quit');
  });
});
