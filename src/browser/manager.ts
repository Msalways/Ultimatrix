import { StagehandBrowser } from '@mastra/stagehand'
import type { BrowserHandle, CamofoxBrowserHandle } from './provider'
import type { UltimatrixConfig } from '../config'
import { PROVIDER_INFO } from '../config'
import { log } from '../utils/logger'
import { mkdirSync, existsSync } from 'node:fs'
import {resolve} from 'node:path'
import { stopDialogWatcher } from './dialog-watcher'
import { getGlobalReactionObserver } from './reaction-observer'
import { getGlobalObserver } from '../capture/human-observer'
import { getGlobalArtifactRegistry } from '../security/artifacts'
import { redactString } from '../security/secret-vault'
import { getEngagementServices } from '../runtime/engagement-context'

export interface BrowserManagerState {
  browser: BrowserHandle | null
  activeBrowser: BrowserHandle | null
  creating: boolean
  configSnapshot: { headless: boolean; viewport: { width: number; height: number }; env: string } | null
}

function isCamofoxBrowser(browser: unknown): browser is CamofoxBrowserHandle {
  return !!browser && typeof browser === 'object' && (browser as { providerName?: unknown }).providerName === 'camofox'
}

export function createBrowserManagerState(): BrowserManagerState {
  return { browser: null, activeBrowser: null, creating: false, configSnapshot: null }
}

const legacyBrowserManager = createBrowserManagerState()

function getBrowserManagerState(): BrowserManagerState {
  return getEngagementServices()?.browserManager ?? legacyBrowserManager
}

/**
 * The one place a browser handle is registered, so reads and writes cannot
 * diverge.
 *
 * Verified live 2026-09-29 (OWASP Juice Shop): the browser started, and then
 * every read of the handle came back empty. The cause was two sources of truth.
 * The writer reached through `runtime.services.browserManager`; the reader used
 * `getBrowserManagerState()`, which is `getEngagementServices()?.browserManager
 * ?? legacyBrowserManager` — and `getEngagementServices()` returns undefined
 * outside `runWithEngagementServices`. So the write landed on the engagement
 * object and the read consulted `legacyBrowserManager`. Different objects, same
 * field name, silent as anything.
 *
 * That is why the browser looked "started but pageless" for every run, and why
 * auth flows and roles were permanently zero: the agent had no page to observe
 * with. Callers must register here rather than reaching into services directly.
 */
export function registerBrowserHandle(handle: unknown): void {
  const state = getBrowserManagerState()
  state.browser = handle as never
  state.activeBrowser = handle as never
}

const STAGEHAND_FAST_PROVIDER = 'groq'
const STAGEHAND_FAST_MODEL = 'llama-3.1-8b-instant'

const STAGEHAND_NATIVE_PROVIDERS = new Set([
  'openai', 'anthropic', 'groq', 'google', 'cerebras', 'xai', 'azure',
  'togetherai', 'together', 'mistral', 'deepseek', 'perplexity', 'ollama',
  'vertex', 'bedrock',
])

function stagehandProvider(raw: string): string {
  // Stagehand's model loader accepts native adapters plus the OpenAI
  // compatible adapter. Providers with an OpenAI-compatible base URL (the
  // configured tier supplies that URL) must use the latter; do not infer a
  // provider-specific Stagehand adapter from the model name.
  return STAGEHAND_NATIVE_PROVIDERS.has(raw) ? raw : 'openai'
}

/** Resolve the model identifier Stagehand's AI SDK can actually load.
 * Providers with OpenAI-compatible endpoints (for example NVIDIA) must use
 * the OpenAI adapter while retaining their configured model id and base URL.
 */
