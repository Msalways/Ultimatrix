import { describe, it, expect, beforeEach } from 'vitest'
import { ModelSelector, type WorkerTask, type ModelCapabilities } from '../../src/models/selector'
import { resetAllProviderLimiters } from '../../src/models/limiter-factory'
import { resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
import type { UltimatrixConfig } from '../../src/config'

function makeConfig(overrides?: Partial<UltimatrixConfig>): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'groq/llama3-8b-8192',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_xxx' }, openai: { apiKey: 'sk_test' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    budgetPolicy: {
      enforcement: 'soft',
      scope: 'session',
      resetOn: 'never',
      allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
      maxModelCallsPerTask: 15,
      trackTokens: false,
    },
    modelCapabilities: {
      'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 4096, strengths: ['fast-inference'], supportsStreaming: true, supportsStructuredOutput: false },
      'openai/gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, strengths: ['reasoning', 'vision'], supportsStreaming: true, supportsStructuredOutput: true },
    },
    ...overrides,
  }
}

function makeTask(overrides?: Partial<WorkerTask>): WorkerTask {
  return {
    skillId: 'recon',
    taskDescription: 'Enumerate endpoints',
    complexity: 'medium',
    ...overrides,
  }
}

describe('ModelSelector', () => {
  beforeEach(() => {
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
  })

  it('selects a model for a task', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const selection = selector.selectForTask(makeTask(), 'worker')

    expect(selection.provider).toBeTruthy()
    expect(selection.modelId).toBeTruthy()
    expect(selection.tier).toBeTruthy()
    expect(selection.reasoning).toBeTruthy()
    expect(selection.budget).toBeTruthy()
  })

  it('respects capability match in scoring', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask({ requiredCapabilities: ['reasoning'] })
    const selection = selector.selectForTask(task, 'worker')

    // openai/gpt-4o has 'reasoning' strength, should be preferred
    expect(selection.reasoning).toContain('reasoning')
  })

  it('prefers fast tier for low complexity', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask({ complexity: 'low' })
    const selection = selector.selectForTask(task, 'worker')

    expect(selection.tier).toBe('fast')
  })

  it('prefers powerful tier for critical complexity', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask({ complexity: 'critical' })
    const selection = selector.selectForTask(task, 'worker')

    expect(selection.tier).toBe('powerful')
  })

  it('calculates budget based on allocation', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask()
    const selection = selector.selectForTask(task, 'worker')

    // workers get 0.6 allocation of 15 maxModelCalls = 9
    expect(selection.budget.maxAllowedModelCalls).toBe(9)
  })

  it('brain gets different allocation than worker', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask()

    const brainSelection = selector.selectForTask(task, 'brain')
    const workerSelection = selector.selectForTask(task, 'worker')

    // brain: 0.3 * 15 = 4, worker: 0.6 * 15 = 9
    expect(brainSelection.budget.maxAllowedModelCalls).toBe(4)
    expect(workerSelection.budget.maxAllowedModelCalls).toBe(9)
  })

  it('falls back to default when no capabilities defined', () => {
    const config = makeConfig({ modelCapabilities: undefined })
    const selector = new ModelSelector({}, config.budgetPolicy!, config)
    const selection = selector.selectForTask(makeTask(), 'worker')

    expect(selection.provider).toBe('groq')
    expect(selection.modelId).toBe('groq/llama3-8b-8192')
  })

  it('explainSelection returns readable string', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    const task = makeTask()
    const selection = selector.selectForTask(task, 'worker')
    const explanation = selector.explainSelection(selection, task)

    expect(typeof explanation).toBe('string')
    expect(explanation.length).toBeGreaterThan(10)
    expect(explanation).toContain('recon')
  })

  it('provider diversity bonus when brain provider set', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)
    selector.setBrainProvider('groq')
    const task = makeTask()
    const selection = selector.selectForTask(task, 'worker')

    // Should prefer openai (diversity) when groq is brain provider
    expect(selection.reasoning).toContain('provider diversity')
  })

  it('recordSuccess increments history', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)

    // Record several successes for openai
    for (let i = 0; i < 5; i++) {
      selector.recordSuccess('openai', 'gpt-4o')
    }

    const task = makeTask({ requiredCapabilities: ['reasoning'] })
    const selection = selector.selectForTask(task, 'worker')

    // Should mention success rate in reasoning or at least still select openai
    expect(selection.provider).toBe('openai')
  })

  it('selectTierForSkill maps complexity to tier', () => {
    const config = makeConfig()
    const selector = new ModelSelector(config.modelCapabilities!, config.budgetPolicy!, config)

    expect(selector.selectTierForSkill('recon', 'low')).toBe('fast')
    expect(selector.selectTierForSkill('recon', 'medium')).toBe('balanced')
    expect(selector.selectTierForSkill('recon', 'high')).toBe('powerful')
    expect(selector.selectTierForSkill('recon', 'critical')).toBe('powerful')
  })

  it('A1: uses config.modelTiers even when modelCapabilities is unset', () => {
    // Mirrors the user's tier-only config: no modelCapabilities, only modelTiers.
    const config = makeConfig({
      provider: 'nvidia',
      model: 'nvidia/nemotron-3-super-120b',
      creds: { nvidia: { apiKey: 'nv_xxx' } },
      modelCapabilities: undefined,
      modelTiers: {
        fast: { provider: 'nvidia', model: 'nvidia/nemotron-nano-9b-v2' },
        balanced: { provider: 'nvidia', model: 'nvidia/nemotron-3-super-120b' },
        powerful: { provider: 'nvidia', model: 'nvidia/nemotron-3-ultra-550b-a55b' },
      },
    })
    const selector = new ModelSelector({}, config.budgetPolicy!, config)

    const critical = selector.selectForTask(makeTask({ complexity: 'critical' }), 'worker')
    expect(critical.tier).toBe('powerful')
    expect(critical.modelId).toBe('nvidia/nemotron-3-ultra-550b-a55b')

    const low = selector.selectForTask(makeTask({ complexity: 'low' }), 'worker')
    expect(low.tier).toBe('fast')
    expect(low.modelId).toBe('nvidia/nemotron-nano-9b-v2')
  })

  it('A1: prefixes modelTiers model when provider slash is absent', () => {
    const config = makeConfig({
      provider: 'nvidia',
      model: 'nvidia/nemotron-3-super-120b',
      creds: { nvidia: { apiKey: 'nv_xxx' } },
      modelCapabilities: undefined,
      modelTiers: {
        fast: { provider: 'nvidia', model: 'nemotron-nano-9b-v2' },
        powerful: { provider: 'nvidia', model: 'nemotron-3-ultra-550b-a55b' },
      },
    })
    const selector = new ModelSelector({}, config.budgetPolicy!, config)
    const critical = selector.selectForTask(makeTask({ complexity: 'critical' }), 'worker')
    expect(critical.modelId).toBe('nvidia/nemotron-3-ultra-550b-a55b')
  })
})
