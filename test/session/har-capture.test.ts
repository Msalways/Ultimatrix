import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attachHarCaptureViaCdp } from '../../src/session/cdp-network-capture'
import { attachHarCaptureViaPlaywright } from '../../src/session/playwright-network-capture'

/**
 * `attachHarCaptureToPage` (the old `page.on('response')` approach) was removed:
 * Stagehand v3 is CDP-native and rejects `page.on('response')`. The approved
 * capture path is `attachHarCaptureViaCdp`, which taps the live context's CDP
 * connection (human + spider + agent in one listener). These tests exercise it
 * with a mocked CDP `CdpConnection` (`conn.on` / `conn.send`) — the same shape
 * Stagehand v3 exposes via `stagehand.context.conn`.
 */
function createMockStagehand() {
  const handlers: Record<string, Function> = {}
  const sent: any[] = []
  const conn = {
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler
    }),
    send: vi.fn((method: string, params: any) => {
      sent.push({ method, params })
      if (method === 'Network.getResponseBody') {
        return Promise.resolve({ body: '<html>ok</html>', base64Encoded: false })
      }
      if (method === 'Network.getRequestPostData') {
        return Promise.resolve({ postData: 'orderId=1' })
      }
      return Promise.resolve({})
    }),
    _emit: (event: string, params: any) => handlers[event]?.(params),
  }
  const stagehand: any = {
    context: { conn },
    page: { url: () => 'https://app.test/' },
  }
  return { stagehand, conn, handlers, sent }
}

