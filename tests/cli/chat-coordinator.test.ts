// tests/cli/chat-coordinator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { LLMClient } from '../../src/llm/client';
import {
  buildChatUserMessage,
  buildSummaryUserMessage,
  callChat,
  parseChatResponse,
  trimHistory,
  type ChatContext,
  type ChatMessage,
} from '../../src/cli/chat-coordinator';

function mkLLM(responses: Array<{ text: string; json?: unknown }>): LLMClient {
  const c = new LLMClient({ provider: 'mock' });
  c.call = vi.fn(async () => {
    const r = responses.shift() ?? { text: '{"text":"(no response)","plan":[]}' };
    return { text: r.text, json: r.json ?? null, provider: 'mock' as const, model: 'mock', durationMs: 0 };
  });
  c.isReal = () => false;
  return c;
}

function mkContext(over: Partial<ChatContext> = {}): ChatContext {
  return {
    target: 'https://xss-game.appspot.com',
    currentUrl: 'https://xss-game.appspot.com/level1/frame',
    findings: [],
    recording: [],
    formsOnPage: [],
    history: [],
    autotest: true,
    ...over,
  };
}

describe('buildChatUserMessage', () => {
  it('includes target, current URL, and user message', () => {
    const msg = buildChatUserMessage('hi', mkContext());
    expect(msg).toContain('Target: https://xss-game.appspot.com');
    expect(msg).toContain('Current URL: https://xss-game.appspot.com/level1/frame');
    expect(msg).toContain('User: hi');
  });

  it('lists findings in the context', () => {
    const msg = buildChatUserMessage('explain', mkContext({
      findings: [
        { id: 'f1', type: 'xss', endpoint: '/q', param: 'q', method: 'GET', severity: 'high', confidence: 0.9, confirmed: true, evidence: [] },
      ],
    }));
    expect(msg).toContain('xss');
    expect(msg).toContain('/q');
  });

  it('describes forms on the page', () => {
    const msg = buildChatUserMessage('test it', mkContext({
      formsOnPage: [
        { index: 0, action: '/search', method: 'GET', fields: [{ name: 'q', type: 'text' }] },
      ],
    }));
    expect(msg).toContain('form #0');
    expect(msg).toContain('action="/search"');
    expect(msg).toContain('q: text');
  });

  it('includes form auto-test trigger context when present', () => {
    const msg = buildChatUserMessage('auto', mkContext({
      triggerForm: { index: 0, action: '/login', method: 'POST', fields: [{ name: 'username', type: 'text' }] },
    }));
    expect(msg).toContain('Form auto-test trigger');
    expect(msg).toContain('login');
  });

  it('includes chat history', () => {
    const history: ChatMessage[] = [
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: 'hello' },
    ];
    const msg = buildChatUserMessage('and you?', mkContext({ history }));
    expect(msg).toContain('user: hi');
    expect(msg).toContain('agent: hello');
  });
});

describe('parseChatResponse', () => {
  it('parses text + plan', () => {
    const r = parseChatResponse(
      { text: 'on it', plan: [{ kind: 'attack', url: '/q', technique: 'xss' }] },
      'fallback',
    );
    expect(r.text).toBe('on it');
    expect(r.plan.length).toBe(1);
    expect(r.plan[0].kind).toBe('attack');
  });

  it('falls back to raw text when text is missing', () => {
    const r = parseChatResponse({ plan: [] }, 'raw text');
    expect(r.text).toBe('raw text');
  });

  it('drops invalid actions', () => {
    const r = parseChatResponse(
      { text: 'ok', plan: [{ kind: 'attack' }, { kind: 'noop' }, null, { kind: 'go', url: '/x' }] },
      '',
    );
    expect(r.plan.length).toBe(2);
    expect(r.plan[0].kind).toBe('noop');
    expect(r.plan[1].kind).toBe('go');
  });

  it('handles null input gracefully', () => {
    const r = parseChatResponse(null, 'fallback');
    expect(r.text).toBe('fallback');
    expect(r.plan).toEqual([]);
  });

  it('parses fillForm with values + submit flag', () => {
    const r = parseChatResponse(
      { text: 'ok', plan: [{ kind: 'fillForm', formIndex: 0, values: { user: 'admin' }, submit: true }] },
      '',
    );
    expect(r.plan[0].kind).toBe('fillForm');
    if (r.plan[0].kind === 'fillForm') {
      expect(r.plan[0].values).toEqual({ user: 'admin' });
      expect(r.plan[0].submit).toBe(true);
    }
  });
});

