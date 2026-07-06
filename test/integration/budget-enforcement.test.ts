import { describe, it, expect } from 'vitest'
import { TokenBudgetTracker } from '../../src/models/token-budget-tracker'
import { BudgetDashboard } from '../../src/tools/budget-dashboard'
import { ForensicLog } from '../../src/logging/forensic-log'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BudgetPolicy } from '../../src/config'

let tempDir: string

function makeBudgetPolicy(overrides?: Partial<BudgetPolicy>): BudgetPolicy {
  return {
    enforcement: 'soft',
    scope: 'session',
    resetOn: 'never',
    allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
    maxModelCallsPerTask: 15,
    trackTokens: true,
    ...overrides,
  }
}

describe('Integration: Budget Enforcement', () => {
  it('hard enforcement throws when budget exceeded', () => {
    const tracker = new TokenBudgetTracker(100, 3, 'hard')
    expect(() => {
      tracker.recordUsage(50, 60) // 110 total > 100 max
    }).toThrow('Budget exceeded')
  })

  it('soft enforcement returns false when budget exceeded', () => {
    const tracker = new TokenBudgetTracker(100, 3, 'soft')
    const ok = tracker.recordUsage(50, 60) // 110 total > 100 max
    expect(ok).toBe(false)
  })

  it('warn enforcement does not throw', () => {
    const tracker = new TokenBudgetTracker(100, 3, 'warn')
    const ok = tracker.recordUsage(50, 60)
    expect(ok).toBe(true)
    expect(tracker.isOverBudget()).toBe(true)
  })

  it('budget tracker records usage correctly', () => {
    const tracker = new TokenBudgetTracker(1000, 10, 'soft')
    tracker.recordUsage(100, 200)
    tracker.recordUsage(50, 100)

    const status = tracker.getStatus()
    expect(status.usedTokens).toBe(450)
    expect(status.usedModelCalls).toBe(2)
    expect(status.isOverBudget).toBe(false)
  })

  it('budget tracker detects near-budget', () => {
    const tracker = new TokenBudgetTracker(1000, 10, 'soft')
    tracker.recordUsage(850, 0) // 850/1000 = 85%
    expect(tracker.isNearBudget(0.2)).toBe(true)
  })

  it('budget tracker reset clears state', () => {
    const tracker = new TokenBudgetTracker(1000, 10, 'soft')
    tracker.recordUsage(500, 200)
    tracker.reset()

    const status = tracker.getStatus()
    expect(status.usedTokens).toBe(0)
    expect(status.usedModelCalls).toBe(0)
  })

  it('budget tracker toInstructionBlock produces readable output', () => {
    const tracker = new TokenBudgetTracker(10000, 15, 'soft')
    tracker.recordUsage(2000, 1000)
    const block = tracker.toInstructionBlock()

    expect(block).toContain('Token Budget')
    expect(block).toContain('3,000')
    expect(block).toContain('1 calls')
  })
})

describe('Integration: Budget Dashboard from Forensic Log', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'integration-budget-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('end-to-end: log model calls → dashboard summary', () => {
    const fl = new ForensicLog(join(tempDir, 'e2e.ndjson'))
    const policy = makeBudgetPolicy({ maxModelCallsPerTask: 10 })

    // Simulate multiple model calls
    for (let i = 0; i < 5; i++) {
      fl.log({
        type: 'model-call',
        agent: i % 2 === 0 ? 'solver-brain' : 'worker-1',
        metadata: {
          provider: i % 3 === 0 ? 'groq' : 'openai',
          modelId: 'llama3-8b',
          inputTokens: 100 + i * 50,
          outputTokens: 200 + i * 30,
          totalTokens: 300 + i * 80,
        },
      })
    }

    const dash = new BudgetDashboard(fl, policy)
    const summary = dash.getSessionSummary()

    expect(summary.totalModelCalls).toBe(5)
    expect(summary.totalTokens.input).toBe(100 + 150 + 200 + 250 + 300) // sum of inputs
    expect(Object.keys(summary.byProvider)).toHaveLength(2) // groq + openai
    expect(Object.keys(summary.byAgentRole)).toHaveLength(2) // brain + worker
    expect(summary.warnings).toHaveLength(0) // 5 < 10 maxModelCalls
  })

  it('end-to-end: budget exceeded warning', () => {
    const fl = new ForensicLog(join(tempDir, 'exceed.ndjson'))
    const policy = makeBudgetPolicy({ maxModelCallsPerTask: 3, maxTokensPerSession: 500 })

    for (let i = 0; i < 5; i++) {
      fl.log({
        type: 'model-call',
        agent: 'brain',
        metadata: {
          provider: 'groq',
          modelId: 'llama3-8b',
          inputTokens: 100,
          outputTokens: 100,
          totalTokens: 200,
        },
      })
    }

    const dash = new BudgetDashboard(fl, policy)
    const summary = dash.getSessionSummary()

    expect(summary.totalModelCalls).toBe(5)
    expect(summary.warnings.length).toBeGreaterThanOrEqual(1) // Both calls and tokens exceeded
  })
})
