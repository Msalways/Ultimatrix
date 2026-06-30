import { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import { PROVIDER_INFO } from '../config'
import { log } from '../utils/logger'
import { mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

let browser: StagehandBrowser | null = null
let activeBrowserRef: StagehandBrowser | null = null

const STAGEHAND_FAST_PROVIDER = 'groq'
const STAGEHAND_FAST_MODEL = 'llama-3.1-8b-instant'

function deriveStagehandModel(config: UltimatrixConfig) {
  if (config.provider === STAGEHAND_FAST_PROVIDER) {
    const creds = config.creds?.[STAGEHAND_FAST_PROVIDER] as { apiKey?: string; baseUrl?: string } | undefined
    const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[STAGEHAND_FAST_PROVIDER]?.envVar] || ''
    const baseURL = creds?.baseUrl || PROVIDER_INFO[STAGEHAND_FAST_PROVIDER]?.defaultBaseUrl
    return { modelName: `${STAGEHAND_FAST_PROVIDER}/${STAGEHAND_FAST_MODEL}`, apiKey, baseURL }
  }

  if (config.modelTiers?.fast) {
    const fastModel = config.modelTiers.fast
    const slashIdx = fastModel.indexOf('/')
    const fastProvider = slashIdx !== -1 ? fastModel.slice(0, slashIdx) : STAGEHAND_FAST_PROVIDER
    const fastModelId = slashIdx !== -1 ? fastModel.slice(slashIdx + 1) : fastModel

    const creds = config.creds?.[fastProvider] as { apiKey?: string; baseUrl?: string } | undefined
    const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[fastProvider]?.envVar] || ''
    const baseURL = creds?.baseUrl || PROVIDER_INFO[fastProvider]?.defaultBaseUrl
    return { modelName: `${fastProvider}/${fastModelId}`, apiKey, baseURL }
  }

  const stagehandNativeProviders = new Set([
    'openai', 'anthropic', 'groq', 'google', 'cerebras', 'xai', 'azure',
    'togetherai', 'together', 'mistral', 'deepseek', 'perplexity', 'ollama',
    'vertex', 'bedrock', 'openrouter',
  ])

  const provider = config.provider
  const model = config.model
  const creds = config.creds?.[provider] as { apiKey?: string; baseUrl?: string } | undefined
  const apiKey = creds?.apiKey || process.env[PROVIDER_INFO[provider]?.envVar] || ''
  const baseURL = creds?.baseUrl || PROVIDER_INFO[provider]?.defaultBaseUrl

  if (stagehandNativeProviders.has(provider)) {
    return { modelName: `${provider}/${model}`, apiKey, baseURL }
  }

  return { modelName: `openai/${model}`, apiKey, baseURL }
}

export function getOrCreateBrowser(config: UltimatrixConfig): StagehandBrowser {
  if (!browser) {
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

    // Log Stagehand model for debugging
    log.dim(`🤖 Stagehand browser initialized with model: ${stagehandModel.modelName}`)
  }
  return browser
}

export function setActiveBrowser(b: StagehandBrowser): void {
  activeBrowserRef = b
}

export function getActiveBrowser(): StagehandBrowser | null {
  return activeBrowserRef || browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
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
