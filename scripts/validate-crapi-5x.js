#!/usr/bin/env node
/**
 * scripts/validate-crapi-5x.js
 *
 * Run the CrAPI integration smoke test 5 times and aggregate results.
 * This is for validation of the depth-first rebuild against a live
 * public CrAPI instance.
 *
 * Requirements:
 *   - CRAPI_URL env var (e.g. https://crapi.apisec.ai)
 *   - CRAPI_CREDS env var (JSON: { mechanic: {email, password}, driver: {email, password} })
 *
 * Usage:
 *   CRAPI_URL=https://crapi.apisec.ai CRAPI_CREDS='{...}' node scripts/validate-crapi-5x.js
 *
 * Writes a summary table to ./crapi-validation-results.md
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const RUNS = 5;
const RUN_DIR = path.resolve('./runs');
const SUMMARY_PATH = path.resolve('./crapi-validation-results.md');

const CRAPI_URL = process.env.CRAPI_URL;
const CRAPI_CREDS = process.env.CRAPI_CREDS;

if (!CRAPI_URL || !CRAPI_CREDS) {
  console.error('Set CRAPI_URL and CRAPI_CREDS env vars before running.');
  console.error('Example:');
  console.error('  CRAPI_URL=https://crapi.apisec.ai CRAPI_CREDS=\'{"mechanic":{...}}\' node scripts/validate-crapi-5x.js');
  process.exit(1);
}

if (!fs.existsSync(RUN_DIR)) fs.mkdirSync(RUN_DIR, { recursive: true });

const results = [];

for (let i = 1; i <= RUNS; i++) {
  console.log(`\n=== Run ${i}/${RUNS} ===`);
  const out = spawnSync('npx', [
    'vitest', 'run', 'tests/integration/crapi-smoke.test.ts',
    '--reporter=json', '--outputJson',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, CRAPI_URL, CRAPI_CREDS },
    encoding: 'utf-8',
  });
  const runResult = parseVitestOutput(out.stdout || '', out.stderr || '', out.status);
  results.push({ run: i, ...runResult });
  console.log(`Run ${i}: ${runResult.passed}/${runResult.total} passed (${runResult.failed} failed)`);
}

writeSummary(results, SUMMARY_PATH);
console.log(`\nSummary written: ${SUMMARY_PATH}`);

function parseVitestOutput(stdout, stderr, status) {
  let total = 0, passed = 0, failed = 0;
  try {
    const lines = stdout.split('\n');
    for (const line of lines) {
      if (!line.trim().startsWith('{')) continue;
      try {
        const json = JSON.parse(line);
        if (json.numTotalTests !== undefined) total = json.numTotalTests;
        if (json.numPassedTests !== undefined) passed = json.numPassedTests;
        if (json.numFailedTests !== undefined) failed = json.numFailedTests;
      } catch { /* ignore non-JSON lines */ }
    }
  } catch { /* ignore */ }
  if (total === 0) {
    const m = stdout.match(/Tests\s+(\d+)\s+passed/);
    const f = stdout.match(/(\d+)\s+failed/);
    if (m) passed = parseInt(m[1], 10);
    if (f) failed = parseInt(f[1], 10);
    total = passed + failed;
  }
  return {
    total,
    passed,
    failed,
    exitStatus: status,
    stderrTail: stderr.split('\n').slice(-5).join('\n'),
  };
}

function writeSummary(results, filePath) {
  const lines = [];
  lines.push('# CrAPI 5x Validation Results');
  lines.push('');
  lines.push(`- Date: ${new Date().toISOString()}`);
  lines.push(`- Target: ${CRAPI_URL}`);
  lines.push(`- Runs: ${RUNS}`);
  lines.push('');
  lines.push('| Run | Passed | Failed | Exit | Notes |');
  lines.push('| --- | ------ | ------ | ---- | ----- |');
  for (const r of results) {
    lines.push(`| ${r.run} | ${r.passed} | ${r.failed} | ${r.exitStatus} | ${r.notes || ''} |`);
  }
  lines.push('');
  const totalPassed = results.reduce((a, r) => a + r.passed, 0);
  const totalFailed = results.reduce((a, r) => a + r.failed, 0);
  lines.push(`**Aggregate**: ${totalPassed} passed, ${totalFailed} failed across ${RUNS} runs.`);
  fs.writeFileSync(filePath, lines.join('\n'));
}
