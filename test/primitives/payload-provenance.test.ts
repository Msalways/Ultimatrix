import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { coreEvidenceLedger } from '../../src/core/evidence'
import type { AttackStep, StepExecutionResult } from '../../src/primitives/framework'

vi.mock('../../src/tools/http-tools', () => ({
  httpRequest: { execute: vi.fn().mockResolvedValue({ ok: true, value: { status: 200, headers: {}, body: 'ok', durationMs: 100 } }) },
  rawHttpClient: { execute: vi.fn() },
}))

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({ queryNodes: () => [], addRenderedElement: vi.fn() }),
  NodeType: { ENDPOINT: 'Endpoint' },
}))

vi.mock('../../src/graph/workspace', () => ({
  getGlobalWorkspace: () => ({ getGraphStore: () => ({ queryNodes: () => [], addRenderedElement: vi.fn() }) }),
}))

import { runPrimitive, type TechniquePrimitive, type TechniqueContext } from '../../src/primitives/framework'

const mockExecutor = async (step: AttackStep): Promise<StepExecutionResult> => ({
  step, ok: true, status: 200, headers: {}, body: 'response', durationMs: 100,
})

describe('Payload provenance tracking', () => {
  beforeEach(() => {
    coreEvidenceLedger.clear()
  })
  it('records payloadSource in observed facts via recordObserved', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-prov-record',
      name: 'Test',
      description: 'Test',
      appliesTo: () => true,
      generate: async () => [{
        id: 'step-0',
        description: 'Test',
        request: { method: 'GET', url: 'https://example.com/api?q=test' },
        metadata: { payload: 'test-payload' },
      }],
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [] }),
    }

    const ctx: TechniqueContext = { target: 'https://example.com', payloads: ['test-payload'] }
    await runPrimitive(primitive, ctx, mockExecutor, gate)

    // The gate should have recorded observed facts with payloadSource
    const allEvidence = coreEvidenceLedger.all()
    const requestEvidence = allEvidence.find(e => e.type === 'raw_request')
    expect(requestEvidence).toBeDefined()
    expect(requestEvidence?.observed?.payloadSource).toBe('llm')
  })

  it('tags static payloads with payloadSource=static', async () => {
    const gate = new EvidenceGate()
    const primitive: TechniquePrimitive = {
      id: 'test-prov-static',
      name: 'Test',
      description: 'Test',
      appliesTo: () => true,
      generate: async () => [{
        id: 'step-0',
        description: 'Test',
        request: { method: 'GET', url: 'https://example.com/api?q=static' },
        metadata: { payload: 'static-payload' },
      }],
      oracle: async () => ({ confirmed: false, confidence: 0, evidence: [] }),
    }

    const ctx: TechniqueContext = { target: 'https://example.com' }
    await runPrimitive(primitive, ctx, mockExecutor, gate)

    const allEvidence = coreEvidenceLedger.all()
    const requestEvidence = allEvidence.find(e => e.type === 'raw_request')
    expect(requestEvidence?.observed?.payloadSource).toBe('static')
  })

  it('oracle receives steps with payloadSource in metadata', async () => {
    const gate = new EvidenceGate()
    let oracleSteps: AttackStep[] = []

    const primitive: TechniquePrimitive = {
      id: 'test-prov-oracle',
      name: 'Test',
      description: 'Test',
      appliesTo: () => true,
      generate: async () => [{
        id: 'step-0',
        description: 'Test',
        request: { method: 'GET', url: 'https://example.com/api?q=llm' },
        metadata: { payload: 'llm-payload' },
      }],
      oracle: async (results) => {
        oracleSteps = results.map(r => r.step)
        return { confirmed: false, confidence: 0, evidence: [] }
      },
    }

    const ctx: TechniqueContext = { target: 'https://example.com', payloads: ['llm-payload'] }
    await runPrimitive(primitive, ctx, mockExecutor, gate)

    expect(oracleSteps).toHaveLength(1)
    expect(oracleSteps[0].metadata?.payloadSource).toBe('llm')
  })
})
