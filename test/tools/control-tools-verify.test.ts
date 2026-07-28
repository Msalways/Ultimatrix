import { describe, it, expect, beforeEach, vi } from 'vitest'

const fakeStore: any = {
  queryNodes: vi.fn(() => []),
  addFinding: vi.fn((n: any) => ({ id: 'f1', properties: n })),
  save: vi.fn(() => Promise.resolve()),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => fakeStore,
}))
vi.mock('../../src/graph/schema', () => ({
  NodeType: { FINDING: 'finding' },
  validateNodeProperties: vi.fn(() => ({ valid: true, errors: [] })),
}))
vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => ({ getCurrentTarget: () => null, getTargetDir: () => '/tmp' }),
}))
vi.mock('../../src/browser/manager', () => ({
  captureScreenshot: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../src/generation/test-generator', () => ({
  generateFromFinding: vi.fn(() => ({ id: 't1' })),
}))
vi.mock('../../src/generation/test-storage', () => ({
  TestStorage: class {
    constructor(_d: string) {}
    async save() {}
  },
}))

import {
  recordEvidence,
  writeFinding,
  recordStructuredEvidence,
  resetStructuredLedger,
} from '../../src/tools/control-tools'

describe('writeFinding — structural hard-reject (A5)', () => {
  beforeEach(() => {
    resetStructuredLedger()
    fakeStore.addFinding.mockClear()
    fakeStore.queryNodes.mockReturnValue([])
  })

  it('rejects a claim with no supporting evidence (no downgrade)', async () => {
    const r: any = await (writeFinding.execute as any)({
      type: 'sql_injection',
      endpoint: 'https://app.example.com/api/users',
      method: 'GET',
      severity: 'high',
      confidence: 0.9,
      findingKey: 'k1',
    })
    expect(r.ok).toBe(false)
    expect(r.missing.join(' ')).toContain('endpoint')
    expect(fakeStore.addFinding).not.toHaveBeenCalled()
  })

  it('accepts when a tool-captured structured record supports the claim', async () => {
    recordStructuredEvidence({
      type: 'raw_response',
      data: '200',
      label: 'resp',
      observed: { method: 'GET', url: 'https://app.example.com/api/users', status: 200 },
    })
    const r: any = await (writeFinding.execute as any)({
      type: 'idor',
      endpoint: 'https://app.example.com/api/users',
      method: 'GET',
      observedStatus: 200,
      severity: 'high',
      confidence: 0.9,
      findingKey: 'k2',
    })
    expect(r.ok).toBe(true)
    expect(fakeStore.addFinding).toHaveBeenCalled()
  })

  it('info severity bypasses verification', async () => {
    const r: any = await (writeFinding.execute as any)({
      type: 'note',
      endpoint: 'https://x.com',
      severity: 'info',
      confidence: 0.5,
      findingKey: 'k3',
    })
    expect(r.ok).toBe(true)
  })

  it('recordEvidence typed observed facts support a later claim', async () => {
    await (recordEvidence.execute as any)({
      type: 'raw_response',
      data: '403',
      label: 'r',
      url: 'https://app.example.com/admin',
      status: 403,
      method: 'GET',
    })
    const r: any = await (writeFinding.execute as any)({
      type: 'idor',
      endpoint: 'https://app.example.com/admin',
      method: 'GET',
      observedStatus: 403,
      severity: 'high',
      confidence: 0.9,
      findingKey: 'k4',
    })
    expect(r.ok).toBe(true)
  })

  it('rejects when status is asserted but no evidence matches it', async () => {
    recordStructuredEvidence({
      type: 'raw_response',
      data: '200',
      label: 'resp',
      observed: { url: 'https://app.example.com/api/users', status: 200 },
    })
    const r: any = await (writeFinding.execute as any)({
      type: 'idor',
      endpoint: 'https://app.example.com/api/users',
      observedStatus: 403,
      severity: 'high',
      confidence: 0.9,
      findingKey: 'k5',
    })
    expect(r.ok).toBe(false)
    expect(r.missing.join(' ')).toContain('status:403')
  })
})
