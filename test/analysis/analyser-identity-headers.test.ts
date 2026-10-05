import { describe, expect, it } from 'vitest'
import { classifyHeaders } from '../../src/analysis/analyser'

describe('classifyHeaders actor identity', () => {
  it('learns custom session headers as identity headers', () => {
    const [header] = classifyHeaders([{
      method: 'GET',
      url: 'https://app.example.test/api/profile',
      host: 'app.example.test',
      path: '/api/profile',
      headers: { 'X-Session-ID': 'owner-session-value' },
      cookies: {},
      params: [],
      authType: null,
    }])

    expect(header.properties.role).toBe('identity')
    expect(header.properties.header).toBe('X-Session-ID')
  })
})
