/**
 * End-to-end proof that a model failure reaches the operator.
 *
 * The unit tests prove the classifier and the unwrapper work. This proves the
 * WIRING: that an `error` chunk on the agent stream — which is how every real
 * provider failure has arrived — actually reaches the answer, instead of being
 * dropped by a `switch` with no case for it.
 *
 * The error is injected through the stream rather than thrown, because that is
 * exactly what distinguishes the live bug from the already-tested throw path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  graphStoreMock: {
    hasFinding: false,
    endpoints: [] as any[],
    findings: [] as any[],
    queryNodes: (type?: any) => {
      if (type && String(type) === 'Endpoint') return h.graphStoreMock.endpoints
      if (type && String(type) === 'Finding') return h.graphStoreMock.findings
      return []
    },
    getTargetSummary: () => ({
      totalEndpoints: h.graphStoreMock.endpoints.length,
      totalFindings: h.graphStoreMock.findings.length,
      findingsBySeverity: {},
      totalTests: 0,
      authFlows: 0,
      rbacRoles: 0,
      untestedActions: 0,
      totalCapturedHeaders: 0,
      totalPages: 0,
      totalActions: 0,
      totalInputs: 0,
      endpoints: [],
      lastUpdated: Date.now(),
    }),
    queryEdges: () => [],
  },
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn(), nl: vi.fn() },
}))
vi.mock('../../src/tools/report-tools', () => ({
  setForensicLog: vi.fn().mockReturnValue({ log: vi.fn() }),
  getForensicLog: vi.fn().mockReturnValue({ log: vi.fn() }),
}))
vi.mock('../../src/intelligence/chain-planner', () => ({ runActiveChaining: vi.fn() }))
vi.mock('../../src/solver/exploitation-loop', () => ({ runExploitationLoop: vi.fn() }))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => h.graphStoreMock,
  NodeType: { FINDING: 'FINDING', ENDPOINT: 'ENDPOINT' },
}))
vi.mock('../../src/config', () => ({
  getConfig: () => ({ context: { maxFindingsPerTurn: 20 } }),
  resolveModelRef: () => ({ provider: 'test', model: 'test/model' }),
  DEFAULTS: { solver: { maxToolCalls: 5, maxDurationMs: 8000, maxParallel: 1 }, antiLoop: { staleThreshold: 3 } },
  CONTEXT_WINDOW_MAP: {},
}))

import { solve } from '../../src/solver/solver'

const TEST_SOLVER_CONFIG = {
  provider: 'test',
  model: 'test-model',
  modelCapabilities: {
    'test/test-model': { contextWindow: 128_000, maxOutputTokens: 8_192 },
  },
}

function agentYielding(chunks: unknown[]) {
  return {
    instructions: undefined as any,
    tools: undefined as any,
    stream: vi.fn().mockResolvedValue({
      fullStream: (async function* () {
        for (const c of chunks) yield c
      })(),
      toolCalls: [],
      text: Promise.resolve(''),
    }),
  } as any
}

async function run(chunks: unknown[]) {
  const result = await solve(agentYielding(chunks), {
    origin: 'https://target.test',
    goal: 'check the endpoint',
    ultimatrixConfig: TEST_SOLVER_CONFIG as any,
  })
  return result as { answer?: { content?: string }; error?: string }
}

describe('a model failure on the stream reaches the operator', () => {
  beforeEach(() => { h.graphStoreMock.findings = [] })

  it('reports the provider outage instead of "No deliverable response"', async () => {
    const r = await run([{
      type: 'error',
      payload: {
        error: new Error('Service temporarily overloaded'),
        type: 'service_unavailable',
        code: 503,
      },
    }])

    const answer = r.answer?.content ?? ''
    expect(answer).not.toMatch(/No deliverable response/i)
    expect(answer).toMatch(/service unavailable/i)
    expect(answer).toMatch(/Service temporarily overloaded/)
    expect(answer).toMatch(/retry|switch/i)
  })

  it('records the failure on the result envelope too', async () => {
    const r = await run([{ type: 'error', payload: { message: 'Rate limit exceeded', code: 429 } }])
    expect(r.answer?.content ?? '').toMatch(/rate limited|quota/i)
    expect(r.error ?? r.answer?.content ?? '').toMatch(/rate limited|quota/i)
  })

  it('never emits the empty-deliverable placeholder for a stream failure', async () => {
    for (const payload of [
      { message: 'Service temporarily overloaded', code: 503 },
      { error: new Error('fetch failed') },
      { message: 'overloaded' },
      { message: 'Rate limit exceeded: free-models-per-day', code: 429 },
    ]) {
      const r = await run([{ type: 'error', payload }])
      expect(r.answer?.content ?? '', JSON.stringify(payload)).not.toMatch(/No deliverable response/i)
      expect((r.answer?.content ?? '').trim().length, JSON.stringify(payload)).toBeGreaterThan(0)
    }
  })

  it('does not let a late provider error erase an answer the model already gave', async () => {
    // A hiccup on the final chunk must not destroy a real result.
    const r = await run([
      { type: 'text-delta', payload: { text: 'The endpoint reflects unencoded input in the body.' } },
      { type: 'error', payload: { message: 'Service temporarily overloaded', code: 503 } },
    ])
    expect(r.answer?.content ?? '').toMatch(/reflects unencoded input/)
  })
})
