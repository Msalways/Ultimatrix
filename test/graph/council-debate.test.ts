import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { GraphStore } from '../../src/graph/store'
import { NodeType } from '../../src/graph/schema'

const tmpDir = join(tmpdir(), 'ultimatrix-council-debate-test')

describe('COUNCIL_DEBATE graph node (B4)', () => {
  let store: GraphStore
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    store = new GraphStore(join(tmpDir, 'graph.json'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('adds a COUNCIL_DEBATE node with typed properties and is queryable', () => {
    const node = store.addCouncilDebate({
      goal: 'find auth bypass on /login',
      round: 2,
      members: ['strategist', 'operator', 'skeptic', 'analyst', 'human'],
      summary: 'Proposed SQLi and XSS; skeptic gated XSS claim.',
      proposedTasks: 2,
      newEvidence: 3,
      complete: false,
    })
    expect(node.type).toBe(NodeType.COUNCIL_DEBATE)
    expect(node.properties.goal).toBe('find auth bypass on /login')
    expect(node.properties.round).toBe(2)
    expect(node.properties.members).toContain('skeptic')
    expect(node.properties.proposedTasks).toBe(2)
    expect(node.properties.complete).toBe(false)

    const fetched = store.queryNodes(NodeType.COUNCIL_DEBATE)
    expect(fetched.length).toBe(1)
    expect((fetched[0] as any).id).toBe(node.id)
  })

  it('defaults optional fields when omitted', () => {
    const node = store.addCouncilDebate({ goal: 'recon' })
    expect(node.properties.round).toBe(0)
    expect(node.properties.members).toEqual([])
    expect(node.properties.complete).toBe(false)
  })
})
