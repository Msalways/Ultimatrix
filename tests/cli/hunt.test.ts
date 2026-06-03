// tests/cli/hunt.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseHuntFlags, type HuntOptions } from '../../src/cli/hunt-flags';

describe('parseHuntFlags', () => {
  it('requires --target', () => {
    expect(() => parseHuntFlags([])).toThrow(/--target/);
  });

  it('parses minimal target', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com']);
    expect(opts.target).toBe('http://x.com');
    expect(opts.mode).toBe('guided');
    expect(opts.outputDir).toBe('./output');
    expect(opts.depth).toBe(2);
  });

  it('parses long-form flags', () => {
    const opts = parseHuntFlags([
      '--target', 'http://x.com',
      '--output', '/tmp/out',
      '--auto',
      '--depth', '3',
      '--max-runtime', '600',
      '--no-tests',
      '--tests-dir', '/tmp/tests',
      '--no-chains',
      '--no-recon',
      '--no-spider',
    ]);
    expect(opts.target).toBe('http://x.com');
    expect(opts.outputDir).toBe('/tmp/out');
    expect(opts.mode).toBe('auto');
    expect(opts.depth).toBe(3);
    expect(opts.maxRuntimeMs).toBe(600_000);
    expect(opts.skipTests).toBe(true);
    expect(opts.testsDir).toBe('/tmp/tests');
    expect(opts.skipChains).toBe(true);
    expect(opts.skipRecon).toBe(true);
    expect(opts.skipSpider).toBe(true);
  });

  it('accepts --existing-model', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--existing-model', '/tmp/m.json']);
    expect(opts.existingModelPath).toBe('/tmp/m.json');
  });
});
