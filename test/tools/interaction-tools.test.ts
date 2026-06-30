import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'events'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockPage = {
  url: vi.fn().mockReturnValue('https://example.com/login'),
  title: vi.fn().mockResolvedValue('Login Page'),
  screenshot: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/browser/manager', () => ({
  getActivePage: () => mockPage,
  captureScreenshot: vi.fn().mockResolvedValue('/tmp/screenshots/before.png'),
}))

const mockWorkspace = {
  getCurrentTarget: vi.fn().mockReturnValue('https://example.com'),
  getTargetDir: vi.fn().mockReturnValue('/tmp/test'),
}

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => mockWorkspace,
}))

vi.mock('../../src/utils/logger', () => ({
  log: { error: vi.fn(), dim: vi.fn() },
}))

const mockObserver = {
  startSnapshot: vi.fn(),
  getActionsSinceSnapshot: vi.fn().mockReturnValue([
    { type: 'click', selector: '#login-btn', url: 'https://example.com/login' },
    { type: 'fill', selector: '#username', value: 'admin', url: 'https://example.com/login' },
  ]),
}

vi.mock('../../src/capture/human-observer', () => ({
  getGlobalObserver: () => mockObserver,
}))

async function callTool(tool: any, args: any) {
  return tool.execute(args, {})
}

describe('interaction-tools', () => {
  let mockRl: any
  let askUser: any
  let setReadlineInterface: any

  beforeEach(async () => {
    vi.clearAllMocks()

    mockRl = new EventEmitter()
    mockRl.once = vi.fn((event: string, cb: Function) => {
      mockRl.on(event, cb)
    })
    mockRl.removeListener = vi.fn((event: string, cb: Function) => {
      mockRl.off(event, cb)
    })

    const mod = await import('../../src/tools/interaction-tools')
    askUser = mod.askUser
    setReadlineInterface = mod.setReadlineInterface
    setReadlineInterface(mockRl as any)
  })

  describe('askUser (text mode)', () => {
    it('returns answer when user types', async () => {
      const promise = callTool(askUser, { question: 'What target should I test?' })

      // Simulate user typing
      setTimeout(() => mockRl.emit('line', 'https://target.com'), 50)

      const result = await promise
      expect(result.ok).toBe(true)
      expect(result.value.answer).toBe('https://target.com')
      expect(result.value.waitForBrowserAction).toBe(false)
    })

    it('appends options to question', async () => {
      const promise = callTool(askUser, {
        question: 'Which endpoint?',
        options: ['/api/users', '/api/admin'],
      })

      setTimeout(() => mockRl.emit('line', '/api/users'), 50)

      const result = await promise
      expect(result.ok).toBe(true)
      expect(result.value.question).toContain('/api/users')
    })

    it('takes screenshot before asking', async () => {
      const promise = callTool(askUser, { question: 'test' })
      setTimeout(() => mockRl.emit('line', 'ok'), 50)

      await promise
      const { captureScreenshot } = await import('../../src/browser/manager')
      expect(captureScreenshot).toHaveBeenCalledWith('askUser', '/tmp/test')
    })

    it('returns page URL and title', async () => {
      const promise = callTool(askUser, { question: 'test' })
      setTimeout(() => mockRl.emit('line', 'ok'), 50)

      const result = await promise
      expect(result.value.pageUrl).toBe('https://example.com/login')
      expect(result.value.pageTitle).toBe('Login Page')
    })

    it('returns empty on close', async () => {
      const promise = callTool(askUser, { question: 'test' })
      setTimeout(() => mockRl.emit('close'), 50)

      const result = await promise
      expect(result.value.answer).toBe('')
    })
  })

  describe('askUser (browser action mode)', () => {
    it('waits for browser action and captures human actions', async () => {
      const promise = callTool(askUser, {
        question: 'Please log in',
        waitForBrowserAction: true,
      })

      setTimeout(() => mockRl.emit('line', 'done'), 50)

      const result = await promise
      expect(result.ok).toBe(true)
      expect(result.value.waitForBrowserAction).toBe(true)
      expect(result.value.humanActionCount).toBe(2)
      expect(result.value.humanActions[0].type).toBe('click')
      expect(result.value.humanActions[1].type).toBe('fill')
      expect(mockObserver.startSnapshot).toHaveBeenCalled()
      expect(mockObserver.getActionsSinceSnapshot).toHaveBeenCalled()
    })

    it('takes before and after screenshots', async () => {
      const promise = callTool(askUser, {
        question: 'Solve the captcha',
        waitForBrowserAction: true,
        screenshotContext: 'captcha-page',
      })

      setTimeout(() => mockRl.emit('line', 'done'), 50)

      await promise
      const { captureScreenshot } = await import('../../src/browser/manager')
      expect(captureScreenshot).toHaveBeenCalledWith('captcha-page', '/tmp/test')
      expect(captureScreenshot).toHaveBeenCalledWith('after-human-action', '/tmp/test')
    })

    it('returns page info after action', async () => {
      const promise = callTool(askUser, {
        question: 'Log in',
        waitForBrowserAction: true,
      })

      setTimeout(() => mockRl.emit('line', 'done'), 50)

      const result = await promise
      expect(result.value.pageUrl).toBe('https://example.com/login')
      expect(result.value.pageTitle).toBe('Login Page')
    })
  })

  describe('setReadlineInterface', () => {
    it('sets the readline interface', () => {
      const newRl = new EventEmitter()
      newRl.once = vi.fn()
      newRl.removeListener = vi.fn()
      setReadlineInterface(newRl as any)
      // Just verifying it doesn't throw
      expect(true).toBe(true)
    })
  })
})
