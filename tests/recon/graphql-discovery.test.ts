// tests/recon/graphql-discovery.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runGraphqlDiscovery } from '../../src/recon/graphql-discovery';
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

describe('runGraphqlDiscovery', () => {
  it('finds the /graphql endpoint on the demo target', async () => {
    const result = await runGraphqlDiscovery(server.baseUrl, modelPath, 3000);
    expect(result.endpoints.length).toBeGreaterThanOrEqual(1);
    const ep = result.endpoints.find(e => e.url.endsWith('/graphql'));
    expect(ep).toBeDefined();
    expect(ep!.introspectionEnabled).toBe(true);
    expect(ep!.method).toBe('POST');
  });

  it('classifies field sensitivity (User.password -> admin, User.username -> user)', async () => {
    const result = await runGraphqlDiscovery(server.baseUrl, modelPath, 3000);
    const ep = result.endpoints[0];
    const password = ep.fieldAuthzHints.find(h => h.type === 'User' && h.field === 'password');
    const username = ep.fieldAuthzHints.find(h => h.type === 'User' && h.field === 'username');
    expect(password?.sensitivity).toBe('admin');
    expect(username?.sensitivity).toBe('user');
  });

  it('returns empty endpoints for unreachable target', async () => {
    const otherModel = await makeTempModelPath();
    try {
      const result = await runGraphqlDiscovery('http://127.0.0.1:1', otherModel, 500);
      expect(result.endpoints).toEqual([]);
    } finally {
      await cleanup(otherModel);
    }
  });
});
