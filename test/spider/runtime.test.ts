import { describe, expect, it } from 'vitest'
import { EngagementBoundary, SpiderRuntime } from '../../src/spider/runtime'
import type { UltimatrixConfig } from '../../src/config'

function config(overrides: Partial<UltimatrixConfig> = {}): UltimatrixConfig {
  return {
    provider: 'groq',
    model: 'llama3-8b-8192',
    target: 'https://example.com',
    depth: 2,
    timeout: 60000,
    creds: { groq: { apiKey: 'gsk_xxx' } },
    browser: { provider: 'stagehand', headless: true, viewport: { width: 1280, height: 720 }, domSettleTimeout: 5000, env: 'LOCAL', selfHeal: true, verbose: 0, sessionScope: 'workflow' },
    memory: { lastMessages: 10, semanticRecall: false, workingMemory: true },
    agent: { maxSteps: 50, scansDir: './scans' },
    rateLimit: { requestsPerMinute: 60, maxConcurrent: 3, retryOnLimit: true, maxRetries: 3 },
    ...overrides,
  }
}

describe('EngagementBoundary', () => {
  it('classifies target URLs as allowed and external URLs as proposed', () => {
    const boundary = new EngagementBoundary('https://example.com', config())

    expect(boundary.classifyUrl('https://example.com/app').scope).toBe('allowed')
    expect(boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('proposed')
  })

  it('denies invalid and non-http URLs', () => {
    const boundary = new EngagementBoundary('https://example.com', config())

    expect(boundary.classifyUrl('not-a-url').scope).toBe('denied')
    expect(boundary.classifyUrl('file:///etc/passwd').scope).toBe('denied')
  })
})

describe('SpiderRuntime', () => {
  it('dedupes frontier and can resume from prior state', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config() })
    runtime.enqueue('https://example.com/a', 1)
    runtime.enqueue('https://example.com/a', 1)
    runtime.recordPage('https://example.com/a')

    const resumed = new SpiderRuntime({
      workflowId: 'wf1',
      target: 'https://example.com',
      config: config(),
      initialState: runtime.snapshot(),
    })
    resumed.enqueue('https://example.com/a', 1)

    expect(resumed.snapshot().frontier.filter((item) => item.url === 'https://example.com/a')).toHaveLength(1)
    expect(resumed.snapshot().visitedUrls).toContain('https://example.com/a')
  })

  it('stops after stale rounds reach the threshold', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config() })

    expect(runtime.recordProgress(false, 2)).toBeUndefined()
    expect(runtime.recordProgress(false, 2)).toBe('stale')
    expect(runtime.snapshot().stopReason).toBe('stale')
  })

  it('tracks endpoints, forms, auth states, and max page limit', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf1', target: 'https://example.com', config: config() })

    runtime.recordPage('https://example.com/a')
    runtime.recordEndpoint('GET', 'https://example.com/api/users', ['id'])
    runtime.recordForm('https://example.com/login', '#login', 'POST', '/login', 'anonymous')
    runtime.recordAuth('https://example.com/login', 'login-form', 'anonymous')

    const state = runtime.snapshot()
    expect(state.pagesSeen).toBe(1)
    expect(state.endpoints[0]).toMatchObject({ method: 'GET', params: ['id'], scope: 'allowed' })
    expect(state.discoveredForms).toHaveLength(1)
    expect(state.authStates).toHaveLength(1)
    expect(runtime.shouldStopByLimits(1, 2)).toBe('max_pages')
  })
})
