import { describe, it, expect, vi } from 'vitest'
import type { Page } from 'playwright'

type MockElementHandle = {
  isVisible: () => Promise<boolean>
  click: (opts?: any) => Promise<void>
  fill: (value: string) => Promise<void>
  getAttribute: (attr: string) => Promise<string | null>
  textContent: () => Promise<string>
  evaluate: (fn: (el: Element, ...args: any[]) => any, ...args: any[]) => Promise<any>
  locator: (sel: string) => MockLocator
}

type MockLocator = {
  all: () => Promise<MockElementHandle[]>
  first: () => MockLocator
  isVisible: () => Promise<boolean>
  click: (opts?: any) => Promise<void>
  fill: (value: string) => Promise<void>
  getAttribute: (attr: string) => Promise<string | null>
  textContent: () => Promise<string>
  evaluate: (fn: any, ...args: any[]) => Promise<any>
  locator: (sel: string) => MockLocator
}

function makeElement(overrides: Partial<MockElementHandle> = {}): MockElementHandle {
  return {
    isVisible: vi.fn().mockResolvedValue(false),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockResolvedValue(null),
    textContent: vi.fn().mockResolvedValue(''),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => makeLocator()),
    ...overrides,
  }
}

function makeLocator(overrides: Partial<MockLocator> = {}): MockLocator {
  return {
    all: vi.fn().mockResolvedValue([]),
    first: vi.fn().mockReturnThis(),
    isVisible: vi.fn().mockResolvedValue(false),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    getAttribute: vi.fn().mockResolvedValue(null),
    textContent: vi.fn().mockResolvedValue(''),
    evaluate: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(() => makeLocator()),
    ...overrides,
  }
}

