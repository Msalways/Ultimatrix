import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { NetworkCapture } from './network-capture'
import type { CaptureOptions } from './network-capture'

export interface BrowserOptions {
  headless?: boolean
  viewport?: { width: number; height: number }
  timeout?: number
  userAgent?: string
  proxy?: string
  captureOptions?: CaptureOptions
}

export interface ManagedPage {
  page: Page
  capture: NetworkCapture
}

export class BrowserLauncher {
  private browser: Browser | null = null
  private context: BrowserContext | null = null
  private pages = new Map<Page, NetworkCapture>()

  async launch(options: BrowserOptions = {}): Promise<Browser> {
    const {
      headless = true,
      viewport = { width: 1280, height: 720 },
      timeout = 30000,
      userAgent,
      proxy,
    } = options

    try {
      this.browser = await chromium.launch({
        headless,
        args: ['--disable-blink-features=AutomationControlled'],
      })
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to launch browser: ${msg}`, { cause: error })
    }

    try {
      this.context = await this.browser.newContext({
        viewport,
        userAgent,
        proxy: proxy ? { server: proxy } : undefined,
      })
      this.context.setDefaultTimeout(timeout)
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to create browser context: ${msg}`, { cause: error })
    }

    return this.browser
  }

  async newPage(options: BrowserOptions = {}): Promise<ManagedPage> {
    if (!this.context) {
      await this.launch(options)
    }

    let page: Page
    try {
      page = await this.context!.newPage()
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error)
      throw new Error(`Failed to create page: ${msg}`, { cause: error })
    }

    const capture = new NetworkCapture(options.captureOptions)
    capture.start(page)
    this.pages.set(page, capture)

    return { page, capture }
  }

  async closePage(page: Page): Promise<void> {
    const capture = this.pages.get(page)
    if (capture) {
      capture.stop()
      this.pages.delete(page)
    }
    await page.close()
  }

  async close(): Promise<void> {
    for (const [page, capture] of this.pages) {
      capture.stop()
      await page.close().catch(() => {})
    }
    this.pages.clear()

    if (this.context) {
      await this.context.close().catch(() => {})
      this.context = null
    }

    if (this.browser) {
      await this.browser.close().catch(() => {})
      this.browser = null
    }
  }

  getBrowser(): Browser | null {
    return this.browser
  }

  getContext(): BrowserContext | null {
    return this.context
  }

  getAllCaptures(): NetworkCapture[] {
    return Array.from(this.pages.values())
  }

  getCaptureForPage(page: Page): NetworkCapture | undefined {
    return this.pages.get(page)
  }

  exportAllHar(): string {
    const allEntries = this.getAllCaptures().flatMap(c => c.getEntries())
    const archive = {
      log: {
        version: '1.2',
        creator: { name: 'ultimatrix', version: '7.0.0' },
        entries: allEntries,
      },
    }
    return JSON.stringify(archive, null, 2)
  }
}
