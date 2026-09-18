import { describe, it, expect, beforeEach } from 'vitest'
import {
  createOrUpdate,
  getById,
  getByRun,
  getActive,
  promote,
  kill,
  addCandidate,
  clearOpportunities,
} from '../../../src/research/opportunities/store'
import type { OpportunitySignal } from '../../../src/research/opportunities/types'

const SIGNAL: OpportunitySignal = { type: 'suspicious-endpoint', source: 'traffic' }

describe('Opportunity Store', () => {
  beforeEach(() => {
    clearOpportunities()
  })

  it('creates a new opportunity', () => {
    const opp = createOrUpdate('run-1', 'https://example.com', SIGNAL, {
      title: 'Suspicious API endpoint',
      priority: 70,
    })

    expect(opp.id).toBeTruthy()
    expect(opp.runId).toBe('run-1')
    expect(opp.targetRef).toBe('https://example.com')
    expect(opp.title).toBe('Suspicious API endpoint')
    expect(opp.priority).toBe(70)
    expect(opp.status).toBe('new')
    expect(opp.seenCount).toBe(1)
  })

  it('deduplicates on same target + signal', () => {
    const opp1 = createOrUpdate('run-1', 'https://example.com', SIGNAL)
    const opp2 = createOrUpdate('run-1', 'https://example.com', SIGNAL)

    expect(opp1.id).toBe(opp2.id) // same object
    expect(opp2.seenCount).toBe(2)
  })

  it('creates separate opportunities for different targets', () => {
    const opp1 = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    const opp2 = createOrUpdate('run-1', 'https://b.com', SIGNAL)

    expect(opp1.id).not.toBe(opp2.id)
  })

  it('creates separate opportunities for different signals', () => {
    const s1: OpportunitySignal = { type: 'auth-anomaly', source: 'traffic' }
    const s2: OpportunitySignal = { type: 'injection-signal', source: 'scanner' }

    const opp1 = createOrUpdate('run-1', 'https://a.com', s1)
    const opp2 = createOrUpdate('run-1', 'https://a.com', s2)

    expect(opp1.id).not.toBe(opp2.id)
  })

  it('merges evidence refs on dedup', () => {
    createOrUpdate('run-1', 'https://a.com', SIGNAL, { evidenceRefs: ['ev-1'] })
    const opp = createOrUpdate('run-1', 'https://a.com', SIGNAL, { evidenceRefs: ['ev-2'] })

    expect(opp.evidenceRefs).toContain('ev-1')
    expect(opp.evidenceRefs).toContain('ev-2')
  })

  it('looks up by ID', () => {
    const opp = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    expect(getById(opp.id)).toBe(opp)
    expect(getById('nonexistent')).toBeUndefined()
  })

  it('filters by run ID', () => {
    createOrUpdate('run-1', 'https://a.com', SIGNAL)
    createOrUpdate('run-2', 'https://b.com', SIGNAL)

    expect(getByRun('run-1')).toHaveLength(1)
    expect(getByRun('run-2')).toHaveLength(1)
    expect(getByRun('run-3')).toHaveLength(0)
  })

  it('filters active opportunities', () => {
    const opp1 = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    const opp2 = createOrUpdate('run-1', 'https://b.com', SIGNAL)

    promote(opp1.id, 'task-1')

    const active = getActive('run-1')
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe(opp2.id)
  })

  it('promotes opportunity to task', () => {
    const opp = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    const result = promote(opp.id, 'task-1')

    expect(result!.status).toBe('promoted')
    expect(result!.taskRefs).toContain('task-1')
  })

  it('kills opportunity with reason', () => {
    const opp = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    const result = kill(opp.id, 'already_tested')

    expect(result!.status).toBe('killed')
    expect(result!.killReason).toBe('already_tested')
    expect(result!.killedAt).toBeGreaterThan(0)
  })

  it('adds candidate refs', () => {
    const opp = createOrUpdate('run-1', 'https://a.com', SIGNAL)
    addCandidate(opp.id, 'cand-1')
    addCandidate(opp.id, 'cand-2')

    expect(opp.candidateRefs).toEqual(['cand-1', 'cand-2'])
  })

  it('clears all data', () => {
    createOrUpdate('run-1', 'https://a.com', SIGNAL)
    clearOpportunities()
    expect(getByRun('run-1')).toHaveLength(0)
  })
})
