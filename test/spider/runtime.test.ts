import { describe, expect, it, vi } from 'vitest'
import { createSpiderFinalizer, EngagementBoundary, SpiderRuntime, runSpiderRuntime } from '../../src/spider/runtime'
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
  it('requires memory identity when memory is enabled', async () => {
    await expect(runSpiderRuntime({
      config: config(),
      target: 'https://example.com',
      browser: {},
      memory: {},
    })).rejects.toThrow('threadId and resourceId')
  })

  it('fails crawl initialization when no browser navigation surface exists', async () => {
    const result = await runSpiderRuntime({
      config: config(),
      target: 'https://example.com',
      browser: {},
    })

    expect(result.outcome).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('Target grounding failed'),
    })
    expect(result.state.pagesSeen).toBe(0)
  })

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

  it('finalizes once and uses one terminal state for event, persistence, and result', async () => {
    const events: any[] = []
    const order: string[] = []
    const runtime = new SpiderRuntime({
      workflowId: 'wf-final',
      target: 'https://example.com',
      config: config(),
      onEvent: event => {
        events.push(event)
        if (event.type === 'crawl_completed') order.push('completed')
      },
    })
    runtime.recordPage('https://example.com/a')
    runtime.setIdentity({ id: 'admin:one', kind: 'admin', label: 'Admin', roleName: 'Administrator' })
    const addReachability = vi.fn()
    const onFinalize = vi.fn(async () => {
      order.push('checkpoint')
      return 'checkpoint:1'
    })
    const finalize = createSpiderFinalizer(runtime, {
      config: config(),
      target: 'https://example.com',
      browser: {},
      graphStore: { addReachability },
      onFinalize,
    }, Date.now())

    const first = await finalize('frontier_exhausted')
    const second = await finalize('error', 'late error')
    const completed = events.find(event => event.type === 'crawl_completed')

    expect(second).toEqual(first)
    expect(first).toMatchObject({ outcome: { status: 'completed', stopReason: 'frontier_exhausted' }, checkpointId: 'checkpoint:1' })
    expect(completed.state).toEqual(first.state)
    expect(first.state.stopReason).toBe('frontier_exhausted')
    expect(onFinalize).toHaveBeenCalledOnce()
    expect(order).toEqual(['checkpoint', 'completed'])
    expect(addReachability).toHaveBeenCalledOnce()
    expect(addReachability).toHaveBeenCalledWith(expect.objectContaining({
      identityId: 'anonymous',
      identityKind: 'anonymous',
    }))
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

describe('SpiderRuntime identity & reachability (Slice 06)', () => {
  it('defaults to the anonymous identity and honors initialIdentity', () => {
    const anon = new SpiderRuntime({ workflowId: 'wf-id-1', target: 'https://example.com', config: config() })
    expect(anon.snapshot().currentIdentity).toMatchObject({ id: 'anonymous', kind: 'anonymous' })

    const admin = new SpiderRuntime({
      workflowId: 'wf-id-2',
      target: 'https://example.com',
      config: config(),
      initialIdentity: { id: 'admin:administrator', kind: 'admin', label: 'Admin', roleName: 'Administrator' },
    })
    expect(admin.snapshot().currentIdentity).toMatchObject({ kind: 'admin', roleName: 'Administrator' })
  })

  it('setIdentity records a typed transition and emits auth_transition with from/to', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf-id-3', target: 'https://example.com', config: config() })
    const events: Array<{ from?: string; to?: string }> = []
    const onEvent = (e: any) => {
      if (e.type === 'auth_transition') events.push({ from: e.from?.id, to: e.to?.id })
    }
    getGlobalEmitter().on('spider:event', onEvent)
    try {
      const admin = { id: 'admin:administrator', kind: 'admin' as const, label: 'Admin', roleName: 'Administrator' }
      runtime.setIdentity(admin, 'https://example.com/login')
      runtime.setIdentity(admin, 'https://example.com/login')

      const state = runtime.snapshot()
      expect(state.authTransitions).toHaveLength(1)
      expect(state.authTransitions[0]).toMatchObject({ from: { id: 'anonymous' }, to: { kind: 'admin' }, url: 'https://example.com/login' })
      expect(state.currentIdentity).toMatchObject({ kind: 'admin' })
      expect(events).toEqual([{ from: 'anonymous', to: 'admin:administrator' }])
    } finally {
      getGlobalEmitter().off('spider:event', onEvent)
    }
  })

  it('setIdentity swaps back to anonymous on logout-like flows', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf-id-4',
      target: 'https://example.com',
      config: config(),
      initialIdentity: { id: 'authenticated:operator', kind: 'authenticated', label: 'Operator' },
    })
    runtime.setIdentity({ id: 'anonymous', kind: 'anonymous', label: 'Anonymous' })
    const state = runtime.snapshot()
    expect(state.currentIdentity.kind).toBe('anonymous')
    expect(state.authTransitions[state.authTransitions.length - 1]).toMatchObject({ from: { kind: 'authenticated' }, to: { kind: 'anonymous' } })
  })

  it('recordAuthFlow folds typed AUTH_FLOW kinds into identity and is idempotent per flow id', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf-id-5', target: 'https://example.com', config: config() })
    runtime.recordAuthFlow('flow-1', 'login', 'Customer Portal', 'https://example.com/login')
    runtime.recordAuthFlow('flow-1', 'login', 'Customer Portal', 'https://example.com/login')
    runtime.recordAuthFlow('flow-2', 'logout', 'Logout', 'https://example.com/logout')

    const state = runtime.snapshot()
    expect(state.currentIdentity.kind).toBe('anonymous')
    expect(state.authTransitions).toHaveLength(2)
  })

  it('recordAuthFlow ignores flow types that do not change identity (refresh)', () => {
    const runtime = new SpiderRuntime({
      workflowId: 'wf-id-6',
      target: 'https://example.com',
      config: config(),
      initialIdentity: { id: 'authenticated:operator', kind: 'authenticated', label: 'Operator' },
    })
    runtime.recordAuthFlow('flow-refresh', 'refresh', 'Token refresh')
    expect(runtime.snapshot().authTransitions).toHaveLength(0)
    expect(runtime.snapshot().currentIdentity.kind).toBe('authenticated')
  })

  it('attributes discoveries to the active identity and dedupes reachability', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf-id-7', target: 'https://example.com', config: config() })
    runtime.recordPage('https://example.com/')
    runtime.recordPage('https://example.com/')
    runtime.setIdentity({ id: 'authenticated:operator', kind: 'authenticated', label: 'Operator' })
    runtime.recordEndpoint('GET', 'https://example.com/api/users')
    runtime.recordForm('https://example.com/login', '#login')

    const state = runtime.snapshot()
    expect(state.reachability).toHaveLength(3)
    expect(state.reachability[0].identity).toMatchObject({ id: 'anonymous', kind: 'anonymous' })
    expect(state.endpoints[0].identity).toMatchObject({ kind: 'authenticated' })
    expect(state.discoveredForms[0].identity).toMatchObject({ kind: 'authenticated' })
  })

  it('keeps role-specific reachability distinct from anonymous reach', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf-id-8', target: 'https://example.com', config: config() })
    runtime.recordEndpoint('GET', 'https://example.com/admin')
    runtime.setIdentity({ id: 'admin:administrator', kind: 'admin', label: 'Admin', roleName: 'Administrator' })
    runtime.recordEndpoint('GET', 'https://example.com/admin')

    const state = runtime.snapshot()
    const adminReach = state.reachability.filter((r) => r.identityId === 'admin:administrator')
    expect(adminReach).toHaveLength(1)
    expect(adminReach[0]).toMatchObject({ resourceId: 'https://example.com/admin', resourceType: 'endpoint' })
    expect(state.reachability).toHaveLength(2)
  })

  it('resumes reachability from a prior snapshot without re-recording', () => {
    const runtime = new SpiderRuntime({ workflowId: 'wf-id-9', target: 'https://example.com', config: config() })
    runtime.recordEndpoint('GET', 'https://example.com/api')
    const resumed = new SpiderRuntime({
      workflowId: 'wf-id-9',
      target: 'https://example.com',
      config: config(),
      initialState: runtime.snapshot(),
    })
    resumed.recordEndpoint('GET', 'https://example.com/api')
    expect(resumed.snapshot().reachability).toHaveLength(1)
    expect(resumed.snapshot().endpoints).toHaveLength(1)
  })
})
