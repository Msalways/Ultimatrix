import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const graphNodes = new Map<string, any>()
const mockStore = {
  queryNodes: vi.fn().mockReturnValue([]),
  getNode: vi.fn((id: string) => graphNodes.get(id)),
  upsertNode: vi.fn((node: any) => {
    graphNodes.set(node.id, node)
    return node
  }),
  addFinding: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

const mockWorkspace = {
  getCurrentTarget: vi.fn().mockReturnValue(null),
  getTargetDir: vi.fn().mockReturnValue('/tmp/eval-test'),
}

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => mockWorkspace,
}))

vi.mock('../../src/generation/test-generator', () => ({
  generateFromFinding: vi.fn().mockReturnValue({ id: 'eval-test-1' }),
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

import { architectureEvals } from '../../src/evals/fixtures'
import { runEvalCase, runEvalSuite } from '../../src/evals/runner'
import { getGlobalDecisionLedger } from '../../src/security/decision-ledger'

describe('architecture evals (slice 12)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    graphNodes.clear()
    mockStore.queryNodes.mockReturnValue([])
    mockStore.addFinding.mockImplementation((data: any) => ({
      id: 'finding:eval',
      type: 'Finding',
      properties: data,
    }))
    const { resetStructuredLedger } = await import('../../src/tools/control-tools')
    resetStructuredLedger()
    getGlobalDecisionLedger().clear()
  })

  it(`evaluates all ${architectureEvals.cases.length} architecture evals in one pass`, async () => {
    const results = await runEvalSuite(architectureEvals)
    for (const result of results) {
      expect(result.passed, `[${result.caseId}] ${result.failures.join(' | ')}`).toBe(true)
    }
    expect(results.every((r) => r.passed)).toBe(true)
    expect(results.length).toBe(architectureEvals.cases.length)
  })

  describe('per-case diagnostics', () => {
    for (const caseDef of architectureEvals.cases) {
      it(`passes ${caseDef.id} — ${caseDef.name}`, async () => {
        const result = await runEvalCase(caseDef)
        expect(result.passed, result.failures.join('\n')).toBe(true)
      })
    }
  })
})
