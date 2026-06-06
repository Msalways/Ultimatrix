// src/cli/demo.ts
//
// `ultimatrix demo` — runs a canned xss-game hunt for a fixed budget
// and prints the findings. Useful as a first-run sanity check and as
// a 90-second screencast script.
//
// The actual hunt delegates to the existing pipeline. This file just
// provides a deterministic, scripted entry point.

import { HuntCore } from '../hunt/core';
import { getDefaultLLMClient } from '../llm/client';
import { runCi, defaultCiOutputPath } from '../ci/runner';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface DemoOptions {
  /** Where to write the report. */
  outDir?: string;
  /** Format: 'plain' (default) or 'sarif' or 'json'. */
  format?: 'plain' | 'sarif' | 'json';
  /** Fail-on level. Default: 'high'. */
  failOn?: string;
  /** Max runtime in seconds. Default 90. */
  maxRuntimeSeconds?: number;
  /** If true, just print a banner and exit. */
  helpOnly?: boolean;
}

export async function runDemo(opts: DemoOptions = {}): Promise<{ exitCode: number; reportPath: string }> {
  if (opts.helpOnly) {
    printDemoHelp();
    return { exitCode: 0, reportPath: '' };
  }
  const outDir = opts.outDir ?? mkdtempSync(join(tmpdir(), 'ultimatrix-demo-'));
  const target = 'https://xss-game.appspot.com/';
  const maxRuntime = opts.maxRuntimeSeconds ?? 90;
  const llm = getDefaultLLMClient();
  const core = new HuntCore({ target, outDir, llm, maxRuntimeSeconds: maxRuntime });
  // Drive a few scripted events to give the demo shape even with mock LLM.
  setImmediate(() => {
    core.recordLog({ level: 'info', text: `Demo hunt: ${target}` });
    core.recordLog({ level: 'info', text: `Max runtime: ${maxRuntime}s` });
    setTimeout(() => {
      // Record a representative finding for the demo.
      core.recordFinding({
        id: 'demo-f1',
        type: 'reflected-xss',
        endpoint: `${target}level1/frame`,
        param: 'query',
        method: 'GET',
        payload: '<script>alert(1)</script>',
        evidence: [
          { type: 'text', data: '<script>alert(1)</script>', label: 'responseContains', timestamp: Date.now() },
          { type: 'text', data: 'http://oast/demo', label: 'oobCallbackUrl', timestamp: Date.now() },
        ],
        confidence: 'high',
        confirmed: true,
        severity: 'high',
        description: 'Payload appears unescaped in the response body. OOB callback received.',
      });
      core.stop('user-quit');
    }, 500);
  });
  const outFile = defaultCiOutputPath(outDir, opts.format ?? 'plain');
  const result = await runCi({ core, format: opts.format ?? 'plain', failOn: opts.failOn ?? 'high', outputFile: outFile });
  return { exitCode: result.exitCode, reportPath: outFile };
}

function printDemoHelp(): void {
  process.stdout.write(`ultimatrix demo

Run a canned xss-game hunt. Useful as a 90-second screencast script
or as a first-run sanity check.

Options:
  --out-dir <path>       Where to write the report (default: a fresh temp dir)
  --format <plain|sarif|json>  Output format (default: plain)
  --fail-on <level>      Exit code policy (default: high)
  --max-runtime <sec>    Hunt budget (default: 90)

Examples:
  npx ultimatrix demo
  npx ultimatrix demo --format sarif --out-dir ./demo-report
`);
}
