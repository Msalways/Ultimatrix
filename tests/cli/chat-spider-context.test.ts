// tests/cli/chat-spider-context.test.ts
//
// Block 10: chat spider context. The chat coordinator now summarises
// the on-disk app-model so the chat LLM can see what the spider has
// discovered (endpoints, forms, tech stack, auth, OOB callbacks).
// These tests cover the pure functions: summarizeSpider() builds the
// summary, formatSpiderSection() renders it as a chat-prompt section.

import { describe, it, expect } from 'vitest';
import { DEFAULT_MODEL, type AppModel, type AppModelEndpoint, type AppModelForm } from '../../src/core/app-model';
import {
  summarizeSpider,
  formatSpiderSection,
  type ChatSpiderSummary,
} from '../../src/cli/chat-coordinator';

function mkEndpoint(over: Partial<AppModelEndpoint>): AppModelEndpoint {
  return {
    path: '/default',
    method: 'GET',
    params: [],
    requiresAuth: false,
    responseStatus: 200,
    contentType: 'text/html',
    bodyPreview: '',
    ...over,
  };
}

function mkForm(over: Partial<AppModelForm>): AppModelForm {
  return {
    pageUrl: 'https://example.com/',
    action: '/submit',
    method: 'POST',
    fields: [],
    ...over,
  };
}

describe('summarizeSpider', () => {
  it('returns all-zero counts for an empty app-model', () => {
    const s = summarizeSpider({ ...DEFAULT_MODEL });
    expect(s.endpointCount).toBe(0);
    expect(s.formCount).toBe(0);
    expect(s.scriptCount).toBe(0);
    expect(s.oastCallbackCount).toBe(0);
    expect(s.endpoints).toEqual([]);
    expect(s.visitedUrls).toEqual([]);
    expect(s.techStack).toEqual([]);
  });

  it('counts endpoints, forms, scripts, and OOB callbacks', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [mkEndpoint({ path: '/a' }), mkEndpoint({ path: '/b' })],
      forms: [mkForm({ pageUrl: 'https://example.com/' })],
      scripts: [{ src: 'https://cdn.example/x.js', type: 'text/javascript', content: '' }],
      oastCallbacks: [{ uuid: 'u', url: 'http://oast/c', timestamp: 1, method: 'GET' }],
    };
    const s = summarizeSpider(m);
    expect(s.endpointCount).toBe(2);
    expect(s.formCount).toBe(1);
    expect(s.scriptCount).toBe(1);
    expect(s.oastCallbackCount).toBe(1);
  });

  it('passes through auth type and login endpoint', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      auth: { ...DEFAULT_MODEL.auth, type: 'JWT', loginEndpoint: '/api/auth/login' },
    };
    const s = summarizeSpider(m);
    expect(s.authType).toBe('JWT');
    expect(s.loginEndpoint).toBe('/api/auth/login');
  });

  it('falls back to "unknown" auth type when unset', () => {
    const m: AppModel = { ...DEFAULT_MODEL, auth: { ...DEFAULT_MODEL.auth, type: 'unknown' } };
    const s = summarizeSpider(m);
    expect(s.authType).toBe('unknown');
    expect(s.loginEndpoint).toBe('');
  });

  it('caps tech stack at 10 entries', () => {
    const stack = Array.from({ length: 20 }, (_, i) => `tech-${i}`);
    const m: AppModel = { ...DEFAULT_MODEL, techStack: stack };
    const s = summarizeSpider(m);
    expect(s.techStack).toHaveLength(10);
    expect(s.techStack[0]).toBe('tech-0');
  });

  it('sorts endpoints by param count desc', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [
        mkEndpoint({ path: '/low', params: [{ name: 'a', type: 'string', required: false }] }),
        mkEndpoint({ path: '/high', params: [
          { name: 'a', type: 'string', required: false },
          { name: 'b', type: 'string', required: false },
          { name: 'c', type: 'string', required: false },
        ] }),
        mkEndpoint({ path: '/mid', params: [
          { name: 'x', type: 'string', required: false },
          { name: 'y', type: 'string', required: false },
        ] }),
      ],
    };
    const s = summarizeSpider(m);
    expect(s.endpoints.map((e) => e.path)).toEqual(['/high', '/mid', '/low']);
  });

  it('caps endpoint list at the configured limit', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: Array.from({ length: 30 }, (_, i) => mkEndpoint({ path: `/e${i}` })),
    };
    const s = summarizeSpider(m, { endpointCap: 5 });
    expect(s.endpoints).toHaveLength(5);
    expect(s.totalEndpointCount).toBe(30);
  });

  it('keeps totalEndpointCount equal to endpointCount when under cap', () => {
    const m: AppModel = { ...DEFAULT_MODEL, endpoints: [mkEndpoint({ path: '/a' })] };
    const s = summarizeSpider(m);
    expect(s.endpointCount).toBe(1);
    expect(s.totalEndpointCount).toBe(1);
  });

  it('caps visitedUrls at the configured limit and keeps the tail', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      visitedUrls: Array.from({ length: 30 }, (_, i) => `https://example.com/p${i}`),
    };
    const s = summarizeSpider(m, { visitedCap: 3 });
    expect(s.visitedUrls).toHaveLength(3);
    expect(s.visitedUrls[0]).toBe('https://example.com/p27');
    expect(s.visitedUrls[2]).toBe('https://example.com/p29');
  });

  it('caps nextSteps at the configured limit', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      nextSteps: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
    };
    const s = summarizeSpider(m, { nextStepsCap: 3 });
    expect(s.nextSteps).toEqual(['s1', 's2', 's3']);
  });

  it('passes through requiresAuth and bodyFormat on each endpoint', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [
        mkEndpoint({ path: '/api', method: 'POST', requiresAuth: true, bodyFormat: 'json' }),
      ],
    };
    const s = summarizeSpider(m);
    expect(s.endpoints[0]).toMatchObject({
      method: 'POST', path: '/api', requiresAuth: true, bodyFormat: 'json', paramCount: 0,
    });
  });

  it('paramCount matches the number of params declared on the endpoint', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [
        mkEndpoint({
          path: '/search',
          params: [
            { name: 'q', type: 'string', required: true },
            { name: 'page', type: 'number', required: false },
          ],
        }),
      ],
    };
    const s = summarizeSpider(m);
    expect(s.endpoints[0].paramCount).toBe(2);
  });
});

