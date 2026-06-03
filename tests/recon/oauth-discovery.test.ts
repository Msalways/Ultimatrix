// tests/recon/oauth-discovery.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runOauthDiscovery } from '../../src/recon/oauth-discovery';
import { readAppModel } from '../../src/core/app-model';
import { makeTempModelPath, cleanup, startDemoTarget } from './recon-helpers';

let server: { stop: () => void; baseUrl: string };
let modelPath: string;

beforeAll(async () => {
  server = await startDemoTarget(4567);
  modelPath = await makeTempModelPath();
});

afterAll(async () => {
  server.stop();
  await cleanup(modelPath);
});

describe('runOauthDiscovery', () => {
  it('fetches /.well-known/openid-configuration from demo target', async () => {
    const result = await runOauthDiscovery(server.baseUrl, modelPath, 3000);
    expect(result.providers.length).toBeGreaterThanOrEqual(1);
    const p = result.providers[0];
    expect(p.authorizationEndpoint).toContain('/oauth/authorize');
    expect(p.tokenEndpoint).toContain('/oauth/token');
    expect(p.discoveryUrl).toContain('/.well-known/openid-configuration');
    expect(p.scopesSupported).toEqual(expect.arrayContaining(['read', 'write']));
  });

  it('writes providers into the AppModel', async () => {
    await runOauthDiscovery(server.baseUrl, modelPath, 3000);
    const model = readAppModel(modelPath);
    expect(model.oauthProviders.length).toBeGreaterThanOrEqual(1);
  });

  it('records a recon log entry', async () => {
    await runOauthDiscovery(server.baseUrl, modelPath, 3000);
    const model = readAppModel(modelPath);
    const entries = model.reconLog.filter(e => e.tool === 'oauth-discovery');
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[entries.length - 1].status).toBe('found');
  });

  it('returns empty providers when target unreachable', async () => {
    const otherModel = await makeTempModelPath();
    try {
      const result = await runOauthDiscovery('http://127.0.0.1:1', otherModel, 500);
      expect(result.providers).toEqual([]);
    } finally {
      await cleanup(otherModel);
    }
  });

  it('extracts client_id from homepage HTML if present', async () => {
    const result = await runOauthDiscovery(server.baseUrl, modelPath, 3000);
    // demo target does not embed client_id in HTML; the array may be empty
    expect(Array.isArray(result.providers[0].clientIds)).toBe(true);
  });
});
