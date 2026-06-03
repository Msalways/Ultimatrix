// tests/setup/demo-target-server.ts
//
// Vitest global setup: starts the demo target once before all tests, makes
// it available via process.env.DEMO_TARGET_URL.
//
// Why: each test file that calls startDemoTarget would try to bind port
// 4567 in parallel — only one can succeed. By starting it once, we avoid
// port conflicts and speed tests up.

import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

let server: ChildProcess | null = null;

export async function setup(): Promise<void> {
  // kill any stale instance
  if (server) return;
  server = spawn(process.execPath, [path.join(__dirname, '..', '..', 'demo-target', 'server.js')], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  server.stdout?.on('data', d => {
    process.stdout.write(`[demo-target] ${d}`);
  });
  server.stderr?.on('data', d => {
    process.stderr.write(`[demo-target] ${d}`);
  });
  // wait for "listening"
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('demo-target startup timeout')), 5000);
    server!.stdout?.on('data', (d: Buffer) => {
      if (d.toString().includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
  });
  process.env.DEMO_TARGET_URL = 'http://127.0.0.1:4567';
  // store handle for teardown
  (global as any).__demoTargetServer = server;
}

export async function teardown(): Promise<void> {
  if (server) {
    server.kill();
    server = null;
  }
}
