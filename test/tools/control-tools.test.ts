import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  queryNodes: vi.fn().mockReturnValue([]),
  getNode: vi.fn(),
  upsertNode: vi.fn((node: any) => node),
  addFinding: vi.fn(),
  addExploitProof: vi.fn(),
  addEdge: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

const mockWorkspace = {
  getCurrentTarget: vi.fn().mockReturnValue(null),
  getTargetDir: vi.fn().mockReturnValue('/tmp/test'),
}

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => mockWorkspace,
}))

vi.mock('../../src/generation/test-generator', () => ({
  generateFromFinding: vi.fn().mockReturnValue({ id: 'test-1' }),
}))

vi.mock('../../src/generation/test-storage', () => ({
  TestStorage: vi.fn().mockImplementation(() => ({
    save: vi.fn().mockResolvedValue(undefined),
  })),
}))

vi.mock('../../src/utils/logger', () => ({
  log: {
    error: vi.fn(),
    dim: vi.fn(),
    warn: vi.fn(),
  },
}))

async function callTool(tool: any, args: any) {
  const input = tool.id === 'writeFinding' && args.severity !== 'info'
    ? { experimentIds: ['experiment:proven'], ...args }
    : args
  return tool.execute(input, {})
}

/** Record structured evidence (with observed facts) matching `endpoint` so a
 * non-info claim can pass structural verification. */
async function recordFor(type: string, data: string, endpoint: string) {
  const { recordEvidence } = await import('../../src/tools/control-tools')
  await callTool(recordEvidence, {
    type,
    data,
    label: `evidence for ${endpoint}`,
    url: endpoint,
    method: 'GET',
    status: 200,
  })
}

