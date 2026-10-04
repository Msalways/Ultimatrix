import type { BrowserHandle } from './provider'
import { isCamofoxHandle } from './provider'
import { isUrlInScope } from '../safety/scope-guard'
import { getTargetTransportGovernor, type TargetTransportGovernor } from '../runtime/target-governor'
import type { ScopeConfig, UltimatrixConfig } from '../config'

export type BrowserPolicyCleanup = () => Promise<void>

/** Schemes the browser must never be asked to route through the target governor. */
const NON_NETWORK_SCHEMES = new Set(['about:', 'data:', 'blob:', 'javascript:', 'file:', 'chrome:', 'devtools:'])

/**
 * Protocol identity, parsed rather than pattern-matched. A URL that cannot be
 * parsed is treated as non-network so it is never counted or admitted as a
 * governed target request.
 */
function protocolOf(url: string): string {
  try {
    return new URL(url).protocol.toLowerCase()
  } catch {
    return ''
  }
}

function isHttpUrl(url: string): boolean {
  const protocol = protocolOf(url)
  return protocol === 'http:' || protocol === 'https:'
}

function isNonNetworkScheme(url: string): boolean {
  return NON_NETWORK_SCHEMES.has(protocolOf(url))
}

async function governUrl(url: string, continueRequest: () => Promise<void>, failRequest: (reason: string) => Promise<void>, scope: ScopeConfig | null, governor: TargetTransportGovernor): Promise<void> {
  if (isNonNetworkScheme(url) || !isHttpUrl(url)) {
    await continueRequest()
    return
  }
  const check = isUrlInScope(url, scope ?? null, { allowAny: false })
  if (!check.allowed) {
    await failRequest('BlockedByClient')
    return
  }
  const release = await governor.acquire(url)
  try {
    await continueRequest()
  } finally {
    release()
  }
}

/**
 * Attach provider-native request interception for a bounty or evidence-bound
 * engagement. The latter shares the engagement's hard wire-request budget.
 * Playwright uses context.route; Stagehand v3 uses the active target's native
 * CDP Fetch domain. Both paths abort before an out-of-scope request is sent.
 */
export async function attachBrowserTransportPolicy(
  browser: BrowserHandle,
  config: UltimatrixConfig,
): Promise<BrowserPolicyCleanup> {
  if (!config.bounty?.enabled && config.scope?.requireObservedRoutes !== true) return async () => {}

  const scope = config.scope ?? null
  const governor = getTargetTransportGovernor()
  if (isCamofoxHandle(browser)) {
    const context = browser.context as any
    if (!context || typeof context.route !== 'function') {
      throw new Error('Bounty browser policy requires a Playwright BrowserContext with route() support')
    }
    const handler = async (route: any): Promise<void> => {
      const requestUrl = String(route.request()?.url?.() ?? '')
      await governUrl(
        requestUrl,
        async () => { await route.continue() },
        async (reason) => { await route.abort(reason) },
        scope,
        governor,
      )
    }
    await context.route('**/*', handler)
    return async () => {
      if (typeof context.unroute === 'function') await context.unroute('**/*', handler)
    }
  }

  const stagehand = (browser as any)?.requireStagehand?.()
  const context = stagehand?.context
  const page = typeof context?.activePage === 'function' ? await context.activePage() : undefined
  const connection = page?.mainSession ?? context?.conn
  if (!connection || typeof connection.on !== 'function' || typeof connection.send !== 'function') {
    throw new Error('Bounty browser policy requires Stagehand CDP Fetch support')
  }

  const handler = (params: any): void => {
    const requestUrl = String(params?.request?.url ?? '')
    void governUrl(
      requestUrl,
      async () => { await connection.send('Fetch.continueRequest', { requestId: params.requestId }) },
      async () => { await connection.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }) },
      scope,
      governor,
    ).catch(() => {
      // A policy handler must never leave a paused request hanging.
      void connection.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }).catch(() => {})
    })
  }
  connection.on('Fetch.requestPaused', handler)
  try {
    await connection.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] })
  } catch (error) {
    if (typeof connection.off === 'function') connection.off('Fetch.requestPaused', handler)
    throw error
  }
  return async () => {
    if (typeof connection.off === 'function') connection.off('Fetch.requestPaused', handler)
    await connection.send('Fetch.disable').catch(() => {})
  }
}
