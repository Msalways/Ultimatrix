import { describe, expect, it, beforeEach } from 'vitest'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'
import { ModelSelector, type ModelCapabilities } from '../../src/models/selector'
import { resetAllProviderLimiters } from '../../src/models/limiter-factory'
import { resetGlobalQuotaTracker } from '../../src/models/quota-tracker'
import { getGlobalEmitter, emitWorkerSpawned } from '../../src/events/emitter'
import { SpiderRuntime } from '../../src/spider/runtime'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'
import type { UltimatrixConfig } from '../../src/config'

function makeConfig(overrides?: Partial<UltimatrixConfig>): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'groq/llama3-8b-8192',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_xxx' }, openai: { apiKey: 'sk_test' } },
    browser: { headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0 },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    budgetPolicy: {
      enforcement: 'soft',
      scope: 'session',
      resetOn: 'never',
      allocation: { brain: 0.3, workers: 0.6, spider: 0.1 },
      maxModelCallsPerTask: 15,
      trackTokens: false,
    },
    ...overrides,
  }
}

const CAPABILITIES: ModelCapabilities = {
  'groq/llama3-8b-8192': { contextWindow: 8192, maxOutputTokens: 4096, strengths: ['fast-inference'], supportsStreaming: true, supportsStructuredOutput: false },
  'openai/gpt-4o': { contextWindow: 128000, maxOutputTokens: 16384, strengths: ['reasoning'], supportsStreaming: true, supportsStructuredOutput: true },
}

describe('DecisionLedger', () => {
  beforeEach(() => {
    getGlobalDecisionLedger().clear()
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
  })

  it('records a decision with routing reason and source refs', () => {
    const ledger = getGlobalDecisionLedger()
    const rec = ledger.recordDecision({
      kind: 'worker.spawn',
      reason: 'spawn recon specialist worker',
      routingReason: 'capabilities: reasoning; complexity match: balanced',
      provider: 'openai',
      model: 'gpt-4o',
      sourceRefs: ['worker-1', 'tier:balanced'],
    })

    expect(rec.id.startsWith('decision:worker.spawn:')).toBe(true)
    expect(rec.workflowId).toBe('session')
    expect(rec.routingReason).toContain('complexity match: balanced')
    expect(rec.provider).toBe('openai')
    expect(rec.model).toBe('gpt-4o')
    expect(rec.sourceRefs).toContain('worker-1')
    expect(ledger.getDecision(rec.id)).toBe(rec)
  })

  it('threads workflowId through record and query helpers', () => {
    const ledger = getGlobalDecisionLedger()
    ledger.setWorkflowId('wf-engagement-9')
    const d = ledger.recordDecision({ kind: 'tool.exec', reason: 'tool http called' })
    const p = ledger.recordProvenance({ source: 'web', pageUrl: 'https://example.com/x' })

    expect(d.workflowId).toBe('wf-engagement-9')
    expect(p.workflowId).toBe('wf-engagement-9')
    expect(ledger.decisionsForWorkflow('wf-engagement-9')).toContain(d)
    expect(ledger.provenanceForWorkflow('wf-engagement-9')).toContain(p)

    ledger.setWorkflowId(null)
    expect(ledger.getWorkflowId()).toBe('session')
  })

  it('lists decisions and provenance by kind/source', () => {
    const ledger = getGlobalDecisionLedger()
    ledger.recordDecision({ kind: 'model.selection', reason: 'r1' })
    ledger.recordDecision({ kind: 'model.selection', reason: 'r2' })
    ledger.recordDecision({ kind: 'scope.classify', reason: 'r3' })
    ledger.recordProvenance({ source: 'browser', pageUrl: 'https://example.com/a' })
    ledger.recordProvenance({ source: 'web', pageUrl: 'https://example.com/b' })

    expect(ledger.listDecisions('model.selection')).toHaveLength(2)
    expect(ledger.listProvenance('web')).toHaveLength(1)
  })

  it('redacts secret-shaped values in reasons and page URLs', () => {
    const ledger = getGlobalDecisionLedger()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
    const rec = ledger.recordDecision({
      kind: 'browser.action',
      reason: `navigated to /?session=${jwt}`,
    })
    const prov = ledger.recordProvenance({
      source: 'browser',
      pageUrl: `https://example.com/?apikey=sk-live-secret-abc`,
    })

    expect(rec.reason).not.toContain(jwt)
    expect(prov.pageUrl).not.toContain('sk-live-secret-abc')
  })

  it('preserves routing reason verbatim (routing reasoning is not target data)', () => {
    const ledger = getGlobalDecisionLedger()
    const reasoning = 'capabilities: reasoning; context headroom: 120000; provider diversity'
    const rec = ledger.recordDecision({ kind: 'model.selection', reason: 'select', routingReason: reasoning })
    expect(rec.routingReason).toBe(reasoning)
  })

  it('clear() empties the ledger', () => {
    const ledger = getGlobalDecisionLedger()
    ledger.recordDecision({ kind: 'tool.exec', reason: 'x' })
    ledger.recordProvenance({ source: 'tool', pageUrl: 'https://example.com' })
    ledger.clear()
    expect(ledger.listDecisions()).toHaveLength(0)
    expect(ledger.listProvenance()).toHaveLength(0)
  })
})

