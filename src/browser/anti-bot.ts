/**
 * Anti-Bot Detection & Challenge Handling
 *
 * Detects common bot-protection challenges (Cloudflare, Akamai, DataDome,
 * PerimeterX/HUMAN) and either waits for auto-resolution or prompts the
 * human operator to solve the challenge manually.
 *
 * Design: Challenge patterns are identified by page title, body text,
 * and DOM elements — not by fragile CSS class names or resource URLs.
 * Each vendor has unique markers that survive obfuscation.
 */

import { log } from '../utils/logger'

export type BotVendor =
  | 'cloudflare'
  | 'akamai'
  | 'datadome'
  | 'perimeterx'
  | 'unknown'

export interface BotChallenge {
  detected: boolean
  vendor: BotVendor
  challengeType: string
  pageTitle: string
  url: string
  timestamp: number
}

interface VendorPattern {
  vendor: BotVendor
  challengeType: string
  titlePatterns: RegExp[]
  bodyPatterns: RegExp[]
  domPatterns: string[]
}

const VENDOR_PATTERNS: VendorPattern[] = [
  {
    vendor: 'cloudflare',
    challengeType: 'browser-verification',
    titlePatterns: [
      /just a moment/i,
      /checking your browser/i,
      /attention required/i,
      /cloudflare/i,
    ],
    bodyPatterns: [
      /checking if the site connection is secure/i,
      /enable javascript and cookies to continue/i,
      /ray id:/i,
      /cloudflare ray/i,
      /checking your browser.*before accessing/i,
      /this process is automatic/i,
      /turnstile/i,
      /cf-challenge/i,
      /_cf_chl_/i,
    ],
    domPatterns: [
      '#challenge-running',
      '#challenge-stage',
      '.cf-browser-verification',
      '#cf-challenge-running',
      '.cf-turnstile',
      '[data-sitekey]',
    ],
  },
  {
    vendor: 'cloudflare',
    challengeType: 'captcha',
    titlePatterns: [
      /attention required/i,
    ],
    bodyPatterns: [
      /captcha/i,
      /verify you are human/i,
      /are you a robot/i,
    ],
    domPatterns: [
      '.cf-captcha',
      '#challenge-form',
    ],
  },
  {
    vendor: 'akamai',
    challengeType: 'bot-manager',
    titlePatterns: [
      /akamai/i,
      /access denied/i,
      /request blocked/i,
    ],
    bodyPatterns: [
      /akamai.*bot.*manager/i,
      /reference.*#\d+/i,
      /access denied/i,
      /unable to fulfill/i,
      /your request has been blocked/i,
      /ak_bmsc_/i,
      /bm_sv=/i,
    ],
    domPatterns: [
      '#akamai-bot-manager',
      '.akamai-challenge',
    ],
  },
  {
    vendor: 'datadome',
    challengeType: 'captcha',
    titlePatterns: [
      /datadome/i,
      /access denied/i,
    ],
    bodyPatterns: [
      /datadome/i,
      /blocked by datadome/i,
      /captcha.*datadome/i,
      /dd_captcha/i,
    ],
    domPatterns: [
      '.datadome',
      '#datadome',
      'iframe[src*="datadome"]',
    ],
  },
  {
    vendor: 'perimeterx',
    challengeType: 'human-challenge',
    titlePatterns: [
      /perimeterx/i,
      /please verify/i,
      /human verification/i,
    ],
    bodyPatterns: [
      /perimeterx/i,
      /px-captcha/i,
      /human.*verification/i,
      /please complete.*security check/i,
      /blocked.*perimeterx/i,
    ],
    domPatterns: [
      '#px-captcha',
      '.px-captcha',
      '[id*="px-"]',
    ],
  },
]

const CHALLENGE_WAIT_MS = 30_000
const CHALLENGE_POLL_MS = 500

export class BotDetectionHandler {
  private challenges: BotChallenge[] = []
  private isWaiting = false

  /**
   * Detect if the current page is showing a bot challenge.
   * Returns structured challenge info without any substring hacks.
   */
  async detectChallenge(page: any): Promise<BotChallenge> {
    const result: BotChallenge = {
      detected: false,
      vendor: 'unknown',
      challengeType: 'unknown',
      pageTitle: '',
      url: '',
      timestamp: Date.now(),
    }

    try {
      const url = typeof page.url === 'function' ? page.url() : ''
      const info = await page.evaluate(() => {
        const title = document.title || ''
        const bodyText = document.body?.innerText || ''

        // Check DOM elements for vendor-specific selectors
        const domMatches: string[] = []
        const selectors = [
          '#challenge-running', '#challenge-stage', '.cf-browser-verification',
          '#cf-challenge-running', '.cf-turnstile', '.cf-captcha', '#challenge-form',
          '#akamai-bot-manager', '.akamai-challenge',
          '.datadome', '#datadome',
          '#px-captcha', '.px-captcha',
        ]
        for (const sel of selectors) {
          try {
            if (document.querySelector(sel)) domMatches.push(sel)
          } catch { /* ignore invalid selectors */ }
        }

        // Check for iframes that might contain challenges
        const iframes = document.querySelectorAll('iframe')
        const challengeIframes: string[] = []
        for (const iframe of iframes) {
          const src = iframe.src || ''
          if (src.includes('datadome') || src.includes('challenges.cloudflare.com') || src.includes('captcha')) {
            challengeIframes.push(src)
          }
        }

        return { title, bodyText: bodyText.slice(0, 2000), domMatches, challengeIframes }
      })

      result.url = url
      result.pageTitle = info.title

      // Match against vendor patterns
      for (const vendor of VENDOR_PATTERNS) {
        const titleMatch = vendor.titlePatterns.some(p => p.test(info.title))
        const bodyMatch = vendor.bodyPatterns.some(p => p.test(info.bodyText))
        const domMatch = vendor.domPatterns.some(sel => info.domMatches.includes(sel))

        if (titleMatch || bodyMatch || domMatch) {
          result.detected = true
          result.vendor = vendor.vendor
          result.challengeType = vendor.challengeType
          break
        }
      }

      // Check for challenge iframes
      if (!result.detected && info.challengeIframes.length > 0) {
        result.detected = true
        result.challengeType = 'iframe-challenge'
        if (info.challengeIframes.some(s => s.includes('cloudflare'))) result.vendor = 'cloudflare'
        else if (info.challengeIframes.some(s => s.includes('datadome'))) result.vendor = 'datadome'
        else result.vendor = 'unknown'
      }
    } catch {
      // Page may be unavailable
    }

    if (result.detected) {
      this.challenges.push(result)
      log.info(`[anti-bot] Detected ${result.vendor} ${result.challengeType} on ${result.url}`)
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
  if (!globalHandler) globalHandler = new BotDetectionHandler()
  return globalHandler
}

export function resetGlobalBotHandler(): void {
  globalHandler = null
}
