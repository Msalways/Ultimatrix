// tests/cli/cli-help.test.ts
//
// Spawns the built CLI as a subprocess to verify:
//   - `ultimatrix --help` shows the new `setup` and `tools` commands
//   - `ultimatrix --help` does NOT show the deprecated `interact`/`test`/`verify` (they're hidden)
//   - `ultimatrix setup --help` works
//   - `ultimatrix tools --help` works
//
// This is a black-box test: if the build is broken, these fail loudly.

import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const CLI = path.resolve(__dirname, '../../dist/cli/index.js');

function run(args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8' });
  return { stdout: r.stdout, stderr: r.stderr, status: r.status };
}

describe('ultimatrix --help (CLI integration)', () => {
  it('exits 0 on --help', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
  });
  it('lists `setup` command in --help', () => {
    const r = run(['--help']);
    expect(r.stdout).toMatch(/\bsetup\b/);
  });
  it('lists `tools` command in --help', () => {
    const r = run(['--help']);
    expect(r.stdout).toMatch(/\btools\b/);
  });
  it('lists `hunt` command in --help', () => {
    const r = run(['--help']);
    expect(r.stdout).toMatch(/\bhunt\b/);
  });
  it('does NOT list deprecated `interact` in --help (hidden)', () => {
    const r = run(['--help']);
    expect(r.stdout).not.toMatch(/^\s\sinteract\s/m);
  });
  it('does NOT list deprecated `test` in --help (hidden)', () => {
    const r = run(['--help']);
    expect(r.stdout).not.toMatch(/^\s\stest\s/m);
  });
  it('does NOT list deprecated `verify` in --help (hidden)', () => {
    const r = run(['--help']);
    expect(r.stdout).not.toMatch(/^\s\sverify\s/m);
  });
  it('does NOT list deprecated `assess` in --help (hidden)', () => {
    const r = run(['--help']);
    expect(r.stdout).not.toMatch(/^\s\sassess\s/m);
  });
  it('does NOT list deprecated `init` in --help (replaced by setup)', () => {
    const r = run(['--help']);
    expect(r.stdout).not.toMatch(/^\s\sinit\s/m);
  });
});

describe('ultimatrix setup --help', () => {
  it('exits 0', () => {
    const r = run(['setup', '--help']);
    expect(r.status).toBe(0);
  });
  it('documents --provider flag', () => {
    const r = run(['setup', '--help']);
    expect(r.stdout).toMatch(/--provider/);
  });
  it('documents --api-key flag', () => {
    const r = run(['setup', '--help']);
    expect(r.stdout).toMatch(/--api-key/);
  });
  it('documents --local flag', () => {
    const r = run(['setup', '--help']);
    expect(r.stdout).toMatch(/--local/);
  });
});

describe('ultimatrix tools --help', () => {
  it('exits 0', () => {
    const r = run(['tools', '--help']);
    expect(r.status).toBe(0);
  });
  it('documents --category flag', () => {
    const r = run(['tools', '--help']);
    expect(r.stdout).toMatch(/--category/);
  });
});

describe('ultimatrix hunt --help', () => {
  it('exits 0', () => {
    const r = run(['hunt', '--help']);
    expect(r.status).toBe(0);
  });
  it('documents --max-runtime flag (Block 9c sentinel)', () => {
    const r = run(['hunt', '--help']);
    expect(r.stdout).toMatch(/--max-runtime/);
  });
  it('mentions 0=unlimited', () => {
    const r = run(['hunt', '--help']);
    expect(r.stdout).toMatch(/0=unlimited/);
  });
});
