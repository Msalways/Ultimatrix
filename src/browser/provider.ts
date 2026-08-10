/**
 * Browser Provider Abstraction — Slice 05.
 *
 * A provider-neutral boundary over browser execution. The configured provider
 * is selected at workflow start, recorded in `WorkflowState`, and fixed for the
 * lifetime of that workflow (resume with a different provider is rejected).
 *
 * Only `stagehand` is implemented today. Unsupported providers fail clearly —
 * they never fall back silently. `camofox` is declared for forward-compat but
 * must not be constructed until its implementation lands.
 *
 * No provider name is inferred from strings: `BrowserProviderName` is a closed
 * typed union and the factory rejects anything outside it.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'
import type { ArtifactRecord } from '../security/artifacts'
import { StagehandProvider } from './stagehand-provider'

export type BrowserProviderName = 'stagehand' | 'camofox'

export interface BrowserStartInput {
  config: UltimatrixConfig
  workflowId?: string
  sessionId: string
}

/** A started browser session. `browser` is the provider-specific handle. */
export interface BrowserSession {
  sessionId: string
  provider: BrowserProviderName
  browser: StagehandBrowser
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

/** Declared providers that are planned but not yet implemented. */
const PLANNED_PROVIDERS: ReadonlySet<BrowserProviderName> = new Set(['camofox'])

/**
 * Resolve a provider instance for the configured provider. Throws a clear error
 * for unsupported or planned-but-unimplemented providers — never a silent
 * fallback to the default.
 */
export function resolveBrowserProvider(config: UltimatrixConfig): BrowserProvider {
  const requested = config.browser.provider ?? 'stagehand'
  if (requested !== 'stagehand') {
    if (PLANNED_PROVIDERS.has(requested)) {
      throw new Error(
        `Browser provider '${requested}' is planned but not yet implemented. Keep browser.provider: 'stagehand' (the default).`,
      )
    }
    throw new Error(`Unsupported browser provider: '${requested}'. Supported providers: stagehand.`)
  }
  return new StagehandProvider()
}

export function isBrowserProviderName(value: unknown): value is BrowserProviderName {
  return value === 'stagehand' || value === 'camofox'
}
