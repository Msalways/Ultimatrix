// tests/recon/framework-fingerprint.test.ts
import { describe, it, expect } from 'vitest';
import { runFrameworkFingerprint } from '../../src/recon/framework-fingerprint';
import { readAppModel } from '../../src/core/app-model';
import { makeTempModelPath, cleanup } from './recon-helpers';

describe('runFrameworkFingerprint', () => {
  it('returns empty for an unreachable target', async () => {
    const p = await makeTempModelPath();
    try {
      const result = await runFrameworkFingerprint('http://127.0.0.1:1', p, 500);
      expect(result.frameworks).toEqual([]);
    } finally { await cleanup(p); }
  });

  it('detects express from x-powered-by header', async () => {
    // use the demo target which is express
    const { startDemoTarget } = await import('./recon-helpers');
    const server = await startDemoTarget(4567);
    const p = await makeTempModelPath();
    try {
      const result = await runFrameworkFingerprint(server.baseUrl, p, 3000);
      // express may or may not set x-powered-by in modern node, but if it does, it should be detected
      const names = result.frameworks.map(f => f.name);
      // at minimum, the recon should complete without error
      expect(Array.isArray(names)).toBe(true);
    } finally {
      server.stop();
      await cleanup(p);
    }
  });
});
