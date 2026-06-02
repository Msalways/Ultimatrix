import { describe, it, expect } from 'vitest';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { AppModel, AppModelEndpoint, AppModelForm } from '../../src/core/app-model';
import {
  selectTechniquesForEndpoint,
  selectTechniquesForForm,
  listAllTechniques,
} from '../../src/agents/specialist-builder';

class FakeLLM {
  public responses: string[];
  public callCount = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async invoke(_messages: any[]): Promise<any> {
    const r = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return { content: r };
  }
}

function makeEndpoint(overrides: Partial<AppModelEndpoint> = {}): AppModelEndpoint {
  return {
    path: '/api/users/123',
    method: 'GET',
    params: [{ name: 'id', type: 'number', required: true }],
    requiresAuth: true,
    responseStatus: 200,
    contentType: 'application/json',
    bodyPreview: '{"id":123,"name":"Alice"}',
    ...overrides,
  };
}

function makeForm(overrides: Partial<AppModelForm> = {}): AppModelForm {
  return {
    pageUrl: 'https://example.com/login',
    action: 'https://example.com/api/login',
    method: 'POST',
    fields: [
      { name: 'email', type: 'email', placeholder: '', required: true },
      { name: 'password', type: 'password', placeholder: '', required: true },
    ],
    ...overrides,
  };
}

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

describe('specialist-builder', () => {
  it('listAllTechniques returns the 10 known techniques', () => {
    const all = listAllTechniques();
    expect(all).toHaveLength(10);
    expect(all).toContain('sqli');
    expect(all).toContain('xss');
    expect(all).toContain('idor');
  });

  it('parses a valid LLM response with techniques and reasoning', async () => {
    const fakeLLM = new FakeLLM([
      '{"techniques": ["sqli", "idor"], "reasoning": "ID-numeric parameter on authed endpoint"}',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint(),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.source).toBe('llm');
    expect(result.techniques).toEqual(['sqli', 'idor']);
    expect(result.reasoning).toContain('ID-numeric');
  });

  it('parses LLM response wrapped in prose', async () => {
    const fakeLLM = new FakeLLM([
      'I think we should test for the following:\n{"techniques": ["xss"], "reasoning": "search field"}\nDone.',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint({ path: '/search', params: [{ name: 'q', type: 'string', required: false }] }),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.source).toBe('llm');
    expect(result.techniques).toEqual(['xss']);
  });

  it('filters out unknown techniques', async () => {
    const fakeLLM = new FakeLLM([
      '{"techniques": ["sqli", "unknown-tech", "idor", "made-up"], "reasoning": "test"}',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint(),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.techniques).toEqual(['sqli', 'idor']);
  });

  it('returns empty array when LLM says no techniques apply', async () => {
    const fakeLLM = new FakeLLM([
      '{"techniques": [], "reasoning": "static asset, nothing to test"}',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint({ path: '/favicon.ico' }),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.techniques).toEqual([]);
    expect(result.source).toBe('llm');
  });

  it('falls back to safe techniques when LLM throws', async () => {
    const brokenLLM = {
      invoke: async () => { throw new Error('network down'); },
    } as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint(),
      makeAppModel(),
      brokenLLM,
    );

    expect(result.source).toBe('fallback');
    expect(result.techniques).toEqual(['xss', 'sqli']);
    expect(result.error).toContain('network down');
  });

  it('falls back when LLM returns non-JSON', async () => {
    const fakeLLM = new FakeLLM(['I cannot answer that request.']) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint(),
      makeAppModel(),
      brokenOverride(fakeLLM),
    );

    expect(result.source).toBe('fallback');
    expect(result.techniques).toEqual(['xss', 'sqli']);
  });

  it('handles forms', async () => {
    const fakeLLM = new FakeLLM([
      '{"techniques": ["sqli", "xss"], "reasoning": "login form with email/password fields"}',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForForm(
      makeForm(),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.techniques).toEqual(['sqli', 'xss']);
    expect(result.source).toBe('llm');
  });

  it('deduplicates repeated techniques', async () => {
    const fakeLLM = new FakeLLM([
      '{"techniques": ["xss", "xss", "sqli", "sqli"], "reasoning": "both"}',
    ]) as unknown as BaseChatModel;

    const result = await selectTechniquesForEndpoint(
      makeEndpoint(),
      makeAppModel(),
      fakeLLM,
    );

    expect(result.techniques).toEqual(['xss', 'sqli']);
  });
});

function brokenOverride(llm: BaseChatModel): BaseChatModel {
  return llm;
}
