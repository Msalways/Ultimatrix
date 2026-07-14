import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { wireRenderTrace } from '../../src/capture/render-bridge'
import { GraphStore, setGlobalGraphStore } from '../../src/graph/store'
import { NodeType } from '../../src/graph/schema'

const tmpDir = join(tmpdir(), 'ultimatrix-wire-rt')

function fakePage() {
  const handlers: Record<string, Array<(r: any) => void>> = {}
  return {
    on(event: string, cb: (r: any) => void) {
      ;(handlers[event] ||= []).push(cb)
    },
    emit(event: string, arg: any) {
      ;(handlers[event] || []).forEach((cb) => cb(arg))
    },
  }
}

function htmlResponse(url: string, body: string) {
  return {
    headers: () => ({ 'content-type': 'text/html' }),
    request: () => ({ url: () => url, method: () => 'GET' }),
    status: () => 200,
    body: () => Promise.resolve(Buffer.from(body)),
  }
}

function jsonResponse(url: string, body: string) {
  return {
    headers: () => ({ 'content-type': 'application/json' }),
    request: () => ({ url: () => url, method: () => 'GET' }),
    status: () => 200,
    body: () => Promise.resolve(Buffer.from(body)),
  }
}

describe('wireRenderTrace (spider page render tracing)', () => {
  let store: GraphStore
  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true })
    store = new GraphStore(join(tmpDir, 'g.json'))
    setGlobalGraphStore(store)
  })
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('render-traces HTML responses on a wired page', async () => {
    const page = fakePage()
    wireRenderTrace(page)
    page.emit('response', htmlResponse('https://t.example/p', '<!doctype html><html><body><input id="q" name="q"></body></html>'))
    await new Promise((r) => setTimeout(r, 50))
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBeGreaterThan(0)
  })

  it('skips non-HTML responses', async () => {
    const page = fakePage()
    wireRenderTrace(page)
    page.emit('response', jsonResponse('https://t.example/api', '{"ok":1}'))
    await new Promise((r) => setTimeout(r, 50))
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(0)
  })

  it('is idempotent per page (no double tracing)', async () => {
    const page = fakePage()
    wireRenderTrace(page)
    wireRenderTrace(page)
    page.emit('response', htmlResponse('https://t.example/p', '<!doctype html><html><body><input id="q" name="q"></body></html>'))
    await new Promise((r) => setTimeout(r, 50))
    // idempotent wiring → single response → exactly the form field(s) of one page.
    expect(store.queryNodes(NodeType.RENDERED_ELEMENT).length).toBe(1)
  })
})
