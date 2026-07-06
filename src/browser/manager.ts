import { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import { PROVIDER_INFO } from '../config'
import { log } from '../utils/logger'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { stopDialogWatcher } from './dialog-watcher'
import { getGlobalReactionObserver } from './reaction-observer'

let browser: StagehandBrowser | null = null
let activeBrowserRef: StagehandBrowser | null = null
let creating = false

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
  if (browser) return browser
  if (creating) {
    // Wait for the other creation to finish
    const start = Date.now()
    while (creating && Date.now() - start < 30_000) {
      // busy wait — creation is fast
    }
    if (browser) return browser!
  }
  creating = true
  try {
    const stagehandModel = deriveStagehandModel(config)
    browser = new StagehandBrowser({
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      timeout: config.timeout,
      env: config.browser.env as any,
      selfHeal: config.browser.selfHeal,
      domSettleTimeout: config.browser.domSettleTimeout,
      verbose: config.browser.verbose as 0 | 1 | 2,
      disablePino: true,
      scope: 'shared',
      model: stagehandModel,
    })
    activeBrowserRef = browser

    log.dim(`Stagehand browser initialized with model: ${stagehandModel.modelName}`)
  } finally {
    creating = false
  }
  return browser!
}

export function setActiveBrowser(b: StagehandBrowser): void {
  if (activeBrowserRef && activeBrowserRef !== b && browser !== b) {
    activeBrowserRef.close().catch(() => {})
  }
  activeBrowserRef = b
}

export function getActiveBrowser(): StagehandBrowser | null {
  return activeBrowserRef || browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    try {
      stopDialogWatcher()
      getGlobalReactionObserver().detach()
      await browser.close()
    } catch (err) {
      log.dim(`Browser close error: ${err instanceof Error ? err.message : String(err)}`)
    }
    browser = null
    activeBrowserRef = null
  }
}

export function getActivePage(): any | null {
  const b = activeBrowserRef || browser
  if (!b) return null
  try {
    const stagehand = (b as any).requireStagehand?.()
    if (stagehand?.context) {
      return stagehand.context.activePage() || stagehand.context.pages?.[0] || null
    }
  } catch {}
  return null
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
  const safeContext = context.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60)
  const filePath = resolve(screenshotsDir, `${ts}-${safeContext}.png`)

  try {
    await page.screenshot({ path: filePath, fullPage: false })
    log.dim(`📸 Screenshot: ${filePath}`)
    return filePath
  } catch (err) {
    log.dim(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
