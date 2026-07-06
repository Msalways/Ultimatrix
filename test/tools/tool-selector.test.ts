import { describe, it, expect, beforeEach } from 'vitest'
import { DynamicToolSelector, DEFAULT_INFERENCE_RULES } from '../../src/tools/tool-selector'
import type { TaskBudget } from '../../src/models/selector'

function makeBudget(overrides?: Partial<TaskBudget>): TaskBudget {
  return {
    estimatedModelCalls: 10,
    estimatedInputTokens: 5000,
    estimatedOutputTokens: 3000,
    maxAllowedModelCalls: 15,
    maxAllowedTokens: 50000,
    toolSet: [],
    prunedTools: [],
    ...overrides,
  }
}

describe('DynamicToolSelector', () => {
  let selector: DynamicToolSelector

  beforeEach(() => {
    selector = new DynamicToolSelector()
  })

  it('always includes universal tools', () => {
    const tools = selector.selectTools('test task', [])
    expect(tools).toContain('updateGraph')
    expect(tools).toContain('writeFinding')
    expect(tools).toContain('recordEvidence')
    expect(tools).toContain('queryGraph')
  })

  it('adds skill-specific tools from matched skills', () => {
    const tools = selector.selectTools('test task', ['recon'])
    // recon skill should add its tools
    expect(tools.length).toBeGreaterThan(5)
  })

  it('infers tools from task description keywords', () => {
    const tools = selector.selectTools('Find SQL injection vulnerabilities in login form', [])
    // Should infer checkWaf, measureTiming from SQL injection
    expect(tools).toContain('checkWaf')
    expect(tools).toContain('measureTiming')
  })

  it('infers XSS tools', () => {
    const tools = selector.selectTools('Test for cross-site scripting in search', [])
    expect(tools).toContain('evaluateRendered')
    expect(tools).toContain('getDialogEvidence')
  })

  it('infers recon tools', () => {
    const tools = selector.selectTools('Enumerate all endpoints', [])
    expect(tools).toContain('getTargetSummary')
    expect(tools).toContain('getEndpointsWithParams')
  })

  it('prunes to budget when budget provided', () => {
    const budget = makeBudget({ maxAllowedModelCalls: 2 })
    const tools = selector.selectTools('SQL injection testing', ['recon', 'vuln-discovery'], budget)
    // Essential tools should still be present
    expect(tools).toContain('updateGraph')
    expect(tools).toContain('writeFinding')
  })

  it('returns all tools when no budget constraint', () => {
    const tools = selector.selectTools('SQL injection testing', [])
    // Should include universal + inferred
    expect(tools.length).toBeGreaterThanOrEqual(7)
  })

  it('getUniversalTools returns universal tools list', () => {
    const tools = selector.getUniversalTools()
    expect(tools).toContain('updateGraph')
    expect(tools).toContain('writeFinding')
  })

  it('getInferenceRules returns configured rules', () => {
    const rules = selector.getInferenceRules()
    expect(rules.length).toBe(DEFAULT_INFERENCE_RULES.length)
    expect(rules.some(r => r.keywords.includes('sqli'))).toBe(true)
  })

  it('inference rules are ordered by priority', () => {
    const rules = selector.getInferenceRules()
    const highIdx = rules.findIndex(r => r.priority === 'high')
    const lowIdx = rules.findIndex(r => r.priority === 'low')
    expect(highIdx).toBeLessThan(lowIdx)
  })

  it('multiple keywords in same rule add same tools once', () => {
    const tools = selector.selectTools('SQL injection blind sqli attack', [])
    const checkWafCount = tools.filter(t => t === 'checkWaf').length
    expect(checkWafCount).toBe(1)
  })
})
