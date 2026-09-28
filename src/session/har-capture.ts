import { NetworkCapture } from '../capture/network-capture'
import { chromium } from 'playwright'

export interface HarCapture {
  capture: NetworkCapture
  browser: Awaited<ReturnType<typeof chromium.launch>>
  /** Drain currently captured entries without closing the fallback browser. */
  flush: () => Promise<string | null>
  stop: () => Promise<string | null>
}

export async function startHarCapture(target: string, excludeDomains: string[]): Promise<HarCapture> {
  const captureBrowser = await chromium.launch({ headless: true })
  const page = await captureBrowser.newPage()
  const capture = new NetworkCapture({ excludeDomains })
  capture.start(page)

  // Await the baseline navigation before returning the capture handle. If the
  // caller stops immediately after its own observation, a fire-and-forget
  // navigation leaves the fallback HAR empty.
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500).catch(() => {})

  return {
    capture,
    browser: captureBrowser,
    flush: async () => {
      await capture.flush()
      const entries = capture.getEntries()
      capture.clear()
      if (entries.length === 0) return null
      const har = capture.exportHar()
      return JSON.stringify(har, null, 2)
    },
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
