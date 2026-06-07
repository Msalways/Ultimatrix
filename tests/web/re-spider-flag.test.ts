/**
 * tests/web/re-spider-flag.test.ts
 *
 * Block 19: when the WS start message arrives with `reSpider: true`,
 * the server deletes the cached `app-model.json` so runHunt falls
 * through to a fresh crawl. (The CLI hunt's own stale-model detection
 * at hunt.ts:118-133 would also re-spider, but the user explicitly
 * asked for a force-respider — clearer to do it at the start.)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startWebServer } from '../../src/web/server';

function openWs(port: number): Promise<{ ws: import('ws').WebSocket; messages: any[]; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const { WebSocket } = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: any[] = [];
    let opened = false;
    ws.on('open', () => {
      opened = true;
      resolve({
        ws,
        messages,
        close: () => new Promise<void>((r) => { ws.terminate(); r(); }),
      });
    });
    ws.on('error', (e: Error) => { if (!opened) reject(e); });
    ws.on('message', (raw: Buffer) => { try { messages.push(JSON.parse(raw.toString())); } catch {} });
  });
}

describe('web server: reSpider flag (Block 19)', () => {
  let port: number;
  let close: () => Promise<void>;
  let tmpOut: string;

  beforeAll(async () => {
    tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-respider-'));
    fs.writeFileSync(path.join(tmpOut, 'app-model.json'), JSON.stringify({
      target: 'https://old.example.com',
      endpoints: [{ path: '/old', method: 'GET' }],
    }));
    const res = await startWebServer({ port: 0, host: '127.0.0.1' });
    port = (res.port as unknown as { port: number }).port ?? res.port;
    close = res.close;
  });

  afterAll(async () => {
    await close();
    fs.rmSync(tmpOut, { recursive: true, force: true });
  });

  it('with reSpider=true, deletes app-model.json before runHunt', async () => {
    // Confirm file exists first
    expect(fs.existsSync(path.join(tmpOut, 'app-model.json'))).toBe(true);
    const conn = await openWs(port);
    try {
      // Use a local target so the hunt doesn't take long. We don't
      // need it to actually find vulns — we only need the server to
      // delete the file BEFORE runHunt starts. runHunt will see no
      // app-model.json and spider from scratch.
      conn.ws.send(JSON.stringify({
        type: 'start',
        target: 'http://127.0.0.1:1/', // unreachable; we'll error fast
        outputDir: tmpOut,
        reSpider: true,
        maxRuntimeMs: 5000,
      }));
      // Wait for the server to delete the file. The deletion happens
      // synchronously in the WS handler, before runHunt is awaited.
      // We can poll the file system to confirm.
      const start = Date.now();
      while (Date.now() - start < 5000) {
        if (!fs.existsSync(path.join(tmpOut, 'app-model.json'))) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(fs.existsSync(path.join(tmpOut, 'app-model.json'))).toBe(false);
    } finally {
      await conn.close();
    }
  }, 20_000);

  it('with reSpider=false (default), does NOT delete app-model.json', async () => {
    // Re-seed the file
    const modelPath = path.join(tmpOut, 'app-model.json');
    fs.writeFileSync(modelPath, JSON.stringify({ target: 'https://x.com', endpoints: [] }));
    const conn = await openWs(port);
    try {
      conn.ws.send(JSON.stringify({
        type: 'start',
        target: 'http://127.0.0.1:1/',
        outputDir: tmpOut,
        reSpider: false,
        maxRuntimeMs: 5000,
      }));
      // Give the server a moment to (not) delete
      await new Promise((r) => setTimeout(r, 500));
      expect(fs.existsSync(modelPath)).toBe(true);
    } finally {
      await conn.close();
    }
  }, 20_000);
});
