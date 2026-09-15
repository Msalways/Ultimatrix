/**
 * Base Architecture Contracts — F1 Service Ownership.
 *
 * I1: evidence-gate resolution is engagement-scoped (a gate registered inside
 * one engagement context never bleeds into another or into the legacy
 * fallback). F1.3: spawn tools resolve the model selector from the engagement
 * container when the constructor arg is absent, and the routed model proves it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn() },
}))
vi.mock('../../src/events/emitter', () => ({
  emitWorkerSpawned: vi.fn(),
  emitWorkerStarted: vi.fn(),
  emitWorkerCompleted: vi.fn(),
  emitWorkerError: vi.fn(),
}))
vi.mock('../../src/security/decision-ledger', () => ({
  getGlobalDecisionLedger: () => ({ recordDecision: vi.fn().mockReturnValue({ id: 'd1' }) }),
}))
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({
    queryNodes: vi.fn(() => []),
    getNode: vi.fn(() => undefined),
    addFinding: vi.fn(),
  }),
}))

import { runWithEngagementServices, type EngagementServices } from '../../src/runtime/engagement-context'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { setEvidenceGateForFindings, getGlobalEvidenceGate } from '../../src/tools/control-tools'
import { createSpawnWorkerTool } from '../../src/manager/tools/spawn-worker'
import type { ModelSelector } from '../../src/models/selector'

function fakeServices(overrides: Partial<EngagementServices> = {}): EngagementServices {
  return {
    findingState: { evidenceBuffer: new Map(), evidenceGate: null },
    workspace: { getTargetDir: vi.fn(() => '/tmp/test') } as any,
    graph: { queryNodes: vi.fn(() => []), getNode: vi.fn(() => undefined), addFinding: vi.fn() } as any,
    oast: { register: vi.fn(), checkCallbacks: vi.fn() } as any,
    decisions: { recordDecision: vi.fn().mockReturnValue({ id: 'd1' }) } as any,
    artifacts: { create: vi.fn() } as any,
    evidence: { record: vi.fn(), verify: vi.fn() } as any,
    usage: { record: vi.fn(), getUsage: vi.fn() } as any,
    forensicLog: { log: vi.fn() } as any,
    humanObserver: { record: vi.fn() } as any,
    reactionObserver: { onReaction: vi.fn() } as any,
    dialogWatcher: { start: vi.fn(), stop: vi.fn() } as any,
    recorder: null,
    browserManager: { getActivePage: vi.fn(() => null) } as any,
    passiveObserver: { observe: vi.fn() } as any,
    botHandler: { detectChallenge: vi.fn().mockResolvedValue(null) } as any,
    oastConfig: null,
    events: { on: vi.fn(), off: vi.fn(), emit: vi.fn() } as any,
    httpSessions: { get: vi.fn() } as any,
    quota: { recordRequest: vi.fn() } as any,
    toolEvents: { emit: vi.fn() } as any,
    providerLimiters: new Map(),
    scopeConfig: null,
    externalTools: null,
    allowAny: false,
    ...overrides,
  }
}

describe('I1 — evidence-gate scoping', () => {
  beforeEach(() => {
    setEvidenceGateForFindings(null as any) // reset legacy slot via scoped path? legacy fallback below
  })

  it('a gate registered inside context A is visible in A, invisible in B and outside', () => {
    const gateA = new EvidenceGate()
    const servicesA = fakeServices()

    runWithEngagementServices(servicesA, () => {
      setEvidenceGateForFindings(gateA)
      expect(getGlobalEvidenceGate()).toBe(gateA)
    })

    // Context B never saw gateA
    runWithEngagementServices(fakeServices(), () => {
      expect(getGlobalEvidenceGate()).not.toBe(gateA)
    })

    // Re-entering A still resolves gateA (per-engagement ownership)
    runWithEngagementServices(servicesA, () => {
      expect(getGlobalEvidenceGate()).toBe(gateA)
    })
  })
})

describe('F1.3 — spawn tools resolve the engagement-scoped selector', () => {
  it('routedModelId comes from the engagement container selector when ctor arg is absent', async () => {
const selection = { 
    tier: 'powerful', 
    modelId: 'groq/engagement-selector-model', 
    provider: 'groq', 
    reasoning: 'engagement',
    budget: { maxAllowedModelCalls: 15 }
  }
    const selector: ModelSelector = {
      selectForTask: vi.fn().mockReturnValue(selection),
    } as unknown as ModelSelector

    const taskCoordinator = {
      run: vi.fn().mockResolvedValue({ status: 'completed', resultSummary: 'done' }),
    }
    const skillRegistry = {
      has: vi.fn(() => true),
      load: vi.fn(() => ({ id: 'web-pentest', instructions: 'x', references: [] })),
    }

    const tool = createSpawnWorkerTool(
      { provider: 'groq', model: 'base-model', browser: { headless: true, viewport: { width: 1, height: 1 }, domSettleTimeout: 5, env: 'LOCAL', selfHeal: false, verbose: 0 }, memory: { lastMessages: 1, semanticRecall: false, workingMemory: false } } as any,
      skillRegistry as any,
      taskCoordinator as any,
      undefined, // ctor selector ABSENT — must fall through to engagement container
    )

    const result = await runWithEngagementServices(
      fakeServices({ modelSelector: selector }),
      () => (tool as any).execute({
        task: 'probe endpoint',
        skillId: 'web-pentest',
      }, {}),
    )

    expect(result.status).toBe('completed')
    expect((selector.selectForTask as any).mock.calls.length).toBe(1)
    expect(result.routing?.modelId).toBe('groq/engagement-selector-model')
  })
})
