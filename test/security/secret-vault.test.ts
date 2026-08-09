import { describe, expect, it } from 'vitest'
import { redactHarJson, redactSecret } from '../../src/security/secret-vault'

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
})
