/**
 * CamoufoxProvider â€” Phase A (spec 02 A2/A3).
 *
 * Anti-detection Firefox (Camoufox) launched through Playwright. This is the
 * root-cause fix for bot-challenge-blocked crawls: the browser is not
 * fingerprintable automation Chromium.
 *
 * Launch contract:
 * - Executable resolved from config.browser.camofox.executablePath, then the
 *   CAMOUFOX_EXECUTABLE env var. FAIL-CLOSED when absent â€” never a silent
 *   chromium fallback, which would reintroduce the fingerprinting problem.
 * - The binary itself is obtained out-of-band (the camoufox fetcher or a
 *   manual install); this provider only launches what it is given.
 *
 * The handle exposes Playwright page/context plus the same 7-tool surface as
 * stagehand, so wrapStagehandTools (scope guard, dialog/reaction evidence,
 * render tracing) applies unchanged and consumers stay provider-blind.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import type { BrowserContext, Page } from 'playwright'
import type {
  BrowserProvider,
  BrowserProviderName,
  BrowserSession,
  BrowserStartInput,
  CamofoxBrowserHandle,
} from './provider'
import type { ArtifactRecord } from '../security/artifacts'
import { createCamoufoxTools } from './camoufox-tools'
import { getGlobalArtifactRegistry } from '../security/artifacts'
import { getGlobalWorkspace } from '../workspace'
import { setActiveCamofoxSession, clearActiveCamofoxSession } from './manager'

export class CamoufoxProvider implements BrowserProvider {
  readonly name: BrowserProviderName = 'camofox'
  private session: { context: BrowserContext; page: Page; browser: import('playwright').Browser } | null = null

  private resolveExecutable(config: BrowserStartInput['config']): string {
    const fromConfig = config.browser.camofox?.executablePath?.trim()
    const fromEnv = process.env.CAMOUFOX_EXECUTABLE?.trim()
    const candidate = fromConfig || fromEnv || ''
    if (!candidate || !existsSync(candidate)) {
      throw new Error(
        `Browser provider 'camofox' requires the Camoufox Firefox executable. ` +
          `Set browser.camofox.executablePath (or CAMOUFOX_EXECUTABLE) to a valid binary. ` +
          `Received: '${candidate || '(unset)'}'. Never falls back to chromium â€” that would reintroduce fingerprinting.`,
      )
    }
    return candidate
  }

  async start(input: BrowserStartInput): Promise<BrowserSession> {
    const executablePath = this.resolveExecutable(input.config)
    // Lazy import so playwright stays tree-shakeable elsewhere.
    const { firefox } = await import('playwright')

    const camo = input.config.browser.camofox ?? {}
    const browser = await firefox.launch({
      executablePath,
      headless: input.config.browser.headless ?? true,
      ...(camo.proxy ? { proxy: { server: camo.proxy.server, username: camo.proxy.username, password: camo.proxy.password } } : {}),
    })

    const context = await browser.newContext({
      viewport: input.config.browser.viewport,
      ...(camo.locale ? { locale: camo.locale } : {}),
    })
    // Humanize: light deterministic jitter between actions (camoufox humanize
    // equivalent at the Playwright layer).
    if (camo.humanize) {
      await context.addInitScript(() => {
        const originalClick = HTMLElement.prototype.click
        HTMLElement.prototype.click = function (...args: Parameters<HTMLElement['click']>) {
          return new Promise<number>((resolveTick) => setTimeout(resolveTick, 40 + Math.floor(Math.random() * 90)))
            .then(() => originalClick.apply(this, args))
        }
      })
    }

    const page = await context.newPage()
    this.session = { context, page, browser }

    const handle: CamofoxBrowserHandle = {
      providerName: 'camofox',
      get page() { return page },
      get context() { return context },
      getTools: () => createCamoufoxTools({ page, context }),
      requireContext: () => context,
    }

    // Register with the shared manager so getActivePage()/close flows cover
    // this session without consumers knowing the vendor.
    setActiveCamofoxSession({ handle, page, context, browser })

    return { sessionId: input.sessionId, provider: this.name, browser: handle }
  }

  async getActivePage(_sessionId: string): Promise<unknown> {
    return this.session?.page ?? null
  }

  async captureScreenshot(sessionId: string, context: string, outputDir?: string): Promise<string | null> {
    void sessionId
    if (!this.session) return null
    try {
      const dir = outputDir || process.cwd()
      const screenshotsDir = resolve(dir, 'screenshots')
      await mkdir(screenshotsDir, { recursive: true })
      const ts = new Date().toISOString().replace(/[:.]/g, '-')
      const safeContext = context.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 60)
      const filePath = resolve(screenshotsDir, `${ts}-${safeContext}.png`)
      await this.session.page.screenshot({ path: filePath, fullPage: false })
      getGlobalArtifactRegistry().create('screenshot', {
        path: filePath,
        initialStatus: 'redacted',
        provenance: [{ source: 'browser', ref: 'camoufox.captureScreenshot', detail: context }],
      })
      return filePath
    } catch {
      return null
    }
  }

  /** Export cookies + localStorage via Playwright storageState. */
  async exportStorage(sessionId: string): Promise<ArtifactRecord> {
    if (!this.session) throw new Error('Camoufox session is not available to export browser storage')
    const state = await this.session.context.storageState()

    const dir = resolve(getGlobalWorkspace().getGlobalMemoryDir(), 'sessions')
    await mkdir(dir, { recursive: true })
    const filePath = resolve(dir, `${sessionId}.json`)
    const localStorage: Record<string, Record<string, string>> = {}
    for (const origin of state.origins) {
      localStorage[origin.origin] = Object.fromEntries(origin.localStorage.map((e) => [e.name, e.value]))
    }
    await writeFile(filePath, JSON.stringify({ cookies: state.cookies, localStorage }, null, 2), 'utf8')

    return getGlobalArtifactRegistry().create('session', {
      initialStatus: 'redacted',
      provenance: [
        { source: 'browser', detail: 'cookies + localStorage (storageState)', ref: 'camoufox.exportStorage' },
        { source: 'redaction', detail: 'operational store retained; metadata redacted' },
      ],
      metadata: {
        sessionId,
        cookieCount: state.cookies.length,
        localStorageKeys: Object.keys(localStorage).length,
      },
    })
  }

  async close(_sessionId: string): Promise<void> {
    clearActiveCamofoxSession()
    if (!this.session) return
    try {
      await this.session.context.close()
      await this.session.browser.close()
    } finally {
      this.session = null
    }
  }
}
