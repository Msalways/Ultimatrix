import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const findingNode: any = {
  id: 'finding:f1',
  type: 'Finding',
  label: 'f1',
  properties: {
    findingId: 'f1',
    severity: 'critical',
    technique: 'auth_bypass',
    endpoint: 'https://t.example/admin',
    evidence: ['observed login bypass'],
    confidence: 0.9,
    lifecycleStatus: 'verified',
    evidenceLevel: 'L3',
    cwe: 'CWE-287',
    impact: 'Full admin takeover',
  },
}
const proofNode: any = {
  id: 'proof:f1',
  type: 'ExploitProof',
  label: 'f1',
  properties: {
    findingId: 'f1',
    status: 'confirmed',
    impact: 'Obtained admin session without credentials',
    request: 'POST /login\nuser=admin&pass=\' OR 1=1--',
    response: 'HTTP 200 {"token":"admin"}',
    method: 'POST',
    url: 'https://t.example/login',
    title: 'auth bypass',
    scenario: 'Authentication bypass via SQLi login',
    reproSteps: ['send payload'],
    replayable: true,
  },
}

const fakeStore: any = {
  queryNodes: vi.fn((t: string) =>
    t === 'Finding' ? [findingNode] : t === 'ExploitProof' ? [proofNode] : [],
  ),
  getExploitProof: vi.fn(() => [proofNode]),
}

vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => fakeStore }))

const tempBase = mkdtempSync(join(tmpdir(), 'ult-report-'))
vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => ({
    getCurrentTarget: () => 'https://t.example',
    getTargetDir: () => tempBase,
  }),
}))

import { writeOnDemandReport } from '../../src/report/on-demand'

describe('on-demand report (W-R)', () => {
  beforeEach(() => {
    fakeStore.queryNodes.mockClear()
    fakeStore.getExploitProof.mockClear()
  })

  it('single finding → .md with request/response/impact', () => {
    const res = writeOnDemandReport('finding', 'f1')
    expect(res.ok).toBe(true)
    expect(res.findingCount).toBe(1)
    expect(res.path).toBeTruthy()
    const md = readFileSync(res.path!, 'utf8')
    expect(md).toContain('auth_bypass')
    expect(md).toContain('POST /login')
    expect(md).toContain('admin session without credentials')
    expect(md).toContain('CWE-287')
  })

  it('engagement → .md covering all findings', () => {
    const res = writeOnDemandReport('engagement')
    expect(res.ok).toBe(true)
    expect(res.findingCount).toBe(1)
    const md = readFileSync(res.path!, 'utf8')
    expect(md.toLowerCase()).toContain('engagement')
  })
})

afterAll(() => rmSync(tempBase, { recursive: true, force: true }))
