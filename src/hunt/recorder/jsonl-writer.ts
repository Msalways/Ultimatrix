// src/hunt/recorder/jsonl-writer.ts
//
// Append-only JSONL file writer. Every behavioral step is a single line
// of compact JSON. Resilient to crash mid-write: a partial trailing line
// is dropped on next read.

import { writeFileSync, appendFileSync, existsSync, readFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Crash-safe, line-oriented writer. */
export class JsonlWriter {
  private path: string;
  private tmpPath: string;
  private lineCount = 0;
  private sizeBytes = 0;
  private closed = false;

  constructor(path: string) {
    this.path = path;
    this.tmpPath = `${path}.tmp`;
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (existsSync(this.tmpPath)) {
      // Recover from crash: commit the tmp file as final.
      renameSync(this.tmpPath, path);
    }
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf8');
      this.sizeBytes = Buffer.byteLength(content);
      this.lineCount = content.length === 0 ? 0 : content.split('\n').filter((l) => l.length > 0).length;
    } else {
      writeFileSync(path, '');
    }
  }

  append(record: unknown): void {
    if (this.closed) throw new Error('JsonlWriter closed');
    const line = JSON.stringify(record) + '\n';
    appendFileSync(this.path, line);
    this.lineCount += 1;
    this.sizeBytes += Buffer.byteLength(line);
  }

  flush(): void {
    // fs.appendFileSync is already sync on every call.
  }

  close(): void {
    this.closed = true;
  }

  getPath(): string {
    return this.path;
  }

  getLineCount(): number {
    return this.lineCount;
  }

  getSizeBytes(): number {
    return this.sizeBytes;
  }
}

/** Read a JSONL file line-by-line. Drops trailing partial lines. */
export function* readJsonl<T = unknown>(path: string): Generator<T, void, void> {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      yield JSON.parse(line) as T;
    } catch {
      // Partial trailing line after a crash; skip silently.
      continue;
    }
  }
}
