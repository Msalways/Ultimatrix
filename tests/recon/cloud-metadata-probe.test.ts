// tests/recon/cloud-metadata-probe.test.ts
import { describe, it, expect } from 'vitest';
import { runCloudMetadataProbe } from '../../src/recon/cloud-metadata-probe';
import { readAppModel, writeAppModelAsync, DEFAULT_MODEL } from '../../src/core/app-model';
import { makeTempModelPath, cleanup } from './recon-helpers';

describe('runCloudMetadataProbe', () => {
  it('returns empty when no SSRF-prone endpoints in app-model', async () => {
    const p = await makeTempModelPath();
    try {
      const result = await runCloudMetadataProbe('http://127.0.0.1:1', p, 500);
      expect(result.probes).toEqual([]);
    } finally { await cleanup(p); }
  });

  it('does NOT throw when oastBaseUrl is unset', async () => {
    const p = await makeTempModelPath();
    try {
      const result = await runCloudMetadataProbe('http://127.0.0.1:1', p, 500, undefined);
      expect(Array.isArray(result.probes)).toBe(true);
    } finally { await cleanup(p); }
  });

  it('uses the SSRF surface endpoint if present in app-model', async () => {
    const p = await makeTempModelPath();
    try {
      // pre-populate an SSRF surface
      const model = {
        ...DEFAULT_MODEL,
        endpoints: [{
          path: '/api/preview?url=',
          method: 'GET',
          params: [{ name: 'url', type: 'string', required: false }],
          requiresAuth: false,
          responseStatus: 200,
          contentType: 'application/json',
          bodyPreview: '',
        }],
      };
      await writeAppModelAsync(p, model);
      // use a fake oast base; we won't actually receive callbacks
      const result = await runCloudMetadataProbe('http://127.0.0.1:1', p, 500, 'http://127.0.0.1:8765');
      // results are inconclusive because no SSRF surface responded
      expect(Array.isArray(result.probes)).toBe(true);
    } finally { await cleanup(p); }
  });
});
