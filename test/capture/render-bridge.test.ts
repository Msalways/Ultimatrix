import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { recordRenderTraceFromPage, recordRenderTraceFromResponse } from '../../src/capture/render-bridge'
import { extractWorkflows } from '../../src/research/workflow-extractor'
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
    const html = '<!doctype html><html><body><a href="/orders?token=secret">Orders</a><a href="https://outside.test/escape">Elsewhere</a><a>Empty</a><form action="/checkout?session=secret" method="post"><input id="q" name="q" value="private"><button id="go" onclick="s()">Go</button></form></body></html>'
    const t1 = recordRenderTraceFromResponse({ url: 'https://t.example/app?session=source-secret', method: 'GET', status: 200, contentType: 'text/html', body: html })
    expect(t1?.html).toBe(true)
    const nodes = store.queryNodes(NodeType.RENDERED_ELEMENT) as any[]
    expect(nodes).toHaveLength(4) // input, button, same-origin link, and form
    expect(nodes.some(node => node.properties.attributes?.href === '/orders')).toBe(true)
    expect(nodes.some(node => node.properties.attributes?.action === '/checkout' && node.properties.attributes?.method === 'POST')).toBe(true)
    expect(nodes.some(node => JSON.stringify(node.properties).includes('outside.test'))).toBe(false)
    expect(nodes.some(node => JSON.stringify(node.properties).includes('secret'))).toBe(false)
    expect(nodes.every(node => node.properties.url === 'https://t.example/app')).toBe(true)
    expect(nodes.find(node => node.properties.name === 'q')?.properties.value).toBeUndefined()
    expect(nodes.find(node => node.properties.name === 'q')?.properties.attributes?.value).toBeUndefined()

    // Same page again — should NOT create duplicates.
    recordRenderTraceFromResponse({ url: 'https://t.example/app?session=source-secret', method: 'GET', status: 200, contentType: 'text/html', body: html })
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(4)
  })

  it('ignores non-HTML responses', () => {
    const t = recordRenderTraceFromResponse({ url: 'https://t.example/api', method: 'GET', status: 200, contentType: 'application/json', body: '{"ok":true}' })
    expect(t).toBeNull()
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(0)
  })

  it('snapshots SPA DOM controls after interactions without persisting input values', async () => {
    const page = {
      url: () => 'https://t.example/app',
      content: async () => '<!doctype html><html><body><button id="menu">Close menu</button><button id="transfer">Transfer</button><input type="submit" value="Continue"><input id="amount" name="amount" value="125"><input id="password" type="password" value="private-secret"><textarea name="note">private-note</textarea></body></html>',
    }

    await recordRenderTraceFromPage(page)
    const nodes = store.queryNodes(NodeType.RENDERED_ELEMENT) as any[]

    expect(nodes.some(node => node.properties.selector.includes('#menu:has-text("Close menu")'))).toBe(true)
    expect(nodes.some(node => node.properties.selector.includes('#transfer:has-text("Transfer")'))).toBe(true)
    expect(nodes.some(node => node.properties.selector.includes('input[type="submit"][value="Continue"]'))).toBe(true)
    expect(nodes.some(node => node.properties.isFormField && node.properties.name === 'amount')).toBe(true)
    expect(JSON.stringify(nodes)).not.toContain('125')
    expect(JSON.stringify(nodes)).not.toContain('private-secret')
    expect(JSON.stringify(nodes)).not.toContain('private-note')

    const pageMap = extractWorkflows(store).find(workflow => workflow.source === 'render-inference')
    expect(pageMap?.sequenceObserved).toBe(false)
    expect(pageMap?.steps.some(step => step.action === 'button available: Transfer')).toBe(true)
    expect(pageMap?.steps.some(step => step.action === 'button available: Continue')).toBe(true)
  })
})
