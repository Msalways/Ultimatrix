import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  addNode: vi.fn().mockImplementation((type: string, props: any) => ({
    id: `${type}-${Date.now()}`,
    type,
    properties: props,
  })),
  queryNodes: vi.fn().mockReturnValue([]),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

const mockWorkspace = {
  getCurrentTarget: vi.fn().mockReturnValue('https://example.com'),
  getTargetDir: vi.fn().mockReturnValue('/tmp/test'),
}

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => mockWorkspace,
}))

const mockPage = {
  url: vi.fn().mockReturnValue('https://example.com/page'),
  title: vi.fn().mockResolvedValue('Test Page'),
  evaluate: vi.fn().mockResolvedValue({ token: 'abc' }),
  goto: vi.fn().mockResolvedValue(undefined),
  fill: vi.fn().mockResolvedValue(undefined),
  click: vi.fn().mockResolvedValue(undefined),
  selectOption: vi.fn().mockResolvedValue(undefined),
  press: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue(undefined),
}

const mockStagehand = {
  context: {
    cookies: vi.fn().mockResolvedValue([
      { name: 'session', value: 'abc123', domain: 'example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: 9999999999 },
    ]),
    addCookies: vi.fn().mockResolvedValue(undefined),
  },
}

const mockBrowser = {
  requireStagehand: vi.fn().mockReturnValue(mockStagehand),
}

vi.mock('../../src/browser/manager', () => ({
  getActiveBrowser: () => mockBrowser,
  getActivePage: () => mockPage,
  captureScreenshot: vi.fn().mockResolvedValue('/tmp/screenshot.png'),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { error: vi.fn(), dim: vi.fn() },
}))

vi.mock('../../src/capture/human-observer', () => {
  const actions = [
    { type: 'fill', selector: '#user', value: 'admin', url: 'https://example.com/login', timestamp: Date.now() - 100 },
    { type: 'click', selector: '#submit', url: 'https://example.com/login', timestamp: Date.now() },
  ]
  const flows = [
    {
      type: 'login',
      actions,
      startUrl: 'https://example.com/login',
      endUrl: 'https://example.com/login',
      duration: 100,
    },
  ]
  const mockObserver = {
    getActions: vi.fn().mockReturnValue(actions),
    getRecentActions: vi.fn().mockReturnValue(actions),
    getFlowGroups: vi.fn().mockReturnValue(flows),
    startSnapshot: vi.fn(),
    getActionsSinceSnapshot: vi.fn().mockReturnValue(actions),
  }
  return {
    getGlobalObserver: () => mockObserver,
  }
})

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('flow-tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.queryNodes.mockReturnValue([])
  })

  describe('saveSession', () => {
    it('saves session with cookies and localStorage to graph', async () => {
      const { saveSession } = await import('../../src/tools/flow-tools')
      const result = await callTool(saveSession, {
        name: 'admin-login',
        description: 'Admin session',
      })

      expect(result.ok).toBe(true)
      expect(result.value.name).toBe('admin-login')
      expect(result.value.cookieCount).toBe(1)
      expect(result.value.localStorageKeys).toBe(1) // { token: 'abc' }
      expect(mockStore.addNode).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          name: 'admin-login',
          cookies: expect.arrayContaining([
            expect.objectContaining({ name: 'session', value: 'abc123' }),
          ]),
          localStorage: { token: 'abc' },
          credentialHash: expect.any(String),
        })
      )
    })

    it('adds fact node for session', async () => {
      const { saveSession } = await import('../../src/tools/flow-tools')
      await callTool(saveSession, { name: 'test-session' })

      expect(mockStore.addNode).toHaveBeenCalledWith(
        'Fact',
        expect.objectContaining({
          description: expect.stringContaining('test-session'),
          source: 'human-demonstration',
        })
      )
    })

  })

  describe('restoreSession', () => {
    it('restores session by setting cookies and localStorage', async () => {
      mockStore.queryNodes.mockReturnValue([{
        id: 'auth-1',
        type: 'AuthFlow',
        properties: {
          name: 'admin-login',
          target: 'https://example.com',
          cookies: [{ name: 'session', value: 'abc123', domain: 'example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: 9999999999 }],
          localStorage: { token: 'xyz' },
          savedAt: '2026-01-01T00:00:00Z',
        },
      }])

      const { restoreSession } = await import('../../src/tools/flow-tools')
      const result = await callTool(restoreSession, { name: 'admin-login' })

      expect(result.ok).toBe(true)
      expect(result.value.cookieCount).toBe(1)
      expect(result.value.localStorageKeys).toBe(1)
      expect(mockStagehand.context.addCookies).toHaveBeenCalled()
      expect(mockPage.evaluate).toHaveBeenCalled()
    })

    it('returns error when session not found', async () => {
      mockStore.queryNodes.mockReturnValue([])
      const { restoreSession } = await import('../../src/tools/flow-tools')
      const result = await callTool(restoreSession, { name: 'nonexistent' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

  })

  describe('observeHumanActions', () => {
    it('returns all actions by default', async () => {
      const { observeHumanActions } = await import('../../src/tools/flow-tools')
      const result = await callTool(observeHumanActions, {})

      expect(result.ok).toBe(true)
      expect(result.value.actionCount).toBe(2)
      expect(result.value.actions[0].type).toBe('fill')
    })

    it('returns flow groups when flowOnly is true', async () => {
      const { observeHumanActions } = await import('../../src/tools/flow-tools')
      const result = await callTool(observeHumanActions, { flowOnly: true })

      expect(result.ok).toBe(true)
      expect(result.value.flowCount).toBe(1)
      expect(result.value.flows[0].type).toBe('login')
    })
  })

  describe('saveLearnedFlow', () => {
    it('saves flow actions to graph', async () => {
      const { saveLearnedFlow } = await import('../../src/tools/flow-tools')
      const result = await callTool(saveLearnedFlow, {
        name: 'checkout',
        flowType: 'form-fill',
        actions: [
          { type: 'fill', selector: '#card', value: '4111111111111111', url: 'https://example.com/checkout' },
          { type: 'click', selector: '#pay', url: 'https://example.com/checkout' },
        ],
      })

      expect(result.ok).toBe(true)
      expect(result.value.name).toBe('checkout')
      expect(result.value.flowType).toBe('form-fill')
      expect(result.value.actionCount).toBe(2)

      // Should create individual ActionNodes
      const actionCalls = mockStore.addNode.mock.calls.filter(c => c[0] === 'Action')
      expect(actionCalls).toHaveLength(2)
    })

    it('creates AuthFlow node with actionNodeIds', async () => {
      const { saveLearnedFlow } = await import('../../src/tools/flow-tools')
      await callTool(saveLearnedFlow, {
        name: 'test-flow',
        flowType: 'navigation',
        actions: [{ type: 'navigate', url: 'https://example.com' }],
      })

      expect(mockStore.addNode).toHaveBeenCalledWith(
        'AuthFlow',
        expect.objectContaining({
          actionNodeIds: expect.any(Array),
          flowType: 'navigation',
        })
      )
    })
  })

  describe('reproduceFlow', () => {
    it('uses session-restore for login flows with cookies', async () => {
      mockStore.queryNodes.mockReturnValue([{
        id: 'auth-1',
        type: 'AuthFlow',
        properties: {
          name: 'admin-login',
          flowType: 'login',
          target: 'https://example.com',
          cookies: [{ name: 'session', value: 'abc123', domain: 'example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax', expires: 9999999999 }],
          steps: [{ action: 'navigate', url: 'https://example.com/dashboard' }],
        },
      }])

      const { reproduceFlow } = await import('../../src/tools/flow-tools')
      const result = await callTool(reproduceFlow, { flowName: 'admin-login' })

      expect(result.ok).toBe(true)
      expect(result.value.method).toBe('session-restore')
      expect(result.value.cookiesSet).toBe(1)
    })

    it('uses form-replay for non-login flows', async () => {
      mockStore.queryNodes.mockReturnValue([{
        id: 'auth-1',
        type: 'AuthFlow',
        properties: {
          name: 'checkout',
          flowType: 'form-fill',
          target: 'https://example.com',
          steps: [
            { action: 'navigate', url: 'https://example.com/checkout' },
            { action: 'fill', selector: '#card', value: '4111111111111111' },
            { action: 'click', selector: '#pay' },
          ],
        },
      }])

      const { reproduceFlow } = await import('../../src/tools/flow-tools')
      const result = await callTool(reproduceFlow, { flowName: 'checkout' })

      expect(result.ok).toBe(true)
      expect(result.value.method).toBe('form-replay')
      expect(result.value.stepsExecuted).toBe(3)
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com/checkout', expect.any(Object))
      expect(mockPage.fill).toHaveBeenCalledWith('#card', '4111111111111111')
      expect(mockPage.click).toHaveBeenCalledWith('#pay')
    })

    it('returns error when flow not found', async () => {
      mockStore.queryNodes.mockReturnValue([])
      const { reproduceFlow } = await import('../../src/tools/flow-tools')
      const result = await callTool(reproduceFlow, { flowName: 'nonexistent' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('handles select and submit actions', async () => {
      mockStore.queryNodes.mockReturnValue([{
        id: 'auth-1',
        type: 'AuthFlow',
        properties: {
          name: 'form',
          flowType: 'form-fill',
          target: 'https://example.com',
          steps: [
            { action: 'select', selector: '#country', value: 'US' },
            { action: 'submit', selector: '#form' },
          ],
        },
      }])

      const { reproduceFlow } = await import('../../src/tools/flow-tools')
      const result = await callTool(reproduceFlow, { flowName: 'form' })

      expect(result.ok).toBe(true)
      expect(result.value.method).toBe('form-replay')
      expect(mockPage.selectOption).toHaveBeenCalledWith('#country', 'US')
      expect(mockPage.press).toHaveBeenCalledWith('#form', 'Enter')
    })
  })
})
