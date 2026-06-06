// tests/ci/runner.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';
import { runCi, defaultCiOutputPath } from '../../src/ci/runner';
import { computeExitCode } from '../../src/ci/exit-code';
import type { AppModelFinding } from '../../src/core/app-model';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ci-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('CI runner', () => {
  it('produces JSON output and writes file', async () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    const outFile = join(dir, 'report.json');
    const promise = runCi({
      core,
      format: 'json',
      failOn: 'high',
      outputFile: outFile,
      printToStdout: false,
    });
    // Inject a finding after a tick.
    setImmediate(() => {
      const f: AppModelFinding = { id: 'f1', type: 'xss', endpoint: '/x', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'high' };
      core.recordFinding(f);
      core.stop('user-quit');
    });
    const result = await promise;
    expect(result.exitCode).toBe(1);
    expect(existsSync(outFile)).toBe(true);
    const body = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(body.findings).toHaveLength(1);
  });

  it('produces SARIF output', async () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    const outFile = join(dir, 'report.sarif');
    const promise = runCi({ core, format: 'sarif', failOn: 'high', outputFile: outFile, printToStdout: false });
    setImmediate(() => {
      core.recordFinding({ id: 'f1', type: 'sqli', endpoint: '/x', param: 'q', evidence: {}, confidence: 'high', confirmed: true, severity: 'critical' });
      core.stop('user-quit');
    });
    const result = await promise;
    expect(result.exitCode).toBe(2);
    const sarif = JSON.parse(readFileSync(outFile, 'utf8'));
    expect(sarif.version).toBe('2.1.0');
  });

  it('produces plain output', async () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    const outFile = join(dir, 'report.txt');
    const promise = runCi({ core, format: 'plain', failOn: 'high', outputFile: outFile, printToStdout: false });
    setImmediate(() => {
      core.recordFinding({ id: 'f1', type: 'x', endpoint: '/x', param: 'q', evidence: {}, confidence: 'low', confirmed: false, severity: 'low' });
      core.stop('user-quit');
    });
    const result = await promise;
    // low finding, failOn=high -> exit 0
    expect(result.exitCode).toBe(0);
    const text = readFileSync(outFile, 'utf8');
    expect(text).toContain('Ultimatrix hunt report');
  });

  it('exit code is 0 for no findings', async () => {
    const core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
    const outFile = join(dir, 'report.json');
    const promise = runCi({ core, format: 'json', failOn: 'high', outputFile: outFile, printToStdout: false });
    setImmediate(() => core.stop('user-quit'));
    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(result.reason).toContain('No findings');
  });

  it('defaultCiOutputPath returns sensible paths', () => {
    expect(defaultCiOutputPath('out', 'json')).toMatch(/report\.json$/);
    expect(defaultCiOutputPath('out', 'sarif')).toMatch(/report\.sarif$/);
    expect(defaultCiOutputPath('out', 'plain')).toMatch(/report\.plain$/);
  });
});
