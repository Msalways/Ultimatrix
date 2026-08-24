/**
 * Anti-Bot Detection & Challenge Handling
 *
 * Detects bot-protection challenges from TYPED PROTOCOL SIGNALS only — HTTP
 * status classes, protocol header names/values, and exact challenge-platform
 * iframe hostnames. No title/body-text regexes, no frozen CSS selector lists
 * (both were fragile vocabulary detection and violated the standing
 * no-keyword-detection rule).
 *
 * Vendor attribution uses a small registry of PROTOCOL CONSTANTS (header
 * names, platform hosts) — the same class of registry as TOOL_IDS.
 */

import { log } from '../utils/logger'
import { getEngagementServices } from '../runtime/engagement-context'

export type BotVendor =
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'perimeterx'
  | 'unknown'

/** How the challenge was detected — every signal is a structured fact. */
export interface ChallengeSignal {
  kind: 'status' | 'header' | 'platform-frame' | 'thin-interstitial'
  detail: string
}

export interface BotChallenge {
  detected: boolean
  vendor: BotVendor
  challengeType: string
  pageTitle: string
  url: string
  timestamp: number
  /** Typed evidence for the decision — never prose matching. */
  signals: ChallengeSignal[]
}

/** Optional transport-level context supplied by navigation callers. */
export interface NavigationContext {
  status?: number
  headers?: Record<string, string>
}

/**
 * Statuses that (with corroboration) indicate an access-control challenge.
 * Status alone is NOT sufficient — some sites 403 legitimately.
 */
const CHALLENGE_STATUS = new Set([403, 429, 503])

/** Protocol headers that identify a challenge/bot-mitigation response. */
const CHALLENGE_HEADERS: Array<{ name: string; vendor: BotVendor; challengeType: string }> = [
  { name: 'cf-mitigated', vendor: 'cloudflare', challengeType: 'browser-verification' },
  { name: 'x-datadome', vendor: 'datadome', challengeType: 'captcha' },
]

/** Exact hostnames that exclusively serve challenge platforms (iframe srcs). */
const PLATFORM_FRAME_HOSTS: Record<string, { vendor: BotVendor; challengeType: string }> = {
  'challenges.cloudflare.com': { vendor: 'cloudflare', challengeType: 'browser-verification' },
  'geo.captcha-delivery.com': { vendor: 'datadome', challengeType: 'captcha' },
  'captcha-delivery.com': { vendor: 'datadome', challengeType: 'captcha' },
}

const CHALLENGE_WAIT_MS = 30_000
const CHALLENGE_POLL_MS = 500

interface PageStructureSignals {
  url: string
  title: string
  bodyTextLength: number
  formCount: number
  iframeHosts: string[]
}

function normalizeHeaderName(name: string): string {
  return name.toLowerCase()
}

/**
 * Collect STRUCTURAL page facts (counts, lengths, exact hosts) — no content
 * pattern matching inside the page.
 */
async function collectPageSignals(page: any): Promise<PageStructureSignals> {
  const info = await page.evaluate(() => {
    const iframes = Array.from(document.querySelectorAll('iframe'))
    const hosts: string[] = []
    for (const iframe of iframes) {
      try {
        // Empty src / relative frames resolve against location — skip them.
        if (!iframe.src) continue
        hosts.push(new URL(iframe.src).hostname.toLowerCase())
      } catch {
        /* malformed src — ignore */
      }
    }
    return {
      title: document.title || '',
      bodyTextLength: (document.body?.innerText || '').length,
      formCount: document.querySelectorAll('form').length,
      iframeHosts: hosts,
    }
  })
  return {
    url: typeof page.url === 'function' ? page.url() : '',
    ...info,
  }
}

export class BotDetectionHandler {
  private challenges: BotChallenge[] = []
  private isWaiting = false

