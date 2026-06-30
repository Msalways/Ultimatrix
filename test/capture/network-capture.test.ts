import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NetworkCapture } from '../../src/capture/network-capture'

function createMockPage() {
  const handlers: Record<string, Function> = {}
  return {
    on: vi.fn((event: string, handler: Function) => {
      handlers[event] = handler
    }),
    _trigger: (event: string, ...args: any[]) => {
      handlers[event]?.(...args)
    },
    _handlers: handlers,
  }
}

function createMockResponse(overrides: Record<string, any> = {}) {
  const requestHeadersObj = overrides.requestHeaders || { 'host': 'api.example.com' }
  const responseHeadersObj = overrides.responseHeaders || { 'content-type': 'application/json' }

  const requestObj = {
    url: () => overrides.url || 'https://api.example.com/data',
    method: () => overrides.method || 'GET',
    postData: () => overrides.postData || undefined,
    headers: () => requestHeadersObj,
    timing: () => ({
      startTime: 0,
      requestStart: 0,
      responseEnd: 100,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      secureConnectionStart: 0,
    }),
  }

  return {
    status: () => overrides.status || 200,
    statusText: () => overrides.statusText || 'OK',
    headers: () => responseHeadersObj,
    body: () => Promise.resolve(Buffer.from(overrides.body || '{"ok":true}')),
    request: () => requestObj,
  }
}

describe('NetworkCapture', () => {
  let capture: NetworkCapture

  beforeEach(() => {
    capture = new NetworkCapture()
  })

  it('should start capturing', () => {
    const page = createMockPage() as any
    capture.start(page)
    expect(page.on).toHaveBeenCalledWith('response', expect.any(Function))
  })

  it('should capture response entries', async () => {
    const page = createMockPage() as any
    capture.start(page)

    const response = createMockResponse()
    
    // Capture the handler and call it directly
    const handler = page._handlers['response']
    expect(handler).toBeDefined()
    
    // Call and get the promise
    const result = handler(response)
    
    // If it returns a promise, await it
    if (result && typeof result.then === 'function') {
      await result
    }
    
    // Also await flush for any pending microtasks
    await capture.flush()

    const entries = capture.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0].response.status).toBe(200)
  })

  it('should stop capturing', () => {
    const page = createMockPage() as any
    capture.start(page)
    const entries = capture.stop()
    expect(entries).toHaveLength(0)
  })

  it('should export as HAR', async () => {
    const page = createMockPage() as any
    capture.start(page)

    const response = createMockResponse()
    page._trigger('response', response)
    await capture.flush()

    const har = capture.exportHar()
    expect(har.log.version).toBe('1.2')
    expect(har.log.entries).toHaveLength(1)
  })

  it('should filter by excludeDomains', async () => {
    const captureFiltered = new NetworkCapture({
      excludeDomains: ['blocked.example.com'],
    })
    const page = createMockPage() as any
    captureFiltered.start(page)

    const response = createMockResponse({ url: 'https://blocked.example.com/data' })
    page._trigger('response', response)
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(captureFiltered.getEntries()).toHaveLength(0)
  })

  it('should filter by includeDomains', async () => {
    const captureFiltered = new NetworkCapture({
      includeDomains: ['api.example.com'],
    })
    const page = createMockPage() as any
    captureFiltered.start(page)

    const response1 = createMockResponse({ url: 'https://api.example.com/data' })
    const response2 = createMockResponse({ url: 'https://other.com/data' })
    page._trigger('response', response1)
    page._trigger('response', response2)
    await captureFiltered.flush()

    expect(captureFiltered.getEntries()).toHaveLength(1)
  })

  it('should not double-attach same page', () => {
    const page = createMockPage() as any
    capture.start(page)
    capture.start(page)
    expect(page.on).toHaveBeenCalledTimes(1)
  })

  it('should clear entries', async () => {
    const page = createMockPage() as any
    capture.start(page)

    const response = createMockResponse()
    page._trigger('response', response)
    await capture.flush()

    expect(capture.getEntries()).toHaveLength(1)
    capture.clear()
    expect(capture.getEntries()).toHaveLength(0)
  })
})
