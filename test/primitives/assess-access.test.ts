import { describe, it, expect } from 'vitest'
import { assessAccess } from '../../src/primitives/framework'

// These tests prove the anti-rigidity principle: keyword substring lists are a
// SECONDARY signal only. A custom/non-English application is still assessed
// correctly from observable HTTP behavior (status class, session cookie,
// redirect-to-login). No test below relies on the literal English markers.

describe('assessAccess — behavioral, status-authoritative', () => {
  it('grants on a 2xx state-changing response even with a custom localized body', () => {
    const a = assessAccess({ status: 200, body: 'Commande validée avec succès', grantsOn2xx: true })
    expect(a.granted).toBe(true)
    expect(a.denied).toBe(false)
    expect(a.signals).toContain('status-granted-200')
  })

  it('does NOT grant on a bare 2xx when grantsOn2xx is false (auth login semantics)', () => {
    const a = assessAccess({ status: 200, body: '', grantsOn2xx: false })
    expect(a.granted).toBe(false)
    expect(a.denied).toBe(false)
  })

  it('grants on a session cookie even with a non-English body', () => {
    const a = assessAccess({ status: 200, body: 'Connexion réussie', setCookie: 'session=abc123', grantsOn2xx: false })
    expect(a.granted).toBe(true)
    expect(a.signals).toContain('session-cookie')
  })

  it('denies on 403 with a custom non-English denial page (no English marker needed)', () => {
    const a = assessAccess({ status: 403, body: 'Zugriff verweigert. Bitte einloggen.' })
    expect(a.denied).toBe(true)
    expect(a.granted).toBe(false)
    expect(a.signals).toContain('status-denied-403')
  })

  it('denies a 3xx redirect-to-login even though status is "success class"', () => {
    const a = assessAccess({ status: 302, body: 'Please log in to continue', grantsOn2xx: true })
    expect(a.denied).toBe(true)
    expect(a.granted).toBe(false)
    expect(a.signals).toContain('redirect-to-login')
  })

  it('treats 401 as a strong denial regardless of body content', () => {
    const a = assessAccess({ status: 401, body: '{"error":"unauthorized"}' })
    expect(a.denied).toBe(true)
    expect(a.granted).toBe(false)
  })

  it('keyword markers remain a usable secondary signal', () => {
    const granted = assessAccess({ status: 200, body: 'welcome to your dashboard', successMarkers: ['welcome', 'dashboard', 'logout'], grantsOn2xx: false })
    expect(granted.granted).toBe(true)
    const denied = assessAccess({ status: 200, body: 'access denied', denyMarkers: ['unauthorized', 'forbidden', 'denied'], grantsOn2xx: false })
    expect(denied.denied).toBe(true)
  })

  it('on conflict (text says both) status wins', () => {
    const a = assessAccess({ status: 403, body: 'welcome dashboard', successMarkers: ['welcome', 'dashboard', 'logout'], grantsOn2xx: false })
    expect(a.denied).toBe(true)
    expect(a.granted).toBe(false)
    expect(a.signals).toContain('conflict-status-wins')
  })
})
