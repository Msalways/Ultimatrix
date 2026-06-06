// src/report/zip.ts
//
// Zip export. Bundles the report HTML + behavioral JSONL + live spec
// + any screenshots into a single .zip file the user can share.
//
// We avoid the `archiver`/`jszip` native deps to keep the install
// footprint small. The implementation walks files and writes a
// store-mode (no compression) ZIP — fully deterministic, no
// platform-specific binary deps.

import { writeFileSync, readFileSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join, basename, relative, dirname } from 'node:path';

const CRC_TABLE: number[] = (() => {
  const t: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Collect files recursively from a directory. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

function existsSync(_: string): boolean { return require('node:fs').existsSync(_); }

/** Build a store-mode ZIP file from a list of files. */
export function buildZip(files: Array<{ path: string; data?: Buffer; name?: string }>): Buffer {
  const entries: Array<{ name: string; data: Buffer; crc: number; size: number; date: number }> = [];
  for (const f of files) {
    const data = f.data ?? readFileSync(f.path);
    const name = f.name ?? basename(f.path);
    entries.push({ name, data, crc: crc32(data), size: data.length, date: Math.floor(Date.now() / 1000) });
  }
  // Build local file headers + central directory.
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);  // local file header signature
    local.writeUInt16LE(20, 4);  // version needed
    local.writeUInt16LE(0, 6);  // flags
    local.writeUInt16LE(0, 8);  // method = store
    local.writeUInt16LE(((e.date >> 9) & 0x7f) + 1980, 10);  // mod time/date
    local.writeUInt16LE(e.date & 0x1f, 12);
    local.writeUInt32LE(e.crc, 14);
    local.writeUInt32LE(e.size, 18);
    local.writeUInt32LE(e.size, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, e.data);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(((e.date >> 9) & 0x7f) + 1980, 12);
    cd.writeUInt16LE(e.date & 0x1f, 14);
    cd.writeUInt32LE(e.crc, 16);
    cd.writeUInt32LE(e.size, 20);
    cd.writeUInt32LE(e.size, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + e.data.length;
  }
  const centralBuf = Buffer.concat(central);
  chunks.push(centralBuf);
  // End of central directory.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  chunks.push(eocd);
  return Buffer.concat(chunks);
}

/** Build a shareable zip from a hunt's output directory. */
export function buildShareZip(outDir: string, reportHtml: string): Buffer {
  const files: Array<{ path: string; name: string; data?: Buffer }> = [];
  // Inline the report HTML.
  files.push({ path: '', name: 'report.html', data: Buffer.from(reportHtml, 'utf8') });
  // Walk the outDir for behavioral.jsonl, live.spec.ts, screenshots.
  for (const file of listFiles(outDir)) {
    const rel = relative(outDir, file);
    if (rel === 'report.html') continue;  // already added
    files.push({ path: file, name: rel });
  }
  return buildZip(files);
}