export function deriveStagehandModel(config: UltimatrixConfig) {
  if (config.provider === STAGEHAND_FAST_PROVIDER) {
    const creds = config.creds?.[STAGEHAND_FAST_PROVIDER] as { apiKey?: string; baseUrl?: string } | undefined
    const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[STAGEHAND_FAST_PROVIDER]?.envVar] || ''
    const baseURL = creds?.baseUrl || PROVIDER_INFO[STAGEHAND_FAST_PROVIDER]?.defaultBaseUrl
    return { modelName: `${STAGEHAND_FAST_PROVIDER}/${STAGEHAND_FAST_MODEL}`, apiKey, baseURL }
  }

  if (config.modelTiers?.fast) {
    const fastTier = config.modelTiers.fast
    const fastProvider = fastTier.provider
    const fastModelId = fastTier.model

    const creds = config.creds?.[fastProvider] as { apiKey?: string; baseUrl?: string } | undefined
    const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[fastProvider]?.envVar] || ''
    const baseURL = creds?.baseUrl || PROVIDER_INFO[fastProvider]?.defaultBaseUrl
    return { modelName: `${stagehandProvider(fastProvider)}/${fastModelId}`, apiKey, baseURL }
  }

  const provider = config.provider
  const model = config.model
  const creds = config.creds?.[provider] as { apiKey?: string; baseUrl?: string } | undefined
  const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[provider]?.envVar] || ''
  const baseURL = creds?.baseUrl || PROVIDER_INFO[provider]?.defaultBaseUrl
  return { modelName: `${stagehandProvider(provider)}/${model}`, apiKey, baseURL }
}

export function getOrCreateBrowser(config: UltimatrixConfig): StagehandBrowser {
  const state = getBrowserManagerState()
  if (config.browser.provider && config.browser.provider !== 'stagehand') {
    throw new Error(`Unsupported browser provider: ${config.browser.provider}. Use resolveBrowserProvider() for non-stagehand providers.`)
  }
  if (state.browser) {
    if (isCamofoxBrowser(state.browser)) throw new Error('A Camoufox browser is already active; provider cannot switch to Stagehand in this workflow')
    return state.browser as StagehandBrowser
  }
  if (state.creating) {
    // Wait for the other creation to finish
    const start = Date.now()
    while (state.creating && Date.now() - start < 30_000) {
      // busy wait — creation is fast
    }
    if (state.browser) {
      if (isCamofoxBrowser(state.browser)) throw new Error('A Camoufox browser is already active; provider cannot switch to Stagehand in this workflow')
      return state.browser as StagehandBrowser
    }
  }
  state.creating = true
  try {
    const stagehandModel = deriveStagehandModel(config)
    state.browser = new StagehandBrowser({
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      timeout: config.timeout,
      env: config.browser.env as any,
      selfHeal: config.browser.selfHeal,
      domSettleTimeout: config.browser.domSettleTimeout,
      verbose: config.browser.verbose as 0 | 1 | 2,
      disablePino: true,
      scope: 'shared',
      // The browser belongs to the whole interactive session, not one agent
      // turn. Only the host may close it during explicit shutdown.
      excludeTools: ['stagehand_close'],
      model: stagehandModel,
    })
    state.configSnapshot = {
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      env: config.browser.env,
    }
    state.activeBrowser = state.browser

    log.dim(`Stagehand browser initialized with model: ${stagehandModel.modelName}`)
  } finally {
    state.creating = false
  }
  return state.browser as StagehandBrowser
}

export function setActiveBrowser(b: BrowserHandle): void {
  const state = getBrowserManagerState()
  if (state.activeBrowser && state.activeBrowser !== b && state.browser !== b) {
    const previous = state.activeBrowser as any
    if (isCamofoxBrowser(previous)) {
      void (previous.context as any)?.close?.()
    } else {
      void previous.close?.()
    }
  }
  state.activeBrowser = b
}

export function getActiveBrowser(): BrowserHandle | null {
  const state = getBrowserManagerState()
  return state.activeBrowser || state.browser
}

// ─── Phase A: provider-aware session state ───────────────────────────

interface ActiveCamofoxSession {
  handle: unknown
  page: unknown
  context: unknown
  browser: unknown
}
let camofoxSession: ActiveCamofoxSession | null = null

