// tests/helpers/mock-llm.ts
import type { LLMClient, LLMCall, LLMCallResult } from '../../src/llm/client';

export interface MockLLMOptions {
  defaultText?: string;
  defaultJson?: unknown;
  provider?: string;
  model?: string;
  onCall?: (call: LLMCall) => LLMCallResult;
}

export function createMockLLMClient(opts: MockLLMOptions = {}): LLMClient {
  const defaultResult: LLMCallResult = {
    text: opts.defaultText ?? '{"text": "ok", "plan": []}',
    json: opts.defaultJson ?? { text: 'ok', plan: [] },
    provider: (opts.provider ?? 'mock') as LLMCallResult['provider'],
    model: opts.model ?? 'mock-1',
    durationMs: 0,
  };
  // We avoid `new LLMClient()` because it tries to load configs.
  // Instead, return a thin object that satisfies the methods we use.
  const client = {
    async call(call: LLMCall): Promise<LLMCallResult> {
      if (opts.onCall) return opts.onCall(call);
      return defaultResult;
    },
    async stream(call: LLMCall, onToken: (chunk: string) => void): Promise<LLMCallResult> {
      if (opts.onCall) {
        const r = opts.onCall(call);
        for (const ch of r.text) onToken(ch);
        return r;
      }
      for (const ch of defaultResult.text) onToken(ch);
      return defaultResult;
    },
    getProviderName(): string { return opts.provider ?? 'mock'; },
    getModelName(): string { return opts.model ?? 'mock-1'; },
  };
  return client as unknown as LLMClient;
}
