// tests/cli/chat-dispatch.test.ts
//
// Tests for the chat-dispatch path in InteractiveHuntSession. We don't
// spin up a real browser — we just verify that when the user types a
// free-form chat message, the session calls the chatCoordinator, prints
// the LLM's text, and executes the LLM's plan by calling the right
// session methods.
import { describe, it, expect, vi } from 'vitest';
import type { ChatContext, ChatResponse, ChatMessage, ChatAction, ChatObservation } from '../../src/cli/chat-coordinator';

// We can't import the full InteractiveHuntSession because it spins up
// a real browser in the constructor. Instead, we test the dispatch
// logic by building a minimal fake session that uses the same
// dispatch path. We re-implement the relevant dispatch helper here
// for the test scope.
//
// (The integration is also covered by interactive-session.test.ts and
// the e2e hunt test.)

class FakeSession {
  calls: Array<{ kind: string; args: any[] }> = [];
  chatCoordinator: ((message: string, ctx: ChatContext) => Promise<ChatResponse>);
  history: ChatMessage[] = [];
  formsOnPage: any[] = [];
  attackCount = 0;
  findingCount = 0;
  pendingAttacks = new Set<string>();
  /** When the LLM call includes observations (turn 2), capture them. */
  observationsSeen: ChatObservation[][] = [];

  constructor(chatCoordinator: (message: string, ctx: ChatContext) => Promise<ChatResponse>) {
    this.chatCoordinator = chatCoordinator;
  }

  /** Mimic the executeChat path in the real session, including the
   *  plan-execute-resummarize loop. */
  async executeChat(message: string, triggerForm?: any): Promise<void> {
    const context: ChatContext = {
      target: 'https://example.com',
      currentUrl: 'https://example.com/',
      findings: [],
      recording: [],
      formsOnPage: this.formsOnPage.slice(),
      history: this.history.slice(),
      autotest: true,
      triggerForm,
    };
    this.history.push({ role: 'user', text: message });
    let reply: ChatResponse;
    try {
      reply = await this.chatCoordinator(message, context);
    } catch {
      // Mirror the real session: don't crash on LLM error
      return;
    }
    this.history.push({ role: 'assistant', text: reply.text });
    if (reply.plan.length === 0) return;

    const observations: ChatObservation[] = [];
    for (const action of reply.plan) {
      const obs = this.executeAction(action);
      if (obs) observations.push(obs);
    }
    const dataBearing = observations.filter((o) => o.data !== undefined);
    if (dataBearing.length > 0) {
      // Trigger summary turn
      const summaryCtx: ChatContext = { ...context, observations: dataBearing };
      this.observationsSeen.push(dataBearing);
      const summaryReply = await this.chatCoordinator('(summary)', summaryCtx);
      if (summaryReply.text) {
        // Replace the assistant text with the summary
        if (this.history.length > 0 && this.history[this.history.length - 1].role === 'assistant') {
          this.history[this.history.length - 1] = { role: 'assistant', text: summaryReply.text };
        }
      }
    }
  }

  executeAction(action: ChatAction): ChatObservation | null {
    switch (action.kind) {
      case 'attack':
        this.calls.push({ kind: 'attack', args: [action.url, action.technique] });
        this.attackCount++;
        return { action: 'attack', summary: `attacked ${action.url}`, data: { url: action.url, technique: action.technique, findings: 0 } };
      case 'go':
        this.calls.push({ kind: 'go', args: [action.url] });
        return { action: 'go', summary: `navigated to ${action.url}` };
      case 'click':
        this.calls.push({ kind: 'click', args: [action.selector] });
        return { action: 'click', summary: `clicked ${action.selector}` };
      case 'type':
        this.calls.push({ kind: 'type', args: [action.selector, action.value] });
        return { action: 'type', summary: `typed ${action.value} into ${action.selector}` };
      case 'fillForm':
        this.calls.push({ kind: 'fillForm', args: [action.formIndex, action.values, action.submit] });
        return { action: 'fillForm', summary: `filled form #${action.formIndex}` };
      case 'scanInteractive':
        return { action: 'scanInteractive', summary: 'found 3 buttons, 2 inputs', data: { buttons: [{}, {}, {}], inputs: [{}, {}] } };
      case 'scanForms':
        return { action: 'scanForms', summary: 'found 1 form', data: [{ index: 0, fields: [] }] };
      case 'extractLinks':
        return { action: 'extractLinks', summary: 'extracted 5 links', data: 'a\nb\nc\nd\ne' };
      case 'extractText':
        return { action: 'extractText', summary: 'extracted 200 chars', data: 'page text…' };
      case 'screenshot':
        return { action: 'screenshot', summary: 'saved screenshot', data: { bytes: 12345 } };
      case 'findings':
        this.calls.push({ kind: 'findings', args: [] });
        return { action: 'findings', summary: 'no findings', data: { count: 0 } };
      case 'status':
        this.calls.push({ kind: 'status', args: [] });
        return { action: 'status', summary: 'attacks=0 findings=0' };
      case 'noop':
        this.calls.push({ kind: 'noop', args: [] });
        return { action: 'noop', summary: 'no-op' };
    }
  }
}

