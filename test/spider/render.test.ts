/**
 * Spider event renderer tests — the CLI surface contract.
 *
 * Every typed spider event must render to a display line AND bridge to a
 * solver PhaseEvent (nothing dropped). The fixture file is the shared parity
 * contract; the web parity test imports the SAME fixtures to prove CLI and
 * Web render identically.
 */

import { describe, expect, it } from 'vitest'
import { spiderEventLine, spiderEventToPhase, SPIDER_EVENT_PHASE } from '../../src/spider/render'
import { spiderEventFixtures, spiderEventLineExpectations, spiderEventPhaseExpectations } from '../fixtures/spider-events'
import type { SpiderRuntimeEventName } from '../../src/spider/runtime'

const ALL_TYPES: SpiderRuntimeEventName[] = [
  'crawl_started',
  'page_seen',
  'endpoint_seen',
  'form_seen',
  'auth_detected',
  'auth_transition',
  'scope_proposed',
  'crawl_progress',
  'crawl_stalled',
  'crawl_completed',
]

describe('spiderEventLine (CLI parity)', () => {
  it('renders every typed event exactly as the shared contract', () => {
    for (const event of spiderEventFixtures) {
      expect(spiderEventLine(event)).toBe(spiderEventLineExpectations[event.type])
    }
  })

  it('fixtures cover the full typed event set (drift guard)', () => {
    const fixtureTypes = new Set(spiderEventFixtures.map((e) => e.type))
    expect([...fixtureTypes].sort()).toEqual([...ALL_TYPES].sort())
  })

  it('line renderer also covers every type in the enum (drift guard)', () => {
    const known = Object.keys(SPIDER_EVENT_PHASE) as SpiderRuntimeEventName[]
    expect([...known].sort()).toEqual([...ALL_TYPES].sort())
  })

  it('auth_transition line uses typed from/to labels, not string parsing', () => {
    const event = spiderEventFixtures.find((e) => e.type === 'auth_transition')!
    expect(spiderEventLine(event)).toBe('[Spider] Auth transition: anonymous -> alice')
  })
})

describe('spiderEventToPhase (solver-stream bridge)', () => {
  it('bridges every typed event into a PhaseEvent (nothing dropped)', () => {
    for (const event of spiderEventFixtures) {
      expect(spiderEventToPhase(event)).toEqual(spiderEventPhaseExpectations[event.type])
    }
  })

  it('maps crawl_stalled to the stale phase with a typed reason', () => {
    const stalled = spiderEventFixtures.find((e) => e.type === 'crawl_stalled')!
    expect(spiderEventToPhase(stalled)).toEqual({ phase: 'stale', step: 0, reason: 'stale' })
  })

  it('maps all other events to observe with the rendered text', () => {
    for (const event of spiderEventFixtures.filter((e) => e.type !== 'crawl_stalled')) {
      const phase = spiderEventToPhase(event)
      expect(phase.phase).toBe('observe')
      expect(phase.text).toBe(spiderEventLine(event))
    }
  })
})
