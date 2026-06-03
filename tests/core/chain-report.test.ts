// tests/core/chain-report.test.ts
import { describe, it, expect } from 'vitest';
import { renderChainFirstReport, renderChainReportHtml } from '../../src/core/chain-report';
import type { AppModel, AttackChain, AppModelFinding } from '../../src/core/app-model';

function makeModel(overrides: Partial<AppModel> = {}): AppModel {
  return {
    target: 'http://x.com',
    techStack: [],
    auth: undefined,
    workflow: { steps: [], edges: [] },
    endpoints: [],
    forms: [],
    scripts: [],
    cookies: [],
    localStorage: {},
    sessionStorage: {},
    findings: [],
    verifications: [],
    parameterClassifications: [],
    authBoundaries: [],
    recordedSessions: [],
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
    coverage: [],
    ...overrides,
  } as AppModel;
}

describe('renderChainFirstReport', () => {
  it('returns at least the executive summary', () => {
    const sections = renderChainFirstReport(makeModel());
    expect(sections.length).toBeGreaterThan(0);
    expect(sections[0].title).toBe('Executive Summary');
  });

  it('highlights chains when present', () => {
    const chain: AttackChain = {
      id: 'c1',
      name: 'SSRF → AWS takeover',
      severity: 'critical',
      confidence: 0.9,
      exploitability: 'moderate',
      steps: [
        { step: 1, findingType: 'ssrf', endpoint: '/api/preview', evidenceRef: 'r1', description: 'Reflects URL' },
        { step: 2, findingType: 'cloud-metadata-leak', endpoint: 'http://169.254.169.254/', evidenceRef: 'r2', description: 'AWS IMDS' },
      ],
      narrative: 'An SSRF on /api/preview allows the attacker to query the AWS metadata service, which returns IAM creds.',
    };
    const sections = renderChainFirstReport(makeModel({ attackChains: [chain] }));
    const chainSection = sections.find(s => s.title === 'Attack Chains');
    expect(chainSection).toBeTruthy();
    expect(chainSection!.body).toContain('SSRF → AWS takeover');
    expect(chainSection!.body).toContain('CRITICAL');
  });

  it('renders a Mermaid diagram for chains', () => {
    const chain: AttackChain = {
      id: 'c1',
      name: 'OAuth → admin',
      severity: 'high',
      confidence: 0.8,
      exploitability: 'trivial',
      steps: [{ step: 1, findingType: 'oauth-redirect-bypass', endpoint: '/oauth/callback', evidenceRef: 'r1', description: '?' }],
      narrative: 'n',
    };
    const sections = renderChainFirstReport(makeModel({ attackChains: [chain] }));
    const diagram = sections.find(s => s.title === 'Chain Diagram');
    expect(diagram).toBeTruthy();
    expect(diagram!.body).toContain('mermaid');
    expect(diagram!.body).toContain('graph LR');
  });

  it('groups findings by severity', () => {
    const findings: AppModelFinding[] = [
      { id: 'f1', type: 'xss', endpoint: '/', param: 'q', evidence: [], confidence: 'high', confirmed: true, severity: 'high' },
      { id: 'f2', type: 'sqli', endpoint: '/api', param: 'id', evidence: [], confidence: 'medium', confirmed: true, severity: 'medium' },
    ];
    const sections = renderChainFirstReport(makeModel({ findings }));
    const findingsSection = sections.find(s => s.title === 'Individual Findings');
    expect(findingsSection).toBeTruthy();
    expect(findingsSection!.body).toContain('HIGH');
    expect(findingsSection!.body).toContain('MEDIUM');
  });

  it('renders OAuth providers', () => {
    const sections = renderChainFirstReport(makeModel({
      oauthProviders: [{ issuer: 'https://idp.example', discoveryUrl: 'https://idp.example/.well-known/openid-configuration', authorizationEndpoint: 'https://idp.example/auth', tokenEndpoint: 'https://idp.example/token', clientIds: ['myapp'] }],
    }));
    const sec = sections.find(s => s.title === 'Discovered OAuth Providers');
    expect(sec).toBeTruthy();
    expect(sec!.body).toContain('idp.example');
  });

  it('renders GraphQL endpoints', () => {
    const sections = renderChainFirstReport(makeModel({
      graphqlEndpoints: [{ url: 'http://x.com/graphql', introspectionEnabled: true, typeCount: 12, queryCount: 5, mutationCount: 2 }],
    }));
    const sec = sections.find(s => s.title === 'Discovered GraphQL Endpoints');
    expect(sec).toBeTruthy();
    expect(sec!.body).toContain('EXPOSED');
  });
});

describe('renderChainReportHtml', () => {
  it('produces a valid HTML document with Mermaid', () => {
    const html = renderChainReportHtml(renderChainFirstReport(makeModel()));
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('mermaid');
    expect(html).toContain('Ultimatrix Security Report');
  });
});
