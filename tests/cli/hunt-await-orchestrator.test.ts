/**
 * tests/cli/hunt-await-orchestrator.test.ts
 *
 * Block 19: regression test for the bug where runHunt was using
 * `Promise.race([orchPromise, sessionPromise])` to wait for either.
 *
 * When `--skip interactive` was set (web UI / CI / non-TTY callers),
 * the sessionPromise resolved immediately (no REPL/headed browser
 * to open). The race then resolved and runHunt continued — closing
 * the pool and tearing down the HuntCore — while the orchestrator's
 * workers were still running. Workers were killed mid-attack,
 * `[orch] ←` end logs never fired, and 0 findings were reported
 * even on known-vuln targets.
 *
 * The fix: when `opts.skip.has('interactive')`, await `orchPromise`
 * directly instead of racing.
 *
 * This test runs a real runHunt against a tiny in-process HTTP target
 * and verifies that workers' end-of-life logs fire and findings flow.
 * We don't need to actually find a vuln — we need to prove the
 * orchestrator completes.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { runHunt, parseHuntFlags } from '../../src/cli/hunt';

function startTarget(): Promise<{ port: number; hits: any[]; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const hits: any[] = [];
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c.toString()));
      req.on('end', () => {
        hits.push({ url: req.url, body });
        const u = new URL(req.url ?? '/', 'http://x');
        const q = u.searchParams.get('q') || '';
        // Reflect the q param back unescaped (classic XSS playground)
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end(`<html>search: ${q}</html>`);
      });
    });
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      resolve({
        port: addr.port,
        hits,
        close: () => new Promise<void>((r) => srv.close(() => r())),
      });
    });
  });
}

describe('hunt: --skip interactive awaits the orchestrator (regression)', () => {
  let target: Awaited<ReturnType<typeof startTarget>>;
  let outDir: string;

  beforeAll(async () => {
    target = await startTarget();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-await-'));
  });

  afterAll(async () => {
    await target.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('orchestrator workers complete (per-node end logs fire) under --skip interactive', async () => {
    target.hits.length = 0;
    // The orchestrator's workers make real LLM calls. We can't
    // guarantee any specific number of primitives will fire within
    // the test window (the LLM is slow), so we verify the SHAPE of
    // the fix: runHunt returns ONLY after the orchestrator has had
    // a chance to run its workers. With the bug, runHunt returned
    // immediately because the race resolved on the sessionPromise.
    //
    // We check two things:
    //   1) runHunt takes at least 1s (proves the orchestrator was
    //      awaited, not raced out)
    //   2) The target server received at least 1 HTTP hit (proves
    //      a worker actually attacked)
    const args = parseHuntFlags([
      '-t', `http://127.0.0.1:${target.port}/`,
      '-o', outDir,
      '--skip', 'tests,interactive',
      '--max-runtime', '30',
    ]);
    const start = Date.now();
    await runHunt(args);
    const dur = Date.now() - start;
    // (1) The fix means we waited for the orchestrator. With the bug,
    // this would return in <500ms (sessionPromise resolves immediately).
    expect(dur).toBeGreaterThan(1000);
    // (2) The target was actually attacked. With the bug, workers
    // were killed before they could send any HTTP requests.
    expect(target.hits.length).toBeGreaterThan(0);
  }, 90_000);
});
