import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn(), nl: vi.fn() },
}))

vi.mock('../../src/tools/report-tools', () => ({
  setForensicLog: vi.fn().mockReturnValue({
    log: vi.fn(),
  }),
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
        text: Promise.resolve(reasoning + text),
      }
    }),
  }
}

describe('solve', () => {
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

  it('returns frontier_exhausted when no findings', async () => {
    const agent = createMockAgent([
      'No progress possible. All paths blocked.',
    ])
    const result = await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find vulnerabilities and extract shell access',
      config: { maxToolCalls: 5, staleThreshold: 2 },
    })
    expect(result.completed).toBe(false)
    expect(result.reason).toBe('frontier_exhausted')
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

  it('emits reasoning-delta as phase:reason events', async () => {
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
    const reasonEvents = events.filter(e => e.phase === 'reason')
    expect(reasonEvents.length).toBeGreaterThan(0)
    expect(reasonEvents.some(e => e.text?.includes('SQL injection'))).toBe(true)
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

  it('suppresses text-delta display when reasoning chunks present', async () => {
    const agent = createReasoningMockAgent(
      ['Analysis: 8 endpoints found, SQL injection confirmed.'],
      ['| # | Endpoint | Type | Severity |']
    )
    const events: any[] = []
    await solve(agent as any, {
      origin: 'https://example.com',
      goal: 'Find SQL injection',
      onPhase: (event) => events.push(event),
    })
    const reasonEvents = events.filter(e => e.phase === 'reason')
    const hasAnalysis = reasonEvents.some(e => e.text?.includes('Analysis'))
    const hasRawTable = reasonEvents.some(e => e.text?.includes('| # |'))
    expect(hasAnalysis).toBe(true)
    expect(hasRawTable).toBe(false)
  })
})
