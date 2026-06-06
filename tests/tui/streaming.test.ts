// tests/tui/streaming.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { streamToCore } from '../../src/llm/streaming';
import { createMockLLMClient } from '../helpers/mock-llm';
import type { LLMCall, LLMCallResult } from '../../src/llm/client';

let dir: string;
let core: HuntCore;
let llm: ReturnType<typeof createMockLLMClient>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stream-'));
  llm = createMockLLMClient({ defaultText: 'Hello world' });
  core = new HuntCore({ target: 'https://x.com', outDir: dir, llm, maxRuntimeSeconds: 60 });
  core.start();
});

afterEach(() => {
  core.stop('user-quit');
  rmSync(dir, { recursive: true, force: true });
});

describe('LLM streaming to HuntCore', () => {
  it('emits llm-token events while streaming', async () => {
    const tokens: string[] = [];
    core.on((e) => {
      if (e.type === 'llm-token' && e.token.text.length > 0) tokens.push(e.token.text);
    });
    const call: LLMCall = { system: 's', user: 'u' };
    const result: LLMCallResult = await streamToCore(llm, call, { core, source: 'composer' });
    expect(result.text).toBe('Hello world');
    expect(tokens.length).toBeGreaterThan(0);
  });

  it('emits a final done token', async () => {
    let doneSeen = false;
    core.on((e) => {
      if (e.type === 'llm-token' && e.token.done) doneSeen = true;
    });
    const call: LLMCall = { system: 's', user: 'u' };
    await streamToCore(llm, call, { core, source: 'triage' });
    expect(doneSeen).toBe(true);
  });

  it('passes through the call site label', async () => {
    const sources: string[] = [];
    core.on((e) => {
      if (e.type === 'llm-token') sources.push(e.token.source);
    });
    const call: LLMCall = { system: 's', user: 'u' };
    await streamToCore(llm, call, { core, source: 'specialist' });
    expect(sources).toContain('specialist');
  });

  it('invokes onChunk for each chunk', async () => {
    const chunks: string[] = [];
    const call: LLMCall = { system: 's', user: 'u' };
    await streamToCore(llm, call, {
      core,
      source: 'chat',
      onChunk: (c) => chunks.push(c),
    });
    expect(chunks.join('')).toBe('Hello world');
  });
});