function makePage(overrides: Record<string, any> = {}): Page {
  const locator = makeLocator()
  return {
    locator: vi.fn(() => locator),
    keyboard: { press: vi.fn().mockResolvedValue(undefined) },
    goto: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any
}

describe('dismissOverlays', () => {
  it('returns empty array when no overlays are visible', async () => {
    const { dismissOverlays } = await import('./spider-features')
    const page = makePage()
    const result = await dismissOverlays(page)
    expect(result).toEqual([])
  })

  it('returns dismissed selectors when overlay buttons are found', async () => {
    const { dismissOverlays } = await import('./spider-features')
    const visibleEl = makeElement({ isVisible: vi.fn().mockResolvedValue(true) })
    const locator = makeLocator({
      all: vi.fn().mockResolvedValue([visibleEl]),
    })
    const page = makePage({ locator: vi.fn(() => locator) })
    const result = await dismissOverlays(page)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('handles null page gracefully', async () => {
    const { dismissOverlays } = await import('./spider-features')
    const result = await dismissOverlays(null as any)
    expect(result).toEqual([])
  })

  it('handles page with errors gracefully', async () => {
    const { dismissOverlays } = await import('./spider-features')
    const page = makePage({
      locator: vi.fn(() => { throw new Error('fail') }),
    })
    const result = await dismissOverlays(page)
    expect(result).toEqual([])
  })
})

describe('exploreFormsOnPage', () => {
  it('returns empty array when no forms exist', async () => {
    const { exploreFormsOnPage } = await import('./spider-features')
    const page = makePage()
    const result = await exploreFormsOnPage(page)
    expect(result).toEqual([])
  })

  it('returns discovered forms with fields', async () => {
    const { exploreFormsOnPage } = await import('./spider-features')
    const fieldEl = makeElement({
      getAttribute: vi.fn(async (attr: string) => {
        if (attr === 'name') return 'email'
        if (attr === 'placeholder') return 'Enter email'
        if (attr === 'required') return null
        return null
      }),
      evaluate: vi.fn(async (fn: any) => {
        const fnStr = fn.toString()
        if (fnStr.includes('tagName')) return 'text'
        if (fnStr.includes('id') || fnStr.includes('getAttribute')) return '[name="email"]'
        return ''
      }),
    })

    let fieldLocatorCallCount = 0
    const fieldLocator = makeLocator({
      all: vi.fn().mockResolvedValue([fieldEl]),
    })

    const formEl = makeElement({
      getAttribute: vi.fn(async (attr: string) => {
        if (attr === 'action') return '/submit'
        if (attr === 'method') return 'POST'
        return null
      }),
      evaluate: vi.fn(async (fn: any) => '#form-1'),
      locator: vi.fn((sel: string) => {
        if (sel === 'input, select, textarea') return fieldLocator
        return makeLocator()
      }),
    })

    const page = makePage({
      locator: vi.fn((sel: string) => {
        if (sel === 'form') return makeLocator({ all: vi.fn().mockResolvedValue([formEl]) })
        return makeLocator()
      }),
    })
    const result = await exploreFormsOnPage(page)
    expect(result).toHaveLength(1)
    expect(result[0].selector).toBe('#form-1')
    expect(result[0].action).toBe('/submit')
    expect(result[0].method).toBe('POST')
    expect(result[0].fields).toHaveLength(1)
  })

  it('handles empty page gracefully', async () => {
    const { exploreFormsOnPage } = await import('./spider-features')
    const result = await exploreFormsOnPage(null as any)
    expect(result).toEqual([])
  })
})

describe('clickInteractiveElements', () => {
  it('returns empty array when no elements found', async () => {
    const { clickInteractiveElements } = await import('./spider-features')
    const page = makePage()
    const result = await clickInteractiveElements(page)
    expect(result).toEqual([])
  })

  it('click interactive elements are returned', async () => {
    const { clickInteractiveElements } = await import('./spider-features')
    const visibleEl = makeElement({
      isVisible: vi.fn().mockResolvedValue(true),
      textContent: vi.fn().mockResolvedValue('Click Me'),
      evaluate: vi.fn().mockResolvedValue('button'),
      click: vi.fn().mockResolvedValue(undefined),
    })
    const locator = makeLocator({ all: vi.fn().mockResolvedValue([visibleEl]) })
    const page = makePage({ locator: vi.fn(() => locator) })
    const result = await clickInteractiveElements(page)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })

  it('skips overlay-like buttons (accept, ok, etc)', async () => {
    const { clickInteractiveElements } = await import('./spider-features')
    const acceptEl = makeElement({
      isVisible: vi.fn().mockResolvedValue(true),
      textContent: vi.fn().mockResolvedValue('Accept'),
      evaluate: vi.fn().mockResolvedValue('button'),
    })
    const locator = makeLocator({ all: vi.fn().mockResolvedValue([acceptEl]) })
    const page = makePage({ locator: vi.fn(() => locator) })
    const result = await clickInteractiveElements(page)
    expect(result).toEqual([])
  })

  it('handles null page', async () => {
    const { clickInteractiveElements } = await import('./spider-features')
    const result = await clickInteractiveElements(null as any)
    expect(result).toEqual([])
  })
})

describe('extractHashRoutes', () => {
  it('returns empty array when no hash routes found', async () => {
    const { extractHashRoutes } = await import('./spider-features')
    const page = makePage()
    const result = await extractHashRoutes(page)
    expect(result).toEqual([])
  })

  it('returns hash routes from links', async () => {
    const { extractHashRoutes } = await import('./spider-features')
    const linkEl = makeElement({
      getAttribute: vi.fn().mockResolvedValue('#/dashboard'),
    })
    const locator = makeLocator({ all: vi.fn().mockResolvedValue([linkEl, linkEl]) })
    const page = makePage({ locator: vi.fn(() => locator) })
    const result = await extractHashRoutes(page)
    expect(result).toEqual(['#/dashboard'])
  })

  it('deduplicates routes', async () => {
    const { extractHashRoutes } = await import('./spider-features')
    const linkEl = makeElement({
      getAttribute: vi.fn().mockResolvedValue('#/settings'),
    })
    const locator = makeLocator({ all: vi.fn().mockResolvedValue([linkEl, linkEl, linkEl]) })
    const page = makePage({ locator: vi.fn(() => locator) })
    const result = await extractHashRoutes(page)
    expect(result).toHaveLength(1)
  })

  it('handles null page', async () => {
    const { extractHashRoutes } = await import('./spider-features')
    const result = await extractHashRoutes(null as any)
    expect(result).toEqual([])
  })
})

describe('attemptAuthFlow', () => {
  it('returns false when no password field visible', async () => {
    const { attemptAuthFlow } = await import('./spider-features')
    const page = makePage({
      locator: vi.fn(() => makeLocator({ isVisible: vi.fn().mockResolvedValue(false) })),
    })
    const result = await attemptAuthFlow(page, { username: 'admin', password: 'admin' })
    expect(result).toBe(false)
  })

  it('returns true when auth flow completes', async () => {
    const { attemptAuthFlow } = await import('./spider-features')
    const passwordLocator = makeLocator({ isVisible: vi.fn().mockResolvedValue(true) })
    const emailLocator = makeLocator({ isVisible: vi.fn().mockResolvedValue(true) })

    const page = makePage()
    page.locator = vi.fn((sel: string) => {
      if (sel === 'input[type="password"]') return passwordLocator
      if (sel.includes('email') || sel.includes('user') || sel.includes('login')) return emailLocator
      if (sel === 'button[type="submit"]') return makeLocator({ isVisible: vi.fn().mockResolvedValue(true) })
      return makeLocator({ isVisible: vi.fn().mockResolvedValue(false) })
    }) as any
    const result = await attemptAuthFlow(page, { username: 'admin', password: 'pass' })
    expect(result).toBe(true)
  })

  it('returns false when username field not found', async () => {
    const { attemptAuthFlow } = await import('./spider-features')
    const passwordLocator = makeLocator({ isVisible: vi.fn().mockResolvedValue(true) })
    const invisibleLocator = makeLocator({ isVisible: vi.fn().mockResolvedValue(false) })

    const page = makePage()
    page.locator = vi.fn((sel: string) => {
      if (sel === 'input[type="password"]') return passwordLocator
      if (sel.includes('email') || sel.includes('user') || sel.includes('login')) return invisibleLocator
      return makeLocator({ isVisible: vi.fn().mockResolvedValue(false) })
    }) as any
    const result = await attemptAuthFlow(page, { username: 'admin', password: 'pass' })
    expect(result).toBe(false)
  })

  it('returns false on error', async () => {
    const { attemptAuthFlow } = await import('./spider-features')
    const result = await attemptAuthFlow(null as any, { username: 'admin', password: 'pass' })
    expect(result).toBe(false)
  })
})
