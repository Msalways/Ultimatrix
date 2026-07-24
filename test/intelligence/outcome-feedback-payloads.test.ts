import { describe, it, expect, beforeEach } from 'vitest'
import { OutcomeFeedbackStore, type PayloadOutcome } from '../../src/intelligence/outcome-feedback'

vi.mock('../../src/skills/technique-registry', () => ({
  getTechniqueRegistry: () => ({
    setTechniqueOutcomeStats: vi.fn(),
    getTechniqueWeight: vi.fn().mockReturnValue(1),
  }),
}))

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => ({ getCurrentTarget: () => 'https://example.com' }),
}))

vi.mock('../../src/intelligence/reflexion-store', () => ({
  saveOutcomeFeedback: vi.fn(),
}))

describe('Payload-level outcome feedback', () => {
  let store: OutcomeFeedbackStore

  beforeEach(() => {
    store = new OutcomeFeedbackStore()
  })

  it('records a payload outcome with source and context', () => {
    const outcome = store.recordPayloadOutcome({
      payload: "1' AND SLEEP(5)-- -",
      vulnType: 'sqli',
      source: 'llm',
      worked: true,
      context: { dbms: 'mysql', waf: 'cloudflare' },
    })

    expect(outcome.payload).toBe("1' AND SLEEP(5)-- -")
    expect(outcome.vulnType).toBe('sqli')
    expect(outcome.source).toBe('llm')
    expect(outcome.worked).toBe(true)
    expect(outcome.context?.dbms).toBe('mysql')
    expect(outcome.context?.waf).toBe('cloudflare')
    expect(outcome.timestamp).toBeDefined()
    expect(outcome.targetOrigin).toBe('example.com')
  })

  it('retrieves payload effectiveness filtered by vulnType', () => {
    store.recordPayloadOutcome({ payload: 'p1', vulnType: 'sqli', source: 'static', worked: true })
    store.recordPayloadOutcome({ payload: 'p2', vulnType: 'sqli', source: 'llm', worked: false })
    store.recordPayloadOutcome({ payload: 'p3', vulnType: 'xss', source: 'llm', worked: true })

    const sqliOutcomes = store.getPayloadEffectiveness('sqli')
    expect(sqliOutcomes).toHaveLength(2)
    expect(sqliOutcomes.every(o => o.vulnType === 'sqli')).toBe(true)

    const xssOutcomes = store.getPayloadEffectiveness('xss')
    expect(xssOutcomes).toHaveLength(1)
    expect(xssOutcomes[0].payload).toBe('p3')
  })

  it('retrieves all payload outcomes when no vulnType filter', () => {
    store.recordPayloadOutcome({ payload: 'p1', vulnType: 'sqli', source: 'static', worked: true })
    store.recordPayloadOutcome({ payload: 'p2', vulnType: 'xss', source: 'llm', worked: false })

    const all = store.getPayloadEffectiveness()
    expect(all).toHaveLength(2)
  })

  it('tracks both worked and failed payloads for the same vulnType', () => {
    store.recordPayloadOutcome({ payload: 'good', vulnType: 'sqli', source: 'llm', worked: true })
    store.recordPayloadOutcome({ payload: 'bad', vulnType: 'sqli', source: 'static', worked: false })
    store.recordPayloadOutcome({ payload: 'ugly', vulnType: 'sqli', source: 'mutation', worked: false })

    const outcomes = store.getPayloadEffectiveness('sqli')
    const worked = outcomes.filter(o => o.worked)
    const failed = outcomes.filter(o => !o.worked)
    expect(worked).toHaveLength(1)
    expect(failed).toHaveLength(2)
    expect(worked[0].source).toBe('llm')
    expect(failed.map(o => o.source).sort()).toEqual(['mutation', 'static'])
  })
})
