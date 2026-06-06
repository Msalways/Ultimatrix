// tests/report/zip.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildZip, buildShareZip, listFiles } from '../../src/report/zip';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'zip-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Zip builder', () => {
  it('builds a valid ZIP file with 1 file', () => {
    const buf = buildZip([{ name: 'hello.txt', data: Buffer.from('hi', 'utf8') }]);
    expect(buf.length).toBeGreaterThan(0);
    // ZIP starts with PK\x03\x04
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);
  });

  it('ends with EOCD signature', () => {
    const buf = buildZip([{ name: 'hello.txt', data: Buffer.from('hi', 'utf8') }]);
    const tail = buf.subarray(buf.length - 22);
    expect(tail[0]).toBe(0x50);
    expect(tail[1]).toBe(0x4b);
    expect(tail[2]).toBe(0x05);
    expect(tail[3]).toBe(0x06);
  });

  it('includes file count in EOCD', () => {
    const buf = buildZip([
      { name: 'a.txt', data: Buffer.from('a') },
      { name: 'b.txt', data: Buffer.from('bb') },
    ]);
    // EOCD at end-22, count at offset 10 (LE u16).
    const count = buf.readUInt16LE(buf.length - 22 + 10);
    expect(count).toBe(2);
  });

  it('encodes the file name correctly', () => {
    const name = 'myfile-123.txt';
    const buf = buildZip([{ name, data: Buffer.from('x') }]);
    // EOCD at end-22, central dir at end-22-46*1-... Walk backwards.
    // Just check the name appears as bytes in the buffer.
    expect(buf.indexOf(Buffer.from(name, 'utf8'))).toBeGreaterThan(-1);
  });

  it('buildShareZip combines HTML + outDir contents', () => {
    writeFileSync(join(dir, 'live.spec.ts'), '// spec');
    writeFileSync(join(dir, 'behavioral.jsonl'), '{}');
    const zip = buildShareZip(dir, '<html></html>');
    expect(zip.length).toBeGreaterThan(0);
    expect(existsSync(join(dir, 'live.spec.ts'))).toBe(true);
  });

  it('listFiles returns files recursively', () => {
    const { mkdirSync } = require('node:fs') as typeof import('node:fs');
    writeFileSync(join(dir, 'a.txt'), 'a');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    writeFileSync(join(dir, 'sub', 'b.txt'), 'b');
    const files = listFiles(dir);
    expect(files.length).toBe(2);
  });

  it('listFiles returns empty for missing dir', () => {
    expect(listFiles(join(dir, 'nope'))).toEqual([]);
  });
});
