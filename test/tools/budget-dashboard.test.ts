import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForensicLog } from '../../src/logging/forensic-log'
import { BudgetDashboard, type TokenEntry } from '../../src/tools/budget-dashboard'
import type { BudgetPolicy } from '../../src/config'

let tempDir: string
let forensicLog: ForensicLog
let budgetPolicy: BudgetPolicy

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
  tempDir = mkdtempSync(join(tmpdir(), 'budget-dash-test-'))
  forensicLog = new ForensicLog(join(tempDir, 'forensic.ndjson'))
  budgetPolicy = makeBudgetPolicy()
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('BudgetDashboard', () => {
  describe('getSessionSummary', () => {
    it('returns empty summary when no model calls logged', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)
      const summary = dash.getSessionSummary()
      expect(summary.totalModelCalls).toBe(0)
      expect(summary.totalTokens.total).toBe(0)
      expect(Object.keys(summary.byProvider)).toHaveLength(0)
      expect(Object.keys(summary.byAgentRole)).toHaveLength(0)
    })

    it('aggregates model calls correctly', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        agentRole: 'brain',
      })

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 500,
        outputTokens: 800,
        totalTokens: 1300,
        agentRole: 'worker',
      })

      const summary = dash.getSessionSummary()
      expect(summary.totalModelCalls).toBe(2)
      expect(summary.totalTokens.input).toBe(600)
      expect(summary.totalTokens.output).toBe(1000)
      expect(summary.totalTokens.total).toBe(1600)
    })

    it('breaks down by provider', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      })

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
      })

      const summary = dash.getSessionSummary()
      expect(summary.byProvider.groq.calls).toBe(2)
      expect(summary.byProvider.groq.inputTokens).toBe(150)
      expect(summary.byProvider.groq.outputTokens).toBe(300)
    })

    it('breaks down by agent role', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
        agentRole: 'brain',
      })

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        agentRole: 'worker',
      })

      const summary = dash.getSessionSummary()
      expect(summary.byAgentRole.brain.calls).toBe(1)
      expect(summary.byAgentRole.brain.tokens).toBe(300)
      expect(summary.byAgentRole.worker.calls).toBe(1)
      expect(summary.byAgentRole.worker.tokens).toBe(150)
    })

    it('generates warning when maxModelCallsPerTask exceeded', () => {
      const policy = makeBudgetPolicy({ maxModelCallsPerTask: 2 })
      const dash = new BudgetDashboard(forensicLog, policy)

      for (let i = 0; i < 3; i++) {
        dash.recordModelCall({
          timestamp: Date.now(),
          provider: 'groq',
          modelId: 'llama3-8b',
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        })
      }

      const summary = dash.getSessionSummary()
      expect(summary.warnings.length).toBeGreaterThan(0)
      expect(summary.warnings.some(w => w.includes('Model call'))).toBe(true)
    })

    it('generates warning when maxTokensPerSession exceeded', () => {
      const policy = makeBudgetPolicy({ maxTokensPerSession: 100 })
      const dash = new BudgetDashboard(forensicLog, policy)

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 50,
        outputTokens: 60,
        totalTokens: 110,
      })

      const summary = dash.getSessionSummary()
      expect(summary.warnings.some(w => w.includes('Token budget'))).toBe(true)
    })

    it('reads model-call events from forensic log', () => {
      forensicLog.log({
        type: 'model-call',
        agent: 'solver-brain',
        metadata: {
          provider: 'groq',
          modelId: 'llama3-8b',
          inputTokens: 200,
          outputTokens: 400,
          totalTokens: 600,
        },
      })

      const dash = new BudgetDashboard(forensicLog, budgetPolicy)
      const summary = dash.getSessionSummary()
      expect(summary.totalModelCalls).toBe(1)
      expect(summary.totalTokens.total).toBe(600)
      expect(summary.byProvider.groq.calls).toBe(1)
    })
  })

  describe('getTokenHistory', () => {
    it('returns all recorded entries', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)

      dash.recordModelCall({
        timestamp: 1000,
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })

      dash.recordModelCall({
        timestamp: 2000,
        provider: 'openai',
        modelId: 'gpt-4o',
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
      })

      const history = dash.getTokenHistory()
      expect(history).toHaveLength(2)
      expect(history[0].provider).toBe('groq')
      expect(history[1].provider).toBe('openai')
    })

    it('returns a copy, not the internal array', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)
      const h1 = dash.getTokenHistory()
      const h2 = dash.getTokenHistory()
      expect(h1).not.toBe(h2)
    })
  })

  describe('toInstructionBlock', () => {
    it('returns formatted budget status string', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)

      dash.recordModelCall({
        timestamp: Date.now(),
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      })

      const block = dash.toInstructionBlock()
      expect(block).toContain('Budget Status')
      expect(block).toContain('1/')
      expect(block).toContain('300')
    })
  })

  describe('printLiveDashboard', () => {
    it('does not throw', () => {
      const dash = new BudgetDashboard(forensicLog, budgetPolicy)
      expect(() => dash.printLiveDashboard()).not.toThrow()
    })
  })
})
