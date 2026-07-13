import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/skills/technique-registry', () => ({
  getTechniqueRegistry: vi.fn().mockReturnValue({
    getSensitiveFields: vi.fn().mockReturnValue(['password', 'token', 'secret', 'auth', 'credential']),
    getLoginUrlPatterns: vi.fn().mockReturnValue(['/login', '/signin', '/auth']),
  }),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), dim: vi.fn() },
}))

let AuthStateDetector: typeof import('../../src/capture/human-observer').AuthStateDetector

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../../src/capture/human-observer')
  AuthStateDetector = mod.AuthStateDetector
})

function makePage(result: {
  hasPasswordField?: boolean
  formCount?: number
  hasLoginForm?: boolean
  loginEndpoint?: string
  oauthProviders?: string[]
  hasRememberMe?: boolean
} = {}) {
  return {
    url: vi.fn().mockReturnValue('https://example.com/page'),
    evaluate: vi.fn().mockResolvedValue({
      hasPasswordField: result.hasPasswordField ?? false,
      formCount: result.formCount ?? 0,
      hasLoginForm: result.hasLoginForm ?? false,
      loginEndpoint: result.loginEndpoint,
      oauthProviders: result.oauthProviders ?? [],
      hasRememberMe: result.hasRememberMe ?? false,
    }),
  }
}

describe('AuthStateDetector', () => {
  it('detects login forms with password inputs', async () => {
    const detector = new AuthStateDetector()
    const page = makePage({
      hasPasswordField: true,
      formCount: 1,
      hasLoginForm: true,
      loginEndpoint: 'https://example.com/login',
    })

    const state = await detector.detectAuthState(page as any)
    expect(state.hasLoginForm).toBe(true)
    expect(state.authType).toBe('form')
    expect(state.hasPasswordField).toBe(true)
    expect(state.loginEndpoint).toBe('https://example.com/login')
  })

  it('detects OAuth buttons on page', async () => {
    const detector = new AuthStateDetector()
    const page = makePage({
      hasLoginForm: true,
      oauthProviders: ['Google', 'GitHub', 'Microsoft'],
    })

    const state = await detector.detectAuthState(page as any)
    expect(state.authType).toBe('oauth')
    expect(state.oauthProviders).toContain('Google')
    expect(state.oauthProviders).toContain('GitHub')
    expect(state.oauthProviders).toContain('Microsoft')
  })

  it('returns unknown for normal pages without auth indicators', async () => {
    const detector = new AuthStateDetector()
    const page = makePage()

    const state = await detector.detectAuthState(page as any)
    expect(state.hasLoginForm).toBe(false)
    expect(state.authType).toBe('unknown')
    expect(state.hasPasswordField).toBe(false)
    expect(state.oauthProviders).toEqual([])
    expect(state.hasRememberMe).toBe(false)
  })

  it('detects remember-me checkbox', async () => {
    const detector = new AuthStateDetector()
    const page = makePage({
      hasLoginForm: true,
      hasPasswordField: true,
      hasRememberMe: true,
    })

    const state = await detector.detectAuthState(page as any)
    expect(state.hasRememberMe).toBe(true)
    expect(state.authType).toBe('form')
  })

  it('returns default state when page evaluation fails', async () => {
    const detector = new AuthStateDetector()
    const page = {
      evaluate: vi.fn().mockRejectedValue(new Error('page crashed')),
      url: vi.fn().mockReturnValue('https://example.com'),
    }

    const state = await detector.detectAuthState(page as any)
    expect(state.hasLoginForm).toBe(false)
    expect(state.authType).toBe('unknown')
  })

  it('tracks state changes across multiple detections', async () => {
    const detector = new AuthStateDetector()
    const callback = vi.fn()
    detector.onStateChange(callback)

    const page1 = makePage({ hasLoginForm: false })
    await detector.detectAuthState(page1 as any)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(null, expect.objectContaining({ hasLoginForm: false }))

    const page2 = makePage({ hasLoginForm: true, hasPasswordField: true })
    await detector.detectAuthState(page2 as any)
    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({ hasLoginForm: false }),
      expect.objectContaining({ hasLoginForm: true }),
    )
  })

  it('does not fire callback when state has not changed', async () => {
    const detector = new AuthStateDetector()
    const callback = vi.fn()
    detector.onStateChange(callback)

    const page = makePage({ hasLoginForm: false })
    await detector.detectAuthState(page as any)
    await detector.detectAuthState(page as any)
    await detector.detectAuthState(page as any)
    // First call fires (null → initial), subsequent calls with same state do not
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('clear resets internal state', async () => {
    const detector = new AuthStateDetector()
    const page = makePage({ hasLoginForm: true, hasPasswordField: true })
    await detector.detectAuthState(page as any)
    expect(detector.getLastState()).not.toBeNull()

    detector.clear()
    expect(detector.getLastState()).toBeNull()
  })

  it('counts forms on the page', async () => {
    const detector = new AuthStateDetector()
    const page = makePage({ formCount: 3 })
    const state = await detector.detectAuthState(page as any)
    expect(state.formCount).toBe(3)
  })
})
