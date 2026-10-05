import { describe, expect, it } from 'vitest'
import { formatRequestApproval } from '../../src/tools/http-tools'

describe('state-changing HTTP approval details', () => {
  it('shows the action and redacts secrets from the URL, headers, and JSON body', () => {
    const summary = formatRequestApproval({
      method: 'post',
      url: 'https://user:pass@example.test/api/redeem?ticket=reset-secret&item=42',
      headers: {
        Authorization: 'Bearer very-secret-token-value',
        'Content-Type': 'application/json',
        'X-Region': 'west',
      },
      body: JSON.stringify({ offer: 'WELCOME-123', password: 'private-password', profile: { sessionId: 'session-secret' } }),
      sessionRef: 'member@example.test',
    })

    expect(summary).toContain('Method: POST')
    expect(summary).toContain('https://example.test/api/redeem?ticket=%3Credacted%3E&item=42')
    expect(summary).toContain('"X-Region":"west"')
    expect(summary).toContain('Session: member@example.test')
    expect(summary).toContain('"offer": "WELCOME-123"')
    expect(summary).toContain('"password": "<redacted>"')
    expect(summary).not.toContain('very-secret-token-value')
    expect(summary).not.toContain('reset-secret')
    expect(summary).not.toContain('private-password')
    expect(summary).not.toContain('session-secret')
    expect(summary).not.toContain('user:pass')
  })

  it('shows form inputs while hiding recovery tickets and credentials', () => {
    const summary = formatRequestApproval({
      method: 'POST',
      url: 'https://example.test/recover',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'email=member%40example.test&verification_code=482913&password=secret',
    })

    expect(summary).toContain('email=member@example.test')
    expect(summary).toContain('verification_code=<redacted>')
    expect(summary).toContain('password=<redacted>')
    expect(summary).not.toContain('482913')
    expect(summary).not.toContain('password=secret')
  })

  it('redacts sensitive assignments in plain-text bodies', () => {
    const summary = formatRequestApproval({
      method: 'PATCH',
      url: 'https://example.test/profile',
      headers: { 'content-type': 'text/plain' },
      body: 'user=member; password=private; note=change email',
    })

    expect(summary).toContain('user=member')
    expect(summary).toContain('password=<redacted>')
    expect(summary).toContain('note=change')
    expect(summary).not.toContain('password=private')
  })
})