describe('formatSpiderSection', () => {
  it('includes the "Spider summary:" header', () => {
    const s: ChatSpiderSummary = summarizeSpider({ ...DEFAULT_MODEL });
    const out = formatSpiderSection(s);
    expect(out).toMatch(/Spider summary:/);
  });

  it('shows zero counts when the app-model is empty', () => {
    const s: ChatSpiderSummary = summarizeSpider({ ...DEFAULT_MODEL });
    const out = formatSpiderSection(s);
    expect(out).toContain('0 endpoints');
    expect(out).toContain('0 forms');
    expect(out).toContain('0 scripts');
    expect(out).toContain('0 OOB callbacks');
  });

  it('pluralises correctly: 1 endpoint, 1 form, 1 script, 1 OOB callback', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [mkEndpoint({ path: '/a' })],
      forms: [mkForm({ pageUrl: 'https://example.com/' })],
      scripts: [{ src: 'x', type: 'text/javascript', content: '' }],
      oastCallbacks: [{ uuid: 'u', url: 'http://oast/c', timestamp: 1, method: 'GET' }],
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('1 endpoint,');
    expect(out).toContain('1 form,');
    expect(out).toContain('1 script,');
    expect(out).toContain('1 OOB callback\n');
  });

  it('pluralises for >1 correctly', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [mkEndpoint({ path: '/a' }), mkEndpoint({ path: '/b' })],
      oastCallbacks: [
        { uuid: 'a', url: 'http://oast/1', timestamp: 1, method: 'GET' },
        { uuid: 'b', url: 'http://oast/2', timestamp: 2, method: 'GET' },
      ],
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('2 endpoints,');
    expect(out).toContain('2 OOB callbacks\n');
  });

  it('mentions auth type and login endpoint when set', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      auth: { ...DEFAULT_MODEL.auth, type: 'session', loginEndpoint: '/login' },
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('auth: session');
    expect(out).toContain('login: /login');
  });

  it('shows "no auth detected" when auth type is unknown', () => {
    const s: ChatSpiderSummary = summarizeSpider({ ...DEFAULT_MODEL });
    const out = formatSpiderSection(s);
    expect(out).toContain('no auth detected');
  });

  it('lists endpoints with method, path, [auth] marker, body format, and param count', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [
        mkEndpoint({ path: '/search', method: 'GET', params: [
          { name: 'q', type: 'string', required: true },
        ] }),
        mkEndpoint({ path: '/api/users', method: 'POST', requiresAuth: true, bodyFormat: 'json' }),
      ],
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('GET    /search');
    expect(out).toContain('(1 param)');
    expect(out).toContain('POST   /api/users');
    expect(out).toContain('[auth]');
    expect(out).toContain('<json>');
  });

  it('omits the "top endpoints" line when there are no endpoints', () => {
    const s: ChatSpiderSummary = summarizeSpider({ ...DEFAULT_MODEL });
    const out = formatSpiderSection(s);
    expect(out).not.toContain('top endpoints');
  });

  it('includes "X of Y" when the endpoint list is capped', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: Array.from({ length: 50 }, (_, i) => mkEndpoint({ path: `/e${i}` })),
    };
    const s = summarizeSpider(m, { endpointCap: 5 });
    const out = formatSpiderSection(s);
    expect(out).toContain('top endpoints (5 of 50');
  });

  it('lists recently visited URLs', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      visitedUrls: ['https://a.example/', 'https://b.example/p'],
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('recently visited');
    expect(out).toContain('https://a.example/');
    expect(out).toContain('https://b.example/p');
  });

  it('lists next-step suggestions', () => {
    const m: AppModel = {
      ...DEFAULT_MODEL,
      nextSteps: ['Test XSS on /search', 'Probe /admin'],
    };
    const s = summarizeSpider(m);
    const out = formatSpiderSection(s);
    expect(out).toContain('recon\'s next-step suggestions');
    expect(out).toContain('Test XSS on /search');
    expect(out).toContain('Probe /admin');
  });
});

