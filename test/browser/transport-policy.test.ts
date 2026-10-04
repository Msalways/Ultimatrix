import { describe, expect, it, vi } from 'vitest'
import { attachBrowserTransportPolicy } from '../../src/browser/transport-policy'

function config(): any {
  return {
    bounty: { enabled: true },
    scope: {
      allowedDomains: ['target.example'],
      allowedOrigins: ['https://target.example'],
      enforcement: 'hard',
    },
  }
}

describe('browser transport policy', () => {
  it('governs network requests for strict evidence-bound sessions outside bounty mode', async () => {
    const context = { route: vi.fn(async () => undefined), unroute: vi.fn().mockResolvedValue(undefined) }
    const browser: any = { providerName: 'camofox', context }
    const strictConfig = { scope: { requireObservedRoutes: true, allowedDomains: ['target.example'], enforcement: 'hard' } } as any
    const cleanup = await attachBrowserTransportPolicy(browser, strictConfig)
    expect(context.route).toHaveBeenCalledWith('**/*', expect.any(Function))
    await cleanup()
  })

  it('blocks out-of-scope Playwright requests before continuation', async () => {
    const handlers: Record<string, any> = {}
    const context = {
      route: vi.fn(async (_pattern: string, handler: any) => { handlers.route = handler }),
      unroute: vi.fn().mockResolvedValue(undefined),
    }
    const browser: any = { providerName: 'camofox', context }
    const cleanup = await attachBrowserTransportPolicy(browser, config())
    const continueFn = vi.fn().mockResolvedValue(undefined)
    const abortFn = vi.fn().mockResolvedValue(undefined)
    const route = (url: string) => ({ request: () => ({ url: () => url }), continue: continueFn, abort: abortFn })

    await handlers.route(route('https://target.example/app'))
    await handlers.route(route('https://outside.example/app'))

    expect(continueFn).toHaveBeenCalledTimes(1)
    expect(abortFn).toHaveBeenCalledWith('BlockedByClient')
    await cleanup()
    expect(context.unroute).toHaveBeenCalled()
  })

  it('uses native CDP Fetch interception for Stagehand targets', async () => {
    const handlers: Record<string, (params: any) => void> = {}
    const connection = {
      on: vi.fn((event: string, handler: any) => { handlers[event] = handler }),
      off: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    }
    const stagehand = { context: { activePage: () => ({ mainSession: connection }) } }
    const browser: any = { requireStagehand: () => stagehand }
    const cleanup = await attachBrowserTransportPolicy(browser, config())

    expect(connection.send).toHaveBeenCalledWith('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    handlers['Fetch.requestPaused']({ requestId: '1', request: { url: 'https://outside.example/' } })
    await new Promise((resolve) => setImmediate(resolve))
    expect(connection.send).toHaveBeenCalledWith('Fetch.failRequest', { requestId: '1', errorReason: 'BlockedByClient' })

    await cleanup()
    expect(connection.off).toHaveBeenCalledWith('Fetch.requestPaused', expect.any(Function))
    expect(connection.send).toHaveBeenCalledWith('Fetch.disable')
  })

  it('awaits Stagehand activePage before attaching target-scoped Fetch interception', async () => {
    const handlers: Record<string, (params: any) => void> = {}
    const activeConnection = {
      on: vi.fn((event: string, handler: any) => { handlers[event] = handler }),
      off: vi.fn(),
      send: vi.fn().mockResolvedValue(undefined),
    }
    const rootConnection = { on: vi.fn(), off: vi.fn(), send: vi.fn().mockResolvedValue(undefined) }
    const stagehand = {
      context: {
        activePage: vi.fn().mockResolvedValue({ mainSession: activeConnection }),
        conn: rootConnection,
      },
    }
    const browser: any = { requireStagehand: () => stagehand }

    const cleanup = await attachBrowserTransportPolicy(browser, config())

    expect(stagehand.context.activePage).toHaveBeenCalledOnce()
    expect(activeConnection.send).toHaveBeenCalledWith('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
    expect(rootConnection.send).not.toHaveBeenCalled()
    await cleanup()
  })
})