describe('trimHistory', () => {
  it('keeps history under the limit', () => {
    const h: ChatMessage[] = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `m${i}` }));
    const t = trimHistory(h, 10);
    expect(t.length).toBe(10);
    expect(t[0].text).toBe('m10');
    expect(t[9].text).toBe('m19');
  });

  it('returns history as-is when under the limit', () => {
    const h: ChatMessage[] = [{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }];
    const t = trimHistory(h, 10);
    expect(t).toEqual(h);
  });
});

describe('callChat', () => {
  it('invokes the LLM and parses the response', async () => {
    const llm = mkLLM([{ text: '{"text":"hi","plan":[]}', json: { text: 'hi', plan: [] } }]);
    const r = await callChat(llm, 'hello', mkContext());
    expect(r.text).toBe('hi');
    expect(r.plan).toEqual([]);
  });

  it('returns the LLM text as fallback when json is missing', async () => {
    const llm = mkLLM([{ text: 'plain text reply' }]);
    const r = await callChat(llm, 'hi', mkContext());
    expect(r.text).toBe('plain text reply');
  });

  it('passes target, current URL, and forms in the user message', async () => {
    let captured = '';
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      captured = args.user;
      return { text: '{}', json: { text: 'ok', plan: [] }, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    await callChat(llm, 'test it', mkContext({
      target: 'https://example.com',
      currentUrl: 'https://example.com/login',
      formsOnPage: [{ index: 0, action: '/login', method: 'POST', fields: [{ name: 'user', type: 'text' }] }],
    }));
    expect(captured).toContain('Target: https://example.com');
    expect(captured).toContain('Current URL: https://example.com/login');
    expect(captured).toContain('user: text');
  });
});

describe('new action kinds', () => {
  it('parses scanInteractive', () => {
    const r = parseChatResponse({ text: 'scanning…', plan: [{ kind: 'scanInteractive' }] }, '');
    expect(r.plan[0].kind).toBe('scanInteractive');
  });

  it('parses scanForms', () => {
    const r = parseChatResponse({ text: 'scanning…', plan: [{ kind: 'scanForms' }] }, '');
    expect(r.plan[0].kind).toBe('scanForms');
  });

  it('parses extractLinks', () => {
    const r = parseChatResponse({ text: 'extracting…', plan: [{ kind: 'extractLinks' }] }, '');
    expect(r.plan[0].kind).toBe('extractLinks');
  });

  it('parses extractText', () => {
    const r = parseChatResponse({ text: 'extracting…', plan: [{ kind: 'extractText' }] }, '');
    expect(r.plan[0].kind).toBe('extractText');
  });

  it('parses screenshot with fullPage flag', () => {
    const r = parseChatResponse({ text: 'shooting…', plan: [{ kind: 'screenshot', fullPage: true }] }, '');
    expect(r.plan[0].kind).toBe('screenshot');
    if (r.plan[0].kind === 'screenshot') {
      expect(r.plan[0].fullPage).toBe(true);
    }
  });

  it('screenshot defaults fullPage to false when missing', () => {
    const r = parseChatResponse({ text: 'shooting…', plan: [{ kind: 'screenshot' }] }, '');
    if (r.plan[0].kind === 'screenshot') {
      expect(r.plan[0].fullPage).toBe(false);
    }
  });

  it('reason field is preserved on every action kind', () => {
    const r = parseChatResponse({
      text: 'ok',
      plan: [
        { kind: 'attack', url: '/q', technique: 'xss', reason: 'test for XSS' },
        { kind: 'go', url: '/x', reason: 'navigate' },
        { kind: 'click', selector: '#btn', reason: 'click submit' },
        { kind: 'type', selector: '#q', value: 'a', reason: 'fill q' },
        { kind: 'fillForm', formIndex: 0, values: {}, submit: false, reason: 'fill login' },
        { kind: 'scanInteractive', reason: 'find buttons' },
      ],
    }, '');
    expect(r.plan.length).toBe(6);
    for (const action of r.plan) {
      expect((action as any).reason).toBeDefined();
    }
  });
});

describe('system prompt', () => {
  it('forbids narration without a plan', async () => {
    let captured = '';
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      captured = args.system;
      return { text: '{}', json: { text: 'ok', plan: [] }, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    await callChat(llm, 'test', mkContext());
    // Block 21: the prompt was rewritten to be more directive.
    // It now states the contract upfront and ends with an explicit
    // reminder that the action MUST be in plan or the user sees
    // text without the page moving.
    expect(captured).toMatch(/Output contract/i);
    expect(captured).toMatch(/Both fields are required/i);
    expect(captured).toMatch(/#1 thing to avoid/i);
    expect(captured).toMatch(/empty "plan" is allowed ONLY for question-style prompts/i);
  });

  it('lists all 13 ChatAction kinds by name in the system prompt', async () => {
    let captured = '';
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      captured = args.system;
      return { text: '{}', json: { text: 'ok', plan: [] }, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    await callChat(llm, 'test', mkContext());
    for (const kind of ['scanInteractive', 'scanForms', 'extractLinks', 'extractText', 'screenshot', 'go', 'click', 'type', 'fillForm', 'attack', 'findings', 'status', 'noop']) {
      expect(captured).toContain(kind);
    }
  });
});

describe('summary turn (turn 2)', () => {
  it('routes to the summary system prompt when observations are present', async () => {
    let captured = '';
    const llm = new LLMClient({ provider: 'mock' });
    llm.call = vi.fn(async (args: any) => {
      captured = args.system;
      return { text: '{"text":"summary"}', json: { text: 'summary', plan: [] }, provider: 'mock' as const, model: 'mock', durationMs: 0 };
    });
    llm.isReal = () => false;
    const obs = [{ action: 'scanInteractive' as const, summary: 'found 3 buttons', data: { buttons: [] } }];
    const r = await callChat(llm, '(ignored)', mkContext({ observations: obs }));
    expect(captured).toMatch(/summaris/i);
    expect(r.text).toBe('summary');
    expect(r.plan).toEqual([]);
  });

  it('truncates long observation data to keep context small', () => {
    const big = 'x'.repeat(8000);
    const obs = [{ action: 'extractText' as const, summary: 'lots of text', data: big }];
    const msg = buildSummaryUserMessage(obs);
    // The full data should NOT be in the message; it should be truncated
    expect(msg).toContain('truncated');
    expect(msg.length).toBeLessThan(5000);
  });

  it('includes each observation summary in the summary turn', () => {
    const obs = [
      { action: 'scanInteractive' as const, summary: 'found 5 buttons' },
      { action: 'attack' as const, summary: 'found 0 vulnerabilities' },
    ];
    const msg = buildSummaryUserMessage(obs);
    expect(msg).toContain('found 5 buttons');
    expect(msg).toContain('found 0 vulnerabilities');
  });

  it('buildSummaryUserMessage does NOT include the chat history or forms', () => {
    const obs = [{ action: 'scanInteractive' as const, summary: '5 buttons' }];
    const msg = buildSummaryUserMessage(obs);
    expect(msg).not.toContain('Target:');
    expect(msg).not.toContain('Forms on current page');
    expect(msg).not.toContain('User:');
  });
});
