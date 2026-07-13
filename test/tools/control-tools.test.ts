import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  queryNodes: vi.fn().mockReturnValue([]),
  addFinding: vi.fn(),
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
  return tool.execute(args, {})
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
    const { resetStructuredLedger } = await import('../../src/tools/control-tools')
    resetStructuredLedger()
    mockStore.addFinding.mockImplementation((data: any) => ({
      id: 'finding:1',
      type: 'Finding',
      properties: data,
    }))
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
        severity: 'high',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L2')
    })

    it('high severity with L2 evidence gets verified status', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      await recordFor('text', 'error message leaked', '/api/debug')
      const result = await callTool(writeFinding, {
        type: 'info_leak',
        endpoint: '/api/debug',
        severity: 'high',
        confidence: 0.7,
      })
      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
      expect(result.value.evidenceLevel).toBe('L2')
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
      await recordFor('text', 'reflected', '/search')

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
})
