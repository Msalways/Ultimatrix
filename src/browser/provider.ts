/**
 * Browser Provider Abstraction — Slice 05 + Phase A (Jarvis Lethality Program).
 *
 * A provider-neutral boundary over browser execution. The configured provider
 * is selected at workflow start, recorded in `WorkflowState`, and fixed for the
 * lifetime of that workflow (resume with a different provider is rejected).
 *
 * Two implemented providers:
 * - `stagehand` — Stagehand v3 (Chromium, CDP-native). Default.
 * - `camofox`   — Camoufox (anti-detection Firefox) launched through
 *   Playwright. Root-cause fix for bot-challenge-blocked crawls: the browser
 *   is no longer fingerprintable automation Chromium.
 *
 * `BrowserSession.browser` is a union of provider handles. Consumers MUST NOT
 * reach into one vendor's shape directly; use manager helpers or branch on
 * `session.provider`. Unsupported providers fail clearly — never silent
 * fallback.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { ArtifactRecord } from '../security/artifacts'
import { StagehandProvider } from './stagehand-provider'
import { CamoufoxProvider } from './camoufox-provider'

export type BrowserProviderName = 'stagehand' | 'camofox'

/**
 * Handle returned by the Camoufox provider. Exposes Playwright objects plus
 * the same duck-typed tool surface wrapStagehandTools consumes (getTools()),
 * so scope-guard/reaction wrapping is provider-blind.
 */
export interface CamofoxBrowserHandle {
  readonly providerName: 'camofox'
  readonly page: unknown
  readonly context: unknown
  /** Same 7 tool ids as the stagehand surface (stagehand_* names kept for vocabulary stability). */
  getTools(): Record<string, any>
  /** Playwright BrowserContext (dialog watcher + capture attach). */
  requireContext(): unknown
}

export type BrowserHandle = StagehandBrowser | CamofoxBrowserHandle

export interface BrowserStartInput {
  config: UltimatrixConfig
  workflowId?: string
  sessionId: string
}

/** A started browser session. `browser` is the provider-specific handle. */
export interface BrowserSession {
  sessionId: string
  provider: BrowserProviderName
  browser: BrowserHandle
}

export function isCamofoxHandle(browser: unknown): browser is CamofoxBrowserHandle {
  return (
    !!browser &&
    typeof browser === 'object' &&
    (browser as CamofoxBrowserHandle).providerName === 'camofox'
  )
}

export interface BrowserProvider {
  readonly name: BrowserProviderName
  start(input: BrowserStartInput): Promise<BrowserSession>
  getActivePage(sessionId: string): Promise<unknown>
  captureScreenshot(sessionId: string, context: string, outputDir?: string): Promise<string | null>
  /** Export browser storage (cookies/localStorage) as a durable artifact. */
  exportStorage(sessionId: string): Promise<ArtifactRecord>
  close(sessionId: string): Promise<void>
}

/**
 * Resolve a provider instance for the configured provider. Throws a clear error
 * for unsupported providers — never a silent fallback to the default.
 */
export function resolveBrowserProvider(config: UltimatrixConfig): BrowserProvider {
  const requested = config.browser.provider ?? 'stagehand'
  if (requested === 'camofox') return new CamoufoxProvider()
  if (requested === 'stagehand') return new StagehandProvider()
  throw new Error(`Unsupported browser provider: '${requested}'. Supported providers: stagehand, camofox.`)
}

export function isBrowserProviderName(value: unknown): value is BrowserProviderName {
  return value === 'stagehand' || value === 'camofox'
}