/** Register (or clear) the active Camoufox session so shared flows cover it. */
export function setActiveCamofoxSession(session: ActiveCamofoxSession): void {
  camofoxSession = session
}
export function clearActiveCamofoxSession(): void {
  camofoxSession = null
}
export function getActiveCamofoxSession(): ActiveCamofoxSession | null {
  return camofoxSession
}

/**
 * The active browser context regardless of vendor. Both Stagehand's V3Context
 * and a Playwright BrowserContext expose cookies()/addCookies()/addInitScript()
 * — the shape both call sites rely on.
 */
export function getActiveBrowserContext(): any | null {
  if (camofoxSession) return camofoxSession.context ?? null
  const b = getActiveBrowser()
  if (isCamofoxBrowser(b)) return b.context ?? null
  try {
    return (b as any)?.requireStagehand?.()?.context ?? null
  } catch {
    return null
  }
}

export async function closeBrowser(): Promise<void> {
  const state = getBrowserManagerState()
  if (camofoxSession) {
    try {
      stopDialogWatcher()
      getGlobalReactionObserver().detach()
      const ctx = camofoxSession.context as any
      await ctx?.close?.()
      await (camofoxSession.browser as any)?.close?.()
    } catch (err) {
      log.dim(`Camoufox close error: ${err instanceof Error ? err.message : String(err)}`)
    }
    camofoxSession = null
  }
  if (state.browser) {
    try {
      stopDialogWatcher()
      getGlobalReactionObserver().detach()
      getGlobalObserver().detach()
      const browser = state.browser
      if (isCamofoxBrowser(browser)) {
        await (browser.context as any)?.close?.()
        await (browser as any)?.close?.()
      } else {
        await (browser as any)?.close?.()
      }
    } catch (err) {
      log.dim(`Browser close error: ${err instanceof Error ? err.message : String(err)}`)
    }
    state.browser = null
    state.activeBrowser = null
    state.configSnapshot = null
  }
}

export async function getBrowserState(): Promise<{
  active: boolean
  headless: boolean | null
  env: string | null
  pageCount: number | null
  currentUrl: string | null
  humanCaptureActive: boolean
}> {
  const state = getBrowserManagerState()
  const b = state.activeBrowser || state.browser
  const page = await getActivePage()
  let pageCount: number | null = null
  let currentUrl: string | null = null

  try {
    const stagehand = (b as any)?.requireStagehand?.()
    const pages = typeof stagehand?.context?.pages === 'function'
      ? stagehand.context.pages()
      : stagehand?.context?.pages
    if (Array.isArray(pages)) pageCount = pages.length
  } catch {}

  try {
    currentUrl = typeof page?.url === 'function' ? page.url() : null
  } catch {}

  return {
    active: !!b,
    headless: state.configSnapshot?.headless ?? null,
    env: state.configSnapshot?.env ?? null,
    pageCount,
    currentUrl,
    humanCaptureActive: getGlobalObserver().isCapturing(),
  }
}

/** Call an accessor without letting a provider shape change throw us out of here. */
function safeCall<T>(fn: () => T): T | undefined {
  try { return fn() } catch { return undefined }
}

/** Await an accessor without letting a provider shape change throw us out of here. */
async function safeCallAsync<T>(fn: () => T | Promise<T>): Promise<T | undefined> {
  try { return await fn() } catch { return undefined }
}

/**
 * True for a thenable.
 *
 * A Promise is truthy, so a synchronous accessor read that returns one is
 * indistinguishable from a real page by any truthiness check. That ambiguity
 * is the whole bug, so it gets one named predicate rather than an inline check.
 */
function isThenable(v: unknown): v is Promise<unknown> {
  return !!v && (typeof v === 'object' || typeof v === 'function') &&
    typeof (v as { then?: unknown }).then === 'function'
}

/**
 * Stable short identity for an object, for tracing which instance a reader saw.
 *
 * Two objects with the same field name are the whole failure mode here, so
 * "which instance?" has to be answerable at runtime. WeakMap-based: no global
 * counter to drift, and it never retains anything.
 */
