import { describe, expect, it } from 'vitest'
import { EngagementBoundary, SpiderRuntime } from '../../src/spider/runtime'
import { getGlobalEmitter } from '../../src/events/emitter'
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
    const boundary = new EngagementBoundary('https://example.com', config(), false)

    expect(boundary.classifyUrl('https://example.com/app').scope).toBe('allowed')
    expect(boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('proposed')
  })

  it('denies invalid and non-http URLs', () => {
    const boundary = new EngagementBoundary('https://example.com', config(), false)

    expect(boundary.classifyUrl('not-a-url').scope).toBe('denied')
    expect(boundary.classifyUrl('file:///etc/passwd').scope).toBe('denied')
  })

  it('classifies external URLs as proposed even when the ambient global allows any', () => {
    const boundary = new EngagementBoundary('https://example.com', config(), false)
    expect(boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('proposed')
  })

  it('opts the boundary in via explicit allow-any, independent of global state', () => {
    const boundary = new EngagementBoundary('https://example.com', config(), true)
    expect(boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('allowed')
  })

  it('inherits the ambient global allow-any when no explicit flag is given', () => {
    const boundary = new EngagementBoundary('https://example.com', config())
    expect(boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('allowed')
  })
})

describe('SpiderRuntime', () => {
  it('threads explicit allowAny into its boundary', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf1',
      target: 'https://example.com',
      config: config(),
      allowAny: false,
    })
    expect(runtime.boundary.classifyUrl('https://cdn.example.net/x.js').scope).toBe('proposed')
  })

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

describe('proposed scope + approval workflow', () => {
  it('records proposed origins in state and emits typed scope_proposed', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf2', target: 'https://example.com', config: config(), allowAny: false })
    const seen: Array<{ workflowId: string; url: string; reason?: string; timestamp: number }> = []
    const onScopeProposed = (e: { workflowId: string; url: string; reason?: string; timestamp: number }) => { seen.push(e) }
    getGlobalEmitter().on('scope_proposed', onScopeProposed)
    try {
      const scope = runtime.enqueue('https://cdn.example.net/app.js', 0)
      expect(scope).toBe('proposed')
      expect(runtime.snapshot().proposedOrigins).toContain('https://cdn.example.net')
      expect(seen.length).toBe(1)
      expect(seen[0].url).toBe('https://cdn.example.net/app.js')
      expect(seen[0].workflowId).toBe('wf2')
    } finally {
      getGlobalEmitter().off('scope_proposed', onScopeProposed)
    }
  })

  it('approveProposed reclassifies frontier items from that origin to allowed', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf3', target: 'https://example.com', config: config(), allowAny: false })
    runtime.enqueue('https://example.com/', 0)
    runtime.enqueue('https://cdn.example.net/app.js', 1)
    runtime.enqueue('https://other.example.net/x.js', 1)

    runtime.approveProposed('https://cdn.example.net/app.js')

    const frontier = runtime.snapshot().frontier
    expect(frontier.find((i) => i.url === 'https://cdn.example.net/app.js')?.scope).toBe('allowed')
    expect(frontier.find((i) => i.url === 'https://other.example.net/x.js')?.scope).toBe('proposed')
    expect(runtime.boundary.approvedProposals).toContain('https://cdn.example.net')
    expect(runtime.boundary.classifyUrl('https://cdn.example.net/app.js').scope).toBe('allowed')
  })

  it('pre-approves origins passed via approvedOrigins option', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf4',
      target: 'https://example.com',
      config: config(),
      allowAny: false,
      approvedOrigins: ['https://cdn.example.net'],
    })
    expect(runtime.boundary.approvedProposals).toContain('https://cdn.example.net')
    expect(runtime.enqueue('https://cdn.example.net/app.js', 0)).toBe('allowed')
  })

  it('boundary authorization respects allowedCategories and external-tools config', () => {
    const boundary = new EngagementBoundary(
      'https://example.com',
      config({
        scope: { allowedDomains: ['example.com'], allowedCategories: ['read'], enforcement: 'hard' },
        externalTools: { enabled: true },
      }),
      false,
    )
    expect(boundary.isActionAuthorized('read')).toBe(true)
    expect(boundary.isActionAuthorized('create')).toBe(false)
    expect(boundary.isActionAuthorized('external_tool')).toBe(false)
  })

  it('boundary external_tool authorized only when config opts in AND whitelist allows it', () => {
    const boundary = new EngagementBoundary(
      'https://example.com',
      config({
        scope: { allowedDomains: ['example.com'], allowedCategories: ['read', 'external_tool'], enforcement: 'hard' },
        externalTools: { enabled: true },
      }),
      false,
    )
    expect(boundary.isActionAuthorized('external_tool')).toBe(true)
    expect(boundary.isActionAuthorized('delete')).toBe(false)
  })
})
