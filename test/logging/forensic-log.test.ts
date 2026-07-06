import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ForensicLog } from '../../src/logging/forensic-log'

let tempDir: string
let log: ForensicLog

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'forensic-test-'))
  log = new ForensicLog(join(tempDir, 'forensic.ndjson'))
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ForensicLog — extended event types', () => {
  it('logs model-call events with metadata', () => {
    log.log({
      type: 'model-call',
      agent: 'solver-brain',
      metadata: {
        provider: 'groq',
        modelId: 'llama3-8b',
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300,
      },
    })

    const events = log.getEvents({ type: 'model-call' })
    expect(events).toHaveLength(1)
    expect(events[0].metadata?.provider).toBe('groq')
    expect(events[0].metadata?.totalTokens).toBe(300)
  })

  it('logs rate-limit-event with provider info', () => {
    log.log({
      type: 'rate-limit-event',
      agent: 'rate-limiter',
      args: { provider: 'groq' },
      metadata: {
        provider: 'groq',
        rateLimitUsed: 10,
        rateLimitRemaining: 5,
      },
    })

    const events = log.getEvents({ type: 'rate-limit-event' })
    expect(events).toHaveLength(1)
    expect(events[0].metadata?.rateLimitUsed).toBe(10)
    expect(events[0].metadata?.rateLimitRemaining).toBe(5)
  })

  it('logs budget-status event', () => {
    log.log({
      type: 'budget-status',
      agent: 'solver-brain',
      metadata: {
        budgetRemaining: 5000,
        enforcement: 'soft',
      },
    })

    const events = log.getEvents({ type: 'budget-status' })
    expect(events).toHaveLength(1)
    expect(events[0].metadata?.budgetRemaining).toBe(5000)
    expect(events[0].metadata?.enforcement).toBe('soft')
  })

  it('logs model-selection event', () => {
    log.log({
      type: 'model-selection',
      agent: 'solver-brain',
      metadata: {
        provider: 'groq',
        modelId: 'llama3-8b',
      },
      args: { reason: 'fast tier' },
    })

    const events = log.getEvents({ type: 'model-selection' })
    expect(events).toHaveLength(1)
    expect(events[0].metadata?.modelId).toBe('llama3-8b')
  })

  it('logs context-validation event', () => {
    log.log({
      type: 'context-validation',
      agent: 'solver-brain',
      metadata: {
        contextFit: 'warning',
        toolCount: 12,
        prunedTools: ['legacy-tool-1'],
      },
    })

    const events = log.getEvents({ type: 'context-validation' })
    expect(events).toHaveLength(1)
    expect(events[0].metadata?.contextFit).toBe('warning')
    expect(events[0].metadata?.prunedTools).toContain('legacy-tool-1')
  })

  it('logs config-mismatch event', () => {
    log.log({
      type: 'config-mismatch',
      agent: 'rate-limiter',
      args: { expected: 25, actual: 10, header: 'x-ratelimit-remaining' },
    })

    const events = log.getEvents({ type: 'config-mismatch' })
    expect(events).toHaveLength(1)
    expect(events[0].args?.expected).toBe(25)
  })

  it('logs tool-token-record event', () => {
    log.log({
      type: 'tool-token-record',
      agent: 'profiler',
      tool: 'navigate',
      metadata: {
        inputTokens: 50,
        outputTokens: 100,
        totalTokens: 150,
        durationMs: 230,
      },
    })

    const events = log.getEvents({ type: 'tool-token-record' })
    expect(events).toHaveLength(1)
    expect(events[0].tool).toBe('navigate')
    expect(events[0].metadata?.totalTokens).toBe(150)
  })

  it('getIndex tracks new event types', () => {
    log.log({ type: 'model-call', agent: 'brain' })
    log.log({ type: 'model-call', agent: 'brain' })
    log.log({ type: 'budget-status', agent: 'brain' })
    log.log({ type: 'rate-limit-event', agent: 'limiter' })
    log.log({ type: 'model-selection', agent: 'selector' })
    log.log({ type: 'context-validation', agent: 'brain' })

    const idx = log.getIndex()
    expect(idx.modelCalls).toBe(2)
    expect(idx.budgetStatuses).toBe(1)
    expect(idx.rateLimitEvents).toBe(1)
    expect(idx.modelSelections).toBe(1)
    expect(idx.contextValidations).toBe(1)
  })

  it('getSummary includes new counters', () => {
    log.log({ type: 'model-call', agent: 'brain' })
    log.log({ type: 'budget-status', agent: 'brain' })

    const summary = log.getSummary()
    expect(summary).toContain('Model calls: 1')
    expect(summary).toContain('Budget statuses: 1')
  })

  it('getEvents filters by new types', () => {
    log.log({ type: 'model-call', agent: 'brain' })
    log.log({ type: 'tool-call', agent: 'brain', tool: 'navigate' })
    log.log({ type: 'rate-limit-event', agent: 'limiter' })
    log.log({ type: 'context-validation', agent: 'brain' })

    expect(log.getEvents({ type: 'model-call' })).toHaveLength(1)
    expect(log.getEvents({ type: 'rate-limit-event' })).toHaveLength(1)
    expect(log.getEvents({ type: 'context-validation' })).toHaveLength(1)
    expect(log.getEvents({ type: 'tool-call' })).toHaveLength(1)
  })
})
