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
      endpoints: h.graphStoreMock.endpoints.map((e: any) => ({
        id: e.id, url: e.properties.url, method: e.properties.method,
        params: e.properties.params?.length ?? 0,
        authRequired: e.properties.authRequired,
        headerCount: e.properties.headers?.length ?? 0,
      })),
      lastUpdated: Date.now(),
    }),
    queryEdges: () => [],
  },
  logWarn: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: h.logWarn, error: vi.fn(), dim: vi.fn(), success: vi.fn(), nl: vi.fn() },
}))

vi.mock('../../src/tools/report-tools', () => ({
  setForensicLog: vi.fn().mockReturnValue({ log: vi.fn() }),
  getForensicLog: vi.fn().mockReturnValue({ log: vi.fn() }),
}))

vi.mock('../../src/intelligence/chain-planner', () => ({
  runActiveChaining: vi.fn(),
}))

vi.mock('../../src/solver/exploitation-loop', () => ({
  runExploitationLoop: vi.fn(),
}))

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => h.graphStoreMock,
  NodeType: { FINDING: 'FINDING', ENDPOINT: 'ENDPOINT' },
}))

vi.mock('../../src/config', () => ({
  getConfig: () => ({ context: { maxFindingsPerTurn: 20 } }),
  DEFAULTS: { solver: { maxToolCalls: 50, maxDurationMs: 300000, maxParallel: 1 }, antiLoop: { staleThreshold: 3 } },
  CONTEXT_WINDOW_MAP: {},
}))

import { solve } from '../../src/solver/solver'

function createMockAgent(textChunks: string[]) {
  let callIndex = 0
  return {
    instructions: undefined as any,
    tools: undefined as any,
    stream: vi.fn().mockImplementation(async (_prompt: string) => {
      const text = textChunks[Math.min(callIndex++, textChunks.length - 1)] || ''
      return {
        fullStream: (async function* () {
          if (text) {
            yield { type: 'text-delta', payload: { text } }
          }
        })(),
        toolCalls: [],
        text: Promise.resolve(text),
      }
    }),
  }
}

describe('Recent Discoveries — moved to getSessionContext tool', () => {
  beforeEach(() => {
    h.graphStoreMock.endpoints = []
    h.graphStoreMock.findings = []
  })

  it('does NOT embed Recent Discoveries in enriched goal (now via getSessionContext tool)', async () => {
    // First call — establish snapshot
    const agent1 = createMockAgent(['Initial scan'])
    await solve(agent1 as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
    })

    // Simulate new endpoint discovered between turns
    h.graphStoreMock.endpoints.push({
      id: 'ep1',
      type: 'Endpoint',
      properties: { url: 'https://example.com/api/new', method: 'GET' },
    })

    // Second call — discoveries are NOT in the enriched goal anymore
    const agent2 = createMockAgent(['Found something new'])
    await solve(agent2 as any, {
      origin: 'https://example.com',
      goal: 'Continue testing',
    })

    const secondPrompt = agent2.stream.mock.calls[0][0] as string
    // Discoveries were moved to getSessionContext tool — should not be in the goal
    expect(secondPrompt).not.toContain('## Recent Discoveries')
    // But the runtime envelope should still be present
    expect(secondPrompt).toContain('<runtime-index>')
  })

  it('still includes runtime envelope in enriched goal', async () => {
    const agent = createMockAgent(['Test'])
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
    })

    const prompt = agent.stream.mock.calls[0][0] as string
    expect(prompt).toContain('<runtime-index>')
  })
})
