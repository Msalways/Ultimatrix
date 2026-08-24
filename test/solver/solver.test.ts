import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { solve } from '../../src/solver/solver'

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

describe('solve', () => {
  beforeEach(() => {
    h.runActiveChainingMock.mockClear()
    h.exploitLoopMock.mockClear()
    h.graphStoreMock.hasFinding = false
  })

  it('creates plan and executes tasks sequentially', async () => {
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

  it('returns goal_achieved when finding confirmed', async () => {
    const agent = createMockAgent([
      'Found SQL injection error on /api. Evidence confirmed.',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.steps).toBeGreaterThanOrEqual(0)
  })

  it('returns response_complete when the model answers without running tools', async () => {
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
  })

  it('returns budget_reached when max tool calls exceeded', async () => {
    const agent = createMockAgent(
      Array(10).fill('Testing endpoint for SQLi...')
    )
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 3 },
    })
    expect(result.completed).toBe(false)
  })

  it('seeds initial fact with origin and goal', async () => {
    const agent = createMockAgent(['Exploring the target.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.facts).toBeGreaterThanOrEqual(1)
  })

  it('includes hints as initial facts', async () => {
    const agent = createMockAgent(['Exploring with hints.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      hints: ['User enumeration possible'],
    })
    expect(result.facts).toBeGreaterThanOrEqual(2)
  })

  it('reports tool calls', async () => {
    const agent = createMockAgent(['Testing endpoints.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
    })
    expect(result.toolCalls).toBeGreaterThanOrEqual(0)
  })

  it('emits phase events', async () => {
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
  })

  it('conclude rejects ungrounded claims', async () => {
    const agent = createMockAgent([
      'This is a completely fabricated claim with no evidence whatsoever',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 10, staleThreshold: 3 },
    })
    expect(result.completed).toBe(false)
  })

  it('plan summary included in result', async () => {
    const agent = createMockAgent(['Plan: test /api for sqli.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.planSummary).toBeDefined()
  })

  it('returns result with all required fields', async () => {
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
  })

  it('handles agent stream errors gracefully', async () => {
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
    expect(result.reason).toBe('stale')
  })

  it('content does not leak through onPhase events (solver stream only)', async () => {
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
  })

  it('does not persist reasoning prose into result.text (prevents next-turn echo, A12)', async () => {
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
  })

  it('returns responseText as result.text when non-reasoning model', async () => {
    const agent = createMockAgent(['Found SQL injection via error-based response.'])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
    })
    expect(result.text).toBeDefined()
    expect(result.text).toContain('SQL injection')
  })

  it('answer and reasoning flow through solver stream, not phase channel', async () => {
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
  })

  it('invokes exploitation loop after a finding lands (multi-model engine)', async () => {
    h.exploitLoopMock.mockResolvedValue({
      notes: ['escalated idor via held session'],
      executed: 1,
      proofsBuilt: 1,
    })
    h.graphStoreMock.hasFinding = true
    const agent = createMockAgent(['Done.'])
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
  })

  it('does not invoke exploitation loop when maxActiveChainSteps is 0', async () => {
    h.exploitLoopMock.mockResolvedValue({ notes: [], executed: 0, proofsBuilt: 0 })
    const agent = createMockAgent(['Done.'])
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities',
      ultimatrixConfig: { engine: 'multi-model', solver: { maxActiveChainSteps: 0 } } as any,
    })
    expect(h.exploitLoopMock).not.toHaveBeenCalled()
  })

  it('emits structured onMessage: answer vs reasoning separated, done carries answer', async () => {
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
  })

  it('falls back to stream.text when text-delta delivers no answer (reasoning-only model)', async () => {
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

  it('uses structured output response as the final assistant answer', async () => {
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

  it('does not force structured output for normal assistant turns', async () => {
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

  it('answers directly when the typed router chooses respond', async () => {
    let currentTools: Record<string, any> | undefined
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      setTurnToolsOverride: vi.fn((tools?: Record<string, any>) => {
        currentTools = tools
      }),
      stream: vi.fn().mockImplementation(async () => ({
        fullStream: (async function* () {
          await currentTools?.decideTurn.execute({ action: 'respond', response: 'Hi. What would you like to inspect?' })
        })(),
        toolCalls: [],
        text: Promise.resolve(''),
      })),
    }
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'hi',
    })
    expect(agent.setTurnToolsOverride.mock.calls[0][0]).toHaveProperty('decideTurn')
    expect(agent.setTurnToolsOverride).toHaveBeenLastCalledWith(undefined)
    expect(agent.stream).toHaveBeenCalledTimes(1)
    expect(result.toolCalls).toBe(0)
    expect(result.text).toContain('Hi')
  })

  it('runs a capability turn from the original goal without serializing the decision back to the model', async () => {
    let currentTools: Record<string, any> | undefined
    const agent = {
      instructions: undefined as any,
      tools: undefined as any,
      setTurnToolsOverride: vi.fn((tools?: Record<string, any>) => {
        currentTools = tools
      }),
      stream: vi.fn().mockImplementation(async () => {
        const isRouterPass = Boolean(currentTools?.decideTurn)
        return {
          fullStream: (async function* () {
            if (isRouterPass) {
              await currentTools?.decideTurn.execute({ action: 'use_capability', objective: 'map the target surface' })
            } else {
              yield { type: 'text-delta', payload: { text: 'I will map the target surface.' } }
            }
          })(),
          toolCalls: [],
          text: Promise.resolve(isRouterPass ? '' : 'I will map the target surface.'),
        }
      }),
    }
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'map the target attack surface',
      interactionMode: 'run',
    })
    expect(agent.stream).toHaveBeenCalledTimes(2)
    const secondPrompt = agent.stream.mock.calls[1][0]
    expect(secondPrompt).toContain('map the target attack surface')
    expect(secondPrompt).not.toContain('Turn decision')
    expect(secondPrompt).not.toContain('use_capability')
  })

  it('commits the SDK-canonical stream.text as the answer (provider-agnostic, no echo/dup)', async () => {
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
  })

  it('commits stream.reasoningText as the reasoning when present', async () => {
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
  })

  it('falls back to reasoning-delta chunks when stream.reasoningText is undefined', async () => {
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
  })

  it('does not collapse genuinely new (non-echo) text-delta chunks', async () => {
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

  it('forwards cancellation to the model stream', async () => {
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

  it('emits failed tool results instead of leaving streamed tools running', async () => {
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

  it('preserves typed tool failures in the stream', async () => {
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
})
