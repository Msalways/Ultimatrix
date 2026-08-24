import { describe, expect, it, vi } from 'vitest'
import { PassiveObserver } from '../../src/capture/passive-observer'

describe('PassiveObserver', () => {
  it('does not throw when page request events are unsupported', () => {
    const page = {
      on: vi.fn((event: string) => {
        if (event === 'request') throw new Error('Unsupported event: request')
      }),
      off: vi.fn(),
    }

    const observer = new PassiveObserver()
    expect(() => observer.attach(page as any)).not.toThrow()
    expect(page.on).toHaveBeenCalledWith('request', expect.any(Function))
    expect(page.on).toHaveBeenCalledWith('response', expect.any(Function))
  })
})
