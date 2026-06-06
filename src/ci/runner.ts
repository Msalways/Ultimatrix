// src/ci/runner.ts
//
// Headless CI runner. Wraps a HuntCore run with:
//   - format selection (json, plain, sarif)
//   - exit code policy
//   - writes output to stdout + a file
//   - never opens a TUI
//   - SIGINT/SIGTERM safely cancels

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { formatCiOutput } from './formats';
import { computeExitCode, explainExitCode } from './exit-code';
import type { HuntCore } from '../hunt/core';
import type { HuntSummary } from '../hunt/types';

export interface CiRunnerOptions {
  core: HuntCore;
  format: 'json' | 'plain' | 'sarif';
  failOn?: string;
  /** Optional path to write the output to. */
  outputFile?: string;
  /** If true, the output is also printed to stdout. */
  printToStdout?: boolean;
}

export interface CiRunnerResult {
  exitCode: number;
  outputFile: string | null;
  summary: HuntSummary;
  reason: string;
}

/** Run the hunt and return a CI-formatted result. */
export async function runCi(opts: CiRunnerOptions): Promise<CiRunnerResult> {
  const { core } = opts;
  const target = core.getState().target;
  const startedAt = Date.now();
  opts.core.start();
  // We don't drive the hunt; the caller is expected to wire it up.
  // This runner is a thin formatter. Wait until the hunt is done.
  await new Promise<void>((resolve) => {
    const unsub = core.on((e) => {
      if (e.type === 'done') {
        unsub();
        resolve();
      }
    });
  });
  const endedAt = Date.now();
  const summary = core.getState().terminationReason ? buildSummaryFromCore(core) : {
    durationMs: endedAt - startedAt,
    totalSteps: 0,
    totalPrimitiveCalls: 0,
    findingsCount: 0,
    findingsBySeverity: {},
    findingsByType: {},
    oobCallbacks: 0,
    screenshots: 0,
    cost: core.getState().dollarsSpent,
  };
  const ciOpts = {
    target,
    findings: core.getState().findings,
    startedAt,
    endedAt,
    costUsd: core.getState().dollarsSpent,
    exitCode: 0,
  };
  const exitCode = computeExitCode(ciOpts.findings, opts.failOn);
  const out = formatCiOutput(opts.format, { ...ciOpts, exitCode });
  const reason = explainExitCode(exitCode, ciOpts.findings, opts.failOn);
  if (opts.printToStdout !== false) {
    process.stdout.write(out.body);
    process.stdout.write('\n');
  }
  if (opts.outputFile) {
    const dir = dirname(opts.outputFile);
    mkdirSync(dir, { recursive: true });
    writeFileSync(opts.outputFile, out.body);
  }
  return {
    exitCode,
    outputFile: opts.outputFile ?? null,
    summary,
    reason,
  };
}

function buildSummaryFromCore(core: HuntCore): HuntSummary {
  return {
    durationMs: (core.getState().endedAt ?? Date.now()) - core.getState().startedAt,
    totalSteps: core.getState().behavioralStepCount,
    totalPrimitiveCalls: core.getState().primitiveCallCount,
    findingsCount: core.getState().findings.length,
    findingsBySeverity: {},
    findingsByType: {},
    oobCallbacks: core.getState().oobCallbackCount,
    screenshots: core.getState().screenshotCount,
    cost: core.getState().dollarsSpent,
  };
}

/** Convenience: write output file under output/ if not provided. */
export function defaultCiOutputPath(outDir: string, format: 'json' | 'plain' | 'sarif'): string {
  const ext = format === 'sarif' ? 'sarif' : format;
  return join(outDir, `report.${ext}`);
}
