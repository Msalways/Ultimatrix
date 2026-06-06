// tests/oast/wrapper.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OastServer } from '../../src/oast/server';
import { withOobCallback, buildOobPayload } from '../../src/oast/wrapper';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';

let dir: string;
let oast: OastServer;
let core: HuntCore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oob-'));
  oast = new OastServer(0);
  await oast.start();
  core = new HuntCore({ target: 'https://x.com', outDir: dir, llm: createMockLLMClient(), maxRuntimeSeconds: 60 });
  core.start();
});

afterEach(() => {
  core.stop('user-quit');
  oast.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('withOobCallback', () => {
  it('returns a probe even if no callback fires', async () => {
    const result = await withOobCallback({
      oast,
      core,
      category: 'ssrf',
      payloadTemplate: 'http://{host}/{uuid}/probe',
      endpoint: 'https://target.com/image',
      param: 'url',
      send: async () => ({ status: 200, body: 'no callback' }),
      pollMs: 200,
    });
    expect(result.callback).toBeNull();
    expect(result.probed.category).toBe('ssrf');
    expect(result.mutatedPayload).toContain('http://');
  });

  it('detects a callback and emits oob-callback event', async () => {
    let callback: any = null;
    core.on((e) => { if (e.type === 'oob-callback') callback = e.callback; });
    const result = await withOobCallback({
      oast,
      core,
      category: 'blind-xss',
      payloadTemplate: 'http://{host}/{uuid}/x',
      endpoint: 'https://target.com/comment',
      param: 'body',
      send: async (mutated) => {
        // Simulate the target firing a callback to our OOB URL.
        // Extract uuid from the URL path (segment after host).
        const m = mutated.match(/\/([0-9a-f]{12})\//);
        const uuid = m ? m[1] : null;
        if (uuid) {
          const url = `http://127.0.0.1:${oast.getPort()}/${uuid}/x`;
          await fetch(url).catch(() => undefined);
        }
        return { status: 200, body: 'ok' };
      },
      pollMs: 3000,
      pollIntervalMs: 200,
    });
    expect(result.callback).not.toBeNull();
    expect(callback).not.toBeNull();
    expect(callback!.source).toBe('blind-xss');
  });

  it('records the OOB URL in mutatedPayload', async () => {
    const result = await withOobCallback({
      oast,
      core,
      category: 'ssrf',
      payloadTemplate: 'http://{host}/{uuid}/probe',
      endpoint: '/x',
      param: 'q',
      send: async () => ({ status: 200, body: '' }),
      pollMs: 200,
    });
    expect(result.mutatedPayload).toContain(`:${oast.getPort()}/`);
  });
});

describe('buildOobPayload', () => {
  it('replaces placeholders', () => {
    const out = buildOobPayload('ssrf', 'host.test', 'abc123');
    expect(out).toContain('host.test');
    expect(out).toContain('abc123');
  });
});
