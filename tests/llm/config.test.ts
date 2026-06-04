import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('LLMClient config loading', () => {
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

  it('falls back to mock when no config and no env', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-llm-'));
    fs.writeFileSync(path.join(tmpDir, 'ultimatrix.yaml'), 'provider: openai\nmodel: gpt-4\n');
    process.chdir(tmpDir);
    // No OPENAI_API_KEY set
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    expect(c.detectProvider()).toBe('mock');
  });

  it('uses provider from ultimatrix.yaml when apiKey is in env', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-llm-'));
    fs.writeFileSync(path.join(tmpDir, 'ultimatrix.yaml'), 'provider:\n  name: nvidia\n  model: openai/gpt-oss-120b\n');
    process.chdir(tmpDir);
    process.env.NVIDIA_API_KEY = 'nvapi-test';
    delete process.env.OPENAI_API_KEY;
    delete process.env.GROQ_API_KEY;
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    expect(c.detectProvider()).toBe('nvidia');
  });

  it('uses provider from ultimatrix.yaml with inline apiKey', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-llm-'));
    fs.writeFileSync(
      path.join(tmpDir, 'ultimatrix.yaml'),
      'provider:\n  name: openai\n  model: gpt-4o\n  apiKey: sk-test-from-yaml\n',
    );
    process.chdir(tmpDir);
    delete process.env.OPENAI_API_KEY;
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    expect(c.detectProvider()).toBe('openai');
    expect(c.isReal()).toBe(true);
  });

  it('respects env var priority when no yaml is present', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-llm-'));
    process.chdir(tmpDir);
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.MISTRAL_API_KEY;
    delete process.env.TOGETHER_API_KEY;
    delete process.env.NVIDIA_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY;
    process.env.GROQ_API_KEY = 'gsk-test';
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient();
    expect(c.detectProvider()).toBe('groq');
  });

  it('explicit provider config overrides auto-detection', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-llm-'));
    process.chdir(tmpDir);
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GROQ_API_KEY = 'gsk-test';
    const { LLMClient } = await import('../../src/llm/client');
    const c = new LLMClient({ provider: 'groq' });
    expect(c.detectProvider()).toBe('groq');
  });
});
