import { describe, it, expect } from 'vitest'
import { createHarEntryBuilder } from '../../src/capture/har-parser'

/**
 * These tests prove the HAR builder assembles entries from the FULL CDP
 * `Network.*` event set — including the ExtraInfo events that carry cookies and
 * headers split across two CDP events. This is the make-or-break correctness
 * check: a hand-rolled subset that ignores ExtraInfo would silently drop
 * auth cookies/headers.
 */
describe('createHarEntryBuilder (full CDP event set)', () => {
  it('merges requestWillBeSentExtraInfo headers + cookies into the request', () => {
    const b = createHarEntryBuilder()
    b.onRequestWillBeSent({
      requestId: '1',
      timestamp: 1,
      request: { url: 'https://app.test/api/login', method: 'POST', headers: { 'content-type': 'application/json' }, postData: '{"u":"a"}' },
    })
    b.onRequestWillBeSentExtraInfo({
      requestId: '1',
      headers: { 'x-request-id': 'abc' },
      cookies: [{ name: 'session', value: 'xyz' }],
    })
    b.onResponseReceived({
      requestId: '1',
      timestamp: 2,
      response: { url: 'https://app.test/api/login', status: 200, headers: { 'content-type': 'application/json' }, mimeType: 'application/json' },
    })
    b.onResponseReceivedExtraInfo({
      requestId: '1',
      headers: { 'set-cookie-shadow': 'no' },
      cookies: [{ name: 'auth', value: 'tok' }],
    })
    b.onLoadingFinished({ requestId: '1', timestamp: 3, encodedDataLength: 10 })

    const entries = b.takeCompleted()
    expect(entries).toHaveLength(1)
    const e = entries[0]
    const reqHeaderNames = e.request.headers.map((h) => h.name)
    expect(reqHeaderNames).toContain('content-type')
    expect(reqHeaderNames).toContain('x-request-id')
    expect(e.request.cookies).toContainEqual({ name: 'session', value: 'xyz' })
    const respHeaderNames = e.response.headers.map((h) => h.name)
    expect(respHeaderNames).toContain('content-type')
    expect(respHeaderNames).toContain('set-cookie-shadow')
    expect(e.response.cookies).toContainEqual({ name: 'auth', value: 'tok' })
  })

  it('attaches a fetched response body via setResponseBody', () => {
    const b = createHarEntryBuilder()
    b.onRequestWillBeSent({ requestId: '2', timestamp: 1, request: { url: 'https://app.test/x', method: 'GET' } })
    b.onResponseReceived({ requestId: '2', timestamp: 2, response: { url: 'https://app.test/x', status: 200, mimeType: 'text/html' } })
    b.setResponseBody('2', '<html>ok</html>')
    b.onLoadingFinished({ requestId: '2', timestamp: 3 })
    const [e] = b.takeCompleted()
    expect(e.response.content.text).toBe('<html>ok</html>')
    expect(e.response.content.mimeType).toBe('text/html')
  })

  it('attaches a fetched request body via setRequestBody', () => {
    const b = createHarEntryBuilder()
    b.onRequestWillBeSent({ requestId: '3', timestamp: 1, request: { url: 'https://app.test/y', method: 'POST' } })
    b.onResponseReceived({ requestId: '3', timestamp: 2, response: { url: 'https://app.test/y', status: 201, mimeType: 'application/json' } })
    b.setRequestBody('3', 'field=value')
    b.onLoadingFinished({ requestId: '3', timestamp: 3 })
    const [e] = b.takeCompleted()
    expect(e.request.postData?.text).toBe('field=value')
  })

  it('does not finalize until both request and response are present', () => {
    const b = createHarEntryBuilder()
    b.onRequestWillBeSent({ requestId: '4', timestamp: 1, request: { url: 'https://app.test/z', method: 'GET' } })
    b.onLoadingFinished({ requestId: '4', timestamp: 2 })
    expect(b.takeCompleted()).toHaveLength(0)
    b.onResponseReceived({ requestId: '4', timestamp: 3, response: { url: 'https://app.test/z', status: 200, mimeType: 'text/plain' } })
    b.onLoadingFinished({ requestId: '4', timestamp: 4 })
    expect(b.takeCompleted()).toHaveLength(1)
  })

  it('parses query string from the request URL', () => {
    const b = createHarEntryBuilder()
    b.onRequestWillBeSent({ requestId: '5', timestamp: 1, request: { url: 'https://app.test/s?q=1&r=2', method: 'GET' } })
    b.onResponseReceived({ requestId: '5', timestamp: 2, response: { url: 'https://app.test/s', status: 200, mimeType: 'text/plain' } })
    b.onLoadingFinished({ requestId: '5', timestamp: 3 })
    const [e] = b.takeCompleted()
    expect(e.request.queryString).toEqual([{ name: 'q', value: '1' }, { name: 'r', value: '2' }])
  })
})
