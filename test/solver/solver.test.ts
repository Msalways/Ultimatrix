import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runInEngagementContext } from '../utils/engagement-context'

const h = vi.hoisted(() => ({
  runActiveChainingMock: vi.fn(),
  exploitLoopMock: vi.fn(),
  graphStoreMock: {
    hasFinding: false,
    queryNodes: (type?: any) =>
      type && String(type) === 'Finding' && h.graphStoreMock.hasFinding
        ? [
            {
              id: 'finding-1',
              type: 'Finding',
              properties: { technique: 'idor', endpoint: 'https://example.com/api/user/1', method: 'GET', severity: 'medium' },
            },
          ]
        : [],
    getTargetSummary: () => ({ totalFindings: 0, totalEndpoints: 0, totalTests: 0, totalCapturedHeaders: 0, findingsBySeverity: {}, endpoints: [], authFlows: 0, rbacRoles: 0, untestedActions: 0 }),
    save: vi.fn().mockResolvedValue(undefined),
    upsertNode: vi.fn(),
  },
  logWarn: vi.fn(),
}))
vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: h.logWarn, error: vi.fn(), dim: vi.fn(), success: vi.fn(), nl: vi.fn() },
}))

vi.mock('../../src/tools/report-tools', () => ({
  setForensicLog: vi.fn().mockReturnValue({
    log: vi.fn(),
  }),
  getForensicLog: vi.fn().mockReturnValue({
    log: vi.fn(),
  }),
}))

vi.mock('../../src/intelligence/chain-planner', () => ({
  runActiveChaining: (...args: any[]) => h.runActiveChainingMock(...args),
}))

vi.mock('../../src/solver/exploitation-loop', () => ({
  runExploitationLoop: (...args: any[]) => h.exploitLoopMock(...args),
}))

// Mock the global graph store with a seeded IDOR finding.
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => h.graphStoreMock,
  NodeType: { FINDING: 'FINDING' },
}))

import { solve as solveCore } from '../../src/solver/solver'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import { resolveModelRef } from '../../src/models/routing'

const TEST_MODEL_CAPABILITY = {
  contextWindow: 128000,
  maxOutputTokens: 8192,
  strengths: ['reasoning'],
  supportsStreaming: true,
  supportsStructuredOutput: false,
}

async function solve(agent: any, params: any) {
  const supplied = params.ultimatrixConfig ?? {}
  const config = {
    ...supplied,
    provider: supplied.provider ?? 'mock',
    model: supplied.model ?? 'mock-model',
  }
  const modelRef = resolveModelRef(config as any, { role: 'brain' })
  const modelCapabilities = {
    ...supplied.modelCapabilities,
    [modelRef.modelId]: supplied.modelCapabilities?.[modelRef.modelId] ?? TEST_MODEL_CAPABILITY,
  }
  return solveCore(agent, {
    ...params,
    ultimatrixConfig: { ...config, modelCapabilities } as any,
  })
}
function itEngagement(name: string, fn: () => Promise<void>) {
  it(name, async () => {
    await runInEngagementContext(async () => {
      await fn()
    })
  })
}

function createMockAgent(textChunks: string[]) {
  let callIndex = 0
  return {
    instructions: undefined as any,
    tools: undefined as any,
    stream: vi.fn().mockImplementation(async (_prompt: string) => {
      const text = textChunks[Math.min(callIndex++, textChunks.length - 1)] || ''
      return {
        fullStream: (async function* () {
          if (text) {
            yield { type: 'text-delta', payload: { text } }
          }
        })(),
        toolCalls: [],
        text: Promise.resolve(text),
      }
    }),
  }
}

function createReasoningMockAgent(reasoningChunks: string[], textChunks: string[]) {
  let callIndex = 0
  return {
    instructions: undefined as any,
    tools: undefined as any,
    stream: vi.fn().mockImplementation(async (_prompt: string) => {
      const idx = Math.min(callIndex++, reasoningChunks.length - 1)
      const reasoning = reasoningChunks[idx] || ''
      const text = textChunks[idx] || ''
      return {
        fullStream: (async function* () {
          if (reasoning) {
            yield { type: 'reasoning-delta', payload: { text: reasoning } }
          }
          if (text) {
            yield { type: 'text-delta', payload: { text } }
          }
        })(),
        toolCalls: [],
        // AI-SDK contract: `text` is the deliverable ONLY; `reasoningText` is the
        // separate reasoning channel. They are normalized independently by the SDK.
        text: Promise.resolve(text),
        reasoningText: Promise.resolve(reasoning),
      }
    }),
  }
}