describe('buildChatUserMessage with spider context', () => {
  it('includes the spider summary section when context.spider is set', async () => {
    const { buildChatUserMessage } = await import('../../src/cli/chat-coordinator');
    const m: AppModel = {
      ...DEFAULT_MODEL,
      endpoints: [mkEndpoint({ path: '/search' })],
      auth: { ...DEFAULT_MODEL.auth, type: 'JWT', loginEndpoint: '/api/auth/login' },
    };
    const msg = buildChatUserMessage('what did you find?', {
      target: 'https://xss-game.appspot.com',
      currentUrl: 'https://xss-game.appspot.com/',
      findings: [],
      recording: [],
      formsOnPage: [],
      history: [],
      autotest: false,
      spider: summarizeSpider(m),
    });
    expect(msg).toContain('Spider summary:');
    expect(msg).toContain('auth: JWT');
    expect(msg).toContain('/search');
  });

  it('omits the spider section when context.spider is not set', async () => {
    const { buildChatUserMessage } = await import('../../src/cli/chat-coordinator');
    const msg = buildChatUserMessage('hi', {
      target: 'https://xss-game.appspot.com',
      currentUrl: 'https://xss-game.appspot.com/',
      findings: [],
      recording: [],
      formsOnPage: [],
      history: [],
      autotest: false,
    });
    expect(msg).not.toContain('Spider summary:');
  });
});
