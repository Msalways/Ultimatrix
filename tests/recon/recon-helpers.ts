// tests/recon/recon-helpers.ts
//
// Shared test helpers for recon tools — writes a fresh AppModel to a tmp
// file and returns the path.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { writeAppModelAsync, DEFAULT_MODEL } from '../../src/core/app-model';

export async function makeTempModelPath(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ultimatrix-recon-'));
  const p = path.join(dir, 'app-model.json');
  await writeAppModelAsync(p, { ...DEFAULT_MODEL, target: process.env.DEMO_TARGET_URL || 'http://127.0.0.1:4567' });
  return p;
}

export async function cleanup(p: string): Promise<void> {
  try { fs.rmSync(path.dirname(p), { recursive: true, force: true }); } catch { /* ignore */ }
}

// Returns a no-op stop function — the demo target is started globally
// by tests/setup/demo-target-server.ts.
export async function startDemoTarget(_port?: number): Promise<{ stop: () => void; baseUrl: string }> {
  return {
    baseUrl: process.env.DEMO_TARGET_URL || 'http://127.0.0.1:4567',
    stop: () => {},
  };
}