describe('control-tools', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockStore.queryNodes.mockReturnValue([])
    mockStore.getNode.mockImplementation((id: string) => id === 'experiment:proven' ? {
      id,
      type: 'Experiment',
      properties: {
        outcome: { status: 'proven', proof: { experimentId: id, phase: 'initial', evidenceRefs: ['evidence:initial'] } },
        retest: { outcome: { status: 'proven', proof: { experimentId: id, phase: 'retest', evidenceRefs: ['evidence:retest'] } } },
      },
    } : undefined)
    const { resetStructuredLedger } = await import('../../src/tools/control-tools')
    resetStructuredLedger()
    mockStore.addFinding.mockImplementation((data: any) => ({
      id: 'finding:1',
      type: 'Finding',
      properties: data,
    }))
    mockStore.addExploitProof.mockImplementation((data: any) => ({
      id: 'proof:1',
      type: 'ExploitProof',
      properties: data,
    }))
    mockStore.addEdge.mockReturnValue(undefined)
  })

  describe('writeFinding — structural evidence contract (A5)', () => {
    it('HARD-REJECTS a non-info finding with no supporting evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      const result = await callTool(writeFinding, {
        type: 'sql_injection',
        endpoint: '/api/users',
        severity: 'high',
        confidence: 0.8,
      })
      expect(result.ok).toBe(false)
      expect(result.missing.length).toBeGreaterThan(0)
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('HARD-REJECTS a critical finding with no supporting evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      const result = await callTool(writeFinding, {
        type: 'rce',
        endpoint: '/admin/exec',
        severity: 'critical',
        confidence: 0.9,
      })
      expect(result.ok).toBe(false)
    })

    it('allows an info finding without evidence (not a vuln claim)', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      const result = await callTool(writeFinding, {
        type: 'info_disclosure',
        endpoint: '/version',
        severity: 'info',
        confidence: 0.3,
      })
      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
    })

    it('creates a finding when structural evidence supports the claim', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('text', 'user data reflected', '/search')
      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/search',
        param: 'q',
        severity: 'low',
        confidence: 0.5,
      })
      expect(result.ok).toBe(true)
      expect(result.value.findingId).toBe('xss:/search:q')
      expect(mockStore.addFinding).toHaveBeenCalledWith(
        expect.objectContaining({ findingId: 'xss:/search:q' })
      )
    })

    it('assigns L4 evidence level when evidence contains har_entry', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('har_entry', '{"url":"/api"}', '/api')
      const result = await callTool(writeFinding, {
        type: 'sqli',
        endpoint: '/api',
        severity: 'medium',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L4')
    })

    it('assigns L4 evidence level when evidence contains raw_request', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('raw_request', 'GET /api HTTP/1.1', '/api')
      const result = await callTool(writeFinding, {
        type: 'sqli',
        endpoint: '/api',
        severity: 'high',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L4')
    })

    it('assigns L3 evidence level for screenshot evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('screenshot', 'base64data', '/reflect')
      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/reflect',
        severity: 'high',
        confidence: 0.8,
      })
      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L3')
    })

    it('assigns L2 evidence level for text-only evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('text', 'response contains user data', '/user/123')
      const result = await callTool(writeFinding, {
        type: 'idor',
        endpoint: '/user/123',
        severity: 'medium',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L2')
    })

    it('fails CLOSED: high severity with text-only evidence fails the proof floor', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('text', 'error message leaked', '/api/debug')
      const result = await callTool(writeFinding, {
        type: 'info_leak',
        endpoint: '/api/debug',
        severity: 'high',
        confidence: 0.7,
      })
      expect(result.ok).toBe(false)
      expect(result.proofCheck).toBeDefined()
      expect(result.proofCheck.passed).toBe(false)
      expect(result.proofCheck.missingEvidence.length).toBeGreaterThan(0)
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('high severity with raw evidence gets verified status', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('raw_request', 'GET /api/debug HTTP/1.1', '/api/debug')
      const result = await callTool(writeFinding, {
        type: 'info_leak',
        endpoint: '/api/debug',
        severity: 'high',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
      expect(result.value.proofCheck.passed).toBe(true)
    })

    it('generates findingId without param as wildcard', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('text', 'no csrf token', '/transfer')
      const result = await callTool(writeFinding, {
        type: 'csrf',
        endpoint: '/transfer',
        severity: 'medium',
        confidence: 0.6,
      })
      expect(result.ok).toBe(true)
      expect(result.value.findingId).toBe('csrf:/transfer:*')
    })

    it('deduplicates: second writeFinding with same findingId updates existing', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('raw_request', 'GET /search HTTP/1.1', '/search')

      const existingNode = {
        id: 'finding:existing',
        type: 'Finding',
        label: 'Finding: xss on /search',
        properties: {
          severity: 'medium',
          technique: 'xss',
          endpoint: '/search',
          evidence: [],
          confidence: 0.5,
          lifecycleStatus: 'verified',
          evidenceLevel: 'L1',
          findingId: 'xss:/search:q',
        },
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      mockStore.queryNodes.mockReturnValue([existingNode])

      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/search',
        param: 'q',
        severity: 'high',
        confidence: 0.9,
      })

      expect(result.ok).toBe(true)
      expect(result.value.deduplicated).toBe(true)
      expect(result.value.id).toBe('finding:existing')
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })
  })

  describe('promoteFindingCandidate — shared finding-promotion gate (F1)', () => {
    const gateInput = (overrides: any) => ({
      type: 'idor',
      endpoint: '/api/users',
      severity: 'medium' as const,
      confidence: 0.7,
      source: 'llm' as const,
      tool: 'test',
      experimentIds: ['experiment:proven'],
      ...overrides,
    })

    const rawFor = (url: string) => ({
      type: 'raw_request' as const,
      data: `GET ${url} HTTP/1.1`,
      label: 'raw capture',
      observed: { url, method: 'GET', status: 200 },
    })

    it('rejects a non-human claim when evidence does not support the endpoint', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(
        gateInput({ endpoint: '/api/private', evidence: [rawFor('/other')] }),
      )
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.missing).toEqual(['endpoint:/api/private'])
      }
      expect(mockStore.addFinding).not.toHaveBeenCalled()
      expect(mockStore.upsertNode).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'CandidateFinding',
          properties: expect.objectContaining({
            status: 'needs-more-evidence',
            blockers: ['endpoint:/api/private'],
          }),
        }),
      )
    })

    it('rejects a referenced experiment unless its persisted outcome is proven', async () => {
      mockStore.getNode.mockReturnValue({
        id: 'experiment:1',
        type: 'Experiment',
        properties: { outcome: { status: 'inconclusive' } },
      })
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({
        experimentIds: ['experiment:1'],
        evidence: [rawFor('/api/users')],
      }))
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.missing).toEqual(['experiment-not-proven:experiment:1'])
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('requires a proven experiment reference for every non-info promotion', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({ experimentIds: [], evidence: [rawFor('/api/users')] }))
      expect(result).toMatchObject({ ok: false, missing: ['experiment-required'] })
      expect(mockStore.upsertNode).toHaveBeenLastCalledWith(expect.objectContaining({
        type: 'CandidateFinding',
        properties: expect.objectContaining({ status: 'needs-more-evidence', blockers: ['experiment-required'] }),
      }))
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('rejects a proven outcome whose proof assertion belongs to another experiment', async () => {
      mockStore.getNode.mockReturnValue({
        id: 'experiment:1',
        type: 'Experiment',
        properties: { outcome: { status: 'proven', proof: { experimentId: 'experiment:other', evidenceRefs: ['ev:1'] } } },
      })
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({
        experimentIds: ['experiment:1'],
        evidence: [rawFor('/api/users')],
      }))
      expect(result).toMatchObject({ ok: false, missing: ['experiment-not-proven:experiment:1'] })
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('rejects a proven experiment without an independent proven retest', async () => {
      mockStore.getNode.mockReturnValue({
        id: 'experiment:1',
        type: 'Experiment',
        properties: { outcome: { status: 'proven', proof: { experimentId: 'experiment:1', phase: 'initial', evidenceRefs: ['ev:1'] } } },
      })
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({
        experimentIds: ['experiment:1'],
        evidence: [rawFor('/api/users')],
      }))
      expect(result).toMatchObject({ ok: false, missing: ['experiment-not-proven:experiment:1'] })
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('human assertions skip claim verification but the proof floor still fails CLOSED', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(
        gateInput({
          severity: 'high',
          source: 'human',
          evidence: [
            { type: 'text', data: 'observed by operator', label: 'human note', observed: { url: '/api/users', method: 'GET', status: 200 } },
          ],
        }),
      )
      // Human trust bypasses claim verification (no endpoint:missing), but the
      // deterministic floor is NOT downgraded: high requires a non-text capture.
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.missing).toEqual(
          expect.arrayContaining([expect.stringContaining('screenshot/har_entry/raw_request/raw_response')]),
        )
        expect(result.proofCheck).toBeDefined()
        expect(result.proofCheck!.passed).toBe(false)
      }
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('human assertions with a real capture pass the floor and commit', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(
        gateInput({ severity: 'high', source: 'human', evidence: [rawFor('/api/users')] }),
      )
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.evidenceLevel).toBe('L4')
        expect(result.value.lifecycleStatus).toBe('verified')
        expect(result.value.proofCheck.passed).toBe(true)
      }
      expect(mockStore.addFinding).toHaveBeenCalled()
    })

    it('attaches committed evidence to the persisted finding', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({ evidence: [rawFor('/api/users')] }))
      expect(result.ok).toBe(true)
      expect(mockStore.addFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          evidence: expect.arrayContaining(['[raw capture] GET /api/users HTTP/1.1']),
          findingId: 'idor:/api/users:*',
        }),
      )
    })

    it('persists an EXPLOIT_PROOF node with a PROVES edge when exploitProof is supplied', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(
        gateInput({
          severity: 'high',
          evidence: [rawFor('/api/users')],
          exploitProof: {
            scenario: 'read another user record',
            relation: 'cross-api trust boundary',
            request: 'GET /api/users/2',
            response: '{"id":2,"email":"victim"}',
            impact: 'read victim data',
          },
        }),
      )
      expect(result.ok).toBe(true)
      expect(mockStore.addExploitProof).toHaveBeenCalledWith(
        expect.objectContaining({
          scenario: 'read another user record',
          findingId: expect.any(String),
          status: 'proposed',
        }),
      )
      expect(mockStore.addEdge).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PROVES', fromId: 'proof:1', toId: 'finding:1' }),
      )
      if (result.ok) {
        expect(result.value.exploitProofNodeId).toBe('proof:1')
      }
    })

    it('merges duplicates through the gate (no second graph write)', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const existingNode = {
        id: 'finding:existing',
        type: 'Finding',
        properties: {
          findingId: 'idor:/api/users:*',
          severity: 'low',
          evidence: [],
          confidence: 0.3,
          lifecycleStatus: 'verified',
          evidenceLevel: 'L1',
        },
      }
      mockStore.queryNodes.mockReturnValue([existingNode])
      const result = await promoteFindingCandidate(gateInput({ evidence: [rawFor('/api/users')] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.deduplicated).toBe(true)
        expect(result.value.merged).toBe(true)
        expect(result.value.id).toBe('finding:existing')
      }
      expect(mockStore.addFinding).not.toHaveBeenCalled()
    })

    it('carries the proofCheck on the committed finding for report gating', async () => {
      const { promoteFindingCandidate } = await import('../../src/tools/control-tools')
      const result = await promoteFindingCandidate(gateInput({ evidence: [rawFor('/api/users')] }))
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.value.proofCheck.ruleId).toBe('floor-medium')
        expect(result.value.proofCheck.passed).toBe(true)
        expect(result.value.candidateId).toMatch(/^candidate:/)
      }
      expect(mockStore.upsertNode).toHaveBeenLastCalledWith(
        expect.objectContaining({
          type: 'CandidateFinding',
          properties: expect.objectContaining({ status: 'verified' }),
        }),
      )
    })
  })
})
