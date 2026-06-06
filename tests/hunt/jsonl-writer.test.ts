// tests/hunt/jsonl-writer.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlWriter, readJsonl } from '../../src/hunt/recorder/jsonl-writer';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jsonl-'));
  path = join(dir, 'test.jsonl');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('JsonlWriter', () => {
  it('appends records as newline-delimited JSON', () => {
    const w = new JsonlWriter(path);
    w.append({ a: 1 });
    w.append({ b: 2 });
    w.close();
    const content = readFileSync(path, 'utf8');
    expect(content).toBe('{"a":1}\n{"b":2}\n');
  });

  it('tracks line count and size', () => {
    const w = new JsonlWriter(path);
    w.append({ x: 1 });
    w.append({ y: 2 });
    w.append({ z: 3 });
    expect(w.getLineCount()).toBe(3);
    expect(w.getSizeBytes()).toBeGreaterThan(0);
  });

  it('reopens an existing file and continues counting', () => {
    const w1 = new JsonlWriter(path);
    w1.append({ n: 1 });
    w1.close();
    const w2 = new JsonlWriter(path);
    expect(w2.getLineCount()).toBe(1);
    w2.append({ n: 2 });
    expect(w2.getLineCount()).toBe(2);
  });

  it('rejects writes after close', () => {
    const w = new JsonlWriter(path);
    w.close();
    expect(() => w.append({ x: 1 })).toThrow();
  });

  it('recovers a partial trailing line from .tmp', () => {
    // Simulate crash: write valid lines + a partial line + a tmp file.
    const tmpPath = path + '.tmp';
    const { writeFileSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(path, '{"a":1}\n{"b":');
    writeFileSync(tmpPath, '{"c":3}\n');
    const w = new JsonlWriter(path);
    expect(w.getLineCount()).toBe(1);
    expect(existsSync(tmpPath)).toBe(false);
  });

  it('readJsonl yields records', () => {
    const w = new JsonlWriter(path);
    w.append({ id: 1 });
    w.append({ id: 2 });
    w.close();
    const out: number[] = [];
    for (const r of readJsonl<{ id: number }>(path)) {
      out.push(r.id);
    }
    expect(out).toEqual([1, 2]);
  });

  it('readJsonl returns nothing for missing file', () => {
    const out: unknown[] = [];
    for (const r of readJsonl(join(dir, 'nope.jsonl'))) {
      out.push(r);
    }
    expect(out).toEqual([]);
  });
});
