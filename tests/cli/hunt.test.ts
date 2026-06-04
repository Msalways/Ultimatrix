// tests/cli/hunt.test.ts
import { describe, it, expect } from 'vitest';
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
    expect(opts.skip.size).toBe(0);
  });

  it('parses --mode auto', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--mode', 'auto']);
    expect(opts.mode).toBe('auto');
  });

  it('rejects invalid --mode', () => {
    expect(() => parseHuntFlags(['-t', 'http://x.com', '--mode', 'fast']))
      .toThrow(/--mode/);
  });

  it('parses --skip with multiple phases', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--skip', 'recon,chains']);
    expect(opts.skip.has('recon')).toBe(true);
    expect(opts.skip.has('chains')).toBe(true);
    expect(opts.skip.has('spider')).toBe(false);
    expect(opts.skip.has('tests')).toBe(false);
  });

  it('rejects unknown --skip phase', () => {
    expect(() => parseHuntFlags(['-t', 'http://x.com', '--skip', 'recon,fishing']))
      .toThrow(/--skip/);
  });

  it('accepts --existing-model', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--existing-model', '/tmp/m.json']);
    expect(opts.existingModelPath).toBe('/tmp/m.json');
  });

  it('parses long-form flags', () => {
    const opts = parseHuntFlags([
      '--target', 'http://x.com',
      '--output', '/tmp/out',
      '--mode', 'auto',
      '--depth', '3',
      '--max-runtime', '600',
      '--skip', 'tests',
    ]);
    expect(opts.target).toBe('http://x.com');
    expect(opts.outputDir).toBe('/tmp/out');
    expect(opts.mode).toBe('auto');
    expect(opts.depth).toBe(3);
    expect(opts.maxRuntimeMs).toBe(600_000);
    expect(opts.skip.has('tests')).toBe(true);
  });

  it('parses repeatable --seed-url', () => {
    const opts = parseHuntFlags([
      '-t', 'http://x.com',
      '--seed-url', '/a',
      '--seed-url', '/b',
    ]);
    expect(opts.seedUrls).toEqual(['/a', '/b']);
  });
});
