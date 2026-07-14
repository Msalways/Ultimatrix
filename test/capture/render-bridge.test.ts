import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { recordRenderTraceFromResponse } from '../../src/capture/render-bridge'
import { GraphStore, setGlobalGraphStore } from '../../src/graph/store'
import { NodeType } from '../../src/graph/schema'

const tmpDir = join(tmpdir(), 'ultimatrix-render-bridge')

describe('render-bridge (live capture wiring)', () => {
  let store: GraphStore
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    store = new GraphStore(join(tmpDir, 'g.json'))
    setGlobalGraphStore(store)
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('records RENDERED_ELEMENT nodes for HTML responses and dedupes', () => {
    const html = '<!doctype html><html><body><form><input id="q" name="q" value="x"><button id="go" onclick="s()">Go</button></form></body></html>'
    const t1 = recordRenderTraceFromResponse({ url: 'https://t.example/app', method: 'GET', status: 200, contentType: 'text/html', body: html })
    expect(t1?.html).toBe(true)
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(2) // input#q + button#go

    // Same page again — should NOT create duplicates.
    recordRenderTraceFromResponse({ url: 'https://t.example/app', method: 'GET', status: 200, contentType: 'text/html', body: html })
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(2)
  })

  it('ignores non-HTML responses', () => {
    const t = recordRenderTraceFromResponse({ url: 'https://t.example/api', method: 'GET', status: 200, contentType: 'application/json', body: '{"ok":true}' })
    expect(t).toBeNull()
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(0)
  })
})
