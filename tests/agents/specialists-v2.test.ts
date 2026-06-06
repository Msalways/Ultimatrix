// tests/agents/specialists-v2.test.ts
import { describe, it, expect } from 'vitest';
import { ALL_SPECIALISTS_V2, selectSpecialists } from '../../src/agents/specialists-v2';
import { jwtSpecialist } from '../../src/agents/specialists-v2/jwt';
import { oauthSpecialist } from '../../src/agents/specialists-v2/oauth';
import { raceSpecialist } from '../../src/agents/specialists-v2/race';
import { graphqlSpecialist } from '../../src/agents/specialists-v2/graphql';
import { idorSpecialist } from '../../src/agents/specialists-v2/idor';
import { cloudSpecialist } from '../../src/agents/specialists-v2/cloud';
import { wafMutatorSpecialist } from '../../src/agents/specialists-v2/waf-mutator';
import { xssSpecialist } from '../../src/agents/specialists-v2/xss';
import { secondOrderSpecialist, SECOND_ORDER_PROMPTS } from '../../src/agents/specialists-v2/second-order';
import { mutatePayload } from '../../src/agents/specialists-v2/waf-mutator';
import { burst } from '../../src/agents/specialists-v2/race';
import { XSS_PAYLOADS } from '../../src/agents/specialists-v2/xss';
import { GRAPHQL_INTROSPECTION } from '../../src/agents/specialists-v2/graphql';
import type { AppModel } from '../../src/core/app-model';

function emptyAppModel(overrides: Partial<AppModel> = {}): AppModel {
  return { endpoints: [], cookies: {}, auth: { type: 'none', tokens: [] }, ...overrides } as AppModel;
}

describe('Specialists v2', () => {
  it('exports 9 specialists', () => {
    expect(ALL_SPECIALISTS_V2).toHaveLength(9);
  });

  it('every specialist has name, description, shouldInclude, build', () => {
    for (const s of ALL_SPECIALISTS_V2) {
      expect(s.name).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(typeof s.shouldInclude).toBe('function');
      expect(typeof s.build).toBe('function');
    }
  });

  it('jwt specialist includes when auth type is JWT', () => {
    expect(jwtSpecialist.shouldInclude(emptyAppModel({ auth: { type: 'JWT', tokens: [] } }))).toBe(true);
  });

  it('jwt specialist includes when endpoints have auth headers', () => {
    expect(jwtSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/x', method: 'GET', params: [], authHeaders: { Authorization: 'Bearer x' } }] }))).toBe(true);
  });

  it('jwt specialist excludes an app with no auth', () => {
    expect(jwtSpecialist.shouldInclude(emptyAppModel())).toBe(false);
  });

  it('oauth specialist includes when OAuth endpoints exist', () => {
    expect(oauthSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/oauth/authorize', method: 'GET', params: [] }] }))).toBe(true);
  });

  it('race specialist includes when transfer endpoints exist', () => {
    expect(raceSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/api/transfer', method: 'POST', params: [] }] }))).toBe(true);
  });

  it('graphql specialist includes when /graphql endpoint exists', () => {
    expect(graphqlSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/graphql', method: 'POST', params: [] }] }))).toBe(true);
  });

  it('idor specialist includes when path params exist', () => {
    expect(idorSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/users/:id', method: 'GET', params: [] }] }))).toBe(true);
  });

  it('cloud specialist includes when S3 URL in app model', () => {
    const model = emptyAppModel();
    expect(cloudSpecialist.shouldInclude({ ...model, endpoints: [{ path: 'https://x.s3.amazonaws.com/', method: 'GET', params: [] }] })).toBe(true);
  });

  it('waf-mutator specialist includes for any app with endpoints', () => {
    expect(wafMutatorSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/x', method: 'GET', params: [] }] }))).toBe(true);
  });

  it('xss specialist includes when search/params exist', () => {
    expect(xssSpecialist.shouldInclude(emptyAppModel({ endpoints: [{ path: '/search', method: 'GET', params: ['q'] }] }))).toBe(true);
  });

  it('second-order specialist includes for write+read endpoints', () => {
    expect(secondOrderSpecialist.shouldInclude(emptyAppModel({ endpoints: [
      { path: '/comment', method: 'POST', params: [] },
      { path: '/admin/comments', method: 'GET', params: [] },
    ] }))).toBe(true);
  });

  it('second-order specialist excludes when no read endpoint', () => {
    expect(secondOrderSpecialist.shouldInclude(emptyAppModel({ endpoints: [
      { path: '/comment', method: 'POST', params: [] },
    ] }))).toBe(false);
  });

  it('selectSpecialists returns matching subset', () => {
    const model = emptyAppModel({
      auth: { type: 'JWT', tokens: [] },
      endpoints: [
        { path: '/graphql', method: 'POST', params: [] },
        { path: '/api/transfer', method: 'POST', params: [] },
      ],
    });
    const selected = selectSpecialists(model);
    const names = selected.map((s) => s.name);
    expect(names).toContain('jwt');
    expect(names).toContain('graphql');
    expect(names).toContain('race');
    expect(names).toContain('waf-mutator');
  });

  it('build returns agent descriptor with name, description, prompt, tools', () => {
    const tools = {
      httpRequest: { name: 'httpRequest', description: 'http', schema: {} },
      scratchpadWrite: { name: 'scratchpadWrite', description: 'sw', schema: {} },
      scratchpadRead: { name: 'scratchpadRead', description: 'sr', schema: {} },
      conclude: { name: 'conclude', description: 'c', schema: {} },
      mutatePayload: { name: 'mutatePayload', description: 'm', schema: {} },
    } as any;
    const agent = jwtSpecialist.build(tools);
    expect(agent.name).toBe('jwt');
    expect(agent.systemPrompt).toContain('alg=none');
    expect(agent.tools.length).toBeGreaterThan(0);
  });
});

describe('XSS payloads', () => {
  it('has 8 canonical payloads', () => {
    expect(XSS_PAYLOADS).toHaveLength(8);
    expect(XSS_PAYLOADS).toContain('<script>alert(1)</script>');
    expect(XSS_PAYLOADS).toContain('<svg/onload=alert(1)>');
  });
});

describe('Second-order prompts', () => {
  it('has multiple techniques (XSS, SSTI, command injection)', () => {
    expect(SECOND_ORDER_PROMPTS).toContain('<svg/onload=alert(1)>');
    expect(SECOND_ORDER_PROMPTS).toContain('${7*7}');
    expect(SECOND_ORDER_PROMPTS).toContain('{{7*7}}');
  });
});

describe('WAF mutator', () => {
  it('mutatePayload produces variants', () => {
    const variants = mutatePayload('<script>alert(1)</script>');
    expect(variants.length).toBeGreaterThan(5);
    expect(variants.some((v) => v.toUpperCase() === v)).toBe(true);
    expect(variants.some((v) => v.includes('%3C'))).toBe(true);
  });
});

describe('Race burst helper', () => {
  it('sends N parallel calls', async () => {
    let count = 0;
    const results = await burst(20, async (i) => {
      count++;
      return i;
    });
    expect(count).toBe(20);
    expect(results).toHaveLength(20);
  });
});

describe('GraphQL introspection', () => {
  it('payload is a valid introspection query', () => {
    expect(GRAPHQL_INTROSPECTION).toContain('__schema');
    expect(GRAPHQL_INTROSPECTION).toContain('types');
    expect(GRAPHQL_INTROSPECTION).toContain('fields');
  });
});
