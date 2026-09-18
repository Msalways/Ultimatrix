import { describe, it, expect } from 'vitest'
import { compileContext } from '../../src/context/compiler'
import type { CompileContextInput } from '../../src/context/types'

describe('Context Compiler', () => {
  it('includes identity layer with objective', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test authorization boundary on /api/invoices',
      skillId: 'authorization',
      tokenBudget: 5000,
    })

    expect(view.objective).toContain('authorization')
    expect(view.summary).toContain('authorization')
    expect(view.sourceViews.some(s => s.type === 'identity')).toBe(true)
  })

  it('includes exchange refs when provided', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test IDOR',
      exchangeRefs: ['ex-1', 'ex-2', 'ex-3'],
      tokenBudget: 5000,
    })

    expect(view.evidenceRefs).toEqual(['ex-1', 'ex-2', 'ex-3'])
    expect(view.sourceViews.filter(s => s.type === 'exchange')).toHaveLength(3)
  })

  it('includes experiment refs when provided', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test injection',
      experimentRefs: ['exp-1', 'exp-2'],
      tokenBudget: 5000,
    })

    expect(view.experimentRefs).toEqual(['exp-1', 'exp-2'])
    expect(view.sourceViews.filter(s => s.type === 'experiment')).toHaveLength(2)
  })

  it('includes candidate finding refs when provided', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Verify finding',
      candidateRefs: ['cand-1'],
      tokenBudget: 5000,
    })

    expect(view.findingRefs).toEqual(['cand-1'])
    expect(view.sourceViews.filter(s => s.type === 'finding')).toHaveLength(1)
  })

  it('enforces token budget', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test IDOR',
      exchangeRefs: ['ex-1', 'ex-2', 'ex-3', 'ex-4', 'ex-5', 'ex-6', 'ex-7', 'ex-8', 'ex-9', 'ex-10'],
      tokenBudget: 200, // Very tight budget
    })

    expect(view.tokenEstimate).toBeLessThanOrEqual(200)
    // Some exchanges should be omitted
    const exchangeOmission = view.omissions.find(o => o.type === 'exchange')
    expect(exchangeOmission).toBeDefined()
  })

  it('records omissions for raw artifacts', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test',
      exchangeRefs: ['ex-1', 'ex-2'],
      tokenBudget: 5000,
    })

    const artifactOmission = view.omissions.find(o => o.type === 'artifact')
    expect(artifactOmission).toBeDefined()
    expect(artifactOmission!.reason).toContain('on demand')
  })

  it('builds summary with grouped sources', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test authorization',
      skillId: 'authorization',
      exchangeRefs: ['ex-1'],
      experimentRefs: ['exp-1'],
      tokenBudget: 5000,
    })

    expect(view.summary).toContain('## Context')
    expect(view.summary).toContain('authorization')
    expect(view.summary).toContain('Exchange')
    expect(view.summary).toContain('Experiment')
  })

  it('handles empty input gracefully', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Explore target',
      tokenBudget: 5000,
    })

    expect(view.sourceViews).toHaveLength(1) // Only identity
    expect(view.tokenEstimate).toBeGreaterThan(0)
  })

  it('sorts sources by relevance', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test',
      exchangeRefs: ['ex-low', 'ex-high'],
      tokenBudget: 5000,
    })

    // Sources should be sorted by relevance descending
    const sources = view.sourceViews
    for (let i = 1; i < sources.length; i++) {
      expect(sources[i - 1].relevance).toBeGreaterThanOrEqual(sources[i].relevance)
    }
  })

  it('identity is always most relevant', () => {
    const view = compileContext({
      runId: 'run-1',
      taskId: 'task-1',
      objective: 'Test',
      exchangeRefs: ['ex-1'],
      tokenBudget: 5000,
    })

    const identity = view.sourceViews.find(s => s.type === 'identity')
    expect(identity).toBeDefined()
    expect(identity!.relevance).toBe(1.0)
  })
})
