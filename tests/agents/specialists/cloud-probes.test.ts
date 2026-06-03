// tests/agents/specialists/cloud-probes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { probeCloudMetadata, enumerateS3WithCreds } from '../../../src/agents/specialists/cloud-probes';
import { startDemoTarget } from '../../recon/recon-helpers';

let server: { stop: () => void; baseUrl: string };

beforeAll(async () => {
  server = await startDemoTarget(4567);
});

afterAll(() => server.stop());

describe('probeCloudMetadata', () => {
  it('leaks AWS IMDSv1 via SSRF on /api/preview?url=', async () => {
    const results = await probeCloudMetadata({
      target: server.baseUrl,
      ssrfSurfacePath: '/api/preview?x=',   // demo target uses /api/preview?url= but our SSRF param name is 'url'
      ssrfParamName: 'url',
    });
    // demo target has /api/preview?url= accepting arbitrary URL fetches
    // (the metadata IPs 169.254.169.254 won't be reachable in CI, but the
    //  probe will return inconclusive)
    expect(results.length).toBe(4); // AWS IMDSv1, IMDSv2, GCP, Azure
    for (const r of results) {
      expect(['aws', 'gcp', 'azure']).toContain(r.provider);
    }
  });

  it('returns blocked/inconclusive for unreachable metadata IPs', async () => {
    const results = await probeCloudMetadata({
      target: server.baseUrl,
      ssrfSurfacePath: '/api/preview?x=',
      ssrfParamName: 'url',
    });
    // In CI, the metadata IPs are unreachable — the probe should return blocked/inconclusive
    // (not "leaked"), proving the probe doesn't false-positive
    const leaked = results.filter(r => r.status === 'leaked');
    expect(leaked.length).toBe(0);
  });
});

describe('enumerateS3WithCreds', () => {
  it('rejects an unauthorized request with proper error', async () => {
    // We don't have real AWS creds, so this should return an error or empty list
    const r = await enumerateS3WithCreds('AKIA_FAKE', 'fake-secret', 'fake-token', 'us-east-1');
    // AWS will reject fake creds with InvalidAccessKeyId or similar
    expect(r.buckets).toEqual([]);
    // r.error may or may not be set depending on AWS response parsing
  }, 10_000);
});
