import { StagehandBrowser } from '@mastra/stagehand'
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
  browser: StagehandBrowser | null
  activeBrowser: StagehandBrowser | null
  creating: boolean
  configSnapshot: { headless: boolean; viewport: { width: number; height: number }; env: string } | null
}

export function createBrowserManagerState(): BrowserManagerState {
  return { browser: null, activeBrowser: null, creating: false, configSnapshot: null }
}

const legacyBrowserManager = createBrowserManagerState()

function getBrowserManagerState(): BrowserManagerState {
  return getEngagementServices()?.browserManager ?? legacyBrowserManager
}

const STAGEHAND_FAST_PROVIDER = 'groq'
const STAGEHAND_FAST_MODEL = 'llama-3.1-8b-instant'

const STAGEHAND_NATIVE_PROVIDERS = new Set([
  'openai', 'anthropic', 'groq', 'google', 'cerebras', 'xai', 'azure',
  'togetherai', 'together', 'mistral', 'deepseek', 'perplexity', 'ollama',
  'vertex', 'bedrock', 'openrouter',
])

function stagehandProvider(raw: string): string {
  return STAGEHAND_NATIVE_PROVIDERS.has(raw) ? raw : 'openai'
}

function deriveStagehandModel(config: UltimatrixConfig) {
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
  if (state.browser) return state.browser
  if (state.creating) {
    // Wait for the other creation to finish
    const start = Date.now()
    while (state.creating && Date.now() - start < 30_000) {
      // busy wait — creation is fast
    }
    if (state.browser) return state.browser
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
  return state.browser!
}

export function setActiveBrowser(b: StagehandBrowser): void {
  const state = getBrowserManagerState()
  if (state.activeBrowser && state.activeBrowser !== b && state.browser !== b) {
    state.activeBrowser.close().catch(() => {})
  }
  state.activeBrowser = b
}

export function getActiveBrowser(): StagehandBrowser | null {
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
      await state.browser.close()
    } catch (err) {
      log.dim(`Browser close error: ${err instanceof Error ? err.message : String(err)}`)
    }
    state.browser = null
    state.activeBrowser = null
    state.configSnapshot = null
  }
}

export function getBrowserState(): {
  active: boolean
  headless: boolean | null
  env: string | null
  pageCount: number | null
  currentUrl: string | null
  humanCaptureActive: boolean
} {
  const state = getBrowserManagerState()
  const b = state.activeBrowser || state.browser
  const page = getActivePage()
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

export function getActivePage(): any | null {
  const state = getBrowserManagerState()
  const b = state.activeBrowser || state.browser
  if (!b && !camofoxSession) return null
  try {
    const stagehand = (b as any)?.requireStagehand?.()
    if (stagehand?.context) {
      return stagehand.context.activePage() || stagehand.context.pages?.[0] || null
    }
  } catch {}
  // Camoufox (Playwright) session.
  return camofoxSession?.page ?? null
}

export async function captureScreenshot(
  context: string,
  outputDir?: string,
): Promise<string | null> {
  const page = getActivePage()
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
