import { StagehandBrowser } from '@mastra/stagehand'
import type { UltimatrixConfig } from '../config'

let browser: StagehandBrowser | null = null

export function getOrCreateBrowser(config: UltimatrixConfig): StagehandBrowser {
  if (!browser) {
    browser = new StagehandBrowser({
      headless: config.browser.headless,
      viewport: config.browser.viewport,
      timeout: config.timeout,
      env: config.browser.env as any,
      selfHeal: config.browser.selfHeal,
      domSettleTimeout: config.browser.domSettleTimeout,
      verbose: config.browser.verbose as 0 | 1 | 2,
      disablePino: true,
    })
  }
  return browser
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close()
    browser = null
  }
}
