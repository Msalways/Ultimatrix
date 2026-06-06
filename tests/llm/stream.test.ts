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

  it('emits tokens through onToken callback (mock fallback)', async () => {
    // Force mock by clearing all provider envs and pointing cwd at an
    // empty tmp dir (so no ultimatrix.yaml provider is detected).
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-stream-'));
    process.chdir(tmpDir);
    for (const k of ['OPENAI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','GOOGLE_API_KEY','OPENROUTER_API_KEY','MISTRAL_API_KEY','TOGETHER_API_KEY','NVIDIA_API_KEY','AZURE_OPENAI_API_KEY','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY']) {
      delete process.env[k];
    }
    delete process.env.ULTIMATRIX_LLM_DEBUG;
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-stream-'));
    process.chdir(tmpDir);
    for (const k of ['OPENAI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','NVIDIA_API_KEY']) {
      delete process.env[k];
    }
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    const streamResult = await c.stream(
      { system: 'You are a planner.', user: 'Plan something.' },
      () => {},
    );
    const callResult = await c.call(
      { system: 'You are a planner.', user: 'Plan something.' },
    );
    // Both should return the same shape and produce some text
    expect(typeof streamResult.text).toBe('string');
    expect(typeof callResult.text).toBe('string');
    expect(streamResult.text.length).toBeGreaterThan(0);
    expect(callResult.text.length).toBeGreaterThan(0);
    // Same provider used in both
    expect(streamResult.provider).toBe(callResult.provider);
  });

  it('concatenates streamed chunks to match final text', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-stream-'));
    process.chdir(tmpDir);
    for (const k of ['OPENAI_API_KEY','GROQ_API_KEY','ANTHROPIC_API_KEY','NVIDIA_API_KEY']) {
      delete process.env[k];
    }
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    const chunks: string[] = [];
    const result = await c.stream(
      { system: 'You are a planner.', user: 'Plan an XSS attack.' },
      (chunk) => chunks.push(chunk),
    );
    const joined = chunks.join('');
    // Mock fallback emits the full text in one chunk, so joined === result.text
    expect(joined).toBe(result.text);
  });
});