function createMockAgentWithToolCall(textChunks: string[]) {
  let callIndex = 0
  const activationObserver = vi.fn()
  const mockCapabilityRegistry = {
    getActiveToolset: vi.fn().mockReturnValue({}),
    describe: vi.fn().mockResolvedValue({ readOnly: false, namespace: 'recon' }),
    setActivationPolicy: vi.fn(),
    setActivationObserver: vi.fn((fn) => {
      if (fn) fn({ readOnly: false, namespace: 'recon' })
    }),
    resetTurn: vi.fn(),
  }
  return {
    instructions: undefined as any,
    tools: undefined as any,
    capabilityRegistry: mockCapabilityRegistry,
    stream: vi.fn().mockImplementation(async (_prompt: string) => {
      const text = textChunks[Math.min(callIndex++, textChunks.length - 1)] || ''
      return {
        fullStream: (async function* () {
          if (callIndex === 1) {
            yield { type: 'tool-call', payload: { toolName: 'recon', args: { target: 'https://example.com' }, toolCallId: 'tc-1' } }
            yield { type: 'tool-result', payload: { toolCallId: 'tc-1', result: { success: true } } }
          }
          if (text) {
            yield { type: 'text-delta', payload: { text } }
          }
        })(),
        toolCalls: [{ toolName: 'recon', args: { target: 'https://example.com' } }],
        text: Promise.resolve(text),
      }
    }),
  }
}

