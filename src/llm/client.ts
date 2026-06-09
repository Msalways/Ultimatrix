// src/llm/client.ts
//
// Lightweight LLM client wrapper. Picks the first available provider
// based on env vars or ultimatrix.yaml, falls back to mock when
// nothing is configured. The Composer uses this for all reasoning —
// plan proposals, payload crafting, bypass generation, chain reasoning.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { providerRegistry } from '../providers/provider-registry';
import type { LLMProviderName } from '../core/types';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getCurrentPrompt } from '../tools/ask-user-tool';

/** Write a status message to stderr, or to the interactive prompt if active. */
function _writeStatus(msg: string): void {
  const p = getCurrentPrompt();
  if (p) {
    p.notify(msg);
  } else {
    process.stderr.write(msg);
  }
}

interface LoadedConfig {
  provider: string | null;
  apiKey: string | null;
  modelId: string | null;
  baseUrl: string | null;
}

let _yamlMod: { load: (s: string) => unknown } | null = null;
function yamlLoad(s: string): unknown {
  if (!_yamlMod) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _yamlMod = require('js-yaml') as { load: (s: string) => unknown };
  }
  return _yamlMod.load(s);
}

function resolveProvidersPath(): string {
  // Check CWD first (allows tests to override), then homedir
  const local = path.join(process.cwd(), 'providers.yaml');
  if (fs.existsSync(local)) return local;
  return path.join(os.homedir(), '.config', 'ultimatrix', 'providers.yaml');
}

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
  /**
   * Optional label printed at the start of a streaming session so the
   * user knows which LLM call is being streamed (e.g. "plan:1/xss",
   * "triage", "waf-bypass"). Used only when ULTIMATRIX_LLM_STREAM=1.
   */
  label?: string;
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
  private yamlConfig: LoadedConfig | null = null;

  constructor(config: LLMClientConfig = {}) {
    this.config = config;
  }

  private loadYamlConfig(): LoadedConfig | null {
    if (this.yamlConfig) return this.yamlConfig;
    let result: LoadedConfig = { provider: null, apiKey: null, modelId: null, baseUrl: null };
    // 1. Project ultimatrix.yaml
    for (const p of [path.join(process.cwd(), 'ultimatrix.yaml'), path.join(process.cwd(), 'ultimatrix.yml')]) {
      if (fs.existsSync(p)) {
        try {
          const parsed = yamlLoad(fs.readFileSync(p, 'utf-8')) as any;
          if (parsed && typeof parsed === 'object') {
            if (typeof parsed.provider === 'string') {
              result.provider = parsed.provider;
              result.modelId = parsed.model ?? null;
            } else if (parsed.provider && typeof parsed.provider === 'object') {
              result.provider = parsed.provider.name ?? null;
              result.modelId = parsed.provider.model ?? null;
              result.apiKey = parsed.provider.apiKey ?? null;
              result.baseUrl = parsed.provider.baseUrl ?? null;
            }
          }
        } catch { /* ignore */ }
        break;
      }
    }
    // 2. Global providers.yaml (secrets)
    const providersPath = resolveProvidersPath();
    if (fs.existsSync(providersPath) && result.provider) {
      try {
        const parsed = yamlLoad(fs.readFileSync(providersPath, 'utf-8')) as any;
        if (parsed && parsed[result.provider]) {
          if (!result.apiKey) result.apiKey = parsed[result.provider].apiKey ?? null;
          if (!result.modelId) result.modelId = parsed[result.provider].model ?? null;
          if (!result.baseUrl) result.baseUrl = parsed[result.provider].baseUrl ?? null;
        }
      } catch { /* ignore */ }
    }
    this.yamlConfig = result;
    return result.provider ? result : null;
  }

  /** Returns the provider that would be used (without instantiating) */
  detectProvider(): LLMProviderName {
    if (this.config.provider) {
      if (this.config.provider === 'mock') return 'mock';
      const cfg = this.loadYamlConfig();
      if (this.config.provider === cfg?.provider && (cfg?.apiKey || this.hasEnvFor(this.config.provider))) {
        if (process.env.ULTIMATRIX_LLM_DEBUG === '1') console.error(`[llm] explicit provider matched yaml: ${this.config.provider}`);
        return this.config.provider;
      }
      if (this.hasEnvFor(this.config.provider)) {
        if (process.env.ULTIMATRIX_LLM_DEBUG === '1') console.error(`[llm] explicit provider has env: ${this.config.provider}`);
        return this.config.provider;
      }
    }
    // ultimatrix.yaml provider
    const cfg = this.loadYamlConfig();
    if (cfg?.provider && (cfg.apiKey || this.hasEnvFor(cfg.provider as LLMProviderName))) {
      if (process.env.ULTIMATRIX_LLM_DEBUG === '1') console.error(`[llm] using yaml provider: ${cfg.provider} (apiKey=${cfg.apiKey ? 'yes' : 'from-env'})`);
      return cfg.provider as LLMProviderName;
    }
    // env vars in priority order
    for (const name of PROVIDER_PRIORITY) {
      if (name === 'mock') continue;
      if (this.hasEnvFor(name)) {
        if (process.env.ULTIMATRIX_LLM_DEBUG === '1') console.error(`[llm] using env provider: ${name}`);
        return name;
      }
    }
    // Fall back to providers.yaml entries only when no project-level
    // ultimatrix.yaml specifies a provider (cfg is null).
    if (!cfg?.provider) {
      const providersPath = resolveProvidersPath();
      if (fs.existsSync(providersPath)) {
        try {
          const parsed = yamlLoad(fs.readFileSync(providersPath, 'utf-8')) as Record<string, any>;
          if (parsed && typeof parsed === 'object') {
            for (const name of PROVIDER_PRIORITY) {
              if (name === 'mock') continue;
              if (parsed[name] && (parsed[name].apiKey || parsed[name].api_key)) {
                if (process.env.ULTIMATRIX_LLM_DEBUG === '1') console.error(`[llm] using providers.yaml provider: ${name}`);
                return name;
              }
            }
          }
        } catch { /* ignore */ }
      }
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
    if (process.env.ULTIMATRIX_LLM_DEBUG === '1') {
      const cfg = this.loadYamlConfig();
      console.error(`[llm] detected provider: ${detected}`);
      console.error(`[llm] yaml config:`, cfg);
    }
    // Explicit mock (new LLMClient({ provider: 'mock' })) is OK — returns false
    if (detected === 'mock' && this.config.provider === 'mock') {
      this.model = null;
      return false;
    }
    // Implicit mock (no provider configured at all) is an error
    if (detected === 'mock') {
      throw new Error(
        'No LLM provider configured. Set a provider via:\n' +
        '  1. ultimatrix.yaml: provider: groq (or openai, anthropic, etc.)\n' +
        '  2. Environment variable: GROQ_API_KEY, OPENAI_API_KEY, etc.\n' +
        '  3. ~/.config/ultimatrix/providers.yaml\n' +
        '  > Run: ultimatrix setup'
      );
    }
    const factory = providerRegistry.get(detected);
    if (!factory) {
      throw new Error(`LLM factory not found for provider "${detected}"`);
    }
    const { apiKey, modelId, baseUrl } = this.resolveCredentials(detected);
    this.modelId = modelId;
    try {
      this.model = await factory.create({
        apiKey,
        modelId,
        baseURL: baseUrl,
        temperature: this.config.temperature ?? 0.3,
        maxTokens: this.config.maxTokens ?? 4096,
      });
      return true;
    } catch (e) {
      throw new Error(
        `Failed to create LLM model for "${detected}": ${(e as Error).message}\n` +
        '  Check your API key and credentials.'
      );
    }
  }

  private resolveCredentials(name: LLMProviderName): { apiKey: string; modelId: string; baseUrl: string | undefined } {
    const cfg = this.loadYamlConfig();
    let apiKey = 'mock';
    const factory = providerRegistry.get(name);
    if (factory) {
      for (const v of factory.envVars) {
        if (process.env[v]) { apiKey = process.env[v] as string; break; }
      }
    }
    if (apiKey === 'mock' && cfg?.provider === name && cfg.apiKey) {
      apiKey = cfg.apiKey;
    }
    // Fall back to providers.yaml directly when no project-level config
    if (apiKey === 'mock') {
      const providersPath = resolveProvidersPath();
      if (fs.existsSync(providersPath)) {
        try {
          const parsed = yamlLoad(fs.readFileSync(providersPath, 'utf-8')) as Record<string, any>;
          if (parsed?.[name]?.apiKey) apiKey = parsed[name].apiKey;
          else if (parsed?.[name]?.api_key) apiKey = parsed[name].api_key;
        } catch { /* ignore */ }
      }
    }
    const modelId = this.config.modelId ?? cfg?.modelId ?? this.defaultModelFor(name);
    const baseUrl = cfg?.baseUrl ?? undefined;
    return { apiKey, modelId, baseUrl };
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

  /** Public read-only access to the resolved provider name. */
  getProviderName(): string {
    return this.detectProvider();
  }

  /** Public read-only access to the configured model id. */
  getModelName(): string {
    // `this.modelId` is set by resolveCredentials() during ensureModel()
    // and is the actual model used for API calls. `this.config.modelId`
    // is only set if `configure()` was called explicitly. Prefer the
    // resolved value.
    return this.modelId && this.modelId !== 'mock' ? this.modelId : (this.config?.modelId ?? 'default');
  }

  /**
   * Streaming variant of call(). Iterates LangChain's model.stream() and
   * invokes onToken for each chunk, while accumulating the final text.
   * Returns the same LLMCallResult shape as call(). If the model is mock
   * or streaming fails, falls back to a non-streaming call() so callers
   * never have to branch on streaming-vs-not.
   */
  async stream(c: LLMCall, onToken: (chunk: string) => void): Promise<LLMCallResult> {
    const start = Date.now();
    const labelPrefix = c.label ? `[${c.label}] ` : '';
    await this.ensureModel();
    if (!this.model) {
      // Mock fallback — emit one chunk so the user sees *something*
      const text = this.mockResponse(c);
      onToken(text);
      return {
        text,
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
      // Announce the stream so the terminal makes the label clear.
      _writeStatus(`\n\x1b[36m▸ LLM ${labelPrefix}streaming…\x1b[0m `);
      let text = '';
      for await (const chunk of await this.model.stream(messages, opts)) {
        const piece = typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content
                .map((p: unknown) => (typeof p === 'string' ? p : (p as { text?: string })?.text ?? ''))
                .join('')
            : '';
        if (!piece) continue;
        text += piece;
        onToken(piece);
      }
      _writeStatus('\n');
      let json: unknown = null;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try { json = JSON.parse(jsonMatch[0]); } catch { json = null; }
      }
      return {
        text,
        json,
        provider: this.provider,
        model: this.modelId,
        durationMs: Date.now() - start,
      };
    } catch (e) {
      _writeStatus('\n');
      // Streaming failed — fall back to non-streaming call so the agent
      // can still complete the plan (the user just won't see tokens).
      if (process.env.ULTIMATRIX_LLM_DEBUG === '1') {
        process.stderr.write(`[llm] stream failed, falling back to call(): ${(e as Error).message}\n`);
      }
      return this.call(c);
    }
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
