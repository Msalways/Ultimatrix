import { describe, it, expect, vi, beforeEach } from 'vitest'

function makePage(overrides: Record<string, any> = {}) {
  const listeners: Record<string, Function[]> = {}
  return {
    url: vi.fn().mockReturnValue('https://example.com/page'),
    mainFrame: vi.fn().mockReturnValue({ url: vi.fn().mockReturnValue('https://example.com/page') }),
    on: vi.fn((event: string, cb: Function) => {
      if (!listeners[event]) listeners[event] = []
      listeners[event].push(cb)
    }),
    removeListener: vi.fn((event: string, cb: Function) => {
      if (listeners[event]) {
        listeners[event] = listeners[event].filter(fn => fn !== cb)
      }
    }),
    _emit: (event: string, ...args: any[]) => {
      for (const cb of listeners[event] || []) cb(...args)
    },
    _listeners: listeners,
    ...overrides,
  }
}

function makeStagehandPage(overrides: Record<string, any> = {}) {
  const consoleListeners: Function[] = []
  let initScript: string = ''
  return {
    url: vi.fn().mockReturnValue('https://example.com/page'),
    sendCDP: vi.fn().mockResolvedValue({}),
    addInitScript: vi.fn().mockImplementation((script: string) => {
      initScript = script
      return Promise.resolve()
    }),
    on: vi.fn((event: string, cb: Function) => {
      if (event === 'console') consoleListeners.push(cb)
    }),
    off: vi.fn((event: string, cb: Function) => {
      if (event === 'console') {
        const idx = consoleListeners.indexOf(cb)
        if (idx >= 0) consoleListeners.splice(idx, 1)
      }
    }),
    _emitConsole: (text: string) => {
      for (const cb of [...consoleListeners]) {
        cb({ text: () => text, type: () => 'debug' })
      }
    },
    _getInitScript: () => initScript,
    _consoleListeners: consoleListeners,
    ...overrides,
  }
}

