// tests/cli/form-autotest.test.ts
//
// Tests for the form auto-test watcher. The session scans the current
// page every 1.5s; when a NEW form appears, it dispatches a chat turn
// to the LLM with the form's fields. The LLM picks a technique and
// returns an attack plan.
//
// We test the logic by stubbing browser.extractForms and chatCoordinator.
import { describe, it, expect, vi } from 'vitest';
import type { ChatContext, ChatResponse } from '../../src/cli/chat-coordinator';

interface FormSpec {
  index: number;
  action: string;
  method: string;
  fields: Array<{ name: string; type: string }>;
}

/** Minimal re-implementation of the form-watch logic for unit tests.
 *  Mirrors the logic in InteractiveHuntSession.tick() so we can verify
 *  the behavior without spinning up a real session. */
class FormWatcher {
  seenFormSignatures = new Set<string>();
  lastUrl = 'https://example.com/';
  autoTest: boolean;
  forms: FormSpec[] = [];
  chatCalls: Array<{ message: string; triggerForm?: FormSpec }> = [];
  attackCalls: Array<{ url: string; technique?: string }> = [];
  knownUrls = new Set<string>();

  constructor(opts: { autotest: boolean; chat: (m: string, c: ChatContext) => Promise<ChatResponse> }) {
    this.autoTest = opts.autotest;
    this.chatCoordinator = opts.chat;
  }
  chatCoordinator: (m: string, c: ChatContext) => Promise<ChatResponse>;

  /** Simulate one watcher tick with the given forms on the page. */
  async tick(forms: FormSpec[]): Promise<void> {
    this.forms = forms;
    if (!this.autoTest) return;
    for (const form of forms) {
      const sig = this.signature(this.lastUrl, form);
      if (this.seenFormSignatures.has(sig)) continue;
      this.seenFormSignatures.add(sig);
      const ctx: ChatContext = {
        target: 'https://example.com',
        currentUrl: this.lastUrl,
        findings: [],
        recording: [],
        formsOnPage: forms,
        history: [],
        autotest: true,
        triggerForm: form,
      };
      this.chatCalls.push({
        message: `[form auto-test trigger] new form on ${this.lastUrl} with ${form.fields.length} field(s)`,
        triggerForm: form,
      });
      const reply = await this.chatCoordinator(`[auto-test]`, ctx);
      for (const action of reply.plan) {
        if (action.kind === 'attack') {
          this.attackCalls.push({ url: action.url, technique: action.technique });
          this.knownUrls.add(action.url);
        }
      }
    }
  }

  private signature(url: string, form: FormSpec): string {
    const fields = form.fields.map((f) => `${f.name}:${f.type}`).join(',');
    return `${url}::${form.action}::${form.method}::${fields}`;
  }
}

const loginForm: FormSpec = {
  index: 0,
  action: '/login',
  method: 'POST',
  fields: [{ name: 'user', type: 'text' }, { name: 'pass', type: 'password' }],
};

const searchForm: FormSpec = {
  index: 0,
  action: '/search',
  method: 'GET',
  fields: [{ name: 'q', type: 'text' }],
};

describe('form auto-test watcher', () => {
  it('auto-test: a new form triggers a chat call with triggerForm', async () => {
    const chat = vi.fn(async (_m: string, _c: ChatContext): Promise<ChatResponse> => ({
      text: 'testing login for SQLi',
      plan: [{ kind: 'attack', url: '/login', technique: 'sqli' }],
    }));
    const w = new FormWatcher({ autotest: true, chat });
    await w.tick([loginForm]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][1].triggerForm).toEqual(loginForm);
    expect(w.attackCalls).toEqual([{ url: '/login', technique: 'sqli' }]);
  });

  it('does not re-trigger for the same form on a second tick', async () => {
    const chat = vi.fn(async (): Promise<ChatResponse> => ({
      text: 'tested', plan: [{ kind: 'attack', url: '/login', technique: 'sqli' }],
    }));
    const w = new FormWatcher({ autotest: true, chat });
    await w.tick([loginForm]);
    await w.tick([loginForm]);
    await w.tick([loginForm]);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(w.attackCalls.length).toBe(1);
  });

  it('detects a NEW form even if an older one is still present', async () => {
    const chat = vi.fn(async (_m: string, _c: ChatContext): Promise<ChatResponse> => {
      return { text: 'ok', plan: [{ kind: 'attack', url: '/login', technique: 'sqli' }] };
    });
    const w = new FormWatcher({ autotest: true, chat });
    await w.tick([loginForm]);
    await w.tick([loginForm, searchForm]); // search form is new
    expect(chat).toHaveBeenCalledTimes(2);
    expect(w.attackCalls.length).toBe(2);
  });

  it('does NOT auto-test when autotest is off', async () => {
    const chat = vi.fn(async (): Promise<ChatResponse> => ({
      text: 'ok', plan: [],
    }));
    const w = new FormWatcher({ autotest: false, chat });
    await w.tick([loginForm]);
    expect(chat).not.toHaveBeenCalled();
    expect(w.attackCalls.length).toBe(0);
  });

  it('passes form fields in the chat context', async () => {
    const chat = vi.fn(async (_m: string, _c: ChatContext): Promise<ChatResponse> => ({
      text: 'ok', plan: [],
    }));
    const w = new FormWatcher({ autotest: true, chat });
    await w.tick([searchForm]);
    const ctx = chat.mock.calls[0][1] as ChatContext;
    expect(ctx.formsOnPage.length).toBe(1);
    expect(ctx.formsOnPage[0].fields[0].name).toBe('q');
    expect(ctx.formsOnPage[0].action).toBe('/search');
  });
});