  /**
   * Detect a bot challenge from typed signals:
   * - mitigation headers on the navigating response (when context provided)
   * - blocked-class status corroborated by a thin interstitial shape
   * - exact challenge-platform iframe hostnames
   */
  async detectChallenge(page: any, context?: NavigationContext): Promise<BotChallenge> {
    const signals: ChallengeSignal[] = []
    let vendor: BotVendor = 'unknown'
    let challengeType = 'unknown'

    const push = (kind: ChallengeSignal['kind'], detail: string) => signals.push({ kind, detail })
    const attribute = (v: BotVendor, t: string) => {
      if (vendor === 'unknown') {
        vendor = v
        challengeType = t
      }
    }

    let pageSignals: PageStructureSignals = {
      url: typeof page?.url === 'function' ? page.url() : '',
      title: '',
      bodyTextLength: 0,
      formCount: 0,
      iframeHosts: [],
    }

    try {
      pageSignals = await collectPageSignals(page)
    } catch {
      // Page may be unavailable — transport signals still apply.
    }

    // 1. Mitigation headers (protocol names; values compared exactly).
    const headers = context?.headers ?? {}
    for (const hint of CHALLENGE_HEADERS) {
      const match = Object.keys(headers).find((k) => normalizeHeaderName(k) === hint.name)
      if (match !== undefined) {
        push('header', `${hint.name}: ${String(headers[match]).slice(0, 80)}`)
        attribute(hint.vendor, hint.challengeType)
      }
    }

    // 2. Blocked-class status + thin interstitial shape (no content matching).
    const status = context?.status
    let statusCorroborated = false
    const thin =
      pageSignals.bodyTextLength < 400 &&
      pageSignals.formCount <= 1 &&
      pageSignals.title.length > 0
    if (status !== undefined && CHALLENGE_STATUS.has(status)) {
      if (thin || signals.length > 0) {
        statusCorroborated = true
        push('status', `HTTP ${status} with ${thin ? 'thin interstitial' : 'corroborating signal'}`)
        if (vendor === 'unknown') challengeType = 'access-block'
      } else {
        // Recorded as evidence but insufficient alone — legitimate 403s exist.
        push('status', `HTTP ${status} without interstitial shape`)
      }
    }

    // 3. Exact challenge-platform frame hosts.
    for (const host of pageSignals.iframeHosts) {
      const platform = PLATFORM_FRAME_HOSTS[host]
      if (platform) {
        push('platform-frame', host)
        attribute(platform.vendor, platform.challengeType)
      }
    }

    const detected = statusCorroborated || signals.some((s) => s.kind !== 'status')

    const result: BotChallenge = {
      detected,
      vendor: detected ? vendor : 'unknown',
      challengeType: detected ? challengeType : 'unknown',
      pageTitle: pageSignals.title,
      url: pageSignals.url,
      timestamp: Date.now(),
      signals,
    }

    if (detected) {
      this.challenges.push(result)
      log.info(`[anti-bot] Detected ${result.vendor} ${result.challengeType} on ${result.url} (${signals.map(s => s.kind).join(',')})`)
    }

    return result
  }

  /**
   * Wait for a bot challenge to resolve (up to timeoutMs).
   * Polls the page at regular intervals, checking if the challenge is gone.
   * Returns true if resolved, false if timed out.
   */
  async waitForResolution(page: any, timeoutMs = CHALLENGE_WAIT_MS): Promise<boolean> {
    if (this.isWaiting) return false
    this.isWaiting = true

    const start = Date.now()
    log.info(`[anti-bot] Waiting up to ${timeoutMs}ms for challenge resolution...`)

    try {
      while (Date.now() - start < timeoutMs) {
        await new Promise(r => setTimeout(r, CHALLENGE_POLL_MS))
        const challenge = await this.detectChallenge(page)
        if (!challenge.detected) {
          log.info(`[anti-bot] Challenge resolved after ${Date.now() - start}ms`)
          return true
        }
      }
    } finally {
      this.isWaiting = false
    }

    log.warn(`[anti-bot] Challenge not resolved after ${timeoutMs}ms`)
    return false
  }

  /**
   * Get a prompt message for the human operator to solve the challenge.
   * Only useful when running in headful mode.
   */
  getPromptMessage(challenge: BotChallenge): string {
    const vendorMessages: Record<BotVendor, string> = {
      cloudflare: 'Cloudflare bot protection detected. Please solve the challenge in the browser window (click "Verify you are human" or wait for auto-resolution).',
      akamai: 'Akamai Bot Manager challenge detected. Please complete the verification in the browser window.',
      datadome: 'DataDome CAPTCHA detected. Please solve the CAPTCHA in the browser window.',
      perimeterx: 'PerimeterX/HUMAN challenge detected. Please complete the security check in the browser window.',
      unknown: 'A bot detection challenge was detected. Please complete the verification in the browser window.',
    }
    return vendorMessages[challenge.vendor]
  }

  /**
   * Get all detected challenges during this session.
   */
  getChallenges(): BotChallenge[] {
    return [...this.challenges]
  }

  /**
   * Clear stored challenges.
   */
  clear(): void {
    this.challenges = []
    this.isWaiting = false
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

let globalHandler: BotDetectionHandler | null = null

export function getGlobalBotHandler(): BotDetectionHandler {
  const owned = getEngagementServices()?.botHandler
  if (owned) return owned
  if (!globalHandler) globalHandler = new BotDetectionHandler()
  return globalHandler
}

export function resetGlobalBotHandler(): void {
  const owned = getEngagementServices()?.botHandler
  if (owned) {
    owned.clear()
    return
  }
  globalHandler = null
}