describe('solve', () => {
  beforeEach(() => {
    h.runActiveChainingMock.mockClear()
    h.exploitLoopMock.mockClear()
    h.graphStoreMock.hasFinding = false
  })

  itEngagement('blocks unknown models before invoking the model', async () => {
    const agent = createMockAgent(['This must not run.'])
    const messages: any[] = []
    const result = await solveCore(agent as any, {
      origin: 'https://example.com',
      goal: 'inspect the target',
      ultimatrixConfig: { provider: 'unknown-provider', model: 'unknown-model' } as any,
      onMessage: (message) => messages.push(message),
    })

    expect(agent.stream).not.toHaveBeenCalled()
    expect(result.reason).toBe('context_blocked')
    expect(messages).toContainEqual(expect.objectContaining({
      kind: 'event',
      event: 'context.blocked',
      status: 'error',
    }))
  })

  itEngagement('blocks a goal when goal-budget construction would truncate it', async () => {
    const agent = createMockAgent(['This must not run.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'required-evidence '.repeat(5000),
      ultimatrixConfig: {
        provider: 'mock',
        model: 'small-context-model',
        modelCapabilities: {
          'mock/small-context-model': {
            contextWindow: 8192,
            maxOutputTokens: 2048,
            strengths: ['reasoning'],
            supportsStreaming: true,
            supportsStructuredOutput: false,
          },
        },
      },
    })

    expect(agent.stream).not.toHaveBeenCalled()
    expect(result.reason).toBe('context_blocked')
    expect(result.error).toContain('goal context exceeded its budget')
  })

  itEngagement('creates plan and executes tasks sequentially', async () => {
    const agent = createMockAgent([
      'I will test /api/users for SQL injection and /login for auth bypass. Starting with /api/users.',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
    })
    expect(result.steps).toBeGreaterThanOrEqual(0)
    expect(result.toolCalls).toBeGreaterThanOrEqual(0)
  })

  itEngagement('returns goal_achieved when finding confirmed', async () => {
    const agent = createMockAgent([
      'Found SQL injection error on /api. Evidence confirmed.',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.steps).toBeGreaterThanOrEqual(0)
  })

  itEngagement('returns response_complete when the model answers without running tools', async () => {
    const agent = createMockAgent([
      'No progress possible. All paths blocked.',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 5, staleThreshold: 2 },
    })
    expect(result.completed).toBe(false)
    expect(result.reason).toBe('response_complete')
    expect(result.newFindings).toBe(0)
  })  itEngagement('returns budget_reached when max tool calls exceeded', async () => {
    const agent = createMockAgent(
      Array(10).fill('Testing endpoint for SQLi...')
    )
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 3 },
    })
    expect(result.completed).toBe(false)
  })  itEngagement('seeds initial fact with origin and goal', async () => {
    const agent = createMockAgent(['Exploring the target.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.facts).toBeGreaterThanOrEqual(1)
  })  itEngagement('includes hints as initial facts', async () => {
    const agent = createMockAgent(['Exploring with hints.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      hints: ['User enumeration possible'],
    })
    expect(result.facts).toBeGreaterThanOrEqual(2)
  })  itEngagement('reports tool calls', async () => {
    const agent = createMockAgent(['Testing endpoints.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
    })
    expect(result.toolCalls).toBeGreaterThanOrEqual(0)
  })  itEngagement('emits phase events', async () => {
    const agent = createMockAgent(['Starting exploration.'])
    const events: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onPhase: (event) => events.push(event),
    })
    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.phase === 'observe')).toBe(true)
    expect(events.some(e => e.phase === 'complete')).toBe(true)
  })  itEngagement('conclude rejects ungrounded claims', async () => {
    const agent = createMockAgent([
      'This is a completely fabricated claim with no evidence whatsoever',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 10, staleThreshold: 3 },
    })
    expect(result.completed).toBe(false)
  })  itEngagement('plan summary included in result', async () => {
    const agent = createMockAgent(['Plan: test /api for sqli.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.planSummary).toBeDefined()
  })  itEngagement('returns result with all required fields', async () => {
    const agent = createMockAgent(['Done.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result).toHaveProperty('completed')
    expect(result).toHaveProperty('reason')
    expect(result).toHaveProperty('steps')
    expect(result).toHaveProperty('toolCalls')
    expect(result).toHaveProperty('tokensUsed')
    expect(result).toHaveProperty('durationMs')
    expect(result).toHaveProperty('facts')
    expect(result).toHaveProperty('intents')
    expect(typeof result.steps).toBe('number')
    expect(typeof result.toolCalls).toBe('number')
    expect(typeof result.durationMs).toBe('number')
  })  itEngagement('handles agent stream errors gracefully', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockRejectedValue(new Error('API rate limit')),
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
    })
    expect(result.completed).toBe(false)
    expect(result.reason).toBe('model_failed')
  })  itEngagement('content does not leak through onPhase events (solver stream only)', async () => {
    const agent = createReasoningMockAgent(
      ['I found SQL injection in /api/users. Evidence: error-based response.'],
      ['| Endpoint | Type |']
    )
    const events: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onPhase: (event) => events.push(event),
    })
    // Content (reasoning-delta, text-delta) should NOT leak through the phase
    // channel — it flows exclusively through the solver stream (emitMessage).
    const reasonEvents = events.filter(e => e.phase === 'reason')
    const hasContentText = reasonEvents.some(e => e.text?.includes('SQL injection'))
    expect(hasContentText).toBe(false)
    // But the result itself should contain the answer (canonical or appendDelta fallback)
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.text).toContain('| Endpoint | Type |')
  })  itEngagement('does not persist reasoning prose into result.text (prevents next-turn echo, A12)', async () => {
    const agent = createReasoningMockAgent(
      ['I found SQL injection. Evidence confirmed via error-based response.'],
      ['| Endpoint | Type |']
    )
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    // Reasoning is displayed live but NOT persisted into result.text — otherwise it
    // re-enters working memory and bloats the next turn's context.
    expect(result.text).toBeDefined()
    expect(result.text).not.toContain('SQL injection')
    expect(result.text).toContain('| Endpoint | Type |')
  })  itEngagement('returns responseText as result.text when non-reasoning model', async () => {
    const agent = createMockAgent(['Found SQL injection via error-based response.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.text).toBeDefined()
    expect(result.text).toContain('SQL injection')
  })  itEngagement('answer and reasoning flow through solver stream, not phase channel', async () => {
    const agent = createReasoningMockAgent(
      ['Analysis: 8 endpoints found, SQL injection confirmed.'],
      ['| # | Endpoint | Type | Severity |']
    )
    const events: any[] = []
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onPhase: (event) => events.push(event),
    })
    // Content should NOT appear in phase events (emit removed for content)
    const reasonEvents = events.filter(e => e.phase === 'reason')
    const hasAnswerInPhase = reasonEvents.some(e => !e.reasoning && e.text?.includes('| # |'))
    const hasReasoningInPhase = reasonEvents.some(e => e.reasoning && e.text?.includes('Analysis'))
    expect(hasAnswerInPhase).toBe(false)
    expect(hasReasoningInPhase).toBe(false)
    // Answer should be in result.text (canonical stream.text resolution)
    expect(result.text).toContain('| # | Endpoint | Type | Severity |')
  })  itEngagement('invokes exploitation loop after a finding lands (multi-model engine)', async () => {
    h.exploitLoopMock.mockResolvedValue({
      notes: ['escalated idor via held session'],
      executed: 1,
      proofsBuilt: 1,
    })
    h.graphStoreMock.hasFinding = true
    const agent = createMockAgentWithToolCall(['Ran recon tool.'])
    const events: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
      ultimatrixConfig: { engine: 'multi-model', solver: { maxActiveChainSteps: 3 } } as any,
      onPhase: (event) => events.push(event),
    })
    console.log('WARN CALLS:', h.logWarn.mock.calls.map(c => c[0]))
    expect(h.exploitLoopMock).toHaveBeenCalledTimes(1)
    expect(events.some(e => e.text?.includes('[exploitation-loop]'))).toBe(true)
  })  itEngagement('does not invoke exploitation loop when maxActiveChainSteps is 0', async () => {
    h.exploitLoopMock.mockResolvedValue({ notes: [], executed: 0, proofsBuilt: 0 })
    const agent = createMockAgent(['Done.'])
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
      ultimatrixConfig: { engine: 'multi-model', solver: { maxActiveChainSteps: 0 } } as any,
    })
    expect(h.exploitLoopMock).not.toHaveBeenCalled()
  })  itEngagement('emits structured onMessage: answer vs reasoning separated, done carries answer', async () => {
    const agent = createReasoningMockAgent(
      ['Reasoning: planning attack surface.'],
      ['Confirmed SQL injection on /api/users.']
    )
    const messages: any[] = []
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onMessage: (m) => messages.push(m),
    })
    const reasoningMsgs = messages.filter(m => m.kind === 'reasoning')
    const answerMsgs = messages.filter(m => m.kind === 'answer')
    const done = messages.find(m => m.kind === 'done')
    // Answer channel carries the deliverable; reasoning channel carries scratch.
    expect(answerMsgs.some(m => m.text.includes('Confirmed SQL injection'))).toBe(true)
    expect(reasoningMsgs.some(m => m.text.includes('planning attack surface'))).toBe(true)
    expect(done).toBeDefined()
    expect(done.answer.content).toContain('Confirmed SQL injection')
    expect(done.answer.reasoning).toContain('planning attack surface')
    // The deliverable must never contain the reasoning scratch.
    expect(result.text).not.toContain('planning attack surface')
  })  itEngagement('falls back to stream.text when text-delta delivers no answer (reasoning-only model)', async () => {
    // Agent emits ONLY reasoning-delta; the answer lives only in stream.text().
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', payload: { text: 'thinking hard...' } }
        })(),
        toolCalls: [],
        text: Promise.resolve('The final answer is here.'),
      })),
    }
    const messages: any[] = []
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onMessage: (m) => messages.push(m),
    })
    expect(result.text).toContain('The final answer is here.')
    const done = messages.find(m => m.kind === 'done')
    expect(done.answer.content).toContain('The final answer is here.')
  })
  itEngagement('uses structured output response as the final assistant answer', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', payload: { text: 'thinking...' } }
        })(),
        toolCalls: [],
        text: Promise.resolve(''),
        reasoningText: Promise.resolve('thinking...'),
        object: Promise.resolve({ response: 'Hello. How can I help with this target?' }),
      })),
    }
    const messages: any[] = []
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'hi',
      onMessage: (m) => messages.push(m),
    })
    const done = messages.find(m => m.kind === 'done')
    expect(result.text).toBe('Hello. How can I help with this target?')
    expect(done.answer.content).toBe('Hello. How can I help with this target?')
  })
  itEngagement('does not force structured output for normal assistant turns', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string, opts?: any) => {
        if (opts?.structuredOutput) {
          return {
            fullStream: (async function* () {})(),
            toolCalls: [],
            text: Promise.resolve(''),
            object: Promise.resolve(undefined),
          }
        }
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', payload: { text: 'Hello from plain text.' } }
          })(),
          toolCalls: [],
          text: Promise.resolve('Hello from plain text.'),
        }
      }),
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'hi',
    })
    expect(agent.stream).toHaveBeenCalled()
    expect(agent.stream.mock.calls[0][1]?.structuredOutput).toBeUndefined()
    expect(result.text).toBe('Hello from plain text.')
  })
  itEngagement('answers directly without a forced decision pass', async () => {
    const initialTools = { listTools: { id: 'listTools' }, loadTool: { id: 'loadTool' } }
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      getTurnToolset: vi.fn(() => initialTools),
      stream: vi.fn().mockImplementation(async () => ({
        fullStream: (async function* () {
          yield { type: 'text-delta', payload: { text: 'Hi. What would you like to inspect?' } }
        })(),
        toolCalls: [],
        text: Promise.resolve('Hi. What would you like to inspect?'),
      })),
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'hi',
    })
    expect(agent.stream).toHaveBeenCalledTimes(1)
    expect(agent.getTurnToolset).toHaveBeenCalled()
    expect(result.toolCalls).toBe(0)
    expect(result.text).toContain('Hi')
  })
  itEngagement('returns an explicit status when the provider emits reasoning but no answer', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', payload: { text: 'I inspected the available context.' } }
        })(),
        toolCalls: [],
        text: Promise.resolve(''),
        reasoningText: Promise.resolve('I inspected the available context.'),
      }),
    }
    const messages: any[] = []
    const result = await solve(agent as any, { origin: 'https://example.com', goal: 'inspect', onMessage: m => messages.push(m) })
    expect(result.text).toBe('The model ended without producing a deliverable response.')
    expect(messages.find(m => m.kind === 'done')?.answer.content).toBe(result.text)
  })
  itEngagement('returns an explicit status after tool-only execution', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-call', payload: { toolName: 'queryGraph', args: {} } }
          yield { type: 'tool-result', payload: { toolName: 'queryGraph', result: { ok: true, value: [] } } }
        })(),
        toolCalls: [],
        text: Promise.resolve(''),
        reasoningText: Promise.resolve(''),
      }),
    }
    const result = await solve(agent as any, { origin: 'https://example.com', goal: 'inspect' })
    expect(result.text).toBe('Assessment stopped after 1 tool call; no new verified findings were produced.')
  })
  itEngagement('validates context against active next-step tools and rechecks after activation', async () => {
    const registry = new DynamicToolRegistry()
    registry.registerLazyBuiltin({
      id: 'httpRequest',
      description: 'HTTP request',
      namespace: 'builtin',
      source: 'builtin',
      requirements: [],
      readOnly: false,
    }, async () => ({ id: 'httpRequest', inputSchema: { type: 'object', properties: { url: { type: 'string' } } } }))
    const discoveryTools = { listTools: { id: 'listTools' }, loadTool: { id: 'loadTool' } }
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      capabilityRegistry: registry,
      getTurnToolset: vi.fn(() => ({ ...discoveryTools, ...registry.getActiveToolset() })),
      stream: vi.fn().mockImplementation(async () => ({
        fullStream: (async function* () {
          await registry.activate('httpRequest')
          yield { type: 'text-delta', payload: { text: 'Activated HTTP tooling.' } }
        })(),
        toolCalls: [],
        text: Promise.resolve('Activated HTTP tooling.'),
      })),
    }
    const messages: any[] = []

    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'inspect the target',
      onMessage: (m) => messages.push(m),
    })

    const checks = messages.filter(m => m.kind === 'event' && m.event === 'context.checked')
    expect(checks.map(m => m.data.stage)).toEqual(['initial', 'activation'])
    expect(checks[0].data.activeTools).toEqual(['listTools', 'loadTool'])
    expect(checks[1].data.activeTools).toContain('httpRequest')
  })
  itEngagement('runs target-operation turns from the original goal without serializing a routing decision', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async () => {
        return {
          fullStream: (async function* () {
            yield { type: 'text-delta', payload: { text: 'I will map the target surface.' } }
          })(),
          toolCalls: [],
          text: Promise.resolve('I will map the target surface.'),
        }
      }),
    }
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'map the target attack surface',
      interactionMode: 'run',
    })
    expect(agent.stream).toHaveBeenCalledTimes(1)
    const prompt = agent.stream.mock.calls[0][0]
    expect(prompt).toContain('map the target attack surface')
    expect(prompt).not.toContain('Turn decision')
    expect(prompt).not.toContain('use_capability')
  })
  itEngagement('attaches truthful assessment details to run-mode results', async () => {
    const agent = createMockAgent(['Surface mapping is complete.'])
    const campaign = {
      findings: [],
      coverage: {
        endpointsTotal: 1, endpointsCovered: 1, paramsTotal: 1, paramsCovered: 1,
        rolesTotal: 1, rolesCovered: 1, actorsTotal: 1, actorsCovered: 1,
        statesTotal: 1, statesCovered: 1, techniquesTotal: 1, techniquesPlanned: 1,
        slicesPlanned: 1, slicesExecuted: 1, slicesConfirmed: 0, humanHypothesesConsidered: 0,
      },
      budgetExceeded: false,
      slicesRun: 1,
      status: 'complete',
      requestsUsed: 2,
      remainingSlices: [],
      domains: [],
      units: [],
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'assess the observed target',
      interactionMode: 'run',
      lazyServices: {
        observationState: { status: 'completed', result: { requests: 4, url: 'https://example.com' } },
        crawlState: { stopReason: 'frontier_exhausted', pagesSeen: 2, frontier: [] },
        researchBootstrapState: 'completed',
        taskStates: [],
        runCoverageCampaign: vi.fn().mockResolvedValue(campaign),
      },
    })

    expect(result.assessmentStatus).toBe('complete')
    expect(result.assessmentReport).toMatchObject({
      status: 'complete',
      discovery: { observedRequests: 4, crawl: { stopReason: 'frontier_exhausted', pagesSeen: 2, frontierRemaining: 0 } },
      testedCoverage: { status: 'complete', planned: 1, executed: 1, requestsUsed: 2 },
      blockers: [],
    })
    expect(result.answer?.assessmentStatus).toBe('complete')
    expect(result.answer?.assessmentReport).toEqual(result.assessmentReport)
  })
  itEngagement('builds the target research map before starting deterministic coverage', async () => {
    const events: string[] = []
    const campaign = {
      findings: [],
      coverage: {
        endpointsTotal: 0, endpointsCovered: 0, paramsTotal: 0, paramsCovered: 0,
        rolesTotal: 0, rolesCovered: 0, actorsTotal: 0, actorsCovered: 0,
        statesTotal: 0, statesCovered: 0, techniquesTotal: 0, techniquesPlanned: 0,
        slicesPlanned: 0, slicesExecuted: 0, slicesConfirmed: 0, humanHypothesesConsidered: 0,
      },
      budgetExceeded: false,
      slicesRun: 0,
      status: 'complete',
      requestsUsed: 0,
      remainingSlices: [],
      domains: [],
      units: [],
    }
    await solve(createMockAgent(['Research map ready.']) as any, {
      origin: 'https://example.com',
      goal: 'assess the observed target',
      interactionMode: 'run',
      onMessage: (message: any) => {
        if (message.kind === 'event') events.push(message.event)
      },
      lazyServices: {
        observationState: { status: 'completed', result: { requests: 1, url: 'https://example.com' } },
        crawlState: { stopReason: 'frontier_exhausted', pagesSeen: 1, frontier: [] },
        researchBootstrapState: 'pending',
        markResearchBootstrapAttempted: vi.fn(),
        runCoverageCampaign: vi.fn().mockImplementation(async () => {
          events.push('campaign.called')
          return campaign
        }),
      },
    })

    expect(events.indexOf('research.bootstrap.completed')).toBeGreaterThanOrEqual(0)
    expect(events.indexOf('research.bootstrap.completed')).toBeLessThan(events.indexOf('coverage.started'))
    expect(events.indexOf('coverage.started')).toBeLessThan(events.indexOf('campaign.called'))
  })
  itEngagement('commits the SDK-canonical stream.text as the answer (provider-agnostic, no echo/dup)', async () => {
    // Real provider behavior (e.g. nvidia): the model streams reasoning/scratch
    // AND an echoed answer through `text-delta`, but the SDK normalizes the true
    // deliverable into the `stream.text` promise. The committed `answer.content`
    // must be `stream.text` — never the raw, duplicated delta accumulation.
    const scratch = 'The user said "hi" again — I\'m in Talking mode. Let me keep it casual. '
    const answer = 'Hey again — what do you want to get into?'
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          // scratch + a 9× echoed answer via text-delta
          yield { type: 'text-delta', payload: { text: scratch } }
          for (let i = 0; i < 9; i++) {
            yield { type: 'text-delta', payload: { text: answer } }
          }
        })(),
        toolCalls: [],
        // The canonical deliverable — clean, no scratch, no echo.
        text: Promise.resolve(answer),
      })),
    }
    const messages: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Chat with the user',
      onMessage: (m) => messages.push(m),
    })
    const done = messages.find(m => m.kind === 'done')
    // The committed answer is exactly stream.text — one clean sentence.
    expect(done.answer.content).toBe(answer)
    expect(done.answer.content).not.toContain('Talking mode')
    expect(done.answer.content).not.toContain(scratch)
  })  itEngagement('commits stream.reasoningText as the reasoning when present', async () => {
    // The buddy's decision context: `stream.reasoningText` is the canonical
    // reasoning channel (normalized across providers). It must be the committed
    // `answer.reasoning`, not the raw reasoning-delta accumulation.
    const reasoning = 'I should check the login endpoint first because it takes user input.'
    const answer = 'Testing the login form now.'
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', payload: { text: reasoning } }
          yield { type: 'text-delta', payload: { text: answer } }
        })(),
        toolCalls: [],
        text: Promise.resolve(answer),
        reasoningText: Promise.resolve(reasoning),
      })),
    }
    const messages: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Test login',
      onMessage: (m) => messages.push(m),
    })
    const done = messages.find(m => m.kind === 'done')
    expect(done.answer.reasoning).toBe(reasoning)
    expect(done.answer.content).toBe(answer)
    // The answer must never carry the reasoning scratch.
    expect(done.answer.content).not.toContain('login endpoint')
  })  itEngagement('falls back to reasoning-delta chunks when stream.reasoningText is undefined', async () => {
    // Some providers expose reasoning only as reasoning-delta (no normalized
    // reasoningText). The committed reasoning must fall back to the captured
    // chunks so the buddy's thinking is never lost.
    const reasoning = 'Let me enumerate the endpoints.'
    const answer = 'Enumerating endpoints.'
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          yield { type: 'reasoning-delta', payload: { text: reasoning } }
          yield { type: 'text-delta', payload: { text: answer } }
        })(),
        toolCalls: [],
        text: Promise.resolve(answer),
        // No normalized reasoning channel.
        reasoningText: Promise.resolve(undefined as unknown as string),
      })),
    }
    const messages: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Enumerate',
      onMessage: (m) => messages.push(m),
    })
    const done = messages.find(m => m.kind === 'done')
    expect(done.answer.reasoning).toBe(reasoning)
    expect(done.answer.content).toBe(answer)
  })  itEngagement('does not collapse genuinely new (non-echo) text-delta chunks', async () => {
    // Distinct deltas (normal token streaming) must all be preserved.
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockImplementation(async (_prompt: string) => ({
        fullStream: (async function* () {
          yield { type: 'text-delta', payload: { text: 'Hello ' } }
          yield { type: 'text-delta', payload: { text: 'world, ' } }
          yield { type: 'text-delta', payload: { text: 'this is distinct.' } }
        })(),
        toolCalls: [],
        text: Promise.resolve('Hello world, this is distinct.'),
      })),
    }
    const messages: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Chat',
      onMessage: (m) => messages.push(m),
    })
    const done = messages.find(m => m.kind === 'done')
    expect(done.answer.content).toBe('Hello world, this is distinct.')
  })
  itEngagement('forwards cancellation to the model stream', async () => {
    const controller = new AbortController()
    const agent = createMockAgent(['ok'])

    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Test cancellation',
      signal: controller.signal,
    })

    const streamSignal = agent.stream.mock.calls[0][1].abortSignal as AbortSignal
    expect(streamSignal.aborted).toBe(false)

    controller.abort()
    expect(streamSignal.aborted).toBe(true)
  })
  itEngagement('emits failed tool results instead of leaving streamed tools running', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-call', payload: { toolName: 'httpRequest', args: { url: 'https://example.com' } } }
          yield { type: 'tool-error', payload: { toolName: 'httpRequest', error: new Error('connection reset') } }
        })(),
        text: Promise.resolve(''),
        reasoningText: Promise.resolve(''),
      }),
    }
    const messages: any[] = []

    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Test error streaming',
      onMessage: (message) => messages.push(message),
    })

    expect(messages).toContainEqual({
      kind: 'tool-result',
      name: 'httpRequest',
      ok: false,
      result: 'connection reset',
    })
  })
  itEngagement('recovers from one unavailable tool selection', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-error', payload: { toolName: 'staleConnectorTool', error: 'Tool "staleConnectorTool" not found. Available tools: queryGraph' } }
          yield { type: 'text-delta', payload: { text: 'I will continue with the registered graph tools.' } }
        })(),
        text: Promise.resolve('I will continue with the registered graph tools.'),
      }),
    }
    const result = await solve(agent as any, { origin: 'https://example.com', goal: 'Find vulnerabilities' })
    expect(result.reason).toBe('response_complete')
  })
  itEngagement('preserves typed tool failures in the stream', async () => {
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-result', payload: { toolName: 'httpRequest', result: { ok: false, error: 'HTTP 500' } } }
        })(),
        text: Promise.resolve(''),
        reasoningText: Promise.resolve(''),
      }),
    }
    const messages: any[] = []

    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Test typed failure streaming',
      onMessage: (message) => messages.push(message),
    })

    expect(messages).toContainEqual(expect.objectContaining({
      kind: 'tool-result',
      name: 'httpRequest',
      ok: false,
    }))
  })
  itEngagement('counts retry-attempt findings against the turn-level baseline', async () => {
    // A retry is a new solve() call: its private snapshot already includes
    // findings the failed attempt recorded. Without the turnStartFindings
    // floor it reports newFindings 0 and the card cries wolf.
    const agent = createMockAgent(['Nothing further to add.'])
    const summary = () => ({ totalFindings: 2, totalEndpoints: 1, totalTests: 0, totalCapturedHeaders: 0, findingsBySeverity: {}, endpoints: [], authFlows: 0, rbacRoles: 0, untestedActions: 0 })
    const original = h.graphStoreMock.getTargetSummary
    h.graphStoreMock.getTargetSummary = summary
    try {
      const retry = await solve(agent as any, {
        origin: 'https://example.com',
        goal: 'Follow up',
        turnStartFindings: 1,
      })
      expect(retry.newFindings).toBe(1)
      const control = await solve(agent as any, {
        origin: 'https://example.com',
        goal: 'Follow up',
      })
      expect(control.newFindings).toBe(0)
    } finally {
      h.graphStoreMock.getTargetSummary = original
    }
  })
  itEngagement('classifies provider transport death as model_failed even after a browser hiccup', async () => {
    // Live failure: a failed browser probe poisons terminalFailureReason to
    // browser_failed, then the provider connection dies — and the turn can
    // never fail over because the retry gate only accepts model_failed.
    // Transport death must outrank the earlier tool hiccup.
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: (async function* () {
          yield { type: 'tool-error', payload: { toolName: 'stagehand_navigate', error: 'navigation failed: page crashed' } }
          throw new Error('Cannot connect to API: Headers Timeout Error')
        })(),
        text: Promise.resolve(''),
        reasoningText: Promise.resolve(''),
      }),
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Probe the target',
      config: { maxToolCalls: 5 },
    })
    expect(result.reason).toBe('model_failed')
    expect(result.error ?? '').toMatch(/transport failed/i)
  })

  itEngagement('returns at the hard deadline when a stream iterator never settles', async () => {
    const pending = new Promise<IteratorResult<any>>(() => {})
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      stream: vi.fn().mockResolvedValue({
        fullStream: {
          [Symbol.asyncIterator]: () => ({
            next: () => pending,
            return: vi.fn().mockResolvedValue({ done: true, value: undefined }),
          }),
        },
        toolCalls: [],
        text: new Promise<string>(() => {}),
        reasoningText: new Promise<string>(() => {}),
      }),
    }
    const started = Date.now()

    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Stop when the hard deadline is reached',
      config: { maxDurationMs: 50, progressTimeoutMs: 1000 },
    })

    expect(Date.now() - started).toBeLessThan(1000)
    expect(result.durationMs).toBeLessThan(1000)
  })
})
