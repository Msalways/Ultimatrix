import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GraphStore } from '../../src/graph/store'
import { NodeType, EdgeType } from '../../src/graph/schema'
import { proposeThreatModel, listThreatModels } from '../../src/solver/threat-model'
import { setScopeConfig } from '../../src/safety/scope-guard'

describe('threat-model (W0.5)', () => {
  let tmpDir: string
  const origCwd = process.cwd()
  let store: GraphStore

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tm-test-'))
    process.chdir(tmpDir)
    store = new GraphStore(join(tmpDir, 'g.json'))
    setScopeConfig({ allowedDomains: ['t.example'], enforcement: 'hard' })
  })

  afterEach(() => {
    setScopeConfig(null)
    process.chdir(origCwd)
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  afterAll(() => process.chdir(origCwd))

  function seedFinding(id: string, endpoint: string) {
    return store.addFinding({
      findingId: id,
      severity: 'high',
      technique: 'auth_bypass',
      endpoint,
      evidence: ['e1'],
      confidence: 0.9,
      lifecycleStatus: 'verified',
      evidenceLevel: 'L3',
      impact: 'account takeover',
    } as any)
  }

  it('builds a typed THREAT_MODEL node from a confirmed finding', () => {
    seedFinding('f1', 'https://t.example/a')
    const res = proposeThreatModel('f1', { store })
    expect(res.node).toBeDefined()
    expect(res.node!.type).toBe(NodeType.THREAT_MODEL)
    expect(res.node!.properties.findingId).toBe('f1')
    expect(res.node!.properties.assetsAtRisk).toContain('https://t.example/a')
  })

  it('uses SESSION_REACHES edges to add in-scope pivot targets', () => {
    seedFinding('f1', 'https://t.example/a')
    store.addEdge({
      fromId: 'f1',
      toId: 'https://t.example/b',
      type: EdgeType.SESSION_REACHES,
      properties: { fromFindingId: 'f1' },
    })
    const res = proposeThreatModel('f1', { store })
    expect(res.node!.properties.assetsAtRisk).toContain('https://t.example/b')
    expect(res.node!.properties.nextTarget).toBe('https://t.example/b')
  })

  it('skips when finding missing', () => {
    const res = proposeThreatModel('nope', { store })
    expect(res.skipped).toBeDefined()
    expect(res.node).toBeUndefined()
  })

  it('is listed by listThreatModels', () => {
    seedFinding('f1', 'https://t.example/a')
    proposeThreatModel('f1', { store })
    expect(listThreatModels({ store }).length).toBe(1)
  })
})
