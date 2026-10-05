import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import { buildRuntimeEnvelope, runtimeEnvelopeTokenBudget, sanitizeDurableContext } from '../../src/runtime/context-envelope'
import { LazySolverServices } from '../../src/runtime/lazy-services'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'

const { runCampaignAssessmentMock } = vi.hoisted(() => ({ runCampaignAssessmentMock: vi.fn() }))
vi.mock('../../src/campaign/campaign-tool', () => ({ runCampaignAssessment: runCampaignAssessmentMock }))

const descriptor = {
  id: 'coldTool',
  description: 'cold',
  namespace: 'test',
  source: 'builtin' as const,
  requirements: ['test-service'],
  readOnly: true,
}

describe('lazy capability registry', () => {
  it('coalesces concurrent initialization and keeps the service reusable across turns', async () => {
    const registry = new DynamicToolRegistry()
    const resolve = vi.fn(async () => ({ id: 'coldTool', execute: async () => ({ ok: true }) }))
    registry.registerLazyBuiltin(descriptor, resolve)
    await Promise.all([registry.activate('coldTool'), registry.activate('coldTool')])
    expect(resolve).toHaveBeenCalledTimes(1)
    registry.resetTurn()
    expect(registry.getActiveToolset()).toEqual({})
    await registry.activate('coldTool')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('reports initialization failure and remains retryable', async () => {
    const registry = new DynamicToolRegistry()
    let attempts = 0
    registry.registerLazyBuiltin(descriptor, async () => {
      if (++attempts === 1) throw new Error('temporary failure')
      return { id: 'coldTool' }
    })
    await expect(registry.activate('coldTool')).rejects.toMatchObject({ retryable: true, capabilityId: 'coldTool' })
    await expect(registry.activate('coldTool')).resolves.toMatchObject({ id: 'coldTool' })
  })

  it('enforces a turn policy before initialization', async () => {
    const registry = new DynamicToolRegistry()
    const resolve = vi.fn(async () => ({ id: 'coldTool' }))
    registry.registerLazyBuiltin({ ...descriptor, readOnly: false }, resolve)
    registry.setActivationPolicy(item => item.readOnly === true)
    await expect(registry.activate('coldTool')).rejects.toThrow('not permitted')
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('research bootstrap state', () => {
  it('distinguishes an attempted setup from a completed one', () => {
    const services = new LazySolverServices({
      config: {} as any,
      target: 'http://target.test',
      skillRegistry: {} as any,
      extensionRegistry: {} as any,
    })

    expect(services.researchBootstrapState).toBe('pending')
    services.markResearchBootstrapAttempted('observed-revision-1')
    expect(services.researchBootstrapState).toBe('attempted')
    expect(services.researchBootstrapRevision).toBe('observed-revision-1')
    services.markResearchBootstrapCompleted('observed-revision-2')
    expect(services.researchBootstrapState).toBe('completed')
    expect(services.researchBootstrapRevision).toBe('observed-revision-2')
  })
})

describe('bounded runtime context', () => {
  it('uses the configured two-percent envelope bounds', () => {
    expect(runtimeEnvelopeTokenBudget(8_000)).toBe(500)
    expect(runtimeEnvelopeTokenBudget(128_000)).toBe(2000)
  })

  it('indexes state without raw reasoning or bodies', () => {
    const envelope = buildRuntimeEnvelope({ target: 'https://example.com', contextWindow: 8_000 })
    expect(envelope).toContain('<runtime-index>')
    expect(envelope).not.toContain('reasoning')
    expect(sanitizeDurableContext({ ok: 1, reasoning: 'scratch', requestBody: 'secret', nested: { tool_output: 'large' } }))
      .toEqual({ ok: 1, nested: {} })
  })
})

describe('coverage campaign turn scoping', () => {
  afterEach(() => {
    runCampaignAssessmentMock.mockReset()
    vi.useRealTimers()
  })

  it('refreshes changed research and keeps request/time budgets cumulative per run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    let calls = 0
    runCampaignAssessmentMock.mockImplementation(async (_config: unknown, _gate: unknown, _settings: { maxRequests: number; maxDurationMs: number }) => {
      vi.advanceTimersByTime(4_000)
      return { requestsUsed: [4, 3, 1, 0, 0][calls++], status: 'partial' } as any
    })
    const services = new LazySolverServices({
      config: { provider: 'test', campaign: { maxRequests: 10, maxDurationMs: 10_000 } } as any,
      target: 'http://target.test', skillRegistry: {} as any,
      extensionRegistry: {} as any,
    })
    const gate = new EvidenceGate()
    const first = services.runCoverageCampaign(gate, 'run-1', 'revision-1')
    expect(services.runCoverageCampaign(gate, 'run-1', 'revision-1')).toBe(first)
    await first
    await services.runCoverageCampaign(gate, 'run-1', 'revision-2')
    await services.runCoverageCampaign(gate, 'run-1', 'revision-3')
    await services.runCoverageCampaign(gate, 'run-1', 'revision-4')

    expect(runCampaignAssessmentMock.mock.calls.map((call: unknown[]) => call[2])).toEqual([
      { maxRequests: 10, maxDurationMs: 10_000 },
      { maxRequests: 6, maxDurationMs: 6_000 },
      { maxRequests: 3, maxDurationMs: 2_000 },
      { maxRequests: 0, maxDurationMs: 0 },
    ])
    await services.runCoverageCampaign(gate, 'run-2', 'revision-4')
    expect(runCampaignAssessmentMock.mock.calls[4]?.[2]).toEqual({ maxRequests: 10, maxDurationMs: 10_000 })
  })
})
