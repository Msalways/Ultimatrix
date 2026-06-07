/**
 * tests/web/api-endpoints.test.ts
 *
 * Block 19: tests for the read-only HTTP API endpoints that let the web
 * UI surface "what Playwright code is being generated" and "what the
 * spider discovered" without re-running anything.
 *
 *   - GET /api/live-spec?outDir=...   → main HuntCore live spec
 *   - GET /api/live-specs?outDir=...  → all per-worker spec files
 *   - GET /api/live-specs/content?outDir=...&name=... → one spec file
 *   - GET /api/app-model?outDir=...   → app-model.json with summary
 *
 * These run against the real web server (no LLM, no Playwright) so
 * they're fast and deterministic.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startWebServer } from '../../src/web/server';

function get(port: number, urlPath: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET' }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        let body: any = text;
        try { body = JSON.parse(text); } catch { /* keep as text */ }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('web server: read-only API endpoints (Block 19)', () => {
  let port: number;
  let close: () => Promise<void>;
  let tmpOut: string;

  beforeAll(async () => {
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-api-'));
    // Seed with some files we expect to read.
    fs.writeFileSync(path.join(tmpOut, 'live.spec.ts'), '// step 1: go to /foo\nawait page.goto("/foo");\n');
    fs.writeFileSync(path.join(tmpOut, 'live-n1.spec.ts'), '// node-n1\nawait page.goto("/a");\n');
    fs.writeFileSync(path.join(tmpOut, 'live-n2.spec.ts'), '// node-n2\nawait page.goto("/b");\n');
    fs.writeFileSync(path.join(tmpOut, 'app-model.json'), JSON.stringify({
      target: 'https://x.com',
      endpoints: [
        { path: '/a', method: 'GET' },
        { path: '/b', method: 'POST' },
      ],
      routes: ['/a', '/b'],
      forms: [],
      findings: [],
    }));
    // Also a non-spec file that should be ignored
    fs.writeFileSync(path.join(tmpOut, 'report.html'), '<html>report</html>');
    const res = await startWebServer({ port: 0, host: '127.0.0.1' });
    port = (res.port as unknown as { port: number }).port ?? res.port;
    close = res.close;
  });

  afterAll(async () => {
    await close();
    fs.rmSync(tmpOut, { recursive: true, force: true });
  });

  it('GET /api/live-spec returns the main live.spec.ts', async () => {
    const { status, body } = await get(port, `/api/live-spec?outDir=${encodeURIComponent(tmpOut)}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.exists).toBe(true);
    expect(body.content).toContain('page.goto("/foo")');
    expect(body.size).toBeGreaterThan(0);
    expect(typeof body.mtimeMs).toBe('number');
  });

  it('GET /api/live-spec returns ok:false when file missing', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-empty-'));
    try {
      const { status, body } = await get(port, `/api/live-spec?outDir=${encodeURIComponent(empty)}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(false);
      expect(body.exists).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('GET /api/live-specs returns all live-*.spec.ts files', async () => {
    const { status, body } = await get(port, `/api/live-specs?outDir=${encodeURIComponent(tmpOut)}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.specs)).toBe(true);
    const names = body.specs.map((s: any) => s.name);
    // main live.spec.ts does NOT match /^live-.*\.spec\.ts$/ — it starts
    // with "live." not "live-". So the per-node ones should be returned.
    expect(names).toContain('live-n1.spec.ts');
    expect(names).toContain('live-n2.spec.ts');
    // report.html and the main live.spec.ts are excluded
    expect(names).not.toContain('report.html');
    expect(names).not.toContain('live.spec.ts');
    expect(body.specs[0]).toHaveProperty('size');
    expect(body.specs[0]).toHaveProperty('mtimeMs');
  });

  it('GET /api/live-specs returns [] for empty outDir', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-empty2-'));
    try {
      const { status, body } = await get(port, `/api/live-specs?outDir=${encodeURIComponent(empty)}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.specs).toEqual([]);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('GET /api/live-specs/content returns a per-node spec', async () => {
    const { status, body } = await get(port,
      `/api/live-specs/content?outDir=${encodeURIComponent(tmpOut)}&name=${encodeURIComponent('live-n1.spec.ts')}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.content).toContain('node-n1');
  });

  it('GET /api/live-specs/content rejects names not matching live-*.spec.ts', async () => {
    const { status } = await get(port,
      `/api/live-specs/content?outDir=${encodeURIComponent(tmpOut)}&name=../app-model.json`);
    expect(status).toBe(400);
  });

  it('GET /api/live-specs/content returns 404 for non-existent name', async () => {
    const { status } = await get(port,
      `/api/live-specs/content?outDir=${encodeURIComponent(tmpOut)}&name=live-doesnotexist.spec.ts`);
    expect(status).toBe(404);
  });

  it('GET /api/app-model returns the app-model.json with summary', async () => {
    const { status, body } = await get(port, `/api/app-model?outDir=${encodeURIComponent(tmpOut)}`);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.summary.target).toBe('https://x.com');
    expect(body.summary.endpoints).toBe(2);
    expect(body.summary.routes).toBe(2);
    expect(body.summary.forms).toBe(0);
    expect(body.summary.findings).toBe(0);
    expect(body.model.endpoints).toHaveLength(2);
  });

  it('GET /api/app-model returns ok:false when missing', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-empty3-'));
    try {
      const { status, body } = await get(port, `/api/app-model?outDir=${encodeURIComponent(empty)}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(false);
      expect(body.exists).toBe(false);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });

  it('GET /api/app-model handles invalid JSON gracefully', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-broken-'));
    try {
      fs.writeFileSync(path.join(broken, 'app-model.json'), '{not json');
      const { status, body } = await get(port, `/api/app-model?outDir=${encodeURIComponent(broken)}`);
      expect(status).toBe(200);
      expect(body.ok).toBe(true);
      expect(body.summary).toBeNull();
    } finally {
      fs.rmSync(broken, { recursive: true, force: true });
    }
  });
});
