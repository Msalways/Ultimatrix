import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForensicLog } from '../../src/logging/forensic-log'
import { BudgetDashboard } from '../../src/tools/budget-dashboard'
import { TokenProfiler } from '../../src/tools/token-profiler'
import { QuotaTracker, getGlobalQuotaTracker, resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
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

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'cli-test-'))
  resetGlobalQuotaTracker()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
  resetGlobalQuotaTracker()
})

describe('CLI models command — data layer', () => {
  it('TokenProfiler.getAllProfiles returns default profiles when empty', () => {
    const profiler = new TokenProfiler()
    const profiles = profiler.getAllProfiles()
    expect(profiles.length).toBeGreaterThan(0)
    expect(profiles.every(p => p.toolId)).toBe(true)
    expect(profiles.every(p => p.avgModelCalls > 0)).toBe(true)
  })

  it('TokenProfiler.getProfile returns estimated profile for unknown tool', () => {
    const profiler = new TokenProfiler()
    const profile = profiler.getProfile('nonexistent-tool')
    expect(profile.estimated).toBe(true)
    expect(profile.avgModelCalls).toBeGreaterThan(0)
  })
})

describe('CLI budget command — data layer', () => {
  it('BudgetDashboard reads from forensic log', () => {
    const fl = new ForensicLog(join(tempDir, 'test.ndjson'))
    fl.log({
      type: 'model-call',
      agent: 'brain',
      metadata: {
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      },
    })

    const dash = new BudgetDashboard(fl, makeBudgetPolicy())
    const summary = dash.getSessionSummary()
    expect(summary.totalModelCalls).toBe(1)
    expect(summary.totalTokens.total).toBe(300)
  })

  it('BudgetDashboard handles empty log gracefully', () => {
    const fl = new ForensicLog(join(tempDir, 'empty.ndjson'))
    const dash = new BudgetDashboard(fl, makeBudgetPolicy())
    const summary = dash.getSessionSummary()
    expect(summary.totalModelCalls).toBe(0)
    expect(summary.warnings).toHaveLength(0)
  })
})

describe('CLI ratelimit command — data layer', () => {
  it('QuotaTracker tracks provider state', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordRequest('groq')
    tracker.recordRequest('groq')
    tracker.recordExhaustion('groq', 5000)

    const status = tracker.getStatus()
    expect(status.groq.used).toBe(2)
    expect(status.groq.exhaustionCount).toBe(1)
    expect(status.groq.inCooldown).toBe(true)
  })

  it('QuotaTracker clears expired cooldowns', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordExhaustion('groq', 1) // 1ms cooldown

    // Wait for cooldown to expire
    const status1 = tracker.getStatus()
    expect(status1.groq.inCooldown).toBe(true)

    // After delay, cooldown should expire
    setTimeout(() => {
      const status2 = tracker.getStatus()
      expect(status2.groq.inCooldown).toBe(false)
    }, 10)
  })

  it('QuotaTracker resets on reset()', () => {
    const tracker = getGlobalQuotaTracker()
    tracker.recordRequest('openai')
    tracker.recordExhaustion('openai')

    tracker.reset()
    const status = tracker.getStatus()
    expect(Object.keys(status)).toHaveLength(0)
  })
})

describe('CLI tools command — data layer', () => {
  it('TokenProfiler persists and loads', () => {
    const profiler = new TokenProfiler()
    profiler.recordExecution({
      toolId: 'navigate',
      modelCalls: 2,
      inputTokens: 500,
      outputTokens: 300,
      externalApiCalls: 0,
      durationMs: 100,
      success: true,
    })

    const data = profiler.persist()
    expect(data.navigate).toBeDefined()
    expect(data.navigate.avgModelCalls).toBe(2)

    const profiler2 = new TokenProfiler()
    profiler2.load(data)
    const profile = profiler2.getProfile('navigate')
    expect(profile.avgModelCalls).toBe(2)
    expect(profile.estimated).toBe(false)
  })
})
