import { describe, it, expect } from 'vitest'
import { planAdaptiveContext, compressBrainInstructions, filterToolsToBudget } from '../../src/models/adaptive-context'

describe('AdaptiveContext', () => {
  describe('planAdaptiveContext', () => {
    it('returns full detail when plenty of room', () => {
      const plan = planAdaptiveContext({
        contextWindow: 128000,
        systemPromptTokens: 10000,
        toolSchemasTokens: 3000,
        goalTokens: 500,
        historyTokens: 200,
        reservedOutputTokens: 4096,
      })
      expect(plan.detailLevel).toBe('full')
      expect(plan.toolBudget).toBe(999)
    })

    it('returns compact when tight', () => {
      const plan = planAdaptiveContext({
        contextWindow: 8192,
        systemPromptTokens: 3000,
        toolSchemasTokens: 1500,
        goalTokens: 500,
        historyTokens: 200,
        reservedOutputTokens: 2048,
      })
      expect(plan.detailLevel).toBe('compact')
      expect(plan.compressAssumptions).toBe(true)
    })

    it('returns minimal when very tight', () => {
      const plan = planAdaptiveContext({
        contextWindow: 4096,
        systemPromptTokens: 5000,
        toolSchemasTokens: 2000,
        goalTokens: 500,
        historyTokens: 200,
        reservedOutputTokens: 1024,
      })
      expect(plan.detailLevel).toBe('minimal')
      expect(plan.compressEvidence).toBe(true)
      expect(plan.stripWorkflow).toBe(true)
      expect(plan.toolBudget).toBeLessThanOrEqual(10)
    })

    it('never crashes on extreme inputs', () => {
      const plan = planAdaptiveContext({
        contextWindow: 1,
        systemPromptTokens: 99999,
        toolSchemasTokens: 99999,
        goalTokens: 99999,
        historyTokens: 99999,
        reservedOutputTokens: 99999,
      })
      expect(plan.detailLevel).toBe('minimal')
      expect(plan.toolBudget).toBeGreaterThanOrEqual(0)
    })
  })

  describe('compressBrainInstructions', () => {
    const sampleMd = [
      '## Rules',
      'Be safe.',
      '',
      '### Evidence & Integrity',
      'Record all evidence.',
      '',
      'Verify claims.',
      '',
      '### Assumption Verification',
      'Never assume.',
      '',
      'Always check.',
      '',
      '### Output Format',
      'Use structured output.',
      '',
      'Include severity.',
      '',
      '### Workflow',
      'Follow the OODA loop.',
      '',
      '## Safety',
      'Stay in scope.',
    ].join('\n')

    it('returns full instructions at full level', () => {
      const result = compressBrainInstructions(sampleMd, {
        detailLevel: 'full',
        toolBudget: 999,
        compressEvidence: false,
        compressAssumptions: false,
        stripWorkflow: false,
        compactBrainMd: false,
      })
      expect(result).toBe(sampleMd)
    })

    it('strips Evidence section when compressed', () => {
      const result = compressBrainInstructions(sampleMd, {
        detailLevel: 'compact',
        toolBudget: 20,
        compressEvidence: false,
        compressAssumptions: true,
        stripWorkflow: false,
        compactBrainMd: false,
      })
      expect(result).toContain('Evidence & Integrity')
      expect(result).not.toContain('Assumption Verification')
    })

    it('strips both sections at minimal level', () => {
      const result = compressBrainInstructions(sampleMd, {
        detailLevel: 'minimal',
        toolBudget: 5,
        compressEvidence: true,
        compressAssumptions: true,
        stripWorkflow: true,
        compactBrainMd: false,
      })
      expect(result).not.toContain('Evidence & Integrity')
      expect(result).not.toContain('Assumption Verification')
      expect(result).not.toContain('Output Format')
      expect(result).not.toContain('Workflow')
    })

    it('compacts sections keeping only first paragraph', () => {
      const result = compressBrainInstructions(sampleMd, {
        detailLevel: 'minimal',
        toolBudget: 5,
        compressEvidence: false,
        compressAssumptions: false,
        stripWorkflow: false,
        compactBrainMd: true,
      })
      // Should keep the heading and first paragraph of each section
      expect(result).toContain('### Evidence & Integrity')
      expect(result).toContain('Record all evidence.')
      // But NOT the second paragraph
      expect(result).not.toContain('Verify claims.')
    })
  })

  describe('filterToolsToBudget', () => {
    const tools = [
      ['httpRequest', { id: 'httpRequest' }],
      ['writeFinding', { id: 'writeFinding' }],
      ['queryGraph', { id: 'queryGraph' }],
      ['askUser', { id: 'askUser' }],
      ['spawnWorker', { id: 'spawnWorker' }],
      ['stagehand_navigate', { id: 'stagehand_navigate' }],
      ['loadSkillBody', { id: 'loadSkillBody' }],
    ] as Array<[string, any]>

    it('returns all tools when budget is large', () => {
      const result = filterToolsToBudget(tools, 999)
      expect(Object.keys(result)).toHaveLength(7)
    })

    it('prioritizes core tools when budget is tight', () => {
      const result = filterToolsToBudget(tools, 3)
      expect(Object.keys(result)).toHaveLength(3)
      expect(result).toHaveProperty('httpRequest')
      expect(result).toHaveProperty('writeFinding')
      expect(result).toHaveProperty('queryGraph')
    })

    it('includes browser tools in medium budget', () => {
      const result = filterToolsToBudget(tools, 5)
      expect(result).toHaveProperty('httpRequest')
      expect(result).toHaveProperty('writeFinding')
      expect(result).toHaveProperty('queryGraph')
      expect(result).toHaveProperty('stagehand_navigate')
    })
  })
})
