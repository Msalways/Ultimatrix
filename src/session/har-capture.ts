import { NetworkCapture } from '../capture/network-capture'
import { chromium } from 'playwright'

export interface HarCapture {
  capture: NetworkCapture
  browser: Awaited<ReturnType<typeof chromium.launch>>
  stop: () => Promise<string | null>
}

export async function startHarCapture(target: string, excludeDomains: string[]): Promise<HarCapture> {
  const captureBrowser = await chromium.launch({ headless: true })
  const page = await captureBrowser.newPage()
  const capture = new NetworkCapture({ excludeDomains })
  capture.start(page)

  page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

  return {
    capture,
    browser: captureBrowser,
    stop: async () => {
      capture.stop()
      await capture.flush()
      await captureBrowser.close()
      const entries = capture.getEntries()
      if (entries.length === 0) return null
      const har = capture.exportHar()
      return JSON.stringify(har, null, 2)
    },
  }
}
