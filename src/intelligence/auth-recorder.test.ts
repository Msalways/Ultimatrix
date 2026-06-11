import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockStore = {
  addAuthFlow: vi.fn(),
  getAuthFlows: vi.fn(),
  save: vi.fn(),
}

vi.mock('../graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

describe('auth-recorder', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('detectLoginForm', () => {
    it('returns null when no password field in snapshot', async () => {
      const { detectLoginForm } = await import('./auth-recorder')
      const result = detectLoginForm('<html><input name="email" type="text" /></html>')
      expect(result).toBeNull()
    })

    it('detects login form with password field', async () => {
      const { detectLoginForm } = await import('./auth-recorder')
      const result = detectLoginForm('<html><input name="email" type="email" /><input name="password" type="password" /></html>')
      expect(result).not.toBeNull()
      expect(result!.emailField).toBe('email')
      expect(result!.passwordField).toBe('password')
      expect(result!.submitSelector).toContain('button[type="submit"]')
      expect(result!.formSelector).toBe('form')
    })

    it('detects login form with password text', async () => {
      const { detectLoginForm } = await import('./auth-recorder')
      const result = detectLoginForm('<html><input name="user_email" /><input name="user_password" type="password" /></html>')
      expect(result).not.toBeNull()
      expect(result!.emailField).toBe('user_email')
      expect(result!.passwordField).toBe('user_password')
    })

    it('falls back to default field names when only password is present', async () => {
      const { detectLoginForm } = await import('./auth-recorder')
      const result = detectLoginForm('<html><input type="password" /></html>')
      expect(result).not.toBeNull()
      expect(result!.emailField).toBe('email')
      expect(result!.passwordField).toBe('password')
    })
  })

  describe('createAuthFlow', () => {
    it('creates an auth flow and saves', async () => {
      const { createAuthFlow } = await import('./auth-recorder')
      const node = { id: 'flow-1', properties: { flowType: 'login' } }
      mockStore.addAuthFlow.mockReturnValue(node)

      const result = createAuthFlow('login', [
        { action: 'goto', url: '/login' },
        { action: 'fill', selector: '#email', value: 'user@test.com' },
      ], 'hash123')

      expect(result).toBe(node)
      expect(mockStore.addAuthFlow).toHaveBeenCalledWith({
        flowType: 'login',
        steps: [
          { action: 'goto', url: '/login' },
          { action: 'fill', selector: '#email', value: 'user@test.com' },
        ],
        reusable: true,
        credentialHash: 'hash123',
      })
      expect(mockStore.save).toHaveBeenCalled()
    })
  })

  describe('getReusableAuthFlow', () => {
    it('returns first reusable flow', async () => {
      const { getReusableAuthFlow } = await import('./auth-recorder')
      const flows = [
        { id: 'f1', properties: { reusable: false } },
        { id: 'f2', properties: { reusable: true } },
      ]
      mockStore.getAuthFlows.mockReturnValue(flows)

      const result = getReusableAuthFlow()
      expect(result?.id).toBe('f2')
    })

    it('returns null when no reusable flows', async () => {
      const { getReusableAuthFlow } = await import('./auth-recorder')
      mockStore.getAuthFlows.mockReturnValue([])
      expect(getReusableAuthFlow()).toBeNull()
    })
  })

  describe('replayAuthFlow', () => {
    it('replays each step using executeStep', async () => {
      const { replayAuthFlow } = await import('./auth-recorder')
      const steps = [
        { action: 'goto', url: '/login' },
        { action: 'fill', selector: '#email', value: 'user' },
      ]
      mockStore.getAuthFlows.mockReturnValue([
        { id: 'flow-1', properties: { steps, reusable: true } },
      ])

      const executeStep = vi.fn().mockResolvedValue(undefined)
      await replayAuthFlow('flow-1', executeStep)

      expect(executeStep).toHaveBeenCalledTimes(2)
      expect(executeStep).toHaveBeenCalledWith(steps[0])
      expect(executeStep).toHaveBeenCalledWith(steps[1])
    })

    it('throws when flow not found', async () => {
      const { replayAuthFlow } = await import('./auth-recorder')
      mockStore.getAuthFlows.mockReturnValue([])

      await expect(replayAuthFlow('nonexistent', vi.fn())).rejects.toThrow('not found')
    })
  })

    describe('detectLogoutFlow', () => {
    it('returns null when no logout in snapshot', async () => {
      const { detectLogoutFlow } = await import('./auth-recorder')
      const result = detectLogoutFlow('<html><a href="/home">Home</a></html>')
      expect(result).toBeNull()
    })

    it('detects logout link by text', async () => {
      const { detectLogoutFlow } = await import('./auth-recorder')
      const result = detectLogoutFlow('<html><a href="/logout">Sign Out</a></html>')
      expect(result).not.toBeNull()
      expect(result!.buttonText).toMatch(/sign.*out/i)
    })

    it('detects logout by href', async () => {
      const { detectLogoutFlow } = await import('./auth-recorder')
      const result = detectLogoutFlow('<html><a href="/custom/logout">Click</a></html>')
      expect(result).not.toBeNull()
      expect(result!.logoutSelector).toContain('logout')
    })
  })

  describe('detectTokenRefreshFlow', () => {
    it('returns null when no refresh token in snapshot', async () => {
      const { detectTokenRefreshFlow } = await import('./auth-recorder')
      const result = detectTokenRefreshFlow('<html>no tokens here</html>')
      expect(result).toBeNull()
    })

    it('detects refresh token in HTML text', async () => {
      const { detectTokenRefreshFlow } = await import('./auth-recorder')
      const result = detectTokenRefreshFlow('<html><div>refresh_token stored</div></html>')
      expect(result).not.toBeNull()
      expect(result!.refreshUrl).toBe('/auth/refresh')
    })

    it('detects refresh token in script tag', async () => {
      const { detectTokenRefreshFlow } = await import('./auth-recorder')
      const result = detectTokenRefreshFlow('<html><script>const rt = "refreshToken"</script></html>')
      expect(result).not.toBeNull()
    })
  })

  describe('isAuthExpired', () => {
    it('returns true for 401', async () => {
      const { isAuthExpired } = await import('./auth-recorder')
      expect(isAuthExpired(401)).toBe(true)
    })

    it('returns true for 403', async () => {
      const { isAuthExpired } = await import('./auth-recorder')
      expect(isAuthExpired(403)).toBe(true)
    })

    it('returns false for other statuses', async () => {
      const { isAuthExpired } = await import('./auth-recorder')
      expect(isAuthExpired(200)).toBe(false)
      expect(isAuthExpired(500)).toBe(false)
    })
  })
})
