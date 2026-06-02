/**
 * tests/helpers/fake-llm.ts
 *
 * Shared FakeLLM test double. Returns scripted responses in order.
 * Used by inference, specialist-builder, decision-commenter tests.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export class FakeLLM {
  public responses: string[];
  public callCount = 0;
  public failAfter: number | null = null;
  public latencyMs = 0;

  constructor(responses: string[]) {
    this.responses = responses;
  }

  async invoke(_messages: unknown): Promise<{ content: string }> {
    if (this.failAfter !== null && this.callCount >= this.failAfter) {
      throw new Error('FakeLLM simulated failure');
    }
    if (this.latencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.latencyMs));
    }
    const r = this.responses[this.callCount % this.responses.length];
    this.callCount++;
    return { content: r };
  }

  bindTools(_tools: unknown): FakeLLM {
    return this;
  }

  async batch(_inputs: unknown[]): Promise<{ content: string }[]> {
    return this.responses.map((r) => ({ content: r }));
  }

  get lc_namespace(): string[] {
    return ['test', 'fake-llm'];
  }
}

export function asBaseChatModel(llm: FakeLLM): BaseChatModel {
  return llm as unknown as BaseChatModel;
}
