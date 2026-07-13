import { describe, it, expect, vi, beforeEach } from 'vitest'

function makePage(overrides: Record<string, any> = {}) {
  return {
    url: vi.fn().mockReturnValue('https://example.com'),
    evaluate: vi.fn().mockResolvedValue({
      title: '',
      bodyText: '',
      domMatches: [],
      challengeIframes: [],
    }),
    ...overrides,
  }
}

describe('BotDetectionHandler', () => {
  let BotDetectionHandler: typeof import('../../src/browser/anti-bot').BotDetectionHandler
  let getGlobalBotHandler: typeof import('../../src/browser/anti-bot').getGlobalBotHandler
  let resetGlobalBotHandler: typeof import('../../src/browser/anti-bot').resetGlobalBotHandler

  beforeEach(async () => {
    const mod = await import('../../src/browser/anti-bot')
    BotDetectionHandler = mod.BotDetectionHandler
    getGlobalBotHandler = mod.getGlobalBotHandler
    resetGlobalBotHandler = mod.resetGlobalBotHandler
    resetGlobalBotHandler()
  })

  describe('detectChallenge', () => {
    it('returns no challenge for clean pages', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage()
      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(false)
    })

    it('detects Cloudflare "Just a moment" challenge', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Just a moment...',
          bodyText: 'Checking if the site connection is secure. Enable javascript and cookies to continue.',
          domMatches: ['#challenge-running'],
          challengeIframes: [],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('cloudflare')
      expect(challenge.challengeType).toBe('browser-verification')
      expect(challenge.pageTitle).toBe('Just a moment...')
    })

    it('detects Cloudflare Turnstile', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: '',
          bodyText: '',
          domMatches: ['.cf-turnstile'],
          challengeIframes: [],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('cloudflare')
    })

    it('detects Akamai Bot Manager', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Access Denied',
          bodyText: 'Reference #18.abc123. Your request has been blocked by Akamai.',
          domMatches: [],
          challengeIframes: [],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('akamai')
      expect(challenge.challengeType).toBe('bot-manager')
    })

    it('detects DataDome', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: '',
          bodyText: 'Access blocked by DataDome security service. Please complete the challenge.',
          domMatches: ['.datadome'],
          challengeIframes: [],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('datadome')
    })

    it('detects PerimeterX/HUMAN', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Please Verify You Are Human',
          bodyText: 'Access to this page has been restricted by the site owner.',
          domMatches: ['#px-captcha'],
          challengeIframes: [],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('perimeterx')
      expect(challenge.challengeType).toBe('human-challenge')
    })

    it('detects challenge via iframe', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: '',
          bodyText: '',
          domMatches: [],
          challengeIframes: ['https://challenges.cloudflare.com/cdn-cgi/challenge-platform/...'],
        }),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(true)
      expect(challenge.vendor).toBe('cloudflare')
      expect(challenge.challengeType).toBe('iframe-challenge')
    })

    it('handles page evaluation errors gracefully', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockRejectedValue(new Error('page crashed')),
      })

      const challenge = await handler.detectChallenge(page as any)
      expect(challenge.detected).toBe(false)
    })

    it('stores challenges in history', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Just a moment...',
          bodyText: 'Checking your browser',
          domMatches: ['#challenge-running'],
          challengeIframes: [],
        }),
      })

      await handler.detectChallenge(page as any)
      const challenges = handler.getChallenges()
      expect(challenges).toHaveLength(1)
      expect(challenges[0].vendor).toBe('cloudflare')
    })
  })

  describe('waitForResolution', () => {
    it('returns true when challenge resolves', async () => {
      const handler = new BotDetectionHandler()
      let callCount = 0
      const page = makePage({
        evaluate: vi.fn().mockImplementation(async () => {
          callCount++
          if (callCount <= 2) {
            return {
              title: 'Just a moment...',
              bodyText: 'Checking your browser',
              domMatches: ['#challenge-running'],
              challengeIframes: [],
            }
          }
          return {
            title: 'Welcome',
            bodyText: 'Dashboard',
            domMatches: [],
            challengeIframes: [],
          }
        }),
      })

      const resolved = await handler.waitForResolution(page as any, 5000)
      expect(resolved).toBe(true)
    })

    it('returns false when challenge does not resolve within timeout', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Just a moment...',
          bodyText: 'Checking your browser',
          domMatches: ['#challenge-running'],
          challengeIframes: [],
        }),
      })

      const resolved = await handler.waitForResolution(page as any, 1500)
      expect(resolved).toBe(false)
    })

    it('prevents concurrent waits', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Just a moment...',
          bodyText: 'Checking your browser',
          domMatches: ['#challenge-running'],
          challengeIframes: [],
        }),
      })

      // Start first wait (this will block for 2s)
      const first = handler.waitForResolution(page as any, 2000)
      // Second wait should return false immediately (already waiting)
      const second = handler.waitForResolution(page as any, 2000)
      expect(await second).toBe(false)

      // Clean up
      await first
    })
  })

  describe('getPromptMessage', () => {
    it('returns vendor-specific message for Cloudflare', () => {
      const handler = new BotDetectionHandler()
      const msg = handler.getPromptMessage({
        detected: true,
        vendor: 'cloudflare',
        challengeType: 'browser-verification',
        pageTitle: '',
        url: '',
        timestamp: Date.now(),
      })
      expect(msg).toContain('Cloudflare')
      expect(msg).toContain('Verify you are human')
    })

    it('returns vendor-specific message for Akamai', () => {
      const handler = new BotDetectionHandler()
      const msg = handler.getPromptMessage({
        detected: true,
        vendor: 'akamai',
        challengeType: 'bot-manager',
        pageTitle: '',
        url: '',
        timestamp: Date.now(),
      })
      expect(msg).toContain('Akamai')
    })

    it('returns vendor-specific message for DataDome', () => {
      const handler = new BotDetectionHandler()
      const msg = handler.getPromptMessage({
        detected: true,
        vendor: 'datadome',
        challengeType: 'captcha',
        pageTitle: '',
        url: '',
        timestamp: Date.now(),
      })
      expect(msg).toContain('DataDome')
      expect(msg).toContain('CAPTCHA')
    })

    it('returns vendor-specific message for PerimeterX', () => {
      const handler = new BotDetectionHandler()
      const msg = handler.getPromptMessage({
        detected: true,
        vendor: 'perimeterx',
        challengeType: 'human-challenge',
        pageTitle: '',
        url: '',
        timestamp: Date.now(),
      })
      expect(msg).toContain('PerimeterX')
    })

    it('returns generic message for unknown vendor', () => {
      const handler = new BotDetectionHandler()
      const msg = handler.getPromptMessage({
        detected: true,
        vendor: 'unknown',
        challengeType: 'unknown',
        pageTitle: '',
        url: '',
        timestamp: Date.now(),
      })
      expect(msg).toContain('bot detection')
    })
  })

  describe('clear', () => {
    it('clears challenge history', async () => {
      const handler = new BotDetectionHandler()
      const page = makePage({
        evaluate: vi.fn().mockResolvedValue({
          title: 'Just a moment...',
          bodyText: 'Checking your browser',
          domMatches: ['#challenge-running'],
          challengeIframes: [],
        }),
      })

      await handler.detectChallenge(page as any)
      expect(handler.getChallenges()).toHaveLength(1)

      handler.clear()
      expect(handler.getChallenges()).toHaveLength(0)
    })
  })

  describe('global handler', () => {
    it('returns same instance from getGlobalBotHandler', () => {
      const a = getGlobalBotHandler()
      const b = getGlobalBotHandler()
      expect(a).toBe(b)
    })

    it('resetGlobalBotHandler creates fresh instance', () => {
      const original = getGlobalBotHandler()
      resetGlobalBotHandler()
      const fresh = getGlobalBotHandler()
      expect(fresh).not.toBe(original)
    })
  })
})