describe('chat dispatch', () => {
  it('chat with text-only response does not execute any actions', async () => {
    const chatCoordinator = async (msg: string, _ctx: ChatContext) => ({
      text: `echo: ${msg}`,
      plan: [],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('hi');
    expect(session.history.length).toBe(2);
    expect(session.history[0]).toEqual({ role: 'user', text: 'hi' });
    expect(session.history[1]).toEqual({ role: 'assistant', text: 'echo: hi' });
    expect(session.calls.length).toBe(0);
  });

  it('chat with attack plan dispatches the attack', async () => {
    const chatCoordinator = async (_msg: string, _ctx: ChatContext): Promise<ChatResponse> => ({
      text: 'on it',
      plan: [{ kind: 'attack', url: '/q', technique: 'xss' }],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('attack the search field');
    expect(session.calls).toEqual([{ kind: 'attack', args: ['/q', 'xss'] }]);
    expect(session.attackCount).toBe(1);
  });

  it('chat with multi-step plan executes actions in order', async () => {
    const chatCoordinator = async (): Promise<ChatResponse> => ({
      text: 'testing the login flow',
      plan: [
        { kind: 'go', url: '/login' },
        { kind: 'fillForm', formIndex: 0, values: { user: 'admin', pass: 'p' }, submit: true },
        { kind: 'attack', url: '/login', technique: 'sqli' },
      ],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('test the login form for SQLi');
    expect(session.calls.map((c) => c.kind)).toEqual(['go', 'fillForm', 'attack']);
    expect(session.calls[0].args).toEqual(['/login']);
    expect(session.calls[1].args).toEqual([0, { user: 'admin', pass: 'p' }, true]);
    expect(session.calls[2].args).toEqual(['/login', 'sqli']);
  });

  it('chat history is included in subsequent context', async () => {
    const contextsSeen: ChatContext[] = [];
    const chatCoordinator = async (_msg: string, ctx: ChatContext) => {
      contextsSeen.push(ctx);
      return { text: 'ok', plan: [] };
    };
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('hi');
    await session.executeChat('how are you?');
    expect(contextsSeen[0].history.length).toBe(0);
    expect(contextsSeen[1].history.length).toBe(2); // hi + ok
    expect(contextsSeen[1].history[0]).toEqual({ role: 'user', text: 'hi' });
    expect(contextsSeen[1].history[1]).toEqual({ role: 'assistant', text: 'ok' });
  });

  it('form auto-test trigger is passed as triggerForm in context', async () => {
    const contextsSeen: ChatContext[] = [];
    const chatCoordinator = async (_msg: string, ctx: ChatContext) => {
      contextsSeen.push(ctx);
      return { text: 'testing', plan: [{ kind: 'attack', url: '/login', technique: 'sqli' }] };
    };
    const session = new FakeSession(chatCoordinator);
    const trigger = { index: 0, action: '/login', method: 'POST', fields: [{ name: 'user', type: 'text' }] };
    await session.executeChat('auto-test', trigger);
    expect(contextsSeen[0].triggerForm).toBe(trigger);
    expect(session.calls[0]).toEqual({ kind: 'attack', args: ['/login', 'sqli'] });
  });

  it('LLM error does not crash the session', async () => {
    const chatCoordinator = async (): Promise<ChatResponse> => {
      throw new Error('LLM unreachable');
    };
    const session = new FakeSession(chatCoordinator);
    // Should not throw
    await session.executeChat('hi');
    // No calls executed
    expect(session.calls.length).toBe(0);
  });
});

describe('plan-execute-resummarize loop', () => {
  it('data-bearing observations trigger a summary turn', async () => {
    const calls: Array<{ message: string; observations?: ChatObservation[] }> = [];
    const chatCoordinator = async (msg: string, ctx: ChatContext): Promise<ChatResponse> => {
      calls.push({ message: msg, observations: ctx.observations });
      if (ctx.observations) {
        return { text: 'final summary', plan: [], observations: ctx.observations };
      }
      return {
        text: 'scanning…',
        plan: [{ kind: 'scanInteractive' }],
      };
    };
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('check for interactive elements');
    expect(calls.length).toBe(2);
    expect(calls[0].message).toBe('check for interactive elements');
    expect(calls[0].observations).toBeUndefined();
    expect(calls[1].message).toBe('(summary)');
    expect(calls[1].observations).toBeDefined();
    expect(calls[1].observations!.length).toBe(1);
    expect(calls[1].observations![0].action).toBe('scanInteractive');
  });

  it('replaces the assistant text with the summary text', async () => {
    const chatCoordinator = async (_msg: string, ctx: ChatContext): Promise<ChatResponse> => {
      if (ctx.observations) return { text: 'REAL summary', plan: [], observations: ctx.observations };
      return { text: 'fake narrative', plan: [{ kind: 'scanInteractive' }] };
    };
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('check');
    expect(session.history[session.history.length - 1]).toEqual({ role: 'assistant', text: 'REAL summary' });
  });

  it('actions with no data do NOT trigger a summary turn', async () => {
    let callCount = 0;
    const chatCoordinator = async (_msg: string, ctx: ChatContext): Promise<ChatResponse> => {
      callCount++;
      if (ctx.observations) return { text: 'should not be called', plan: [] };
      return {
        text: 'navigating',
        plan: [
          { kind: 'go', url: '/x' },
          { kind: 'click', selector: '#btn' },
          { kind: 'type', selector: '#q', value: 'a' },
        ],
      };
    };
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('go click type');
    expect(callCount).toBe(1);
  });

  it('attack observations DO trigger a summary turn', async () => {
    let callCount = 0;
    const chatCoordinator = async (_msg: string, ctx: ChatContext): Promise<ChatResponse> => {
      callCount++;
      if (ctx.observations) return { text: 'attacked, found 0 issues', plan: [], observations: ctx.observations };
      return { text: 'attacking', plan: [{ kind: 'attack', url: '/q', technique: 'xss' }] };
    };
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('attack /q');
    expect(callCount).toBe(2);
    expect(session.calls.length).toBe(1);
  });
});

describe('new action dispatch', () => {
  it('scanInteractive dispatches as scanInteractive', async () => {
    const chatCoordinator = async (): Promise<ChatResponse> => ({
      text: 'ok',
      plan: [{ kind: 'scanInteractive' }],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('scan');
    expect(session.calls.length).toBe(0); // not in calls list
    expect(session.observationsSeen[0][0].action).toBe('scanInteractive');
  });

  it('extractLinks dispatches as extractLinks', async () => {
    const chatCoordinator = async (): Promise<ChatResponse> => ({
      text: 'ok',
      plan: [{ kind: 'extractLinks' }],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('links');
    expect(session.observationsSeen[0][0].action).toBe('extractLinks');
  });

  it('screenshot dispatches as screenshot', async () => {
    const chatCoordinator = async (): Promise<ChatResponse> => ({
      text: 'ok',
      plan: [{ kind: 'screenshot', fullPage: true }],
    });
    const session = new FakeSession(chatCoordinator);
    await session.executeChat('shot');
    expect(session.observationsSeen[0][0].action).toBe('screenshot');
  });
});
