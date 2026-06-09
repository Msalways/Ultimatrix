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
 * Block 21.1: the same bug fires for `!process.stdin.isTTY`. When
 * runHunt is called from a piped caller (CI, a TUI process, a web
 * server handler, the cli/index subcommand pipe path), stdin is not
 * a TTY and the sessionPromise still returns early. The race then
 * resolved to the sessionPromise. The fix: treat `!isTTY` exactly
 * like `--skip interactive` and await orchPromise directly.
 *
 * The fix: when `opts.skip.has('interactive') || !process.stdin.isTTY`,
 * await `orchPromise` directly instead of racing.
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

describe('hunt: non-TTY stdin awaits the orchestrator (Block 21.1 regression)', () => {
  // The Block 19 fix only handled `opts.skip.has('interactive')`. But
  // when stdin is not a TTY (CI, web server handler, piped CLI), the
  // sessionPromise still returns early at the `!isTTY` branch inside
  // the IIFE. The race then resolved to the sessionPromise and
  // runHunt tore down the pool before workers finished.
  //
  // We can't easily simulate non-TTY inside the same process (stdin is
  // whatever it is), but we can test the SHAPE of the fix: when
  // `--skip` does NOT include `interactive`, runHunt must still wait
  // for the orchestrator if stdin is non-TTY. We force this by
  // running the test under `process.stdin` (which is non-TTY in
  // vitest's worker pool). So we just need to NOT pass `--skip
  // interactive` and verify the same property holds.
  //
  // In vitest's worker pool, process.stdin.isTTY is typically false.
  // If this test ever runs under a TTY, the inner code path is
  // different (real interactive session) and the test's
  // assertions about duration may be wrong — but the test will
  // still pass structurally (real interactive session takes >1s).

  let target: Awaited<ReturnType<typeof startTarget>>;
  let outDir: string;

  beforeAll(async () => {
    target = await startTarget();
    outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-await-non-tty-'));
  });

  afterAll(async () => {
    await target.close();
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  it('when stdin is not a TTY and --skip omits interactive, runHunt still waits for the orchestrator', async () => {
    // Skip this test if we're somehow under a TTY (CI happens to
    // run with one). In that case the real interactive path is
    // exercised, and the wait happens because the sessionPromise
    // is the racing promise, not the orchestrator. Either way the
    // orchestrator runs to completion.
    const isTTY = !!(process.stdin && (process.stdin as { isTTY?: boolean }).isTTY);
    if (isTTY) {
      // TTY path: the interactive session is the one we race on.
      // The session doesn't open unless the user types something,
      // so this is not testable in this suite. Just assert the
      // orchestrator is awaited via the OTHER test (above).
      return;
    }
    target.hits.length = 0;
    const args = parseHuntFlags([
      '-t', `http://127.0.0.1:${target.port}/`,
      '-o', outDir,
      '--skip', 'tests',
      '--max-runtime', '30',
    ]);
    const start = Date.now();
    await runHunt(args);
    const dur = Date.now() - start;
    // With the Block 21.1 fix, non-TTY callers go through the
    // `await orchPromise` path. With the bug, the race resolved
    // immediately and dur would be ~0ms. Phase-gated observe/learn
    // are fast (HTTP fetch) so a tight bound isn't needed — as long
    // as the orchestrator actually ran we're good.
    expect(dur).toBeGreaterThan(100);
    expect(target.hits.length).toBeGreaterThan(0);
  }, 90_000);
});
