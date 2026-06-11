import { AgentBrowser } from '@mastra/agent-browser'

let browser: AgentBrowser | null = null

export function getBrowser(): AgentBrowser {
  if (!browser) {
    browser = new AgentBrowser({
      headless: true,
      viewport: { width: 1280, height: 720 },
      timeout: 30000,
      scope: 'shared',
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

process.on('exit', () => { if (browser) browser.close().catch(() => {}) })
process.on('SIGINT', () => { if (browser) browser.close().catch(() => {}).finally(() => process.exit(0)) })
process.on('SIGTERM', () => { if (browser) browser.close().catch(() => {}).finally(() => process.exit(0)) })
