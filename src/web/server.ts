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
        const huntArgs = parseHuntFlags([
          '-t', msg.target,
          '-o', outDir,
          // Skip the test-generation phase — the web UI doesn't need
          // the Playwright specs and skipping speeds up the demo.
          '--skip', 'tests',
        ]);
        if (typeof msg.maxRuntimeMs === 'number') {
          huntArgs.maxRuntimeMs = msg.maxRuntimeMs;
        }
        // Forward LLM tokens to the browser as they arrive.
        huntArgs.onLLMToken = (label, chunk) => {
          emit(ws, { type: 'llm-token', label, chunk });
        };
        // Block 16: subscribe to the v4 HuntCore and forward every
        // event as a structured `v4-event` message. The frontend
        // turns this into a Findings panel + live activity feed.
        huntArgs.onHuntCore = (core) => {
          core.on((event) => {
            emit(ws, { type: 'v4-event', event });
          });
        };
        // Forward structured Composer lifecycle events. The UI's existing
        // handlers at lines 228-240 of index.html already know how to
        // render `plan` / `primitive` / `finding` / `chain` events.
        huntArgs.onComposerEvent = (event) => {
          switch (event.type) {
            case 'plan-proposed':
              emit(ws, {
                type: 'plan',
                technique: event.technique,
                rationale: event.rationale,
                confidence: event.confidence,
                planId: event.planId,
              });
              break;
            case 'plan-start':
              emit(ws, {
                type: 'plan',
                technique: event.technique,
                url: event.url,
                method: event.method,
                primitives: event.primitives,
                planId: event.planId,
              });
              break;
            case 'plan-end':
              emit(ws, {
                type: 'plan-end',
                planId: event.planId,
                technique: event.technique,
                findings: event.findings,
                durationMs: event.durationMs,
              });
              break;
            case 'primitive':
              emit(ws, {
                type: 'primitive',
                name: event.name,
                outcome: event.outcome,
                durationMs: event.durationMs,
                planId: event.planId,
              });
              break;
            case 'triage':
              emit(ws, {
                type: 'triage',
                planId: event.planId,
                primitive: event.name,
                vulnerable: event.vulnerable,
                confidence: event.confidence,
                severity: event.severity,
              });
              break;
            case 'specialist-spawn':
              emit(ws, {
                type: 'specialist',
                specialist: event.specialist,
                reason: event.reason,
              });
              break;
            case 'finding':
              emit(ws, {
                type: 'finding',
                findingType: event.findingType,
                endpoint: event.endpoint,
                severity: event.severity,
                confidence: event.confidence,
                param: event.param,
                id: event.id,
              });
              break;
            case 'log':
              emit(ws, {
                type: 'orch-log',
                level: event.level,
                message: event.message,
              });
              break;
          }
        };
        huntArgs.onPrimitive = (name, args, result) => {
          emit(ws, {
            type: 'primitive-raw',
            name,
            ok: result.ok,
            error: result.error,
            durationMs: result.durationMs,
          });
        };
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
      const addr = server.address();
      // `addr` is a string (named pipe) or AddressInfo. For TCP we read .port
      // so that tests using port=0 get back the real bound port.
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const close = (): Promise<void> =>
        new Promise((res) => {
          wss.close();
          server.close(() => res());
        });
      resolve({ port: actualPort, close });
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
