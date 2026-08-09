import { describe, expect, it } from 'vitest'
import {
  redactArtifactMetadata,
  redactHarJson,
  redactHeaders,
  redactObject,
  redactSecret,
  redactString,
  redactUrl,
  redactValue,
} from '../../src/security/secret-vault'

describe('secret vault redaction', () => {
  it('masks secret values while preserving enough shape for analysis', () => {
    expect(redactSecret('Bearer abcdefghijklmnop')).toBe('Bear************')
  })

  it('redacts HAR header, cookie, query, and body JWT values', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
    const redacted = redactHarJson(JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 't', version: '1' },
        entries: [{
          request: {
            method: 'GET',
            url: `https://example.com/api?token=secret123&jwt=${jwt}`,
            headers: [{ name: 'authorization', value: `Bearer ${jwt}` }],
            queryString: [{ name: 'token', value: 'secret123' }],
            cookies: [{ name: 'session', value: 'abcdef123456' }],
          },
          response: { headers: [], cookies: [], content: { text: `{"jwt":"${jwt}"}` } },
        }],
      },
    }))

    expect(redacted).not.toContain(jwt)
    expect(redacted).not.toContain('secret123')
    expect(redacted).toContain('****')
  })

  describe('normalized API', () => {
    it('redactValue equals redactSecret and handles short values', () => {
      expect(redactValue('abc')).toBe('****')
      expect(redactValue('')).toBe('<redacted>')
      expect(redactValue('super-secret-value')).toBe(redactSecret('super-secret-value'))
    })

    it('redactString strips JWT and Bearer/Basic tokens from prose', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
      const text = `login used Authorization: Bearer abcdefghijklmnop with refresh ${jwt}`
      const out = redactString(text)

      expect(out).not.toContain('abcdefghijklmnop')
      expect(out).not.toContain(jwt)
      expect(out).toContain('Bearer')
      expect(out).toContain('****')
    })

    it('redactHeaders redacts secret-named headers and JWT in any header', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
      const headers = {
        Authorization: `Bearer ${jwt}`,
        'X-Api-Key': 'sk-abcdefghijklmnop',
        'User-Agent': 'ultimatrix/1.0',
        'X-Request-Id': 'req-123',
      }
      const out = redactHeaders(headers)!

      expect(out.Authorization).not.toContain(jwt)
      expect(out['X-Api-Key']).toBe('sk-a' + '*'.repeat(12))
      expect(out['User-Agent']).toBe('ultimatrix/1.0')
      expect(out['X-Request-Id']).toBe('req-123')
    })

    it('redactHeaders handles undefined and never returns the same reference', () => {
      expect(redactHeaders(undefined)).toBeUndefined()
    })

    it('redactObject deep-redacts nested name/value pairs and urls', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
      const out = redactObject({
        url: 'https://example.com/api?apiKey=abcdef123456',
        cookies: [{ name: 'sid', value: 'abcdef123456' }],
        safe: { note: 'hello world' },
      }) as any

      expect(JSON.stringify(out)).not.toContain('abcdef123456')
      expect(JSON.stringify(out)).not.toContain(jwt)
      expect(out.safe.note).toBe('hello world')
    })

    it('redactArtifactMetadata redacts paths and contexts but keeps structure', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig'
      const out = redactArtifactMetadata({
        path: `/tmp/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOjF9.sig.png`,
        context: 'finding token',
        count: 3,
      }) as any

      expect(out.path).not.toContain(jwt)
      expect(out.count).toBe(3)
    })

    it('redactUrl redacts secret query params and leaves safe ones intact', () => {
      const out = redactUrl('https://example.com/api?token=secret123&page=2')
      expect(out).not.toContain('secret123')
      expect(out).toContain('page=2')
    })
  })
})