describe('attachHarCaptureViaCdp (live CDP capture)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('prefers the active page target session over the root context connection', async () => {
    const { stagehand, conn, sent } = createMockStagehand()
    const targetHandlers: Record<string, Function> = {}
    const target = {
      on: vi.fn((event: string, handler: Function) => { targetHandlers[event] = handler }),
      off: vi.fn(),
      send: vi.fn((method: string) => { sent.push({ method, target: true }); return Promise.resolve({}) }),
    }
    // ASYNC, as the real accessor is. The old synchronous read turned this into
    // an unresolved Promise, page.mainSession was undefined, and the `??` chose
    // the root connection — the one that observes zero requests. That is the
    // defect this suite exists to prevent regressing.
    stagehand.context.activePage = async () => ({ mainSession: target })

    const handle = attachHarCaptureViaCdp(stagehand, {})
    await handle.ready

    expect(target.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function))
    expect(conn.on).not.toHaveBeenCalled()
    expect(target.send).toHaveBeenCalledWith('Network.enable', {})
  })

  it('attaches to the live CDP connection and enables Network', async () => {
    const { stagehand, conn, sent } = createMockStagehand()

    const handle = attachHarCaptureViaCdp(stagehand, {})
    expect(handle.attached).toBe(true)
    // Subscription happens once the target session resolves, so `ready` is the
    // point at which any of this is guaranteed. Asserting before awaiting it was
    // asserting a race.
    await handle.ready
    expect(conn.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function))
    expect(conn.on).toHaveBeenCalledWith('Network.responseReceived', expect.any(Function))
    expect(conn.on).toHaveBeenCalledWith('Network.loadingFinished', expect.any(Function))
    expect(sent.some((s) => s.method === 'Network.enable')).toBe(true)
  })

  it('reports failure through ready when no CDP connection exists', async () => {
    const handle = attachHarCaptureViaCdp({ context: {} } as any, {})
    // No connection is only knowable after the async resolve, so the signal
    // moved from `attached:false` to a rejected `ready`. The caller already
    // handles rejection by falling back to the Playwright capture path.
    await expect(handle.ready).rejects.toThrow(/No usable CDP connection/)
    expect(await handle.flush()).toEqual([])
  })

  it('captures a full request/response pair into a HAR entry', async () => {
    const { stagehand, handlers } = createMockStagehand()

    const handle = attachHarCaptureViaCdp(stagehand, {})
    await handle.ready
    handlers['Network.requestWillBeSent']({
      requestId: 'r1',
      timestamp: 1,
      request: { url: 'https://app.test/api', method: 'POST', headers: { 'content-type': 'application/json' } },
    })
    handlers['Network.responseReceived']({
      requestId: 'r1',
      timestamp: 2,
      response: { url: 'https://app.test/api', status: 200, mimeType: 'application/json', headers: {} },
    })
    handlers['Network.loadingFinished']({ requestId: 'r1', timestamp: 3 })
    const entries = await handle.stop()
    expect(entries).toHaveLength(1)
    expect(entries[0].request.method).toBe('POST')
    expect(entries[0].response.status).toBe(200)
  })

  it('fetches response body and request body lazily', async () => {
    const { stagehand, handlers, conn } = createMockStagehand()
    
    const handle = attachHarCaptureViaCdp(stagehand, { captureResponseBody: true, captureRequestBody: true })
    await handle.ready
    handlers['Network.requestWillBeSent']({
      requestId: 'r2',
      timestamp: 1,
      request: { url: 'https://app.test/login', method: 'POST', headers: {} },
    })
    handlers['Network.responseReceived']({
      requestId: 'r2',
      timestamp: 2,
      response: { url: 'https://app.test/login', status: 200, mimeType: 'text/html', headers: {} },
    })
    handlers['Network.loadingFinished']({ requestId: 'r2', timestamp: 3 })
    const entries = await handle.stop()
    expect(conn.send).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'r2' })
    expect(conn.send).toHaveBeenCalledWith('Network.getRequestPostData', { requestId: 'r2' })
    expect(entries).toHaveLength(1)
    expect(entries[0].response.content.text).toBe('<html>ok</html>')
    expect(entries[0].request.postData?.text).toBe('orderId=1')
    expect(conn.send).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'r2' })
    expect(conn.send).toHaveBeenCalledWith('Network.getRequestPostData', { requestId: 'r2' })
  })

  it('detaches Playwright listeners without closing the provider-owned context', async () => {
    const handlers: Record<string, Function> = {}
    const context = {
      on: vi.fn((event: string, handler: Function) => { handlers[event] = handler }),
      off: vi.fn(),
      close: vi.fn().mockResolvedValue(undefined),
    }
    const handle = attachHarCaptureViaPlaywright(context as any, {})
    const request = {
      url: () => 'https://app.test/actor',
      method: () => 'GET',
      headers: () => ({ cookie: 'sid=1' }),
      postData: () => undefined,
    }
    const response = {
      url: () => request.url(),
      status: () => 200,
      headers: () => ({ 'content-type': 'application/json' }),
      request: () => request,
      text: async () => '{"ok":true}',
    }
    handlers.response(response)
    const entries = await handle.flush()
    expect(entries).toHaveLength(1)
    await handle.stop()
    expect(context.close).not.toHaveBeenCalled()
    expect(context.off).toHaveBeenCalledWith('response', expect.any(Function))
  })

  it('captures ALL traffic (no domain hard-drop) — origin is decided later at graph ingest', async () => {
    const { stagehand, handlers } = createMockStagehand()

    const handle = attachHarCaptureViaCdp(stagehand, {})
    await handle.ready
    handlers['Network.requestWillBeSent']({ requestId: 'a', timestamp: 1, request: { url: 'http://localhost:52236/oast', method: 'GET', headers: {} } })
    handlers['Network.responseReceived']({ requestId: 'a', timestamp: 2, response: { url: 'http://localhost:52236/oast', status: 200, mimeType: 'text/plain', headers: {} } })
    handlers['Network.loadingFinished']({ requestId: 'a', timestamp: 3 })
    handlers['Network.requestWillBeSent']({ requestId: 'b', timestamp: 1, request: { url: 'https://app.test/keep', method: 'GET', headers: {} } })
    handlers['Network.responseReceived']({ requestId: 'b', timestamp: 2, response: { url: 'https://app.test/keep', status: 200, mimeType: 'text/plain', headers: {} } })
    handlers['Network.loadingFinished']({ requestId: 'b', timestamp: 3 })
    const entries = await handle.stop()
    expect(entries).toHaveLength(2)
    expect(entries.some((e) => e.request.url.includes('localhost:52236/oast'))).toBe(true)
    expect(entries.some((e) => e.request.url.includes('app.test/keep'))).toBe(true)
  })
})
