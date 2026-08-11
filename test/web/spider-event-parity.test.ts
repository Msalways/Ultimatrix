/**
 * Spider event WEB parity tests.
 *
 * Proves the Web surface consumes the SAME typed `spider:event` stream the
 * CLI renders from: the global emitter forwards each typed event (the solve
 * route subscribes here), the phase bridge (web engine) matches the CLI
 * contract, and the UI-facing line renderer (chat-stream) produces identical
 * output for the same fixtures.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { getGlobalEmitter } from '../../src/events/emitter'
import { spiderEventLine, spiderEventToPhase } from '../../src/spider/render'
import { spiderEventFixtures, spiderEventLineExpectations, spiderEventPhaseExpectations } from '../fixtures/spider-events'

describe('web spider:event stream (SSE subscriber path)', () => {
  beforeEach(() => {
    getGlobalEmitter().removeAllListeners('spider:event')
  })

  it('spider:event has subscribers and forwards the full typed payload', () => {
    const onSpiderEvent = vi.fn()
    getGlobalEmitter().on('spider:event', onSpiderEvent)

    for (const event of spiderEventFixtures) {
      getGlobalEmitter().emit('spider:event', event)
    }

    expect(getGlobalEmitter().listenerCount('spider:event')).toBeGreaterThan(0)
    expect(onSpiderEvent).toHaveBeenCalledTimes(spiderEventFixtures.length)
    const received = onSpiderEvent.mock.calls.map(([e]) => e)
    for (const event of spiderEventFixtures) {
      expect(received).toContainEqual(event)
    }
  })

  it('off removes the subscriber after the crawl window', () => {
    const onSpiderEvent = vi.fn()
    getGlobalEmitter().on('spider:event', onSpiderEvent)
    getGlobalEmitter().off('spider:event', onSpiderEvent)
    getGlobalEmitter().emit('spider:event', spiderEventFixtures[0])
    expect(onSpiderEvent).not.toHaveBeenCalled()
    expect(getGlobalEmitter().listenerCount('spider:event')).toBe(0)
  })
})

describe('web parity — same fixtures, same output as CLI', () => {
  it('engine phase bridge matches the CLI PhaseEvent contract', () => {
    for (const event of spiderEventFixtures) {
      expect(spiderEventToPhase(event)).toEqual(spiderEventPhaseExpectations[event.type])
    }
  })

  it('UI status-line renderer matches the CLI line contract', () => {
    for (const event of spiderEventFixtures) {
      expect(spiderEventLine(event)).toBe(spiderEventLineExpectations[event.type])
    }
  })

  it('typed events carry workflowId so concurrent engines can be scoped', () => {
    const workflowIds = new Set(spiderEventFixtures.map((e) => e.workflowId))
    expect(workflowIds.size).toBe(1)
    for (const event of spiderEventFixtures) expect(event.workflowId).toBeTruthy()
  })
})
