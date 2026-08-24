/**
 * Anti-bot typed-signal tests (Phase C, spec 03 task 8).
 *
 * Detection must derive from TYPED PROTOCOL SIGNALS only — mitigation
 * headers, blocked-class status corroborated by interstitial shape, and exact
 * challenge-platform iframe hostnames. A source guard pins the no-regex /
 * no-content-vocab rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

function makePage(overrides: Record<string, any> = {}) {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: vi.fn().mockResolvedValue({
      title: '',
      bodyTextLength: 0,
      formCount: 0,
      iframeHosts: [],
    }),
    ...overrides,
  }
}

describe('BotDetectionHandler (typed signals)', () => {
  let BotDetectionHandler: typeof import('../../src/browser/anti-bot').BotDetectionHandler
  let resetGlobalBotHandler: typeof import('../../src/browser/anti-bot').resetGlobalBotHandler

  beforeEach(async () => {
    const mod = await import('../../src/browser/anti-bot')
    BotDetectionHandler = mod.BotDetectionHandler
    resetGlobalBotHandler = mod.resetGlobalBotHandler
    resetGlobalBotHandler()
  })

  describe('detectChallenge', () => {
    it('returns no challenge for clean pages', async () => {
      const handler = new BotDetectionHandler!()
      const challenge = await handler.detectChallenge(makePage() as any)
      expect(challenge.detected).toBe(false)
      expect(challenge.signals).toEqual([])
    })

    it('attributes cloudflare from the cf-mitigated protocol header', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: '', bodyTextLength: 120, formCount: 1, iframeHosts: [] }),
      })
      const challenge = await handler.detectChallenge(page as any, {
        status: 403,
        headers: { 'cf-mitigated': 'challenge' },
      })
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('cloudflare')
      expect(challenge.challengeType).toBe('browser-verification')
      expect(challenge.signals.some(s => s.kind === 'header')).toBe(true)
    })

    it('attributes datadome from the x-datadome header', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage()
      const challenge = await handler.detectChallenge(page as any, {
        status: 403,
        headers: { 'X-DataDome': 'captcha' },   // header name matching is case-insensitive
      })
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('datadome')
      expect(challenge.challengeType).toBe('captcha')
    })

    it('detects via exact challenge-platform iframe hostname', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: '',
          bodyTextLength: 50,
          formCount: 0,
          iframeHosts: ['challenges.cloudflare.com'],
        }),
      })
      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('cloudflare')
      expect(challenge.challengeType).toBe('browser-verification')
      expect(challenge.signals[0].kind).toBe('platform-frame')
    })

    it('detects datadome captcha-delivery frame', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: '',
          bodyTextLength: 30,
          formCount: 0,
          iframeHosts: ['geo.captcha-delivery.com'],
        }),
      })
      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('datadome')
    })

    it('does not false-positive on ordinary third-party frames', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Shop',
          bodyTextLength: 5000,
          formCount: 2,
          iframeHosts: ['www.youtube-nocookie.com', 'analytics.example.com'],
        }),
      })
      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(false)
    })

    it('flags blocked status only when an interstitial shape corroborates', async () => {
      const handler = new BotDetectionHandler!()

      // Thin interstitial + 403 → detected (vendor unknown).
      const thin = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: 'Access Denied', bodyTextLength: 90, formCount: 1, iframeHosts: [] }),
      })
      const detected = await handler.detectChallenge(thin as any, { status: 403 })
      expect(detected.detected).toBe(true)
      expect(detected.vendor).toBe('unknown')
      expect(detected.challengeType).toBe('access-block')

      // Rich content + 403 (legit forbidden page) → NOT attributed.
      const rich = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: 'Forbidden', bodyTextLength: 8000, formCount: 4, iframeHosts: [] }),
      })
      const notDetected = await handler.detectChallenge(rich as any, { status: 403 })
      expect(notDetected.detected).toBe(false)
      expect(notDetected.signals.length).toBeGreaterThan(0) // recorded as evidence
    })

    it('status alone without context does not fabricate a detection', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: 'Home', bodyTextLength: 9000, formCount: 3, iframeHosts: [] }),
      })
      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(false)
    })

    it('handles page evaluation errors gracefully (transport signals still apply)', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({ evaluate: vi.fn().mockRejectedValue(new Error('page crashed')) })
      const dead = await handler.detectChallenge(page as any)
      expect(dead.detected).toBe(false)

      const withHeader = await handler.detectChallenge(page as any, { headers: { 'cf-mitigated': 'challenge' } })
      expect(withHeader.detected).toBe(true)
    })

    it('stores challenges in history with signals', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: '', bodyTextLength: 10, formCount: 0, iframeHosts: ['challenges.cloudflare.com'] }),
      })
      await handler.detectChallenge(page as any)
      const history = handler.getChallenges()
      expect(history).toHaveLength(1)
      expect(history[0].signals[0].kind).toBe('platform-frame')
    })
  })

  describe('waitForResolution', () => {
    it('returns true when challenge resolves', async () => {
      const handler = new BotDetectionHandler!()
      let callCount = 0
      const page = makePage({
        evaluate: vi.fn().mockImplementation(async () => {
          callCount++
          return callCount <= 2
            ? { title: '', bodyTextLength: 5, formCount: 0, iframeHosts: ['challenges.cloudflare.com'] }
            : { title: 'Welcome', bodyTextLength: 900, formCount: 1, iframeHosts: [] }
        }),
      })
      const resolved = await handler.waitForResolution(page as any, 5000)
      expect(resolved).toBe(true)
    })

    it('returns false when challenge does not resolve within timeout', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: '', bodyTextLength: 5, formCount: 0, iframeHosts: ['challenges.cloudflare.com'] }),
      })
      const resolved = await handler.waitForResolution(page as any, 1500)
      expect(resolved).toBe(false)
    })

    it('prevents concurrent waits', async () => {
      const handler = new BotDetectionHandler!()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({ title: '', bodyTextLength: 5, formCount: 0, iframeHosts: ['challenges.cloudflare.com'] }),
      })
      const first = handler.waitForResolution(page as any, 2000)
      const second = handler.waitForResolution(page as any, 2000)
      expect(await second).toBe(false)
      await first
    })
  })

  describe('getPromptMessage', () => {
    it('returns vendor-specific message for Cloudflare', () => {
      const handler = new BotDetectionHandler!()
      const msg = handler.getPromptMessage({
        detected: true, vendor: 'cloudflare', challengeType: 'browser-verification',
        pageTitle: '', url: '', timestamp: Date.now(), signals: [],
      })
      expect(msg).toContain('Cloudflare')
    })

    it('falls back to the generic message for unknown vendors', () => {
      const handler = new BotDetectionHandler!()
      const msg = handler.getPromptMessage({
        detected: true, vendor: 'unknown', challengeType: 'access-block',
        pageTitle: '', url: '', timestamp: Date.now(), signals: [],
      })
      expect(msg).toContain('bot detection challenge')
    })
  })

  describe('no-vocabulary-detection guard (source scan)', () => {
    it('contains no regex literals or content-text pattern lists', () => {
      const source = readFileSync(join(process.cwd(), 'src/browser/anti-bot.ts'), 'utf8')
      expect(source).not.toMatch(/\/(?![/*])[^\n]*\/[gimsuy]*\s*[,)\]]/)     // regex literals in code
      expect(source).not.toMatch(/titlePatterns|bodyPatterns|domPatterns/)   // frozen vocab tables
      expect(source).not.toMatch(/innerText\.slice|bodyText\.slice/)         // content capture for matching
    })
  })
})
