/**
 * tests/agents/specialists/idor-v2.test.ts
 *
 * Tests for the session-aware IDOR specialist. We verify the factory
 * shape, the include heuristic, and that the tool list includes
 * diff_sessions when poolTools are present.
 */

import { describe, it, expect } from 'vitest';
import { idorV2Specialist } from '../../../src/agents/specialists/idor-v2';
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

describe('idorV2Specialist', () => {
  it('has the expected name and description', () => {
    expect(idorV2Specialist.name).toBe('idor-specialist-v2');
    expect(idorV2Specialist.description).toContain('cross-user session diff');
  });

  it('builds a SubAgent that includes diff_sessions when poolTools provided', () => {
    const toolkit = makeToolkit();
    const agent = idorV2Specialist.build(toolkit);
    expect(agent.name).toBe('idor-specialist-v2');
    const toolNames = (agent.tools as any[]).map((t) => t.name);
    expect(toolNames).toContain('diff_sessions');
    expect(toolNames).toContain('switch_session');
    expect(toolNames).toContain('login_session');
    expect(toolNames).toContain('list_sessions');
    expect(toolNames).toContain('conclude');
  });

  it('builds a SubAgent without session tools when no poolTools', () => {
    const agent = idorV2Specialist.build(makeToolkit({ poolTools: undefined }));
    const toolNames = (agent.tools as any[]).map((t) => t.name);
    expect(toolNames).not.toContain('diff_sessions');
    expect(toolNames).toContain('http_request');
    expect(toolNames).toContain('conclude');
  });

  it('system prompt mentions diff_sessions and multi-user comparison', () => {
    const agent = idorV2Specialist.build(makeToolkit());
    expect(agent.systemPrompt).toContain('diff_sessions');
    expect(agent.systemPrompt).toContain('user-a');
    expect(agent.systemPrompt).toContain('user-b');
  });

  it('shouldInclude returns true when there is an id param', () => {
    const m = makeAppModel({
      parameterClassifications: [{ paramName: 'id', pageUrl: 'x', classifiedAs: 'id', attackHints: [] }],
    });
    expect(idorV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns true when there is a path-style id', () => {
    const m = makeAppModel({
      endpoints: [{ path: '/api/users/:id', method: 'GET', params: [], requiresAuth: true, responseStatus: 200, contentType: 'json', bodyPreview: '' }],
    });
    expect(idorV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns true when there is an authed endpoint', () => {
    const m = makeAppModel({
      endpoints: [{ path: '/api/profile', method: 'GET', params: [], requiresAuth: true, responseStatus: 200, contentType: 'json', bodyPreview: '' }],
    });
    expect(idorV2Specialist.shouldInclude(m)).toBe(true);
  });

  it('shouldInclude returns false when no id-like patterns', () => {
    const m = makeAppModel({
      endpoints: [{ path: '/health', method: 'GET', params: [], requiresAuth: false, responseStatus: 200, contentType: 'json', bodyPreview: '' }],
    });
    expect(idorV2Specialist.shouldInclude(m)).toBe(false);
  });
});
