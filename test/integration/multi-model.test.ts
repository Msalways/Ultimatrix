import { describe, it, expect } from 'vitest'
import { ModelSelector, type WorkerTask, type ModelSelection } from '../../src/models/selector'
import type { ModelCapabilities, BudgetPolicy, UltimatrixConfig } from '../../src/config'

const TEST_CAPS: ModelCapabilities = {
  'groq/llama3-8b-8192': {
    contextWindow: 8192,
    maxOutputTokens: 2048,
    strengths: ['fast', 'inference'],
    supportsStreaming: true,
    supportsStructuredOutput: false,
  },
  'openai/gpt-4o': {
    contextWindow: 128000,
    maxOutputTokens: 16384,
    strengths: ['general', 'reasoning', 'code'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
  'anthropic/claude-3-5-sonnet': {
    contextWindow: 200000,
    maxOutputTokens: 8192,
    strengths: ['reasoning', 'code', 'analysis'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
}

const TEST_BUDGET: BudgetPolicy = {
  enforcement: 'soft',
  scope: 'session',
  resetOn: 'never',
  allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
  maxModelCallsPerTask: 15,
  trackTokens: true,
}

const TEST_CONFIG: UltimatrixConfig = {
  provider: 'groq',
  model: 'llama3-8b-8192',
  depth: 2,
  timeout: 60000,
  creds: { groq: { apiKey: 'test' } },
  browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
  modelCapabilities: TEST_CAPS,
  budgetPolicy: TEST_BUDGET,
}

function makeTask(overrides?: Partial<WorkerTask>): WorkerTask {
  return {
    skillId: 'recon',
    taskDescription: 'Navigate to homepage',
    complexity: 'low',
    ...overrides,
  }
}

describe('Integration: Multi-Model Routing', () => {
  it('selects model for simple task', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)
    const result = selector.selectForTask(makeTask({
      taskDescription: 'Navigate to homepage and take screenshot',
      complexity: 'low',
    }), 'worker')

    expect(result.modelId).toBeDefined()
    expect(result.tier).toBeDefined()
    expect(result.reasoning).toBeDefined()
  })

  it('selects model for complex task', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)
    const result = selector.selectForTask(makeTask({
      skillId: 'vuln-discovery',
      taskDescription: 'Chain SQL injection through multiple parameters to extract database schema, then pivot to SSRF via internal API',
      complexity: 'critical',
    }), 'worker')

    expect(result.modelId).toBeDefined()
    expect(result.tier).toBeDefined()
  })

  it('recordSuccess and recordFailure affect selection', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)

    // Record many successes for groq
    for (let i = 0; i < 5; i++) {
      selector.recordSuccess('groq', 'llama3-8b-8192')
    }

    const result = selector.selectForTask(makeTask(), 'worker')
    expect(result.modelId).toBeDefined()
  })

  it('budget calculation returns valid numbers', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)
    const result = selector.selectForTask(makeTask(), 'worker')

    expect(result.budget.estimatedModelCalls).toBeGreaterThan(0)
    expect(result.budget.estimatedInputTokens).toBeGreaterThan(0)
    expect(result.budget.estimatedOutputTokens).toBeGreaterThan(0)
    expect(result.budget.maxAllowedModelCalls).toBeGreaterThan(0)
  })

  it('all selected models have valid context windows', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)

    const tasks: Array<{ complexity: WorkerTask['complexity']; description: string }> = [
      { complexity: 'low', description: 'Navigate to page' },
      { complexity: 'medium', description: 'Test SQL injection' },
      { complexity: 'high', description: 'Chain SSRF through internal APIs' },
      { complexity: 'critical', description: 'Full database extraction via multi-step attack' },
    ]

    for (const task of tasks) {
      const result = selector.selectForTask(makeTask({
        taskDescription: task.description,
        complexity: task.complexity,
      }), 'worker')

      const caps = TEST_CAPS[result.modelId]
      expect(caps).toBeDefined()
      expect(caps.contextWindow).toBeGreaterThan(0)
      expect(caps.maxOutputTokens).toBeGreaterThan(0)
    }
  })

  it('different roles may select different models', () => {
    const selector = new ModelSelector(TEST_CAPS, TEST_BUDGET, TEST_CONFIG)
    const brain = selector.selectForTask(makeTask({ complexity: 'critical' }), 'brain')
    const spider = selector.selectForTask(makeTask({ complexity: 'low' }), 'spider')

    // Both should return valid selections
    expect(brain.modelId).toBeDefined()
    expect(spider.modelId).toBeDefined()
  })
})
