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
    expect(opts.outputDir).toBe('./output');
    expect(opts.depth).toBe(2);
    // Block 9c.2: default maxRuntimeMs is 0 (unlimited).
    expect(opts.maxRuntimeMs).toBe(0);
    expect(opts.skip.size).toBe(0);
    expect(opts.seedUrls).toEqual([]);
  });

  it('treats --max-runtime 0 as unlimited', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--max-runtime', '0']);
    expect(opts.maxRuntimeMs).toBe(0);
  });

  it('rejects --mode flag (removed: hunt is now always terminal-driven)', () => {
    expect(() => parseHuntFlags(['-t', 'http://x.com', '--mode', 'auto']))
      .toThrow(/--mode.*removed/i);
    expect(() => parseHuntFlags(['-t', 'http://x.com', '--mode', 'guided']))
      .toThrow(/--mode.*removed/i);
    expect(() => parseHuntFlags(['-t', 'http://x.com', '--mode', 'fast']))
      .toThrow(/--mode.*removed/i);
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

  it('accepts --skip interactive (web UI autonomous mode)', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--skip', 'interactive']);
    expect(opts.skip.has('interactive')).toBe(true);
  });

  it('accepts --no-interactive as shorthand for --skip interactive', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--no-interactive']);
    expect(opts.skip.has('interactive')).toBe(true);
  });

  it('combines --skip tests,interactive (web server default)', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--skip', 'tests,interactive']);
    expect(opts.skip.has('tests')).toBe(true);
    expect(opts.skip.has('interactive')).toBe(true);
  });

  it('accepts --existing-model', () => {
    const opts = parseHuntFlags(['-t', 'http://x.com', '--existing-model', '/tmp/m.json']);
    expect(opts.existingModelPath).toBe('/tmp/m.json');
  });

  it('parses long-form flags', () => {
    const opts = parseHuntFlags([
      '--target', 'http://x.com',
      '--output', '/tmp/out',
      '--depth', '3',
      '--max-runtime', '600',
      '--skip', 'tests',
    ]);
    expect(opts.target).toBe('http://x.com');
    expect(opts.outputDir).toBe('/tmp/out');
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