const ids = new WeakMap<object, string>()
let seq = 0
function objId(o: unknown): string {
  if (o === null) return 'null'
  if (o === undefined) return 'undefined'
  if (typeof o !== 'object' && typeof o !== 'function') return String(o)
  let id = ids.get(o as object)
  if (!id) { id = `o${++seq}`; ids.set(o as object, id) }
  return id
}
function stateId(s: unknown): string { return objId(s) }
function handleId(h: unknown): string { return objId(h) }
export const __browserTraceIds = { objId }

/**
 * Resolve the current page from a browser context, whatever shape it exposes.
 *
 * This accessor has changed shape across provider versions, and guessing one is
 * what made the whole browser layer silently dead. Verified live 2026-09-28
 * (OWASP Juice Shop, 5 consecutive runs): the old code read `context.activePage`,
 * absent on Stagehand v3, then fell back to `context.pages?.[0]` — but `pages` is
 * a METHOD there, so `[0]` was undefined and this always returned null.
 * Observation failed with "Browser provider did not expose a navigable page" and
 * the engagement degraded to HTTP-only.
 *
 * The cost was not a missing browser. AuthStateDetector and role learning live
 * in the browser layer, so auth flows and RBAC roles came out 0 on an
 * application built around them, and the agent fell back to guessing endpoint
 * paths. A degraded mode is defensible; a degraded mode nobody can see is not.
 */
export function resolveContextPage(context: any): any | null {
  if (!context) return null
  // Invoked on the object, for the same reason as the async variant: a detached
  // call loses `this` and the accessor throws.
  const fromActive = safeCall(() =>
    typeof context.activePage === 'function' ? context.activePage() : context.activePage)
  if (fromActive && !isThenable(fromActive)) return fromActive

  const pages = safeCall(() =>
    typeof context.pages === 'function' ? context.pages() : context.pages)
  const first = Array.isArray(pages) ? pages[0] : safeCall(() => pages?.[0])
  if (first && !isThenable(first)) return first

  // Some builds expose the current page directly on the context.
  const direct = context.page
  return direct && !isThenable(direct) ? direct : null
}

/**
 * Await the same resolution. This is the CANONICAL form: on Stagehand v3 the
 * page accessors are async, so a synchronous read hands back an unresolved
 * Promise — which is truthy, and therefore looks like a page to every caller
 * until it dereferences `.goto` and finds `undefined`.
 *
 * That is the actual root cause of the dead browser layer, found live
 * 2026-09-29 on OWASP Juice Shop after a runtime probe printed
 * `String(ctx.activePage())` as `[object Object]` — a Promise, not a page. The
 * synchronous resolver was the only thing standing between a working browser
 * and five-plus runs of HTTP-only engagement.
 */
export async function resolveContextPageAsync(context: any): Promise<any | null> {
  if (!context) return null
  // Called ON THE OBJECT, never through a detached reference. `activePage` and
  // `pages` are methods that use `this`; `const f = ctx.activePage; f()` loses
  // the receiver, the call throws, and the guard below swallows it into null.
  // That is why this resolver returned null while a direct `ctx.activePage()` in
  // the very same scope returned a live page object — measured on OWASP Juice
  // Shop 2026-09-29, and the reason every stagehand_* tool reported "No active
  // browser page available for this provider" with a working browser open.
  const fromActive = await safeCallAsync(() =>
    typeof context.activePage === 'function' ? context.activePage() : context.activePage)
  if (fromActive) return fromActive

  const pages = await safeCallAsync(() =>
    typeof context.pages === 'function' ? context.pages() : context.pages)
  const first = Array.isArray(pages) ? pages[0] : await pages?.[0]
  if (first) return first

  const direct = await safeCallAsync(() => context.page)
  return direct ?? null
}

