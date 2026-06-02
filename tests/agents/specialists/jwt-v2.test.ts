/**
 * tests/agents/specialists/jwt-v2.test.ts
 */

import { describe, it, expect } from 'vitest';
import { jwtV2Specialist } from '../../../src/agents/specialists/jwt-v2';
import type { SpecialistToolkit } from '../../../src/agents/specialists/types';
import type { AppModel } from '../../../src/core/app-model';

function makeToolkit(overrides: Partial<SpecialistToolkit> = {}): SpecialistToolkit {
  const tool = (name: string) => ({ name, invoke: () => Promise.resolve('') });
  return {
    httpRequest: tool('http_request'),
    scratchpadWrite: tool('scratchpad_write'),
    scratchpadRead: tool('scratchpad_read'),
    conclude: tool('conclude'),
    poolTools: {
      listSessions: tool('list_sessions'),
      switchSession: tool('switch_session'),
      loginSession: tool('login_session'),
      diffSessions: tool('diff_sessions'),
      screenshotSession: tool('screenshot_session'),
      getPageText: tool('get_page_text'),
    },
    ...overrides,
  };
}

function makeAppModel(overrides: Partial<AppModel> = {}): AppModel {
  return {
    target: 'https://x.com',
    techStack: [],
    auth: { type: 'unknown', loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {}, storageStatePath: '', loginMethod: '', loginFields: [], capturedAt: 0 },
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
    oastCallbacks: [],
    workerActions: [],
    coverage: [],
    thinRoutes: [],
    currentPage: { url: '', title: '', lastUpdatedAt: 0, snapshotHash: '' },
    warnings: [],
    eventLog: [],
    artifacts: { harFiles: [], screenshots: [], traceFiles: [] },
    browserSessions: {},
    navigationHistory: [],
    errors: [],
    _meta: { startedAt: 0, duration: 0, totalToolCalls: 0, lastUpdatedAt: 0, agentVersion: '' },
    ...overrides,
  } as AppModel;
}

describe('jwtV2Specialist', () => {
  it('has the expected name and description', () => {
    expect(jwtV2Specialist.name).toBe('jwt-specialist-v2');
    expect(jwtV2Specialist.description).toContain('session diff');
  });

  it('builds with session tools when poolTools provided', () => {
    const agent = jwtV2Specialist.build(makeToolkit());
    const toolNames = (agent.tools as any[]).map((t) => t.name);
    expect(toolNames).toContain('diff_sessions');
    expect(toolNames).toContain('switch_session');
    expect(toolNames).toContain('login_session');
  });

  it('falls back to http-only tools when no poolTools', () => {
    const agent = jwtV2Specialist.build(makeToolkit({ poolTools: undefined }));
    const toolNames = (agent.tools as any[]).map((t) => t.name);
    expect(toolNames).not.toContain('diff_sessions');
    expect(toolNames).toContain('http_request');
  });

  it('system prompt mentions role escalation and cross-role verification', () => {
    const agent = jwtV2Specialist.build(makeToolkit());
    expect(agent.systemPrompt).toContain('role');
    expect(agent.systemPrompt).toContain('alg=none');
    expect(agent.systemPrompt).toContain('diff_sessions');
  });

  it('shouldInclude returns true when auth.type is JWT', () => {
    const m = makeAppModel({ auth: { type: 'JWT' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: [], sessions: {}, storageStatePath: '', loginMethod: '', loginFields: [], capturedAt: 0 } });
    expect(jwtV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns true when auth tokens are present', () => {
    const m = makeAppModel({ auth: { type: 'token' as const, loginEndpoint: '', endpoints: [], cookies: {}, tokens: ['eyJhbGc...'], sessions: {}, storageStatePath: '', loginMethod: '', loginFields: [], capturedAt: 0 } });
    expect(jwtV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns true when an endpoint has Authorization header', () => {
    const m = makeAppModel({
      endpoints: [{ path: '/api/me', method: 'GET', params: [], requiresAuth: true, responseStatus: 200, contentType: 'json', bodyPreview: '', authHeaders: { authorization: 'Bearer x' } }],
    });
    expect(jwtV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns false when no JWT signals', () => {
    const m = makeAppModel({
      endpoints: [{ path: '/health', method: 'GET', params: [], requiresAuth: false, responseStatus: 200, contentType: 'json', bodyPreview: '' }],
    });
    expect(jwtV2Specialist.shouldInclude(m)).toBe(false);
  });
});
