/**
 * Eval harness — Slice 12.
 *
 * Shared deterministic building blocks for architecture evals: a production
 * `UltimatrixConfig` with an explicit test scope, and fakes ONLY at the
 * model/browser boundary (fake worker agent, fake model selector). The evals
 * themselves drive the real runtime modules.
 */

import type { UltimatrixConfig } from '../config'
import type { ModelSelector, WorkerTask } from '../models/selector'
import type { SpiderRuntimeEvent } from '../spider/runtime'

/** Build a production-shaped config with an explicit, deny-by-default scope. */
export function evalConfig(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_eval' } },
    modelTiers: {
      fast: { provider: 'groq', model: 'llama3-8b-8192' },
      balanced: { provider: 'groq', model: 'llama3-70b-8192' },
      powerful: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    },
    browser: { provider: 'stagehand', headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0, sessionScope: 'workflow' },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    scope: {
      allowedDomains: ['example.com'],
      allowedProtocols: ['https', 'http'],
      allowedCategories: ['read', 'search', 'browser_action'],
      enforcement: 'hard',
    },
    externalTools: { enabled: false, tools: {} },
    antiLoop: { staleThreshold: 2 },
    spider: { enabled: true, maxPages: 5, maxDepth: 1, maxDurationMs: 5000, authAware: true, boundaryMode: 'claim-based' },
    ...overrides,
  }
}

/** Capture SpiderRuntime events (via the runtime's own onEvent callback). */
export function eventCapturer(): { events: string[]; push: (e: SpiderRuntimeEvent) => void } {
  const events: string[] = []
  return {
    events,
    push: (e) => events.push(e.type),
  }
}

/** Minimal graph-store surface the spider runtime reads (page/endpoint/form/auth-flow nodes). */
export function fakeGraphStore(nodes: Array<{ type: string; id: string; properties: Record<string, unknown> }> = []) {
  const store = {
    _nodes: [...nodes],
    queryNodes: (type?: string) => store._nodes.filter((n) => !type || n.type === type),
    addReachability: () => undefined,
    save: async () => undefined,
  }
  return store
}

/** Fake worker AGENT — the only model boundary fake (no live LLM). */
export function fakeWorkerAgent(skillId: string, overrides?: { generate?: () => Promise<{ text: string }>; fail?: boolean }) {
  return {
    id: `worker-${skillId}-eval`,
    name: `${skillId} Specialist`,
    generate: overrides?.generate
      ?? (async () => {
        if (overrides?.fail) throw new Error(`worker ${skillId} failed (eval)`)
        return { text: `[eval] ${skillId} worker completed with bounded typed context` }
      }),
  }
}

/** Fake WorkerPool — spawn() returns a fake agent; counts spawns for assertions. */
export function fakeWorkerPool(opts?: { fail?: boolean; spawnOrder?: string[] }) {
  const spawned: Array<Record<string, unknown>> = []
  const agents = new Map<string, ReturnType<typeof fakeWorkerAgent>>()
  return {
    spawned,
    agents,
    spawn(config: { skillId: string; task?: string; tier?: string; modelId?: string; complexity?: string }): ReturnType<typeof fakeWorkerAgent> {
      spawned.push({ ...config })
      const agent = fakeWorkerAgent(config.skillId, { fail: opts?.fail })
      agents.set(agent.id, agent)
      return agent
    },
    get: (id: string) => agents.get(id),
    list: () => Array.from(agents.values()),
    clear: () => agents.clear(),
  }
}

/** Fake ModelSelector — returns a deterministic routing decision (no live model). */
export function fakeModelSelector(decision: { tier?: string; modelId?: string; provider?: string; reasoning?: string } = {}) {
  return {
    selectForTask: (_task: WorkerTask, _role: 'brain' | 'worker' | 'spider') => ({
      tier: decision.tier ?? 'powerful',
      modelId: decision.modelId ?? 'groq/llama-3.3-70b-versatile',
      provider: decision.provider ?? 'groq',
      reasoning: decision.reasoning ?? 'eval: deterministic routing',
    }),
  } as unknown as ModelSelector
}
