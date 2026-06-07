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
    // Block 19: surface the on-disk live spec + app-model so the UI can
    // show "what Playwright code is being generated" and "what the spider
    // discovered" without re-running anything. outDir defaults to ./output.
    if (req.url && (req.url.startsWith('/api/live-spec') || req.url.startsWith('/api/app-model'))) {
      const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      const outDir = url.searchParams.get('outDir') || './output';
      const safe = path.resolve(outDir);
      try {
        if (req.url === '/api/live-spec' || req.url.startsWith('/api/live-spec?')) {
          const fp = path.join(safe, 'live.spec.ts');
          if (!fs.existsSync(fp)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, exists: false, path: fp }));
            return;
          }
          const content = fs.readFileSync(fp, 'utf-8');
          const stat = fs.statSync(fp);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, exists: true, path: fp, content, mtimeMs: stat.mtimeMs, size: stat.size }));
          return;
        }
        if (req.url === '/api/live-specs' || req.url.startsWith('/api/live-specs?')) {
          if (!fs.existsSync(safe)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, exists: true, specs: [] }));
            return;
          }
          const files = fs.readdirSync(safe).filter((f) => /^live-.*\.spec\.ts$/.test(f));
          const specs = files.map((f) => {
            const fp = path.join(safe, f);
            const stat = fs.statSync(fp);
            return { path: fp, name: f, size: stat.size, mtimeMs: stat.mtimeMs };
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, exists: true, specs }));
          return;
        }
        if (req.url.startsWith('/api/live-specs/content')) {
          // /api/live-specs/content?outDir=...&name=live-foo.spec.ts
          const name = url.searchParams.get('name');
          if (!name || !/^live-.*\.spec\.ts$/.test(name)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'missing or invalid name' }));
            return;
          }
          const fp = path.join(safe, name);
          if (!fp.startsWith(safe) || !fs.existsSync(fp)) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'not found' }));
            return;
          }
          const content = fs.readFileSync(fp, 'utf-8');
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, path: fp, content }));
          return;
        }
        // /api/app-model
        const fp = path.join(safe, 'app-model.json');
        if (!fs.existsSync(fp)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, exists: false, path: fp }));
          return;
        }
        const raw = fs.readFileSync(fp, 'utf-8');
        let model: any = null;
        try { model = JSON.parse(raw); } catch { /* leave null */ }
        const summary = model ? {
          target: model.target,
          endpoints: Array.isArray(model.endpoints) ? model.endpoints.length : 0,
          findings: Array.isArray(model.findings) ? model.findings.length : 0,
          routes: Array.isArray(model.routes) ? model.routes.length : 0,
          forms: Array.isArray(model.forms) ? model.forms.length : 0,
        } : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, exists: true, path: fp, summary, model }));
        return;
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
        return;
      }
    }
    res.writeHead(404).end();
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws) => {
    ws.on('message', async (raw) => {
      let msg: { type: string; target?: string; outputDir?: string; maxRuntimeMs?: number; reSpider?: boolean; skipSpider?: boolean };
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
        // Block 19: reSpider=true forces a fresh crawl by deleting the
        // cached app-model.json. The CLI hunt would otherwise load it
        // and skip spidering. We keep live.spec.ts so the user can see
        // what the previous run captured.
        if (msg.reSpider) {
          const modelPath = path.join(outDir, 'app-model.json');
          if (fs.existsSync(modelPath)) {
            try { fs.unlinkSync(modelPath); } catch { /* ignore */ }
          }
        }
        const { parseHuntFlags, runHunt } = await import('../cli/hunt');
        const huntFlagArgs: string[] = [
          '-t', msg.target,
          '-o', outDir,
          // Skip the test-generation phase — the web UI doesn't need
          // the Playwright specs and skipping speeds up the demo.
          // Skip the interactive REPL — the web UI has no terminal
          // for the user to type into, and the REPL would block
          // runHunt from returning. The orchestrator runs alone.
          '--skip', 'tests,interactive',
        ];
        if (msg.skipSpider) huntFlagArgs.push('--skip', 'spider');
        const huntArgs = parseHuntFlags(huntFlagArgs);
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
        // Block 21: the agent-loop emits `agent-turn`, `sub-agent-spawn`,
        // `sub-agent-result`, and `agent-trace` — these previously had
        // no `case` here and were silently dropped, leaving the web UI's
        // Agent tree / LLM stream / Findings panels empty even when
        // autonomous mode found real bugs. We forward them and also add
        // a `default:` clause so unknown event types are visible in dev
        // (never silently swallowed again).
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
            case 'agent-turn':
              emit(ws, {
                type: 'agent-turn',
                turn: event.turn,
                thought: event.thought,
                tool: event.tool,
                ok: event.ok,
                durationMs: event.durationMs,
              });
              break;
            case 'sub-agent-spawn':
              emit(ws, {
                type: 'sub-agent-spawn',
                task: event.task,
                tools: event.tools,
                maxAttempts: event.maxAttempts,
                strategy: event.strategy,
              });
              break;
            case 'sub-agent-result':
              emit(ws, {
                type: 'sub-agent-result',
                task: event.task,
                outcome: event.outcome,
                findings: event.findings,
                durationMs: event.durationMs,
              });
              break;
            case 'agent-trace':
              emit(ws, {
                type: 'agent-trace',
                turns: event.turns,
                subAgents: event.subAgents,
                findings: event.findings,
                outcome: event.outcome,
                durationMs: event.durationMs,
              });
              break;
            case 'specialist-done':
              emit(ws, {
                type: 'specialist-done',
                specialist: event.specialist,
                findings: event.findings,
              });
              break;
            default: {
              // Unknown event type — surface it so we notice in dev.
              const t = (event as { type?: string }).type ?? 'unknown';
              emit(ws, { type: 'orch-log', level: 'debug', message: `unknown composer event: ${t}` });
            }
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
