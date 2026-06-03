// src/web/server.ts
//
// Minimal web UI for the Ultimatrix hunt.
//
//   - Serves a single static HTML page (src/web/static/index.html)
//   - Accepts WebSocket connections
//   - Clients send {type:"start", target, outputDir} to kick off a hunt
//   - Server streams agent events back: {type, ...}
//
// We do NOT use Express — Node's built-in http + the already-installed `ws`
// package is enough. The page is one self-contained HTML file.

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { WebSocketServer, type WebSocket } from 'ws';
// NOTE: runHunt / parseHuntFlags are imported lazily inside the WS handler
// to avoid loading the entire CLI graph (Playwright, browser-tools) when
// the test only wants to check that /healthz works.

export interface WebServerOptions {
  port?: number;
  host?: string;
}

export function startWebServer(opts: WebServerOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const port = opts.port ?? 3000;
  const host = opts.host ?? '0.0.0.0';

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400).end();
      return;
    }
    if (req.url === '/' || req.url === '/index.html') {
      const htmlPath = path.join(__dirname, 'static', 'index.html');
      if (!fs.existsSync(htmlPath)) {
        // Fallback: try the src path (dev mode, before tsup build)
        const devPath = path.resolve(__dirname, '..', '..', 'src', 'web', 'static', 'index.html');
        if (fs.existsSync(devPath)) {
          const html = fs.readFileSync(devPath, 'utf-8');
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(html);
          return;
        }
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Missing index.html — run `npx tsup` to build the web UI.');
        return;
      }
      const html = fs.readFileSync(htmlPath, 'utf-8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg: { type: string; target?: string; outputDir?: string; maxRuntimeMs?: number };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }));
        return;
      }
      if (msg.type === 'start') {
        if (!msg.target) {
          ws.send(JSON.stringify({ type: 'error', message: 'missing target' }));
          return;
        }
        const outDir = msg.outputDir ?? './output';
        try {
          fs.mkdirSync(outDir, { recursive: true });
        } catch { /* ignore */ }
        const { parseHuntFlags, runHunt } = await import('../cli/hunt');
        const huntArgs = parseHuntFlags(['-t', msg.target, '-o', outDir, '--auto', '--no-tests']);
        if (typeof msg.maxRuntimeMs === 'number') {
          huntArgs.maxRuntimeMs = msg.maxRuntimeMs;
        }
        emit(ws, { type: 'started', target: msg.target, outputDir: outDir });
        try {
          await runHunt(huntArgs);
          emit(ws, { type: 'done', outputDir: outDir });
        } catch (e) {
          emit(ws, { type: 'error', message: (e as Error).message });
        }
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const close = (): Promise<void> =>
        new Promise((res) => {
          wss.close();
          server.close(() => res());
        });
      resolve({ port, close });
    });
  });
}

function emit(ws: WebSocket, event: unknown): void {
  try {
    ws.send(JSON.stringify(event));
  } catch { /* ignore */ }
}

if (require.main === module) {
  const port = parseInt(process.env.PORT ?? '3000', 10);
  startWebServer({ port }).then(({ port: p }) => {
    console.log(`Ultimatrix web UI listening on http://localhost:${p}`);
    console.log(`  Open in a browser to start a hunt.`);
  });
}
