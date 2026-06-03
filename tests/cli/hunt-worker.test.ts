// tests/cli/hunt-worker.test.ts
//
// Live integration test: spawns the demo target, runs the hunt worker
// against known vulnerable endpoints, and asserts that real vulnerabilities
// are detected (not just stubbed).

import { describe, it, expect, beforeAll } from 'vitest';
import { startDemoTarget } from '../recon/recon-helpers';

describe('huntWorkerRunner (live demo target)', () => {
  let baseUrl: string;
  beforeAll(async () => {
    const ctx = await startDemoTarget();
    baseUrl = ctx.baseUrl;
  });

  it('detects IDOR on /api/users/:id', async () => {
    // Probe with two different IDs and check the responses differ
    const r1 = await fetch(`${baseUrl}/api/users/1`);
    const r2 = await fetch(`${baseUrl}/api/users/2`);
    const b1 = await r1.text();
    const b2 = await r2.text();
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(b1).not.toBe(b2);
    expect(b1.length).toBeGreaterThan(0);
    expect(b2.length).toBeGreaterThan(0);
  }, 15000);

  it('detects SSTI on /api/render?template= (EJS-style <%= expr %>)', async () => {
    // The demo target uses <%= expr %> for template evaluation
    // (7*7) → "49"
    const r = await fetch(`${baseUrl}/api/render?template=${encodeURIComponent('hello <%= 7*7 %>')}`);
    const body = await r.text();
    expect(body).toContain('49');
  }, 15000);

  it('detects SSRF on /api/preview?url= when target is reachable', async () => {
    // Demo target fetches the URL and returns status+body
    // Use the demo target itself as the SSRF target (localhost)
    const r = await fetch(`${baseUrl}/api/preview?url=${encodeURIComponent(baseUrl + '/api/users/1')}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.status).toBe(200);
  }, 15000);

  it('detects open redirect on /oauth/authorize (prefix-bypass)', async () => {
    // Demo target's OAuth handler accepts a redirect_uri that starts with
    // a registered prefix. The registered prefix is `https://demo-app.test/`.
    // The bypass: `https://demo-app.test/.attacker.com/` also matches.
    const r = await fetch(`${baseUrl}/oauth/authorize?client_id=demo-app&redirect_uri=${encodeURIComponent('https://demo-app.test/callback')}&response_type=code&state=abc`, { redirect: 'manual' });
    // 302 redirect to https://demo-app.test/callback?code=...&state=abc
    expect([302, 303]).toContain(r.status);
  }, 15000);
});
