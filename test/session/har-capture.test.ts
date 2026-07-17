import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attachHarCaptureViaCdp } from '../../src/session/cdp-network-capture'

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

  it('attaches to the live CDP connection and enables Network', () => {
    const { stagehand, conn, sent } = createMockStagehand()
    
    const handle = attachHarCaptureViaCdp(stagehand, {})
    expect(handle.attached).toBe(true)
    expect(conn.on).toHaveBeenCalledWith('Network.requestWillBeSent', expect.any(Function))
    expect(conn.on).toHaveBeenCalledWith('Network.responseReceived', expect.any(Function))
    expect(conn.on).toHaveBeenCalledWith('Network.loadingFinished', expect.any(Function))
    expect(sent.some((s) => s.method === 'Network.enable')).toBe(true)
  })

  it('returns attached:false when no CDP connection exists', () => {
    
    const handle = attachHarCaptureViaCdp({ context: {} } as any, {})
    expect(handle.attached).toBe(false)
  })

  it('captures a full request/response pair into a HAR entry', async () => {
    const { stagehand, handlers } = createMockStagehand()
    
    const handle = attachHarCaptureViaCdp(stagehand, {})
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

  it('captures ALL traffic (no domain hard-drop) — origin is decided later at graph ingest', async () => {
    const { stagehand, handlers } = createMockStagehand()

    const handle = attachHarCaptureViaCdp(stagehand, {})
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
