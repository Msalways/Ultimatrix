import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('LLMClient.stream()', () => {
  const ORIGINAL_CWD = process.cwd();
  const ORIGINAL_ENV = { ...process.env };
  let tmpDir: string | null = null;

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    process.env = { ...ORIGINAL_ENV };
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = null;
    }
  });

  it('emits tokens through onToken callback (mock)', async () => {
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient({ provider: 'mock' });
    const chunks: string[] = [];
    const result = await c.stream(
      { system: 'You are a planner.', user: 'Plan an XSS attack.', label: 'test' },
      (chunk) => chunks.push(chunk),
    );
    expect(chunks.length).toBeGreaterThan(0);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.provider).toBe('mock');
  });

  it('stream() returns same LLMCallResult shape as call()', async () => {
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient({ provider: 'mock' });
    const streamResult = await c.stream(
      { system: 'You are a planner.', user: 'Plan something.' },
      () => {},
    );
    const callResult = await c.call(
      { system: 'You are a planner.', user: 'Plan something.' },
    );
    expect(typeof streamResult.text).toBe('string');
    expect(typeof callResult.text).toBe('string');
    expect(streamResult.text.length).toBeGreaterThan(0);
    expect(callResult.text.length).toBeGreaterThan(0);
    expect(streamResult.provider).toBe(callResult.provider);
  });

  it('concatenates streamed chunks to match final text', async () => {
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient({ provider: 'mock' });
    const chunks: string[] = [];
    const result = await c.stream(
      { system: 'You are a planner.', user: 'Plan an XSS attack.' },
      (chunk) => chunks.push(chunk),
    );
    const joined = chunks.join('');
    expect(joined).toBe(result.text);
  });
});
