import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { GraphStore } from '../../src/graph/store'
import { NodeType, EdgeType } from '../../src/graph/schema'

const tmpDir = join(tmpdir(), 'ultimatrix-render-test')

describe('RENDERED_ELEMENT graph node (WS-E)', () => {
  let store: GraphStore
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    store = new GraphStore(join(tmpDir, 'graph.json'))
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('adds a RENDERED_ELEMENT node and links it to an endpoint via RENDERED_ON', () => {
    const ep = store.addEndpoint({ url: 'https://t.example/app', method: 'POST' })
    const node = store.addRenderedElement(ep.id, {
      url: 'https://t.example/app',
      method: 'POST',
      selector: '#q',
      tag: 'input',
      name: 'q',
      inputType: 'text',
      value: '<script>alert(1)</script>',
      isFormField: true,
      attributes: { id: 'q', name: 'q' },
      payloadHit: true,
    })
    expect(node.type).toBe(NodeType.RENDERED_ELEMENT)
    expect(node.properties.selector).toBe('#q')
    expect(node.properties.payloadHit).toBe(true)

    const edges = store.queryEdges({ fromId: ep.id, type: EdgeType.RENDERED_ON })
    expect(edges.length).toBe(1)
    expect(edges[0].toId).toBe(node.id)

    const fetched = store.queryNodes(NodeType.RENDERED_ELEMENT)
    expect(fetched.length).toBe(1)
    expect((fetched[0] as any).id).toBe(node.id)
  })
})
