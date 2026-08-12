import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  queryNodes: vi.fn(),
  addEndpoint: vi.fn(),
  addFinding: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), dim: vi.fn(), error: vi.fn() },
}))

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('addDiscovery — user-reported findings through the shared gate (F1)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mockStore.queryNodes.mockReturnValue([])
    mockStore.addFinding.mockImplementation((data: any) => ({
      id: 'finding:1',
      type: 'Finding',
      properties: data,
    }))
    mockStore.addEndpoint.mockImplementation((data: any) => ({
      id: 'endpoint:1',
      type: 'Endpoint',
      properties: data,
    }))
    const { resetStructuredLedger } = await import('../../src/tools/control-tools')
    resetStructuredLedger()
  })

  it('commits a user-reported medium finding when the user supplies evidence', async () => {
    const { addDiscovery } = await import('../../src/tools/user-discovery')
    const result = await callTool(addDiscovery, {
      endpoint: '/api/users/2',
      method: 'GET',
      technique: 'IDOR',
      severity: 'medium',
      confidence: 0.8,
      description: 'user said they read another account',
      evidence: ['response included victim email for id=2'],
    })
    expect(result.ok).toBe(true)
    expect(result.value.findingId).toBe('IDOR:/api/users/2:*')
    expect(mockStore.addFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        technique: 'IDOR',
        endpoint: '/api/users/2',
        tags: expect.arrayContaining(['user-reported']),
      }),
    )
  })

  it('fails CLOSED: a user-reported HIGH finding with only prose evidence cannot pass the floor', async () => {
    const { addDiscovery } = await import('../../src/tools/user-discovery')
    const result = await callTool(addDiscovery, {
      endpoint: '/admin',
      technique: 'RCE',
      severity: 'high',
      confidence: 0.9,
      description: 'user says they executed commands',
      evidence: ['the server echoed id output'],
    })
    expect(result.ok).toBe(false)
    expect(mockStore.addFinding).not.toHaveBeenCalled()
  })

  it('accepts an info finding with no evidence (no floor)', async () => {
    const { addDiscovery } = await import('../../src/tools/user-discovery')
    const result = await callTool(addDiscovery, {
      endpoint: '/version',
      technique: 'version-disclosure',
      severity: 'info',
      confidence: 0.5,
      description: 'user noticed the version string',
    })
    expect(result.ok).toBe(true)
    expect(result.value.findingId).toBe('version-disclosure:/version:*')
    expect(mockStore.addFinding).toHaveBeenCalled()
  })

  it('fails CLOSED: a user-reported medium finding with no evidence at all', async () => {
    const { addDiscovery } = await import('../../src/tools/user-discovery')
    const result = await callTool(addDiscovery, {
      endpoint: '/api',
      technique: 'IDOR',
      severity: 'medium',
      confidence: 0.8,
      description: 'user reported IDOR without detail',
    })
    expect(result.ok).toBe(false)
    expect(mockStore.addFinding).not.toHaveBeenCalled()
  })
})
