import { afterEach, describe, expect, it } from 'vitest'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'
import { setAllowAny, setScopeConfig } from '../../src/safety/scope-guard'
import { shadowApiDiscovery } from '../../src/tools/shadow-discovery'

describe('shadowApiDiscovery', () => {
  const captures = getCapturedRequestStore()

  afterEach(() => {
    captures.clear()
    setScopeConfig(null)
    setAllowAny(true)
  })

  it('mines same-origin routes from captured client code and keeps capture provenance', async () => {
    setAllowAny(true)
    const capture = captures.record({
      method: 'GET',
      url: 'http://127.0.0.1:3000/main.js',
      status: 200,
      responseHeaders: { 'content-type': 'application/javascript' },
      responseBody: "fetch('/rest/products/search?q='); axios.post('/rest/user/login', data)",
    })

    const result = await shadowApiDiscovery.execute({ baseUrl: 'http://127.0.0.1:3000' } as never)
    expect(result.ok).toBe(true)
    expect(result.endpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: '/rest/products/search?q=',
        source: `${capture.id}:/main.js:client-fetch`,
        inScope: true,
      }),
      expect.objectContaining({
        path: '/rest/user/login',
        source: `${capture.id}:/main.js:client-fetch`,
        inScope: true,
      }),
    ]))
  })

  it('does not emit guessed documentation paths when no target response supplied them', async () => {
    const result = await shadowApiDiscovery.execute({ baseUrl: 'http://127.0.0.1:3000' } as never)
    expect(result.ok).toBe(true)
    expect(result.endpoints).toEqual([])
  })
})
