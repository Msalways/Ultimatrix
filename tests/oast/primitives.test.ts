// tests/oast/primitives.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OastServer } from '../../src/oast/server';
import { ssrfPrimitive, blindXssPrimitive, blindSqliPrimitive, xxePrimitive, deserializationPrimitive, OOB_PRIMITIVES } from '../../src/oast/primitives';
import { HuntCore } from '../../src/hunt/core';
import { createMockLLMClient } from '../helpers/mock-llm';

let dir: string;
let oast: OastServer;
let core: HuntCore;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'oob-p-'));
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

describe('OOB primitives', () => {
  it('exports 5 primitives', () => {
    expect(Object.keys(OOB_PRIMITIVES)).toHaveLength(5);
  });

  it('ssrf primitive injects an http URL', async () => {
    const result = await ssrfPrimitive({
      oast, core,
      payloadTemplate: 'http://{host}/{uuid}/ssrf',  // ignored — primitive uses its own
      endpoint: '/image', param: 'url',
      send: async (m) => ({ status: 200, body: m }),
      pollMs: 200,
    });
    expect(result.mutatedPayload).toMatch(/^http:\/\//);
    expect(result.probed.category).toBe('ssrf');
  });

  it('blindXss primitive injects an XSS-style tag', async () => {
    const result = await blindXssPrimitive({
      oast, core,
      payloadTemplate: 'noop',
      endpoint: '/comment', param: 'body',
      send: async (m) => ({ status: 200, body: m }),
      pollMs: 200,
    });
    expect(result.mutatedPayload).toContain('<');
    expect(result.mutatedPayload).toContain('>');
    expect(result.probed.category).toBe('blind-xss');
  });

  it('blindSqli primitive injects SQL keywords', async () => {
    const result = await blindSqliPrimitive({
      oast, core,
      payloadTemplate: 'noop',
      endpoint: '/api/users', param: 'q',
      send: async (m) => ({ status: 200, body: m }),
      pollMs: 200,
    });
    expect(result.mutatedPayload.toUpperCase()).toMatch(/UNION|EXEC|SELECT/);
    expect(result.probed.category).toBe('blind-sqli');
  });

  it('xxe primitive injects an XML entity', async () => {
    const result = await xxePrimitive({
      oast, core,
      payloadTemplate: 'noop',
      endpoint: '/api/xml', param: 'xml',
      send: async (m) => ({ status: 200, body: m }),
      pollMs: 200,
    });
    expect(result.mutatedPayload).toContain('<?xml');
    expect(result.mutatedPayload).toContain('ENTITY');
    expect(result.probed.category).toBe('xxe');
  });

  it('deserialization primitive includes a host+uuid reference', async () => {
    const result = await deserializationPrimitive({
      oast, core,
      payloadTemplate: 'noop',
      endpoint: '/api/import', param: 'data',
      send: async (m) => ({ status: 200, body: m }),
      pollMs: 200,
    });
    expect(result.mutatedPayload).toContain(oast.getPort().toString());
    expect(result.probed.category).toBe('deserialization');
  });
});
