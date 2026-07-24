import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'

vi.mock('../../src/tools/http-tools', () => ({
  httpRequest: { execute: vi.fn().mockResolvedValue({ ok: true, value: { status: 200, headers: {}, body: 'ok', durationMs: 100 } }) },
  rawHttpClient: { execute: vi.fn() },
}))

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({
    queryNodes: () => [],
    addRenderedElement: vi.fn(),
  }),
  NodeType: { ENDPOINT: 'Endpoint' },
}))

vi.mock('../../src/graph/workspace', () => ({
  getGlobalWorkspace: () => ({
    getGraphStore: () => ({
      queryNodes: () => [],
      addRenderedElement: vi.fn(),
    }),
  }),
}))

import { runPrimitive, registerPrimitive, type TechniquePrimitive, type TechniqueContext, type AttackStep, type StepExecutionResult, type PrimitiveResult } from '../../src/primitives/framework'

const mockExecutor = async (step: AttackStep): Promise<StepExecutionResult> => ({
  step,
  ok: true,
  status: 200,
  headers: {},
  body: 'response body',
  durationMs: 100,
})

describe('Payload merge + dedup', () => {
  it('merges ctx.payloads into ctx.mergedPayloads with dedup', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-merge',
      name: 'Test Merge',
      description: 'Test primitive',
      appliesTo: () => true,
      generate: async (ctx) => {
        const payloads = ctx.mergedPayloads ?? ['default']
        return payloads.map((p, i) => ({
          id: `step-${i}`,
          description: `Test ${p}`,
          request: { method: 'GET', url: `https://example.com/api?q=${p}` },
          metadata: { payload: p },
        }))
      },
      oracle: async (results) => ({
        confirmed: false,
        confidence: 0,
        evidence: results.map(r => ({ kind: 'request' as const, label: r.step.metadata?.payload, data: String(r.step.metadata?.payload) })),
      }),
    }

    const ctx: TechniqueContext = {
      target: 'https://example.com',
      payloads: ['custom1', 'default', 'custom2', 'custom1'],
    }

    const result = await runPrimitive(primitive, ctx, mockExecutor, gate)
    const payloads = result.evidence.map(e => e.label)
    expect(payloads).toContain('custom1')
    expect(payloads).toContain('custom2')
    expect(payloads).toContain('default')
    // 'custom1' appears twice in input but should be deduplicated
    const custom1Count = payloads.filter(p => p === 'custom1').length
    expect(custom1Count).toBe(1)
  })

  it('tags LLM payloads with payloadSource=llm, others with static', async () => {
    const gate = new EvidenceGate()
    let capturedSteps: AttackStep[] = []

    const primitive: TechniquePrimitive = {
      id: 'test-provenance',
      name: 'Test Provenance',
      description: 'Test',
      appliesTo: () => true,
      generate: async (ctx) => {
        // Simulate: primitive loads 'static-default' from PayloadStore,
        // then mergedPayloads adds 'llm-payload-1' from ctx.payloads
        const fromStore = ['static-default']
        const fromMerged = ctx.mergedPayloads ?? []
        const all = [...fromStore, ...fromMerged]
        return all.map((p, i) => ({
          id: `step-${i}`,
          description: `Test ${p}`,
          request: { method: 'GET', url: `https://example.com/api?q=${p}` },
          metadata: { payload: p },
        }))
      },
      oracle: async (results) => {
        capturedSteps = results.map(r => r.step)
        return { confirmed: false, confidence: 0, evidence: [] }
      },
    }

    const ctx: TechniqueContext = {
      target: 'https://example.com',
      payloads: ['llm-payload-1'],
    }

    await runPrimitive(primitive, ctx, mockExecutor, gate)
    const sources = capturedSteps.map(s => s.metadata?.payloadSource)
    expect(sources).toContain('llm')
    expect(sources).toContain('static')
    const llmStep = capturedSteps.find(s => s.metadata?.payload === 'llm-payload-1')
    expect(llmStep?.metadata?.payloadSource).toBe('llm')
    const staticStep = capturedSteps.find(s => s.metadata?.payload === 'static-default')
    expect(staticStep?.metadata?.payloadSource).toBe('static')
  })

  it('works backward-compatible when ctx.payloads is absent', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-bc',
      name: 'Test BC',
      description: 'Test',
      appliesTo: () => true,
      generate: async () => [{
        id: 'step-0',
        description: 'Default',
        request: { method: 'GET', url: 'https://example.com/api' },
        metadata: { payload: 'default-payload' },
      }],
      oracle: async (results) => ({
        confirmed: false,
        confidence: 0,
        evidence: [],
      }),
    }

    const ctx: TechniqueContext = { target: 'https://example.com' }
    const result = await runPrimitive(primitive, ctx, mockExecutor, gate)
    expect(result.confirmed).toBe(false)
  })

  it('handles empty ctx.payloads array', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-empty',
      name: 'Test Empty',
      description: 'Test',
      appliesTo: () => true,
      generate: async () => [{
        id: 'step-0',
        description: 'Default',
        request: { method: 'GET', url: 'https://example.com/api' },
        metadata: { payload: 'default' },
      }],
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [] }),
    }

    const ctx: TechniqueContext = { target: 'https://example.com', payloads: [] }
    const result = await runPrimitive(primitive, ctx, mockExecutor, gate)
    expect(result.confirmed).toBe(false)
  })

  it('payloadSet does not conflict with mergedPayloads', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-set',
      name: 'Test Set',
      description: 'Test',
      appliesTo: () => true,
      generate: async (ctx) => {
        const fromSet = ctx.payloadSet ? ['from-set'] : []
        const fromMerged = ctx.mergedPayloads ?? []
        const all = [...fromSet, ...fromMerged]
        return all.map((p, i) => ({
          id: `step-${i}`,
          description: `Test ${p}`,
          request: { method: 'GET', url: `https://example.com/api?q=${p}` },
          metadata: { payload: p },
        }))
      },
      oracle: async (results) => ({
        confirmed: false,
        confidence: 0,
        evidence: results.map(r => ({ kind: 'request' as const, label: String(r.step.metadata?.payload), data: String(r.step.metadata?.payload) })),
      }),
    }

    const ctx: TechniqueContext = {
      target: 'https://example.com',
      payloads: ['llm-1'],
      payloadSet: { category: 'sqli/error-based' },
    }

    const result = await runPrimitive(primitive, ctx, mockExecutor, gate)
    const labels = result.evidence.map(e => e.label)
    expect(labels).toContain('from-set')
    expect(labels).toContain('llm-1')
  })
})
