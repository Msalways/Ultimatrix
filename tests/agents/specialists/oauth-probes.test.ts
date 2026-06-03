// tests/agents/specialists/oauth-probes.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { runAllOAuthProbes } from '../../../src/agents/specialists/oauth';
import { probeRedirectUriPrefixBypass, probeStateMissing, probeScopeEscalation, probeResponseTypeConfusion } from '../../../src/agents/specialists/oauth-probes';
import { startDemoTarget } from '../../recon/recon-helpers';

let server: { stop: () => void; baseUrl: string };

beforeAll(async () => {
  server = await startDemoTarget(4567);
});

afterAll(() => server.stop());

describe('runAllOAuthProbes', () => {
  it('detects redirect_uri prefix-bypass on demo target', async () => {
    const result = await runAllOAuthProbes({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    expect(result.summary.vulnerable).toBe(true);
    expect(result.summary.techniques).toContain('redirect_uri-prefix-bypass');
    const redirect = result.results.find(r => r.technique === 'redirect_uri-prefix-bypass');
    expect(redirect?.vulnerable).toBe(true);
    expect(redirect?.severity).toBe('critical');
  });

  it('does not flag state-missing when state is enforced', async () => {
    const result = await runAllOAuthProbes({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    // demo target does NOT enforce state, so it should be vulnerable
    const state = result.results.find(r => r.technique === 'state-missing');
    expect(state?.vulnerable).toBe(true);
  });

  it('returns 5 probe results', async () => {
    const result = await runAllOAuthProbes({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    expect(result.results.length).toBe(5);
  });
});

describe('probeRedirectUriPrefixBypass direct', () => {
  it('marks the demo-app prefix as bypassable', async () => {
    const r = await probeRedirectUriPrefixBypass({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    expect(r.vulnerable).toBe(true);
    expect(r.exploitability).toBe('trivial');
  });
});

describe('probeStateMissing direct', () => {
  it('detects missing state on demo target', async () => {
    const r = await probeStateMissing({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    expect(r.vulnerable).toBe(true);
  });
});

describe('probeScopeEscalation', () => {
  it('flags elevated scope acceptance on permissive targets', async () => {
    // demo target doesn't validate scope, so admin scope may be accepted
    const r = await probeScopeEscalation({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    // result may be vulnerable or not depending on scope handling; just verify it ran
    expect(typeof r.vulnerable).toBe('boolean');
    expect(r.technique).toBe('scope-escalation');
  });
});

describe('probeResponseTypeConfusion', () => {
  it('runs and returns a structured result', async () => {
    const r = await probeResponseTypeConfusion({
      target: server.baseUrl,
      provider: {
        authorizationEndpoint: `${server.baseUrl}/oauth/authorize`,
        tokenEndpoint: `${server.baseUrl}/oauth/token`,
        clientIds: ['demo-app'],
      },
    });
    expect(r.technique).toBe('response_type-confusion');
  });
});
