import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkerContext, createWorkerContext } from '../../src/workers/worker-context'

// Mock the emitters to avoid side effects
vi.mock('../../src/events/emitter', () => ({
  emitWorkerToolCall: vi.fn(),
  emitWorkerToolResult: vi.fn(),
}))
vi.mock('../../src/lib/tool-events', () => ({
  getToolEventEmitter: () => ({ push: vi.fn() }),
}))
vi.mock('../../src/security/decision-ledger', () => ({
  getGlobalDecisionLedger: () => ({ recordDecision: vi.fn() }),
}))

describe('WorkerContext', () => {
  it('stores identity fields', () => {
    const ctx = new WorkerContext('w1', 'Injection Specialist', 'exploitation', 'Test SQLi on /api')
    expect(ctx.workerId).toBe('w1')
    expect(ctx.workerName).toBe('Injection Specialist')
    expect(ctx.skillId).toBe('exploitation')
    expect(ctx.task).toBe('Test SQLi on /api')
  })

  it('getStats returns zero before any calls', () => {
    const ctx = new WorkerContext('w1', 'test', 'skill', 'task')
    const stats = ctx.getStats()
    expect(stats.toolCalls).toBe(0)
    expect(stats.toolCallDetails).toEqual([])
  })

  it('wrap intercepts generate and tracks success', async () => {
    const ctx = new WorkerContext('w1', 'test-worker', 'skill', 'task')
    const originalGenerate = vi.fn().mockResolvedValue('result')
    const mockAgent = { generate: originalGenerate }

    ctx.wrap(mockAgent)
    const result = await mockAgent.generate('hello')
    expect(result).toBe('result')
    // After wrap, the function is replaced — verify original was called
    expect(originalGenerate).toHaveBeenCalledWith('hello', undefined)

    const stats = ctx.getStats()
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolCallDetails[0].name).toBe('agent:generate')
    expect(stats.toolCallDetails[0].ok).toBe(true)
    expect(typeof stats.toolCallDetails[0].durationMs).toBe('number')
  })

  it('wrap intercepts generate and tracks failure', async () => {
    const ctx = new WorkerContext('w1', 'test-worker', 'skill', 'task')
    const originalGenerate = vi.fn().mockRejectedValue(new Error('timeout'))
    const mockAgent = { generate: originalGenerate }

    ctx.wrap(mockAgent)
    await expect(mockAgent.generate('hello')).rejects.toThrow('timeout')

    const stats = ctx.getStats()
    expect(stats.toolCalls).toBe(1)
    expect(stats.toolCallDetails[0].ok).toBe(false)
  })

  it('wrap is no-op for null or missing generate', () => {
    const ctx = new WorkerContext('w1', 'test-worker', 'skill', 'task')
    expect(() => ctx.wrap(null)).not.toThrow()
    expect(() => ctx.wrap({})).not.toThrow()
  })
})

describe('createWorkerContext', () => {
  it('creates and wraps in one call', async () => {
    const originalGenerate = vi.fn().mockResolvedValue('ok')
    const mockAgent = { generate: originalGenerate }
    const ctx = createWorkerContext('w1', 'test-worker', 'skill', 'task', mockAgent)
    await mockAgent.generate('hi')
    expect(ctx.getStats().toolCalls).toBe(1)
  })

  it('creates without wrapping when no agent', () => {
    const ctx = createWorkerContext('w1', 'test-worker', 'skill', 'task')
    expect(ctx.getStats().toolCalls).toBe(0)
  })
})
