import { describe, expect, it } from 'vitest'
import { withProgressWatchdog } from '../../src/solver/solver'

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('solver progress watchdog', () => {
  it('does not treat an active tool call as a stalled model stream', async () => {
    const source = (async function* () {
      yield { type: 'tool-call', payload: { toolName: 'stagehand_navigate', toolCallId: 'nav-1' } }
      await delay(40)
      yield { type: 'tool-result', payload: { toolName: 'stagehand_navigate', toolCallId: 'nav-1' } }
    })()

    const events = []
    for await (const event of withProgressWatchdog(source, 10)) events.push(event)

    expect(events.map(event => event.type)).toEqual(['tool-call', 'tool-result'])
  })

  it('still stops a tool call at the overall turn deadline', async () => {
    const source = (async function* () {
      yield { type: 'tool-call', payload: { toolName: 'stagehand_navigate' } }
      await delay(100)
      yield { type: 'tool-result', payload: { toolName: 'stagehand_navigate' } }
    })()
    const controller = new AbortController()
    const deadline = setTimeout(() => controller.abort(new Error('turn deadline')), 10)

    try {
      await expect(async () => {
        for await (const _event of withProgressWatchdog(source, 5, controller.signal)) { /* consume */ }
      }).rejects.toThrow('turn deadline')
    } finally {
      clearTimeout(deadline)
    }
  })
})
