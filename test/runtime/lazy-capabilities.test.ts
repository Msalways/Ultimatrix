import { afterEach, describe, expect, it, vi } from 'vitest'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import { buildRuntimeEnvelope, runtimeEnvelopeTokenBudget, sanitizeDurableContext } from '../../src/runtime/context-envelope'
import { LazySolverServices } from '../../src/runtime/lazy-services'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { SessionManager } from '../../src/http/session-manager'
import { CapturedRequestStore } from '../../src/capture/captured-request-store'

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
  afterEach(() => __setTestFallback(null))

  it('reuses work for retries in one turn and refreshes on a later turn', async () => {
    const graph = {
      queryNodes: () => [], getAllEdges: () => [], getNode: () => undefined,
      getTargetSummary: () => ({ totalPages: 0, totalEndpoints: 0, totalFindings: 0, totalTests: 0, authFlows: 0, rbacRoles: 0 }),
      upsertNode: (node: unknown) => node, save: async () => {},
    }
    __setTestFallback({
      graph, httpSessions: new SessionManager(), capturedRequests: new CapturedRequestStore(),
      findingState: { evidenceBuffer: new Map(), evidenceGate: null },
    } as any)
    const services = new LazySolverServices({
      config: { provider: 'test', campaign: { maxRequests: 100, maxDurationMs: 10_000 } } as any,
      target: 'http://target.test', skillRegistry: {} as any,
      extensionRegistry: {} as any,
    })
    const firstGate = new EvidenceGate()
    const firstRun = services.runCoverageCampaign(firstGate, 'turn-1')
    expect(services.runCoverageCampaign(firstGate, 'turn-1')).toBe(firstRun)
    const secondGate = new EvidenceGate()
    const secondRun = services.runCoverageCampaign(secondGate, 'turn-2')

    await Promise.all([firstRun, secondRun])
    expect((await firstRun).status).toBe('partial')
    expect((await secondRun).status).toBe('partial')
    __setTestFallback(null)
  })
})
