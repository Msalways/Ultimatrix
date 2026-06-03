import { describe, it, expect } from 'vitest';
import {
  selectSpecialistsForScan,
  listAllSpecialistNames,
  ALL_SPECIALISTS,
} from '../../../src/agents/specialists';
import type { SpecialistToolkit } from '../../../src/agents/specialists';
import type { AppModel } from '../../../src/core/app-model';

function makeToolkit(): SpecialistToolkit {
  return {
    httpRequest: { name: 'http_request' },
    scratchpadWrite: { name: 'scratchpad_write' },
    scratchpadRead: { name: 'scratchpad_read' },
    conclude: { name: 'conclude' },
  };
}

function makeAppModel(overrides: Partial<AppModel> = {}): AppModel {
  return {
    target: 'https://example.com',
    techStack: ['Express.js'],
    auth: { type: 'none' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {} },
    workflow: { nodes: [], edges: [] },
    endpoints: [],
    forms: [],
    scripts: [],
    cookies: {},
    localStorage: {},
    findings: [],
    verifications: [],
    parameterClassifications: [],
    authBoundaries: [],
    recordedSessions: {},
    hypotheses: [],
    nextSteps: [],
    visitedUrls: [],
    oauthProviders: [],
    graphqlEndpoints: [],
    jwtTokens: [],
    frameworks: [],
    cloudProbes: [],
    reconLog: [],
    attackChains: [],
    ...overrides,
  } as AppModel;
}

describe('specialists registry', () => {
  it('listAllSpecialistNames returns the 9 specialist names', () => {
    const names = listAllSpecialistNames();
    expect(names).toHaveLength(9);
    expect(names).toContain('xss-specialist');
    expect(names).toContain('idor-specialist');
    expect(names).toContain('jwt-specialist');
    expect(names).toContain('graphql-specialist');
    expect(names).toContain('waf-mutator-specialist');
    expect(names).toContain('oauth-specialist');
    expect(names).toContain('cloud-specialist');
    expect(names).toContain('race-specialist');
    expect(names).toContain('triage-reviewer-specialist');
  });

  it('ALL_SPECIALISTS has 9 factories', () => {
    expect(ALL_SPECIALISTS).toHaveLength(9);
  });
});

describe('selectSpecialistsForScan', () => {
  it('returns triage by default', async () => {
    const result = await selectSpecialistsForScan(makeAppModel(), makeToolkit());
    expect(result.selectedNames).toContain('triage-reviewer-specialist');
  });

  it('skips triage when includeTriage=false', async () => {
    const result = await selectSpecialistsForScan(makeAppModel(), makeToolkit(), { includeTriage: false });
    expect(result.selectedNames).not.toContain('triage-reviewer-specialist');
  });

  it('includes JWT specialist when auth.type is JWT', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({ auth: { type: 'JWT' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {} } }),
      makeToolkit(),
    );
    expect(result.selectedNames).toContain('jwt-specialist');
  });

  it('includes IDOR specialist when there is an id parameter', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({
        parameterClassifications: [{ paramName: 'userId', pageUrl: '/users', classifiedAs: 'id', attackHints: [] }],
      }),
      makeToolkit(),
    );
    expect(result.selectedNames).toContain('idor-specialist');
  });

  it('includes XSS specialist when there is a search param', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({
        parameterClassifications: [{ paramName: 'q', pageUrl: '/search', classifiedAs: 'search', attackHints: [] }],
      }),
      makeToolkit(),
    );
    expect(result.selectedNames).toContain('xss-specialist');
  });

  it('includes GraphQL specialist when endpoint has graphql bodyFormat', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({
        endpoints: [{
          path: '/api/graphql',
          method: 'POST',
          params: [],
          requiresAuth: false,
          responseStatus: 200,
          contentType: 'application/json',
          bodyPreview: '',
          bodyFormat: 'graphql',
        }],
      }),
      makeToolkit(),
    );
    expect(result.selectedNames).toContain('graphql-specialist');
  });

  it('includes WAF-mutator when 403 response observed', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({
        endpoints: [{
          path: '/admin',
          method: 'GET',
          params: [],
          requiresAuth: false,
          responseStatus: 403,
          contentType: 'text/html',
          bodyPreview: '',
        }],
      }),
      makeToolkit(),
    );
    expect(result.selectedNames).toContain('waf-mutator-specialist');
  });

  it('skips specialists with no relevance signal', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel(),
      makeToolkit(),
      { includeTriage: false },
    );
    expect(result.selectedNames).not.toContain('jwt-specialist');
    expect(result.selectedNames).not.toContain('graphql-specialist');
    expect(result.selectedNames).not.toContain('waf-mutator-specialist');
    expect(result.skipped.length).toBeGreaterThan(0);
  });

  it('alwaysInclude overrides relevance check', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel(),
      makeToolkit(),
      { alwaysInclude: ['jwt-specialist'] },
    );
    expect(result.selectedNames).toContain('jwt-specialist');
  });

  it('builds SubAgent with correct name and system prompt', async () => {
    const result = await selectSpecialistsForScan(
      makeAppModel({ auth: { type: 'JWT' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {} } }),
      makeToolkit(),
    );
    const jwt = result.specialists.find((s) => s.name === 'jwt-specialist');
    expect(jwt).toBeDefined();
    expect((jwt as any).systemPrompt).toContain('JWT');
    expect((jwt as any).tools).toHaveLength(4);
  });
});