describe('worker spawn routing reason preservation', () => {
  beforeEach(() => {
    getGlobalEmitter().removeAllListeners()
    getGlobalDecisionLedger().clear()
  })

  it('carries typed routingReason through the worker:spawned event boundary', () => {
    const emitter = getGlobalEmitter()
    let captured: { routingReason?: string; modelId?: string } | undefined
    emitter.on('worker:spawned', (payload) => {
      captured = { routingReason: payload.routingReason, modelId: payload.modelId }
    })

    emitWorkerSpawned('w1', 'Recon Specialist', 'recon', 'enumerate endpoints', {
      tier: 'balanced',
      modelId: 'openai/gpt-4o',
      routingReason: 'capabilities: reasoning; complexity match: balanced',
    })

    expect(captured?.routingReason).toBe('capabilities: reasoning; complexity match: balanced')
    expect(captured?.modelId).toBe('openai/gpt-4o')
  })
})

describe('model selection decision persistence', () => {
  beforeEach(() => {
    getGlobalDecisionLedger().clear()
    resetAllProviderLimiters()
    resetGlobalQuotaTracker()
  })

  it('persists a decision with the selection reasoning as routing reason', () => {
    const selector = new ModelSelector(CAPABILITIES, undefined, makeConfig())
    const selection = selector.selectForTask(
      { skillId: 'recon', taskDescription: 'enumerate', complexity: 'medium', requiredCapabilities: ['reasoning'] },
      'worker',
    )

    const decisions = getGlobalDecisionLedger().listDecisions('model.selection')
    expect(decisions.length).toBeGreaterThanOrEqual(1)
    const last = decisions[decisions.length - 1]
    expect(last.model).toBe(selection.modelId)
    expect(last.provider).toBe(selection.provider)
    expect(last.routingReason).toBe(selection.reasoning)
    expect(last.sourceRefs).toContain('recon')
  })

  it('records fallback selection decisions', () => {
    const selector = new ModelSelector({}, undefined, makeConfig())
    const selection = selector.selectForTask(
      { skillId: 'sql-injection', taskDescription: 'probe', complexity: 'high' },
      'worker',
    )

    const decisions = getGlobalDecisionLedger().listDecisions('model.selection')
    expect(decisions[decisions.length - 1].routingReason).toBe(selection.reasoning)
    expect(decisions[decisions.length - 1].reason).toContain('sql-injection')
  })
})

describe('spider discovery provenance', () => {
  beforeEach(() => {
    getGlobalDecisionLedger().clear()
  })

  it('records web provenance and attaches it to endpoint discoveries', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf1',
      target: 'https://example.com',
      config: makeConfig(),
      allowAny: false,
    })

    runtime.recordEndpoint('GET', 'https://example.com/api/users', ['id'])

    expect(runtime.snapshot().endpoints).toHaveLength(1)
    const ep = runtime.snapshot().endpoints[0]
    expect(ep.provenanceId).toBeTruthy()
    const prov = getGlobalDecisionLedger().getProvenance(ep.provenanceId!)
    expect(prov?.source).toBe('web')
    expect(prov?.pageUrl).toBe('https://example.com/api/users')
  })

  it('attaches provenance to form and page discoveries', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf2',
      target: 'https://example.com',
      config: makeConfig(),
      allowAny: false,
    })

    runtime.recordPage('https://example.com/')
    runtime.recordForm('https://example.com/login', '#username', 'POST', '/login')

    const forms = runtime.snapshot().discoveredForms
    expect(forms).toHaveLength(1)
    expect(forms[0].provenanceId).toBeTruthy()
    expect(getGlobalDecisionLedger().listProvenance('web').length).toBeGreaterThanOrEqual(2)
  })

  it('records scope classification decisions for proposed URLs', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf3',
      target: 'https://example.com',
      config: makeConfig(),
      allowAny: false,
    })

    runtime.enqueue('https://cdn.example.net/app.js')

    const decisions = getGlobalDecisionLedger().listDecisions('scope.classify')
    expect(decisions.some(d => d.reason.includes('proposed'))).toBe(true)
    expect(decisions[decisions.length - 1].routingReason).toBeTruthy()
  })
})

describe('evidence item provenance', () => {
  beforeEach(() => {
    getGlobalDecisionLedger().clear()
  })

  it('attaches a provenance record to every evidence item', () => {
    const ledger = new EvidenceLedger()
    const item = ledger.record({
      type: 'raw_request',
      data: 'GET /api/users',
      label: 'request',
      observed: { method: 'GET', url: 'https://example.com/api/users', status: 200 },
    })

    expect(item.provenanceIds).toHaveLength(1)
    const prov = getGlobalDecisionLedger().getProvenance(item.provenanceIds![0])
    expect(prov?.source).toBe('tool')
    expect(prov?.pageUrl).toBe('https://example.com/api/users')
    expect(prov?.actionId).toBe('raw_request')
  })
})
