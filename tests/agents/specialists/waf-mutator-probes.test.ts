// tests/agents/specialists/waf-mutator-probes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { detectWaf, probeWafBypass, type WafProbeConfig } from '../../../src/agents/specialists/waf-mutator-probes';
import { startDemoTarget } from '../../recon/recon-helpers';

describe('detectWaf', () => {
  it('detects Cloudflare', () => {
    expect(detectWaf({ 'cf-ray': '12345' }, '')).toBe('cloudflare');
    expect(detectWaf({ server: 'cloudflare' }, '')).toBe('cloudflare');
  });
  it('detects AWS WAF', () => {
    expect(detectWaf({ 'x-amzn-requestid': 'a', 'x-amz-cf-id': 'b' }, '')).toBe('aws-waf');
    expect(detectWaf({ server: 'awselb/2.0' }, '')).toBe('aws-waf');
  });
  it('detects ModSecurity', () => {
    expect(detectWaf({}, 'This was blocked by ModSecurity.')).toBe('modsecurity');
  });
  it('returns null for unknown', () => {
    expect(detectWaf({ 'x-custom': 'foo' }, '<html>Hi</html>')).toBeNull();
  });
});

describe('probeWafBypass (against demo target)', () => {
  let baseUrl: string;
  beforeAll(() => { baseUrl = startDemoTarget(); });
  afterAll(() => {});

  it('returns empty when no bypass works', async () => {
    const cfg: WafProbeConfig = {
      target: baseUrl,
      blockedRequest: { method: 'GET', path: '/api/users/1' },
      payload: '<script>alert(1)</script>',
      paramName: 'q',
    };
    const results = await probeWafBypass(cfg);
    // Demo target has no WAF so no bypass — all blocked
    expect(results).toEqual([]);
  }, 15000);

  it('returns an array (may be empty) regardless of outcome', async () => {
    const cfg: WafProbeConfig = {
      target: baseUrl,
      blockedRequest: { method: 'GET', path: '/' },
      payload: 'OR 1=1',
      paramName: 'q',
    };
    const results = await probeWafBypass(cfg);
    expect(Array.isArray(results)).toBe(true);
  }, 15000);
});
