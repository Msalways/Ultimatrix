/**
 * StagehandProvider — Slice 05.
 *
 * Wraps the existing Stagehand browser manager behind the `BrowserProvider`
 * boundary. This is the default provider; it preserves all current Stagehand
 * behavior (shared session browser, dialog watcher, human observer, screenshots).
 *
 * Type-only import of the provider interface — no runtime cycle with `provider.ts`.
 */

import type { StagehandBrowser } from '@mastra/stagehand'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { BrowserProvider, BrowserProviderName, BrowserSession, BrowserStartInput } from './provider'
import {
  captureScreenshot,
  closeBrowser,
  getActiveBrowser,
  getActivePage,
  getOrCreateBrowser,
} from './manager'
import { exportStateFromStagehand } from './state-bridge'
import { getGlobalArtifactRegistry } from '../security/artifacts'
import { getGlobalWorkspace } from '../workspace'
import type { ArtifactRecord } from '../security/artifacts'

export class StagehandProvider implements BrowserProvider {
  readonly name: BrowserProviderName = 'stagehand'

  async start(input: BrowserStartInput): Promise<BrowserSession> {
    const browser = getOrCreateBrowser(input.config)
    await browser.ensureReady()
    return { sessionId: input.sessionId, provider: this.name, browser }
  }

  async getActivePage(_sessionId: string): Promise<unknown> {
    return getActivePage()
  }

  async captureScreenshot(sessionId: string, context: string, outputDir?: string): Promise<string | null> {
    return captureScreenshot(context, outputDir)
  }

  /**
   * Export cookies + localStorage as a durable, redacted `session` artifact.
   * The exported JSON lives under the global memory dir (operational store,
   * mirroring `saveSession` semantics); the artifact record carries redacted
   * metadata only.
   */
  async exportStorage(sessionId: string): Promise<ArtifactRecord> {
    const browser: StagehandBrowser | null = getActiveBrowser()
    const stagehand = (browser as any)?.requireStagehand?.()
    if (!stagehand?.context) {
      throw new Error('Stagehand is not available to export browser storage')
    }
    const state = await exportStateFromStagehand(stagehand)

    const dir = resolve(getGlobalWorkspace().getGlobalMemoryDir(), 'sessions')
    await mkdir(dir, { recursive: true })
    const filePath = resolve(dir, `${sessionId}.json`)
    await writeFile(filePath, JSON.stringify({ cookies: state.cookies, localStorage: state.localStorage }, null, 2), 'utf8')

    return getGlobalArtifactRegistry().create('session', {
      initialStatus: 'redacted',
      provenance: [
        { source: 'browser', detail: 'cookies + localStorage', ref: 'exportStorage' },
        { source: 'redaction', detail: 'operational store retained; metadata redacted' },
      ],
      metadata: {
        sessionId,
        cookieCount: state.cookies.length,
        localStorageKeys: Object.keys(state.localStorage).length,
      },
    })
  }

  async close(_sessionId: string): Promise<void> {
    await closeBrowser()
  }
}
