import { describe, expect, it, vi } from 'vitest'
import { InteractionBroker } from '../../src/runtime/interaction-broker'

describe('InteractionBroker', () => {
  it('delivers a typed operator reply only to the active run', async () => {
    const broker = new InteractionBroker()
    broker.beginRun('run-a')
    const requestEvent = new Promise<any>(resolve => broker.once('request', resolve))
    const answer = broker.request({ kind: 'approval', question: 'Approve the state-changing request?' }, 1000)
    const request = await requestEvent

    expect(request).toMatchObject({ runId: 'run-a', kind: 'approval' })
    expect(broker.reply('run-b', request.requestId, 'yes')).toBe(false)
    expect(broker.reply('run-a', request.requestId, 'yes')).toBe(true)
    await expect(answer).resolves.toBe('yes')
  })

  it('bounds steering and resolves pending prompts closed when a run ends', async () => {
    const broker = new InteractionBroker()
    broker.beginRun('run-a')
    for (let i = 0; i < 5; i++) expect(broker.steer('run-a', `direction ${i}`)).toBe(true)
    expect(broker.steer('run-a', 'one too many')).toBe(false)
    expect(broker.takeSteering('run-a')).toHaveLength(5)

    const answer = broker.request({ kind: 'question', question: 'Need operator input?' }, 10_000)
    broker.endRun('run-a')
    await expect(answer).resolves.toBe('')
    expect(broker.isActive()).toBe(false)
  })

  it('expires unanswered prompts without approving them', async () => {
    vi.useFakeTimers()
    try {
      const broker = new InteractionBroker()
      broker.beginRun('run-a')
      const answer = broker.request({ kind: 'approval', question: 'Approve?' }, 25)
      await vi.advanceTimersByTimeAsync(25)
      await expect(answer).resolves.toBe('')
    } finally {
      vi.useRealTimers()
    }
  })

  it('serializes parallel prompts so each operator reply has one recipient', async () => {
    const broker = new InteractionBroker()
    broker.beginRun('run-a')
    const requests: any[] = []
    broker.on('request', request => requests.push(request))
    const first = broker.request({ kind: 'approval', question: 'First?' }, 1000)
    const second = broker.request({ kind: 'approval', question: 'Second?' }, 1000)
    expect(requests.map(request => request.question)).toEqual(['First?'])

    expect(broker.reply('run-a', requests[0].requestId, 'yes')).toBe(true)
    expect(requests.map(request => request.question)).toEqual(['First?', 'Second?'])
    expect(broker.reply('run-a', requests[0].requestId, 'yes')).toBe(false)
    expect(broker.reply('run-a', requests[1].requestId, 'no')).toBe(true)
    await expect(first).resolves.toBe('yes')
    await expect(second).resolves.toBe('no')
  })
})