/**
 * Resolve a page, CREATING one if the provider has none yet.
 *
 * The read-only resolver above was not enough. Verified live 2026-09-28 (OWASP
 * Juice Shop, 5 runs): the browser started, exposed no page, and observation
 * failed with "Browser provider did not expose a navigable page" — because
 * observation needs a page in order to navigate, while the provider only gets
 * one once something navigates. A deadlocked pair.
 *
 * The provider does have a way out: `context.newPage(url)`. Verified in the
 * installed @mastra/stagehand build alongside `context.activePage()`,
 * `context.pages()` and `context.setActivePage(page)`. Provisioning here means
 * observation can start from nothing, which is what every browser-resident
 * capability depends on — AuthStateDetector and role learning among them.
 *
 * A URL is passed through when we have one so the page opens already useful;
 * without it, the page is created blank and the caller navigates as before.
 */
export async function ensureContextPage(context: any, url?: string): Promise<any | null> {
  if (!context) return null
  // Awaited, not synchronous: the sync resolver rejects thenables, and on
  // Stagehand v3 every page accessor returns one.
  const existing = await resolveContextPageAsync(context)
  if (existing) return existing
  if (typeof context.newPage !== 'function') return null
  // newPage RETURNS the page it opened. Discarding that and re-resolving was
  // wrong: verified live 2026-09-29, `newPage` succeeded and the follow-up
  // resolve still came back empty, so the open page was thrown away. Prefer the
  // returned value; fall back to a re-read only if it is not navigable.
  let created: any = null
  try {
    created = url ? await context.newPage(url) : await context.newPage()
  } catch {
    return await resolveContextPageAsync(context)
  }
  if (typeof created?.goto === 'function') {
    // Make the new page ACTIVE. A page that exists but is not active is
    // invisible to every later resolution: `activePage()` returns something
    // else (or nothing), so the tools answered "No active browser page
    // available for this provider" on runs where a working page existed and had
    // just been navigated. Verified live on OWASP Juice Shop 2026-09-29.
    if (typeof context.setActivePage === 'function') {
      try { await context.setActivePage(created) } catch { /* best-effort */ }
    }
    return created
  }
  const reread = await resolveContextPageAsync(context)
  if (reread) return reread
  return typeof created?.goto === 'function' ? created : null
}

/**
 * The engagement's active page.
 *
 * ASYNC, necessarily. Stagehand v3 exposes `activePage()` and `pages()` as
 * promises, so a synchronous read can only ever return a thenable — truthy, and
 * therefore passed off as a page by every downstream check. This function was
 * the last-resort fallback for every browser tool, and while it stayed
 * synchronous it silently reported "no page" on runs where a page plainly
 * existed. Verified live on OWASP Juice Shop, 2026-09-29.
 */
export async function getActivePage(): Promise<any | null> {
  const state = getBrowserManagerState()
  const b = state.activeBrowser || state.browser
  if (!b && !camofoxSession) return null
  try {
    const stagehand = (b as any)?.requireStagehand?.()
    const page = await resolveContextPageAsync(stagehand?.context)
    if (page) return page
  } catch {}
  // Camoufox (Playwright) session.
  if (isCamofoxBrowser(b)) return b.page ?? null
  return camofoxSession?.page ?? null
}

export async function captureScreenshot(
  context: string,
  outputDir?: string,
): Promise<string | null> {
  const page = await getActivePage()
  if (!page) return null

  const dir = outputDir || process.cwd()
  const screenshotsDir = resolve(dir, 'screenshots')
  if (!existsSync(screenshotsDir)) {
    mkdirSync(screenshotsDir, { recursive: true })
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const safeContext = redactString(context).replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60)
  const filePath = resolve(screenshotsDir, `${ts}-${safeContext}.png`)

  try {
    await page.screenshot({ path: filePath, fullPage: false })
    log.dim(`📸 Screenshot: ${filePath}`)
    getGlobalArtifactRegistry().create('screenshot', {
      path: filePath,
      initialStatus: 'redacted',
      provenance: [{ source: 'browser', ref: 'captureScreenshot', detail: context }],
    })
    return filePath
  } catch (err) {
    log.dim(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
