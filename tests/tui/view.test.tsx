// tests/tui/view.test.tsx
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render } from 'ink-testing-library';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TuiApp } from '../../src/tui/app';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;
let core: HuntCore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tui-'));
  core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
  core.start();
});

afterEach(() => {
  core.stop('user-quit');
  rmSync(dir, { recursive: true, force: true });
});

describe('TuiApp', () => {
  it('renders the status bar', () => {
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('phase:');
    // core.start() emits 'observing' before the TUI mounts, and the
    // TUI replays recent events on mount so the status shows the
    // post-start phase. The exact phase string depends on the core's
    // start sequence; just assert the status line is there.
    expect(frame).toMatch(/phase: (starting|observing)/);
  });

  it('renders the activity pane', () => {
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('activity');
  });

  it('renders the findings pane', () => {
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('findings');
  });

  it('renders the chat pane', () => {
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('chat');
  });

  it('shows finding when core emits one', () => {
    const f: AppModelFinding = {
      id: 'f1', type: 'reflected-xss', endpoint: '/s', param: 'q',
      evidence: {}, confidence: 'high', confirmed: true, severity: 'high',
    };
    core.recordFinding(f);
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('reflected-xss');
  });

  it('shows chat message when chat-message event fires', () => {
    core.recordChatMessage({ role: 'user', text: 'find a bug' });
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('find a bug');
  });

  it('shows llm-token streaming', () => {
    core.recordLLMToken({ source: 'composer', text: 'thinking…', done: false });
    const { lastFrame } = render(<TuiApp core={core} />);
    const frame = lastFrame();
    expect(frame).toContain('thinking');
  });

  it('invokes onChatMessage callback when user types', () => {
    let received = '';
    const { stdin } = render(<TuiApp core={core} onChatMessage={(t) => { received = t; }} />);
    stdin.write('hello');
    // backspace handling
    // then enter
    stdin.write('\r');
    expect(received).toBe('hello');
  });
});
