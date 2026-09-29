/**
 * The page accessor has had several shapes, and guessing one killed the browser.
 *
 * Verified live 2026-09-28 against OWASP Juice Shop, five consecutive runs: the
 * whole browser layer was silently dead. The old resolution read
 * `context.activePage` (absent on Stagehand v3) then fell back to
 * `context.pages?.[0]` â€” but `pages` is a METHOD on v3, so `[0]` was undefined
 * and it always returned null. Observation failed with "Browser provider did not
 * expose a navigable page" and the engagement degraded to HTTP-only.
 *
 * The cost was not a missing browser. AuthStateDetector and role learning live
 * in the browser layer, so auth flows and RBAC roles came out 0 on an
 * application built around them, and the agent fell back to guessing endpoint
 * paths. A degraded mode is defensible; a degraded mode nobody can see is not.
 *
 * Pinned on the pure resolver so the provider's shape is a covered input rather
 * than something a live run has to discover.
 */
import { describe, it, expect, vi } from 'vitest'
import { resolveContextPage, resolveContextPageAsync, ensureContextPage } from '../../src/browser/manager'

const page = (id: string) => ({ id, goto: () => {} })

describe('resolveContextPage handles every page-accessor shape', () => {
  it('pages as a FUNCTION â€” the Stagehand v3 shape that actually broke', () => {
    // The regression: `pages?.[0]` against a function yields undefined.
    const p = page('first')
    expect(resolveContextPage({ pages: () => [p] })).toBe(p)
  })

  it('pages as an ARRAY property', () => {
    const p = page('first')
    expect(resolveContextPage({ pages: [p] })).toBe(p)
  })

  it('activePage as a FUNCTION', () => {
    const p = page('active')
    expect(resolveContextPage({ activePage: () => p, pages: () => [] })).toBe(p)
  })

  it('activePage as a direct property', () => {
    const p = page('active')
    expect(resolveContextPage({ activePage: p })).toBe(p)
  })

  it('prefers the active page over the first page', () => {
    expect(resolveContextPage({ activePage: () => page('active'), pages: () => [page('first')] })?.id)
      .toBe('active')
  })

  it('a directly exposed page property', () => {
    const p = page('direct')
    expect(resolveContextPage({ page: p })).toBe(p)
  })

  it('returns null when there is genuinely no page yet', () => {
    expect(resolveContextPage({ pages: () => [] })).toBeNull()
    expect(resolveContextPage({})).toBeNull()
    expect(resolveContextPage(null)).toBeNull()
    expect(resolveContextPage(undefined)).toBeNull()
  })

  it('survives accessors that throw rather than propagating', () => {
    expect(() => resolveContextPage({
      activePage: () => { throw new Error('shape changed') },
      pages: () => { throw new Error('gone') },
    })).not.toThrow()
  })

  it('survives a self-referential context without hanging', () => {
    const ctx: any = {}
    Object.defineProperty(ctx, 'self', { get: () => ctx })
    ctx.pages = () => []
    expect(() => resolveContextPage(ctx)).not.toThrow()
  })

  it('never returns a non-page when pages is an empty array', () => {
    // Guards the specific silent-degradation: empty must read as "not ready",
    // not as a truthy stand-in that downstream code treats as a live page.
    expect(resolveContextPage({ pages: () => [] })).toBeNull()
  })
})

/**
 * THE ROOT CAUSE. Locked separately because it is the one that actually
 * mattered, and because it is invisible to any test written against a
 * synchronous accessor.
 *
 * Verified live 2026-09-29 on OWASP Juice Shop. Every page accessor on
 * Stagehand v3 is ASYNC. A synchronous read therefore returns an unresolved
 * Promise — which is truthy, so it is indistinguishable from a real page by
 * every truthiness check in the chain. The page was there the whole time and
 * the code was asking it for `.goto`, which a Promise does not have.
 *
 * The second half matters just as much: `newPage()` RETURNS the page it
 * opened. Re-reading the context afterwards came back empty and threw the open
 * page away.
 */
describe('async page accessors (the real root cause)', () => {
  const page = { goto: vi.fn(), id: 'p1' }

  it('sync resolver returns null, NOT the Promise, for an async accessor', async () => {
    // The trap: this assertion is what the old code failed. A Promise is truthy.
    const ctx = { activePage: () => Promise.resolve(page) }
    expect(resolveContextPage(ctx)).toBeNull()
  })

  it('sync resolver never hands back a thenable from any accessor', async () => {
    for (const ctx of [
      { activePage: () => Promise.resolve(page) },
      { pages: () => Promise.resolve([page]) },
      { page: Promise.resolve(page) },
    ]) {
      const got = resolveContextPage(ctx)
      expect(got === null || typeof got?.then !== 'function').toBe(true)
    }
  })

  it('async resolver awaits an async accessor and returns the real page', async () => {
    const ctx = { activePage: () => Promise.resolve(page) }
    expect(await resolveContextPageAsync(ctx)).toBe(page)
  })

  it('async resolver awaits an async pages() array', async () => {
    expect(await resolveContextPageAsync({ pages: () => Promise.resolve([page]) })).toBe(page)
  })

  it('async resolver still handles the synchronous shapes', async () => {
    expect(await resolveContextPageAsync({ activePage: page })).toBe(page)
    expect(await resolveContextPageAsync({ pages: [page] })).toBe(page)
    expect(await resolveContextPageAsync({ page })).toBe(page)
  })

  it('async resolver returns null, never throws, on absent or hostile shapes', async () => {
    expect(await resolveContextPageAsync(null)).toBeNull()
    expect(await resolveContextPageAsync({})).toBeNull()
    expect(await resolveContextPageAsync({ activePage: () => { throw new Error('x') } })).toBeNull()
    expect(await resolveContextPageAsync({ activePage: () => Promise.reject(new Error('x')) })).toBeNull()
  })

  it('ensureContextPage returns the page newPage() returns', async () => {
    const created = { goto: vi.fn(), id: 'new' }
    const ctx = { activePage: () => Promise.resolve(undefined), newPage: vi.fn().mockResolvedValue(created) }
    expect(await ensureContextPage(ctx, 'http://localhost:3000')).toBe(created)
  })

  it('ensureContextPage prefers an existing page over creating one', async () => {
    const newPage = vi.fn()
    const ctx = { activePage: () => Promise.resolve(page), newPage }
    expect(await ensureContextPage(ctx, 'http://localhost:3000')).toBe(page)
    expect(newPage).not.toHaveBeenCalled()
  })
})
