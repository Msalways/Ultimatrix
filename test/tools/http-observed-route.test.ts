import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapturedRequestStore } from '../../src/capture/captured-request-store'
import { __setTestFallback } from '../../src/runtime/engagement-context'
import { setAllowAny } from '../../src/safety/scope-guard'
import { httpRequest } from '../../src/tools/http-tools'
import { createMockEngagementServices } from '../utils/engagement-context'

describe('httpRequest observed-route policy', () => {
  const { services } = createMockEngagementServices()
  const capturedRequests = new CapturedRequestStore()
  services.scopeConfig = {
    allowedDomains: ['example.test'],
    allowedProtocols: ['https'],
    requireObservedRoutes: true,
    authorizedStartUrl: 'https://example.test/',
    authorizedPentest: true,
    enforcement: 'hard',
  }
  services.capturedRequests = capturedRequests

  afterEach(() => {
    capturedRequests.clear()
    __setTestFallback(null)
    setAllowAny(true)
    vi.restoreAllMocks()
  })

  it('blocks a guessed path before fetch and explains the missing evidence', async () => {
    __setTestFallback(services)
    setAllowAny(false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const result = await httpRequest.execute({
      method: 'GET',
      url: 'https://example.test/openapi.json',
    } as never)

    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unobserved route blocked')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('blocks an unresolved template literal even when client mining added it to the graph', async () => {
    __setTestFallback(services)
    setAllowAny(false)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await httpRequest.execute({
      method: 'GET',
      url: 'https://example.test/$%7Bgt(r.root,!0)%7D',
    } as never)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unresolved route template blocked')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('allows value mutations on a captured route and blocks unobserved query keys', async () => {
    __setTestFallback(services)
    setAllowAny(false)
    capturedRequests.record({
      method: 'GET',
      url: 'https://example.test/rest/products/search?q=baseline',
      status: 200,
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200, headers: { 'content-type': 'text/plain' } }),
    )

    const allowed = await httpRequest.execute({
      method: 'GET',
      url: 'https://example.test/rest/products/search?q=mutation-marker',
    } as never)
    expect(allowed.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const blocked = await httpRequest.execute({
      method: 'GET',
      url: 'https://example.test/rest/products/search?admin=true',
    } as never)
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('Unobserved input blocked')
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
