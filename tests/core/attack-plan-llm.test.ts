import { describe, it, expect } from 'vitest';
import {
  deriveHypothesesWithLLM,
  createAttackPlan,
  type Technique,
} from '../../src/core/attack-plan';
import type { AppModel, AppModelEndpoint, AppModelForm } from '../../src/core/app-model';

function makeAppModel(overrides: Partial<AppModel> = {}): AppModel {
  return {
    target: 'https://example.com',
    techStack: ['Express.js', 'PostgreSQL'],
    auth: { type: 'JWT' as const, loginEndpoint: 'https://example.com/login', endpoints: [], cookies: {}, tokens: [], sessions: {} },
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
    ...overrides,
  } as AppModel;
}

function llmReturning(map: Record<string, Technique[]>) {
  return {
    selectForEndpoint: async (ep: AppModelEndpoint) => {
      const key = `${ep.method}:${ep.path}`;
      const techniques = map[key] || [];
      return { techniques, reasoning: `mocked: ${key}`, source: 'llm' as const };
    },
    selectForForm: async (form: AppModelForm) => {
      const key = `form:${form.action}`;
      const techniques = map[key] || [];
      return { techniques, reasoning: `mocked: ${key}`, source: 'llm' as const };
    },
  };
}

describe('deriveHypothesesWithLLM', () => {
  it('derives hypotheses using LLM-selected techniques only', async () => {
    const ep: AppModelEndpoint = {
      path: '/api/users/123',
      method: 'GET',
      params: [{ name: 'id', type: 'number', required: true }],
      requiresAuth: true,
      responseStatus: 200,
      contentType: 'application/json',
      bodyPreview: '',
    };
    const appModel = makeAppModel({ endpoints: [ep] });

    const selector = llmReturning({
      'GET:/api/users/123': ['idor', 'sqli'],
    });

    const plan = createAttackPlan();
    const hyp = await deriveHypothesesWithLLM({
      appModel,
      existingPlan: plan,
      llmSelector: selector,
    });

    expect(hyp).toHaveLength(2);
    expect(hyp.every((h) => h.technique === 'idor' || h.technique === 'sqli')).toBe(true);
    expect(hyp.every((h) => h.endpoint === 'https://example.com/api/users/123' && h.param === 'id')).toBe(true);
  });

  it('skips endpoints when LLM returns no techniques', async () => {
    const ep: AppModelEndpoint = {
      path: '/health',
      method: 'GET',
      params: [],
      requiresAuth: false,
      responseStatus: 200,
      contentType: 'application/json',
      bodyPreview: '{"status":"ok"}',
    };
    const appModel = makeAppModel({ endpoints: [ep] });

    const selector = llmReturning({ 'GET:/health': [] });
    const hyp = await deriveHypothesesWithLLM({
      appModel,
      existingPlan: createAttackPlan(),
      llmSelector: selector,
    });

    expect(hyp).toHaveLength(0);
  });

  it('respects existing plan dedup', async () => {
    const ep: AppModelEndpoint = {
      path: '/api/users/123',
      method: 'GET',
      params: [{ name: 'id', type: 'number', required: true }],
      requiresAuth: true,
      responseStatus: 200,
      contentType: 'application/json',
      bodyPreview: '',
    };
    const appModel = makeAppModel({ endpoints: [ep] });

    const plan = createAttackPlan();
    plan.hypotheses.push({
      type: 'param',
      id: 'existing',
      endpoint: 'https://example.com/api/users/123',
      param: 'id',
      method: 'GET',
      technique: 'idor',
      priority: 5,
      status: 'pending',
      source: 'spider',
      createdAt: Date.now(),
    });

    const selector = llmReturning({ 'GET:/api/users/123': ['idor', 'sqli'] });
    const hyp = await deriveHypothesesWithLLM({
      appModel,
      existingPlan: plan,
      llmSelector: selector,
    });

    expect(hyp).toHaveLength(1);
    expect(hyp[0].technique).toBe('sqli');
  });

  it('handles forms via selectForForm', async () => {
    const form: AppModelForm = {
      pageUrl: 'https://example.com/login',
      action: 'https://example.com/api/login',
      method: 'POST',
      fields: [
        { name: 'email', type: 'email', placeholder: '', required: true },
        { name: 'password', type: 'password', placeholder: '', required: true },
      ],
    };
    const appModel = makeAppModel({ forms: [form] });

    const selector = llmReturning({ 'form:https://example.com/api/login': ['sqli', 'xss'] });
    const hyp = await deriveHypothesesWithLLM({
      appModel,
      existingPlan: createAttackPlan(),
      llmSelector: selector,
    });

    expect(hyp).toHaveLength(2);
    expect(hyp.every((h) => h.type === 'form')).toBe(true);
  });

  it('falls back to defaults when LLM throws', async () => {
    const ep: AppModelEndpoint = {
      path: '/api/users',
      method: 'GET',
      params: [{ name: 'email', type: 'string', required: true }],
      requiresAuth: false,
      responseStatus: 200,
      contentType: 'application/json',
      bodyPreview: '',
    };
    const appModel = makeAppModel({ endpoints: [ep] });

    const broken = {
      selectForEndpoint: async () => { throw new Error('LLM down'); },
      selectForForm: async () => { throw new Error('LLM down'); },
    };
    const hyp = await deriveHypothesesWithLLM({
      appModel,
      existingPlan: createAttackPlan(),
      llmSelector: broken,
    });

    expect(hyp.length).toBeGreaterThan(0);
    expect(hyp.some((h) => h.technique === 'xss' || h.technique === 'sqli')).toBe(true);
  });
});
