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
  },
}))

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('control-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.queryNodes.mockReturnValue([])
  })

  describe('writeFinding', () => {
    it('creates finding with lifecycleStatus and evidenceLevel', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')
      const { flushEvidence } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/search',
        param: 'q',
        severity: 'low',
        confidence: 0.5,
      })

      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
      expect(result.value.evidenceLevel).toBe('L1')
      expect(result.value.findingId).toBe('xss:/search:q')
      expect(mockStore.addFinding).toHaveBeenCalledWith(
        expect.objectContaining({
          lifecycleStatus: 'verified',
          evidenceLevel: 'L1',
          findingId: 'xss:/search:q',
        })
      )
    })

    it('sets pending_verification for high severity without evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'sql_injection',
        endpoint: '/api/users',
        severity: 'high',
        confidence: 0.8,
      })

      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('pending_verification')
      expect(result.value.evidenceLevel).toBe('L1')
    })

    it('sets pending_verification for critical severity without evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'rce',
        endpoint: '/admin/exec',
        severity: 'critical',
        confidence: 0.9,
      })

      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('pending_verification')
    })

    it('sets verified for low severity even without evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'info_disclosure',
        endpoint: '/version',
        severity: 'info',
        confidence: 0.3,
      })

      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
    })

    it('sets verified for medium severity without evidence', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/search',
        severity: 'medium',
        confidence: 0.6,
      })

      expect(result.ok).toBe(true)
      expect(result.value.lifecycleStatus).toBe('verified')
    })

    it('deduplicates: second writeFinding with same findingId updates existing', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

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
      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:new',
        type: 'Finding',
        properties: data,
      }))

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

    it('assigns L4 evidence level when evidence contains har_entry', async () => {
      const { writeFinding, recordEvidence, flushEvidence } = await import('../../src/tools/control-tools')

      await callTool(recordEvidence, {
        type: 'har_entry',
        data: '{"url": "/api"}',
        label: 'captured request',
      })

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'sqli',
        endpoint: '/api',
        severity: 'medium',
        confidence: 0.7,
        findingKey: undefined,
      })

      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L4')
    })

    it('assigns L4 evidence level when evidence contains raw_request', async () => {
      const { writeFinding, recordEvidence } = await import('../../src/tools/control-tools')

      await callTool(recordEvidence, {
        type: 'raw_request',
        data: 'GET /api HTTP/1.1',
        label: 'raw req',
      })

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

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
      const { writeFinding, recordEvidence } = await import('../../src/tools/control-tools')

      await callTool(recordEvidence, {
        type: 'screenshot',
        data: 'base64data',
        label: 'proof screenshot',
      })

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

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
      const { writeFinding, recordEvidence } = await import('../../src/tools/control-tools')

      await callTool(recordEvidence, {
        type: 'text',
        data: 'response contains user data',
        label: 'observation',
      })

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'idor',
        endpoint: '/user/123',
        severity: 'high',
        confidence: 0.7,
      })

      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L2')
    })

    it('assigns L1 when no evidence exists', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'xss',
        endpoint: '/search',
        severity: 'low',
        confidence: 0.4,
      })

      expect(result.ok).toBe(true)
      expect(result.value.evidenceLevel).toBe('L1')
    })

    it('generates findingId without param as wildcard', async () => {
      const { writeFinding } = await import('../../src/tools/control-tools')

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

      const result = await callTool(writeFinding, {
        type: 'csrf',
        endpoint: '/transfer',
        severity: 'medium',
        confidence: 0.6,
      })

      expect(result.ok).toBe(true)
      expect(result.value.findingId).toBe('csrf:/transfer:*')
    })

    it('high severity with L2 evidence gets verified status', async () => {
      const { writeFinding, recordEvidence } = await import('../../src/tools/control-tools')

      await callTool(recordEvidence, {
        type: 'text',
        data: 'error message leaked',
        label: 'error observation',
      })

      mockStore.addFinding.mockImplementation((data: any) => ({
        id: 'finding:1',
        type: 'Finding',
        properties: data,
      }))

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
  })
})
