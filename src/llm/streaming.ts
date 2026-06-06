// src/llm/streaming.ts
//
// Helper that wraps an LLMClient.stream() call and pipes the tokens
// into a HuntCore via the LLMToken event. Returns the final LLMCallResult.
// Used by the 6 LLM call sites: composer, triage, chat, specialist,
// browser-driver, codegen-mutator.

import type { LLMClient, LLMCall, LLMCallResult } from './client';
import type { HuntCore } from '../hunt/core';
import type { LLMCallSite } from '../hunt/events';

export interface StreamToCoreOptions {
  core: HuntCore;
  source: LLMCallSite;
  /** Called for every chunk (for tests, etc.). */
  onChunk?: (chunk: string) => void;
}

/** Stream an LLM call into a HuntCore. Returns the full result. */
export async function streamToCore(llm: LLMClient, call: LLMCall, opts: StreamToCoreOptions): Promise<LLMCallResult> {
  const source = opts.source;
  const modelName = (llm as unknown as { getModelName?: () => string }).getModelName?.() ?? 'unknown';
  opts.core.recordLLMToken({ source, text: '', done: false, model: modelName });
  return llm.stream({ ...call, label: call.label ?? source }, (chunk) => {
    opts.core.recordLLMToken({ source, text: chunk, done: false });
    if (opts.onChunk) opts.onChunk(chunk);
  }).then((result) => {
    opts.core.recordLLMToken({ source, text: '', done: true, model: result.model, durationMs: result.durationMs });
    return result;
  });
}
