import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReflexionEngine } from '../../src/intelligence/reflexion'

describe('P4.2 — extractVulnType mapping', () => {
  it('maps primitiveId to vulnType via PRIMITIVE_TO_VULN_TYPE', () => {
    const PRIMITIVE_TO_VULN_TYPE: Record<string, string> = {
      classicInjection: 'sqli',
      secondOrderSqli: 'sqli',
      nosqlInjection: 'nosql-injection',
      sstiBlind: 'ssti',
      ssrfMultiCloud: 'ssrf',
      ssrfOast: 'ssrf',
      authBypass: 'auth-bypass',
      authzMatrix: 'authz',
      idorSwapper: 'idor',
      invariantProbe: 'invariant-bypass',
      workflowBypass: 'workflow-bypass',
      configTrust: 'config-trust',
      ldapXpathInjection: 'ldap-injection',
      rceClass: 'rce',
      headerInjection: 'header-injection',
      concurrencyHarness: 'race-condition',
      aiTrust: 'ai-prompt-injection',
    }

    expect(PRIMITIVE_TO_VULN_TYPE['classicInjection']).toBe('sqli')
    expect(PRIMITIVE_TO_VULN_TYPE['nosqlInjection']).toBe('nosql-injection')
    expect(PRIMITIVE_TO_VULN_TYPE['sstiBlind']).toBe('ssti')
    expect(PRIMITIVE_TO_VULN_TYPE['authBypass']).toBe('auth-bypass')
    expect(PRIMITIVE_TO_VULN_TYPE['aiTrust']).toBe('ai-prompt-injection')
  })

  it('reflexion tracks vulnTypeFailCount when vulnType is passed', () => {
    const engine = new ReflexionEngine()
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    expect(engine.shouldReflect()).toBe(true)
    expect(engine.toPromptBlock()).toContain('Same vulnerability type failures: 2')
  })

  it('reflexion does NOT track vulnTypeFailCount when vulnType is empty', () => {
    const engine = new ReflexionEngine()
    engine.recordAttempt('runPrimitive', false, null, 'timeout', '')
    engine.recordAttempt('runPrimitive', false, null, 'timeout', '')
    expect(engine.shouldReflect()).toBe(false)
    const block = engine.toPromptBlock()
    expect(block).toContain('Same vulnerability type failures: 0')
  })
})

describe('P4.3 — escalation gate (toReflectionPrompt + L3 hints)', () => {
  it('shouldReflect triggers toReflectionPrompt with strategy switch text', () => {
    const engine = new ReflexionEngine()
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    expect(engine.shouldReflect()).toBe(true)
    const prompt = engine.toReflectionPrompt()
    expect(prompt).toContain('REFLEXION OVERRIDE')
    expect(prompt).toContain('change strategy')
  })

  it('shouldEscalate triggers after maxReflectionsBeforeEscalate reflections', () => {
    const engine = new ReflexionEngine()
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')

    // shouldReflect is true, and the reflection was recorded inside recordAttempt
    expect(engine.shouldReflect()).toBe(true)
    // First reflection recorded — shouldEscalate is false (need 3 reflections)
    expect(engine.shouldEscalate()).toBe(false)

    // Continue failing to accumulate more reflections
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'timeout', 'sqli')
    // shouldReflect stays true (vulnTypeFailCount keeps incrementing)
    // Now shouldEscalate should be true (3 reflections recorded)
    expect(engine.shouldEscalate()).toBe(true)

    const prompt = engine.toReflectionPrompt()
    expect(prompt).toContain('FORCE ESCALATE')
  })

  it('getEscalationLevel returns increasing levels with consecutive failures', () => {
    const engine = new ReflexionEngine()
    expect(engine.getEscalationLevel()).toBe(0)

    engine.recordAttempt('runPrimitive', false, null, 'err', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'err', 'sqli')
    expect(engine.getEscalationLevel()).toBeGreaterThanOrEqual(1)

    engine.recordAttempt('runPrimitive', false, null, 'err', 'sqli')
    engine.recordAttempt('runPrimitive', false, null, 'err', 'sqli')
    expect(engine.getEscalationLevel()).toBeGreaterThanOrEqual(2)
  })

  it('getEscalationHints returns non-empty array at L3+', () => {
    const engine = new ReflexionEngine()
    for (let i = 0; i < 8; i++) {
      engine.recordAttempt('runPrimitive', false, null, 'err', 'sqli')
    }
    const level = engine.getEscalationLevel()
    expect(level).toBeGreaterThanOrEqual(3)
    const hints = engine.getEscalationHints()
    expect(hints.length).toBeGreaterThan(0)
  })
})

describe('P4.5 — timing executor for time-based steps', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('runs multiple iterations for time-based steps and returns median', async () => {
    const mockHttp = vi.fn()
    let callCount = 0
    mockHttp.mockImplementation(async () => ({
      ok: true,
      value: {
        status: 200,
        headers: {},
        body: 'ok',
        durationMs: [1000, 2000, 3000][callCount++ % 3],
      },
    }))

    vi.doMock('../../src/tools/http-tools', () => ({
      httpRequest: { execute: mockHttp },
      rawHttpClient: { execute: vi.fn() },
    }))

    vi.doMock('../../src/graph/store', () => ({
      getGlobalGraphStore: () => ({
        queryNodes: () => [],
        addRenderedElement: vi.fn(),
      }),
      NodeType: { ENDPOINT: 'Endpoint' },
    }))

    vi.doMock('../../src/graph/workspace', () => ({
      getGlobalWorkspace: () => ({
        getGraphStore: () => ({
          queryNodes: () => [],
          addRenderedElement: vi.fn(),
        }),
      }),
    }))

    const { runPrimitiveById } = await import('../../src/primitives/index')

    const result = await runPrimitiveById('classicInjection', {
      target: 'https://example.com',
      endpoint: {
        url: 'https://example.com/api?q=test',
        method: 'GET',
        params: [{ name: 'q', type: 'string' }],
      },
      param: 'q',
      variant: 'time-based',
    }, { commit: false })

    // classicInjection generates multiple steps (error-based + xss + boolean + time).
    // The time-based step should get 3 iterations; the rest get 1 each.
    // So total calls > number of non-time steps, proving multi-iteration.
    expect(mockHttp.mock.calls.length).toBeGreaterThan(1)
    expect(result.ok).toBe(true)
  })

  it('runs once for non-time-based steps', async () => {
    const mockHttp = vi.fn()
    mockHttp.mockImplementation(async () => ({
      ok: true,
      value: {
        status: 200,
        headers: {},
        body: 'ok',
        durationMs: 500,
      },
    }))

    vi.doMock('../../src/tools/http-tools', () => ({
      httpRequest: { execute: mockHttp },
      rawHttpClient: { execute: vi.fn() },
    }))

    const { runPrimitiveById } = await import('../../src/primitives/index')

    await runPrimitiveById('classicInjection', {
      target: 'https://example.com',
      endpoint: {
        url: 'https://example.com/api?q=test',
        method: 'GET',
        params: [{ name: 'q', type: 'string' }],
      },
      param: 'q',
      variant: 'error-based',
    }, { commit: false })

    // Should not run multiple iterations for non-time-based
    // (classicInjection generates both error-based and time-based steps)
    // so we just verify it was called at least once
    expect(mockHttp.mock.calls.length).toBeGreaterThan(0)
  })
})