describe('HumanObserver', () => {
  let HumanObserver: typeof import('../../src/capture/human-observer').HumanObserver
  let getGlobalObserver: typeof import('../../src/capture/human-observer').getGlobalObserver
  let setGlobalObserver: typeof import('../../src/capture/human-observer').setGlobalObserver
  let maskValue: typeof import('../../src/capture/human-observer').maskValue
  let STAGEHAND_INIT_SCRIPT: typeof import('../../src/capture/human-observer').STAGEHAND_INIT_SCRIPT

  beforeEach(async () => {
    const mod = await import('../../src/capture/human-observer')
    HumanObserver = mod.HumanObserver
    getGlobalObserver = mod.getGlobalObserver
    setGlobalObserver = mod.setGlobalObserver
    maskValue = mod.maskValue
    STAGEHAND_INIT_SCRIPT = mod.STAGEHAND_INIT_SCRIPT
  })

  describe('basic lifecycle', () => {
    it('starts not capturing', () => {
      const obs = new HumanObserver()
      expect(obs.isCapturing()).toBe(false)
      expect(obs.getActions()).toEqual([])
    })

    it('attaches to a Playwright page and starts capturing', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)
      expect(obs.isCapturing()).toBe(true)
      expect(page.on).toHaveBeenCalled()
    })

    it('attaches to a Stagehand V3 page via CDP injection', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      // Mock HEADLESS as undefined (not headless) and page.isClosed as undefined
      Object.defineProperty(page, 'isClosed', {
        get: () => undefined,
      })
      // Also ensure HEADLESS is not set in process.env
      const originalHeadless = process.env.HEADLESS
      process.env.HEADLESS = undefined
      try {
        obs.attach(page as any)
        expect(obs.isCapturing()).toBe(true)
        expect(page.addInitScript).toHaveBeenCalled()
        expect(page.on).toHaveBeenCalledWith('console', expect.any(Function))
      } finally {
        if (originalHeadless === undefined) {
          delete process.env.HEADLESS
        } else {
          process.env.HEADLESS = originalHeadless
        }
      }
    })

    it('detaches and stops capturing', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)
      obs.detach()
      expect(obs.isCapturing()).toBe(false)
      expect(obs.getActions()).toEqual([])
    })

    it('detaches Stagehand V3 page', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)
      obs.detach()
      expect(obs.isCapturing()).toBe(false)
      expect(page.off).toHaveBeenCalledWith('console', expect.any(Function))
    })

    it('clears actions', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'click', url: 'https://example.com', timestamp: Date.now() })
      expect(obs.getActions()).toHaveLength(1)
      obs.clear()
      expect(obs.getActions()).toEqual([])
    })
  })

  describe('record', () => {
    it('records actions and triggers callback', () => {
      const obs = new HumanObserver()
      const cb = vi.fn()
      obs.onAction(cb)

      const ts = Date.now()
      obs.record({ type: 'click', url: 'https://example.com', timestamp: ts })

      expect(cb).toHaveBeenCalledTimes(1)
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ type: 'click', url: 'https://example.com' }))
    })

    it('returns a copy of actions', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'fill', url: 'https://example.com', value: 'test', timestamp: Date.now() })
      const actions = obs.getActions()
      actions.push({ type: 'navigate', url: 'x', timestamp: 0 } as any)
      expect(obs.getActions()).toHaveLength(1)
    })
  })

  describe('getRecentActions', () => {
    it('filters by sinceMs', () => {
      const obs = new HumanObserver()
      const now = Date.now()
      obs.record({ type: 'click', url: 'a', timestamp: now - 10000 })
      obs.record({ type: 'fill', url: 'b', timestamp: now })

      const recent = obs.getRecentActions(5000)
      expect(recent).toHaveLength(1)
      expect(recent[0].type).toBe('fill')
    })

    it('returns all when no sinceMs', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'click', url: 'a', timestamp: Date.now() })
      obs.record({ type: 'navigate', url: 'b', timestamp: Date.now() })
      expect(obs.getRecentActions()).toHaveLength(2)
    })
  })

  describe('snapshot', () => {
    it('returns actions since snapshot', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'click', url: 'a', timestamp: Date.now() })

      obs.startSnapshot()

      obs.record({ type: 'fill', url: 'b', timestamp: Date.now() })
      obs.record({ type: 'navigate', url: 'c', timestamp: Date.now() })

      const since = obs.getActionsSinceSnapshot()
      expect(since).toHaveLength(2)
      expect(since[0].type).toBe('fill')
      expect(since[1].type).toBe('navigate')
    })

    it('clears snapshot after retrieval', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'click', url: 'a', timestamp: Date.now() })
      obs.startSnapshot()
      obs.record({ type: 'fill', url: 'b', timestamp: Date.now() })

      const first = obs.getActionsSinceSnapshot()
      expect(first).toHaveLength(1)
      const second = obs.getActionsSinceSnapshot()
      expect(second).toHaveLength(2)
    })

    it('returns empty when no actions since snapshot', () => {
      const obs = new HumanObserver()
      obs.record({ type: 'click', url: 'a', timestamp: Date.now() })
      obs.startSnapshot()
      const since = obs.getActionsSinceSnapshot()
      expect(since).toHaveLength(0)
    })
  })

  describe('flow groups', () => {
    it('groups actions by navigation', () => {
      const obs = new HumanObserver()
      const now = Date.now()
      obs.record({ type: 'navigate', url: 'https://example.com/login', timestamp: now })
      obs.record({ type: 'fill', url: 'https://example.com/login', selector: '#user', value: 'admin', timestamp: now + 1 })
      obs.record({ type: 'fill', url: 'https://example.com/login', selector: '#pass', value: '***', timestamp: now + 2 })
      obs.record({ type: 'click', url: 'https://example.com/login', selector: '#submit', timestamp: now + 3 })

      obs.record({ type: 'navigate', url: 'https://example.com/dashboard', timestamp: now + 4 })
      obs.record({ type: 'click', url: 'https://example.com/dashboard', selector: '.btn', timestamp: now + 5 })

      const groups = obs.getFlowGroups()
      expect(groups).toHaveLength(2)
      expect(groups[0].type).toBe('login')
      expect(groups[0].actions.length).toBe(4)
      expect(groups[1].type).toBe('navigation')
      expect(groups[1].actions.length).toBe(2)
    })

    it('detects form-fill flow type', () => {
      const obs = new HumanObserver()
      const now = Date.now()
      obs.record({ type: 'navigate', url: 'https://example.com/form', timestamp: now })
      obs.record({ type: 'fill', url: 'https://example.com/form', value: 'test', timestamp: now + 1 })
      obs.record({ type: 'click', url: 'https://example.com/form', timestamp: now + 2 })

      const groups = obs.getFlowGroups()
      expect(groups[0].type).toBe('form-fill')
    })

    it('detects navigation flow type', () => {
      const obs = new HumanObserver()
      const now = Date.now()
      obs.record({ type: 'navigate', url: 'https://example.com/a', timestamp: now })
      obs.record({ type: 'click', url: 'https://example.com/a', timestamp: now + 1 })
      obs.record({ type: 'hover', url: 'https://example.com/a', timestamp: now + 2 })

      const groups = obs.getFlowGroups()
      expect(groups[0].type).toBe('navigation')
    })

    it('returns empty for no actions', () => {
      const obs = new HumanObserver()
      expect(obs.getFlowGroups()).toEqual([])
    })
  })

  describe('Playwright event listeners', () => {
    it('records click events from page', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ textContent: 'Button Text', id: 'btn-1', getAttribute: () => null, tagName: 'BUTTON' })

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('click')
      expect(actions[0].selector).toBe('#btn-1')
    })

    it('records input events with value masking', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const inputCb = page.on.mock.calls.find((c: any) => c[0] === 'input')?.[1]
      inputCb?.({ value: 'secret123', getAttribute: (attr: string) => attr === 'type' ? 'password' : null, tagName: 'INPUT' })

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('fill')
      expect(actions[0].value).toBe('***')
    })

    it('records select events', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const selectCb = page.on.mock.calls.find((c: any) => c[0] === 'select')?.[1]
      selectCb?.({ value: 'option-2', getAttribute: () => null, tagName: 'SELECT' })

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('select')
      expect(actions[0].value).toBe('option-2')
    })

    it('records submit on Enter key in input', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const keydownCb = page.on.mock.calls.find((c: any) => c[0] === 'keydown')?.[1]
      keydownCb?.({ tagName: 'INPUT' }, { key: 'Enter' })

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('submit')
    })

    it('ignores non-Enter keydown', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const keydownCb = page.on.mock.calls.find((c: any) => c[0] === 'keydown')?.[1]
      keydownCb?.({ tagName: 'INPUT' }, { key: 'Tab' })

      expect(obs.getActions()).toHaveLength(0)
    })

    it('records navigation from framenavigated', () => {
      const obs = new HumanObserver()
      const mainFrame = { url: vi.fn().mockReturnValue('https://example.com/new') }
      const page = makePage()
      page.mainFrame.mockReturnValue(mainFrame)
      obs.attach(page as any)

      const navCb = page.on.mock.calls.find((c: any) => c[0] === 'framenavigated')?.[1]
      navCb?.(mainFrame)

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('navigate')
      expect(actions[0].url).toBe('https://example.com/new')
    })

    it('ignores non-main-frame navigation', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const navCb = page.on.mock.calls.find((c: any) => c[0] === 'framenavigated')?.[1]
      navCb?.({ url: vi.fn() })

      expect(obs.getActions()).toHaveLength(0)
    })

    it('does not record when capturing is false', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)
      obs.detach()

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ textContent: 'x' })

      expect(obs.getActions()).toHaveLength(0)
    })
  })

  describe('Stagehand V3 CDP injection', () => {
    it('injects init script on attach', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      expect(page.addInitScript).toHaveBeenCalledTimes(1)
      const script = page._getInitScript()
      expect(script).toContain('__humanObserver')
      expect(script).toContain('console.debug')
      expect(script).toContain('__HUMAN__')
    })

    it('registers console listener on attach', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      expect(page.on).toHaveBeenCalledWith('console', expect.any(Function))
    })

    it('records click from __HUMAN__ console message', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'click',
        element: 'button labeled "Login"',
        url: 'https://example.com/login',
      }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('click')
      expect(actions[0].selector).toBe('button labeled "Login"')
      expect(actions[0].url).toBe('https://example.com/login')
    })

    it('records fill from __HUMAN__ console message with value masking', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'fill',
        element: 'input name="password"',
        value: 'supersecret',
        inputType: 'password',
        url: 'https://example.com/login',
      }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('fill')
      expect(actions[0].selector).toBe('input name="password"')
      expect(actions[0].value).toBe('***')
    })

    it('masks values with sensitive selectors in Node.js', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'fill',
        element: 'input name="auth_token"',
        value: 'tok_abc123',
        url: 'https://example.com/login',
      }))

      const actions = obs.getActions()
      expect(actions[0].value).toBe('***')
    })

    it('does not mask normal values', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'fill',
        element: 'input name="email"',
        value: 'user@example.com',
        url: 'https://example.com/login',
      }))

      const actions = obs.getActions()
      expect(actions[0].value).toBe('user@example.com')
    })

    it('records select from __HUMAN__ console message', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'select',
        element: 'select name="country"',
        value: 'US',
        url: 'https://example.com/form',
      }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('select')
      expect(actions[0].selector).toBe('select name="country"')
      expect(actions[0].value).toBe('US')
    })

    it('records submit from __HUMAN__ console message', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'submit',
        element: 'input name="search"',
        url: 'https://example.com/search',
      }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('submit')
    })

    it('records navigate from __HUMAN__ console message', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'navigate',
        url: 'https://example.com/dashboard',
      }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(1)
      expect(actions[0].type).toBe('navigate')
      expect(actions[0].url).toBe('https://example.com/dashboard')
    })

    it('ignores non-__HUMAN__ console messages', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('normal console log')
      page._emitConsole('debug: some info')
      page._emitConsole('error: something broke')

      expect(obs.getActions()).toHaveLength(0)
    })

    it('ignores malformed JSON in __HUMAN__ messages', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__not valid json{{')

      expect(obs.getActions()).toHaveLength(0)
    })

    it('does not record when capturing is false', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)
      obs.detach()

      page._emitConsole('__HUMAN__' + JSON.stringify({
        type: 'click',
        element: 'button',
        url: 'https://example.com',
      }))

      expect(obs.getActions()).toHaveLength(0)
    })

    it('removes console listener on detach', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)
      obs.detach()

      expect(page.off).toHaveBeenCalledWith('console', expect.any(Function))
    })

    it('records multiple actions in sequence', () => {
      const obs = new HumanObserver()
      const page = makeStagehandPage()
      obs.attach(page as any)

      page._emitConsole('__HUMAN__' + JSON.stringify({ type: 'navigate', url: 'https://example.com/login' }))
      page._emitConsole('__HUMAN__' + JSON.stringify({ type: 'fill', element: 'input name="email"', value: 'a@b.com', url: 'https://example.com/login' }))
      page._emitConsole('__HUMAN__' + JSON.stringify({ type: 'fill', element: 'input name="password"', value: 'secret', inputType: 'password', url: 'https://example.com/login' }))
      page._emitConsole('__HUMAN__' + JSON.stringify({ type: 'submit', element: 'input name="password"', url: 'https://example.com/login' }))

      const actions = obs.getActions()
      expect(actions).toHaveLength(4)
      expect(actions.map(a => a.type)).toEqual(['navigate', 'fill', 'fill', 'submit'])
      expect(actions[1].value).toBe('a@b.com')
      expect(actions[2].value).toBe('***')
    })

    it('truncates long values via maskValue', () => {
      const longVal = 'a'.repeat(250)
      const masked = maskValue(longVal, 'input')
      expect(masked).toBe('a'.repeat(200) + '...')
    })
  })

  describe('selector building (Playwright path)', () => {
    it('uses id when available', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ id: 'my-btn', textContent: 'x', getAttribute: () => null, tagName: 'BUTTON' })

      expect(obs.getActions()[0].selector).toBe('#my-btn')
    })

    it('falls back to data-testid', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ id: '', getAttribute: (attr: string) => attr === 'data-testid' ? 'submit-btn' : null, textContent: 'x', tagName: 'BUTTON' })

      expect(obs.getActions()[0].selector).toBe('[data-testid="submit-btn"]')
    })

    it('falls back to name attribute', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ id: '', getAttribute: (attr: string) => attr === 'name' ? 'email' : null, textContent: 'x', tagName: 'INPUT' })

      expect(obs.getActions()[0].selector).toBe('[name="email"]')
    })

    it('falls back to tag+class', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.({ id: '', getAttribute: () => null, textContent: 'x', tagName: 'BUTTON', className: 'btn primary' })

      expect(obs.getActions()[0].selector).toBe('button.btn')
    })

    it('returns unknown for null element', () => {
      const obs = new HumanObserver()
      const page = makePage()
      obs.attach(page as any)

      const clickCb = page.on.mock.calls.find((c: any) => c[0] === 'click')?.[1]
      clickCb?.(null)

      expect(obs.getActions()[0].selector).toBe('unknown')
    })
  })

  describe('value masking (maskValue)', () => {
    it('masks password input types', () => {
      expect(maskValue('mysecretpass', 'input', 'password')).toBe('***')
    })

    it('masks hidden input types', () => {
      expect(maskValue('secret', 'input', 'hidden')).toBe('***')
    })

    it('masks selectors with sensitive keywords', () => {
      expect(maskValue('token123', '#auth-token')).toBe('***')
      expect(maskValue('value', '[name="password"]')).toBe('***')
      expect(maskValue('value', '.credential-field')).toBe('***')
      expect(maskValue('value', '#credit-card')).toBe('***')
    })

    it('truncates long values', () => {
      const longValue = 'a'.repeat(250)
      expect(maskValue(longValue, 'input')).toBe('a'.repeat(200) + '...')
    })

    it('does not mask normal values', () => {
      expect(maskValue('hello', '#email')).toBe('hello')
      expect(maskValue('user@example.com', 'input')).toBe('user@example.com')
    })

    it('does not mask short sensitive-looking but non-sensitive values', () => {
      expect(maskValue('ab', 'input', 'text')).toBe('ab')
    })
  })

  describe('global observer', () => {
    it('returns same instance from getGlobalObserver', () => {
      const a = getGlobalObserver()
      const b = getGlobalObserver()
      expect(a).toBe(b)
    })

    it('setGlobalObserver replaces the singleton', () => {
      const original = getGlobalObserver()
      const custom = new HumanObserver()
      setGlobalObserver(custom)
      expect(getGlobalObserver()).toBe(custom)
      setGlobalObserver(original)
    })
  })

  describe('STAGEHAND_INIT_SCRIPT', () => {
    it('is a valid self-invoking function', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain('(function()')
      expect(STAGEHAND_INIT_SCRIPT).toContain('})()')
    })

    it('sets window.__humanObserver guard', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain('window.__humanObserver')
    })

    it('reports via console.debug with __HUMAN__ prefix', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain("console.debug('__HUMAN__'")
    })

    it('listens for click, input, change, keydown events', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain("'click'")
      expect(STAGEHAND_INIT_SCRIPT).toContain("'input'")
      expect(STAGEHAND_INIT_SCRIPT).toContain("'change'")
      expect(STAGEHAND_INIT_SCRIPT).toContain("'keydown'")
    })

    it('hooks history.pushState and history.replaceState', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain('history.pushState')
      expect(STAGEHAND_INIT_SCRIPT).toContain('history.replaceState')
    })

    it('listens for popstate', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain("'popstate'")
    })

    it('reports initial navigate on load', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain("report('navigate'")
    })

    it('uses semantic element descriptions, not CSS selectors', () => {
      expect(STAGEHAND_INIT_SCRIPT).toContain('getAttribute')
      expect(STAGEHAND_INIT_SCRIPT).toContain("'placeholder'")
      expect(STAGEHAND_INIT_SCRIPT).toContain("'name'")
      expect(STAGEHAND_INIT_SCRIPT).toContain('labels')
    })
  })
})
