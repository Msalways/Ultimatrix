import { describe, it, expect, afterAll } from 'vitest';
import { startWebServer } from '../../src/web/server';
import * as fs from 'fs';
import * as path from 'path';

describe('web server', () => {
  const port = 31987 + Math.floor(Math.random() * 1000);
  let handle: { close: () => Promise<void> } | null = null;

  afterAll(async () => {
    if (handle) await handle.close();
  });

  it('serves the static index.html at /', async () => {
    handle = await startWebServer({ port, host: '127.0.0.1' });
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Ultimatrix');
    expect(body).toContain('AI security operator');
  });

  it('serves /healthz as JSON ok', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"ok":true');
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/nonexistent`);
    expect(res.status).toBe(404);
  });
});
