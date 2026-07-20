import { describe, it, expect, afterEach } from 'vitest'
import { mineJsEndpoints, mineJsBodies, type JsEndpointCandidate } from '../../src/capture/js-miner'
import { setScopeConfig, setAllowAny } from '../../src/safety/scope-guard'

describe('js-miner', () => {
  afterEach(() => {
    setScopeConfig(null)
    setAllowAny(true) // restore global test default
  })

  it('extracts fetch call sites with relative + absolute urls', () => {
    const body = `
      const r = await fetch('/api/users/' + id)
      fetch(\`/api/v2/items/\${itemId}\`)
      axios.post('https://api.t.example/orders', payload)
      $.get('/legacy/report')
    `
    const out = mineJsEndpoints(body, 'https://t.example')
    const urls = out.map((c) => c.url).filter(Boolean)
    expect(urls.some((u) => u?.includes('/api/users/'))).toBe(true)
    expect(urls.some((u) => u?.includes('/api/v2/items/'))).toBe(true)
    expect(urls.some((u) => u?.includes('/orders'))).toBe(true)
  })

  it('captures method from axios verbs and xhr open()', () => {
    const body = `axios.post('https://api.t.example/x'); xhr.open('DELETE','/y');`
    const out = mineJsEndpoints(body)
    const post = out.find((c) => c.url?.includes('/x'))
    const del = out.find((c) => c.raw.includes('/y'))
    expect(post?.method).toBe('POST')
    expect(del?.method).toBe('DELETE')
    expect(del?.source).toBe('xhr')
  })

  it('marks in-scope vs out-of-scope tokens', () => {
    setAllowAny(false)
    setScopeConfig({ allowedDomains: ['in.example'], enforcement: 'hard' })
    const body = `fetch('https://in.example/a'); fetch('https://out.example/b')`
    const out = mineJsEndpoints(body)
    const inScope = out.find((c) => c.url?.includes('in.example'))
    const outScope = out.find((c) => c.url?.includes('out.example'))
    expect(inScope?.inScope).toBe(true)
    expect(outScope?.inScope).toBe(false)
  })

  it('extracts templated params', () => {
    const body = `fetch(\`/api/accounts/\${acctId}\`)`
    const out = mineJsEndpoints(body, 'https://t.example')
    const c: JsEndpointCandidate | undefined = out.find((x) => x.url?.includes('/accounts/'))
    expect(c?.params.length).toBeGreaterThan(0)
    expect(c?.params).toContain('acctId')
  })

  it('dedupes across bodies by url', () => {
    const bodies = [
      { body: "fetch('/api/dup')", baseUrl: 'https://t.example' },
      { body: "axios.get('https://t.example/api/dup')", baseUrl: 'https://t.example' },
    ]
    const out = mineJsBodies(bodies)
    const dupes = out.filter((c) => c.url?.includes('/api/dup'))
    expect(dupes.length).toBe(1)
  })

  it('returns empty for empty body', () => {
    expect(mineJsEndpoints('')).toEqual([])
  })
})
