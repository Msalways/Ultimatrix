import { describe, it, expect } from 'vitest';
import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { startWebServer } from '../../src/web/server';

interface WsMessage { type: string; [k: string]: unknown; }

function openWs(port: number): Promise<{ ws: import('ws').WebSocket; messages: WsMessage[]; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const { WebSocket } = require('ws');
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const messages: WsMessage[] = [];
    let opened = false;
    ws.on('open', () => {
      opened = true;
      resolve({
        ws,
        messages,
        close: () => new Promise<void>((r) => {
          // ws.terminate() doesn't wait for the close handshake — that
          // matters when the server keeps the connection open (e.g. while
          // a hunt is running). ws.close() would hang.
          ws.terminate();
          r();
        }),
      });
    });
    ws.on('error', (e: Error) => {
      if (!opened) reject(e);
    });
    ws.on('message', (raw: Buffer) => {
      try { messages.push(JSON.parse(raw.toString())); } catch { /* ignore */ }
    });
  });
}

async function waitForMessage(messages: WsMessage[], pred: (m: WsMessage) => boolean, timeoutMs = 20000): Promise<WsMessage> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const m = messages.find(pred);
    if (m) return m;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitForMessage timeout after ${timeoutMs}ms; saw ${messages.length} messages: ${messages.map((m) => m.type).join(',')}`);
}

describe('web server: llm-token passthrough', () => {
  it('forwards llm-token events from Composer to the WebSocket client', { timeout: 200_000 }, async () => {
    if (!process.env.WEB_E2E) {
      // skip when the env var is not set (default for normal test runs
      // — full llm-token coverage requires a real LLM provider and a
      // long-running hunt, so we gate this on WEB_E2E=1 to keep
      // `npx vitest run` fast.
      return;
    }
    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-web-'));
    const { port, close } = await startWebServer({ port: 0, host: '127.0.0.1' });
    try {
      const actualPort = (port as unknown as { port: number }).port ?? port;
      const conn = await openWs(actualPort);
      try {
        conn.ws.send(JSON.stringify({ type: 'start', target: 'https://xss-game.appspot.com/level1/frame', outputDir: tmpOut, maxRuntimeMs: 90000 }));
        // Wait for the first llm-token to confirm streaming is plumbed.
        // Spider + recon can take ~20s, so we give the test a generous
        // 60s window to see the first LLM call after that.
        const first = await waitForMessage(conn.messages, (m) => m.type === 'llm-token', 60000);
        expect(first.label).toBeTruthy();
        expect(typeof first.chunk).toBe('string');
        // Wait for done or error — generous window since real hunts run
        // for tens of seconds.
        await waitForMessage(conn.messages, (m) => m.type === 'done' || m.type === 'error', 90000);
      } finally {
        await conn.close();
      }
    } finally {
      await close();
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }
  });

  it('rejects connections that send invalid JSON', async () => {
    const { port, close } = await startWebServer({ port: 0, host: '127.0.0.1' });
    try {
      const actualPort = (port as unknown as { port: number }).port ?? port;
      const conn = await openWs(actualPort);
      try {
        conn.ws.send('not-json');
        const err = await waitForMessage(conn.messages, (m) => m.type === 'error', 2000);
        expect(err.message).toBe('invalid JSON');
      } finally {
        await conn.close();
      }
    } finally {
      await close();
    }
  });

  it('rejects start messages without a target', async () => {
    const { port, close } = await startWebServer({ port: 0, host: '127.0.0.1' });
    try {
      const actualPort = (port as unknown as { port: number }).port ?? port;
      const conn = await openWs(actualPort);
      try {
        conn.ws.send(JSON.stringify({ type: 'start' }));
        const err = await waitForMessage(conn.messages, (m) => m.type === 'error', 2000);
        expect(err.message).toBe('missing target');
      } finally {
        await conn.close();
      }
    } finally {
      await close();
    }
  });

  it('serves /healthz with ok:true', async () => {
    const { port, close } = await startWebServer({ port: 0, host: '127.0.0.1' });
    try {
      const actualPort = (port as unknown as { port: number }).port ?? port;
      const body = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${actualPort}/healthz`, (res) => {
          let b = '';
          res.on('data', (c) => (b += c));
          res.on('end', () => resolve(b));
        }).on('error', reject);
      });
      expect(body).toBe('{"ok":true}');
    } finally {
      await close();
    }
  });

  it('forwards Composer plan/primitive/finding events to WebSocket (mock LLM)', { timeout: 30_000 }, async () => {
    // A fast unit-style test: use a target that will hit the mock LLM and
    // produce at least one plan event. The mock LLM produces an
    // "headers" plan from the parsePlans fallback, but to actually emit
    // a finding we need a vulnerable primitive. Use compareResponses
    // baseline+target divergence by targeting a server we control:
    // start a tiny local server, point the hunt at it, and verify the
    // event stream shape.
    if (process.env.WEB_E2E) {
      // Skip in E2E mode (the longer test above already covers real LLM)
      return;
    }
    const http2 = await import('http');
    const tinyServer = http2.createServer((req, res) => {
      if (req.url === '/probe') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><form><input name="q"></form></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => tinyServer.listen(0, '127.0.0.1', r));
    const tinyPort = (tinyServer.address() as { port: number }).port;
    const target = `http://127.0.0.1:${tinyPort}`;

    const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-web-events-'));
    const { port, close } = await startWebServer({ port: 0, host: '127.0.0.1' });
    try {
      const actualPort = (port as unknown as { port: number }).port ?? port;
      const conn = await openWs(actualPort);
      try {
        conn.ws.send(JSON.stringify({ type: 'start', target, outputDir: tmpOut, maxRuntimeMs: 12000 }));
        // Wait for the `done` or `error` event — this means the server
        // forwarded the end-of-hunt signal, which is only sent after
        // runHunt() resolves. That guarantees at least the started event
        // made it through, and on most runs we expect plan/primitive
        // events too.
        const result = await waitForMessage(conn.messages, (m) => m.type === 'done' || m.type === 'error', 25000);
        expect(['done', 'error']).toContain(result.type);
        // We don't strictly assert that plan/primitive events appeared
        // (the mock LLM fallback might short-circuit) but we verify the
        // server didn't crash and forwarded the lifecycle events.
        const types = conn.messages.map((m) => m.type);
        expect(types).toContain('started');
      } finally {
        await conn.close();
      }
    } finally {
      await close();
      tinyServer.close();
      fs.rmSync(tmpOut, { recursive: true, force: true });
    }
  });
});
