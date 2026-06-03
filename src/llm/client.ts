// src/llm/client.ts
//
// Lightweight LLM client wrapper. Picks the first available provider
// based on env vars, falls back to mock when nothing is configured.
// The Composer uses this for all reasoning — plan proposals, payload
// crafting, bypass generation, chain reasoning.

import { providerRegistry } from '../providers/provider-registry';
import type { LLMProviderName } from '../core/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

export interface LLMClientConfig {
  /** Explicit provider override */
  provider?: LLMProviderName;
  /** Explicit model override */
  modelId?: string;
  /** Force temperature (default 0.3) */
  temperature?: number;
  /** Force maxTokens (default 4096) */
  maxTokens?: number;
}

export interface LLMCall {
  /** System prompt — sets the agent's role and constraints */
  system: string;
  /** User prompt — the actual question/task */
  user: string;
  /** Optional JSON schema for structured output */
  jsonSchema?: Record<string, unknown>;
  /** Optional temperature override */
  temperature?: number;
  /** Optional maxTokens override */
  maxTokens?: number;
}

export interface LLMCallResult {
  text: string;
  /** Parsed JSON if the response was JSON, else null */
  json: unknown;
  /** Provider used */
  provider: LLMProviderName;
  /** Model used */
  model: string;
  /** Duration in ms */
  durationMs: number;
  /** Tokens used (if reported by provider) */
  tokens?: { input: number; output: number };
}

const PROVIDER_PRIORITY: LLMProviderName[] = [
  'groq',
  'together',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'azure-openai',
  'mistral',
  'nvidia',
  'bedrock',
  'mock',
];

export class LLMClient {
  private model: BaseChatModel | null = null;
  private provider: LLMProviderName = 'mock';
  private modelId: string = 'mock';
  private config: LLMClientConfig;

  constructor(config: LLMClientConfig = {}) {
    this.config = config;
  }

  /** Returns the provider that would be used (without instantiating) */
  detectProvider(): LLMProviderName {
    if (this.config.provider && this.hasEnvFor(this.config.provider)) {
      return this.config.provider;
    }
    for (const name of PROVIDER_PRIORITY) {
      if (name === 'mock') continue;
      if (this.hasEnvFor(name)) return name;
    }
    return 'mock';
  }

  private hasEnvFor(name: LLMProviderName): boolean {
    const factory = providerRegistry.get(name);
    if (!factory) return false;
    return factory.envVars.every((v) => !!process.env[v]);
  }

  /** Lazily build the model. Returns true if a real model is available. */
  async ensureModel(): Promise<boolean> {
    if (this.model) return this.provider !== 'mock';
    const detected = this.detectProvider();
    this.provider = detected;
    const factory = providerRegistry.get(detected);
    if (!factory) {
      this.provider = 'mock';
      this.provider = 'mock';
    }
    const apiKey = factory ? this.resolveApiKey(detected) : 'mock';
    const modelId = this.config.modelId ?? this.defaultModelFor(detected);
    this.modelId = modelId;
    if (detected === 'mock' || !factory) {
      this.model = null;
      this.provider = 'mock';
      return false;
    }
    try {
      this.model = await factory.create({
        apiKey,
        modelId,
        temperature: this.config.temperature ?? 0.3,
        maxTokens: this.config.maxTokens ?? 4096,
      });
      return true;
    } catch (e) {
      this.model = null;
      this.provider = 'mock';
      return false;
    }
  }

  private resolveApiKey(name: LLMProviderName): string {
    const factory = providerRegistry.get(name);
    if (!factory) return 'mock';
    for (const v of factory.envVars) {
      if (process.env[v]) return process.env[v] as string;
    }
    return 'mock';
  }

  private defaultModelFor(name: LLMProviderName): string {
    switch (name) {
      case 'groq': return 'llama-3.3-70b-versatile';
      case 'together': return 'mistralai/Mixtral-8x22B-Instruct-v0.1';
      case 'openai': return 'gpt-4o-mini';
      case 'anthropic': return 'claude-3-5-haiku-20241022';
      case 'gemini': return 'gemini-2.0-flash';
      case 'nvidia': return 'meta/llama-3.1-70b-instruct';
      case 'mock': return 'mock';
      default: return 'default';
    }
  }

  /** Make a single LLM call. Returns text + parsed JSON. */
  async call(c: LLMCall): Promise<LLMCallResult> {
    const start = Date.now();
    await this.ensureModel();
    if (!this.model) {
      // Mock fallback — return deterministic canned response
      return {
        text: this.mockResponse(c),
        json: null,
        provider: 'mock',
        model: 'mock',
        durationMs: Date.now() - start,
      };
    }
    try {
      const { SystemMessage, HumanMessage } = await import('@langchain/core/messages');
      const messages = [new SystemMessage(c.system), new HumanMessage(c.user)];
      const opts: Record<string, unknown> = {};
      if (c.temperature !== undefined) opts.temperature = c.temperature;
      else if (this.config.temperature !== undefined) opts.temperature = this.config.temperature;
      if (c.maxTokens !== undefined) opts.maxTokens = c.maxTokens;
      else if (this.config.maxTokens !== undefined) opts.maxTokens = this.config.maxTokens;
      const res = await this.model.invoke(messages, opts);
      const text = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
      let json: unknown = null;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          json = JSON.parse(jsonMatch[0]);
        } catch {
          json = null;
        }
      }
      return {
        text,
        json,
        provider: this.provider,
        model: this.modelId,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      return {
        text: `LLM error: ${(e as Error).message}`,
        json: null,
        provider: this.provider,
        model: this.modelId,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Returns whether a real (non-mock) provider is configured */
  isReal(): boolean {
    return this.detectProvider() !== 'mock';
  }

  private mockResponse(c: LLMCall): string {
    // Return a sensible mock based on the system prompt
    if (c.system.includes('plan proposer')) {
      return JSON.stringify({
        plans: [
          { id: 1, technique: 'idor', confidence: 0.7, rationale: 'mock — no real LLM configured' },
          { id: 2, technique: 'xss', confidence: 0.5, rationale: 'mock — no real LLM configured' },
        ],
      });
    }
    if (c.system.includes('bypass')) {
      return JSON.stringify({
        variants: [
          'mock-1',
          'mock-2',
          'mock-3',
        ],
      });
    }
    if (c.system.includes('chain')) {
      return JSON.stringify({
        chain: {
          name: 'mock-chain',
          steps: [],
          narrative: 'Mock chain — no LLM configured. Set GROQ_API_KEY or OPENAI_API_KEY to enable real reasoning.',
        },
      });
    }
    return 'mock response — no LLM configured';
  }
}

let _defaultClient: LLMClient | null = null;
export function getDefaultLLMClient(): LLMClient {
  if (!_defaultClient) _defaultClient = new LLMClient();
  return _defaultClient;
}
