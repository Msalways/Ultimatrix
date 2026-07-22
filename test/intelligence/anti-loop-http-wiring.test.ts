import { describe, it, expect, beforeEach } from 'vitest'
import { getHttpLoopDetector } from '../../src/tools/http-tools'

describe('Anti-loop HTTP wiring', () => {
  let detector: ReturnType<typeof getHttpLoopDetector>

  beforeEach(() => {
    detector = getHttpLoopDetector()
    detector.reset()
  })

  it('getHttpLoopDetector returns the singleton LoopDetector wired into httpRequest', () => {
    expect(detector).toBeDefined()
    expect(detector.blockedTargets).toBeInstanceOf(Set)
    expect(detector.failedTargets).toBeInstanceOf(Map)
  })

  it('trackFailedTarget blocks a host after threshold failures', () => {
    const blocked1 = detector.trackFailedTarget(
      'https://unreachable.example.com/page',
      'Connection refused',
    )
    expect(blocked1).toBeNull()

    const blocked2 = detector.trackFailedTarget(
      'https://unreachable.example.com/page2',
      'Name or service not known',
    )
    expect(blocked2).toBeNull()

    const blocked3 = detector.trackFailedTarget(
      'https://unreachable.example.com/page3',
      'Connection refused',
    )
    expect(blocked3).toBe('unreachable.example.com')
    expect(detector.isTargetBlocked('unreachable.example.com')).toBe(true)
  })

  it('isTargetBlocked returns false for hosts that have not failed enough times', () => {
    detector.trackFailedTarget('https://target.example.com', 'Connection refused')
    expect(detector.isTargetBlocked('target.example.com')).toBe(false)
  })

  it('trackFailedTarget ignores non-access errors (e.g. generic timeout)', () => {
    const result = detector.trackFailedTarget(
      'https://timeout.example.com',
      'Some unexpected error message',
    )
    expect(result).toBeNull()
    expect(detector.isTargetBlocked('timeout.example.com')).toBe(false)
  })

  it('blocked target stays blocked across multiple checks', () => {
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')

    expect(detector.isTargetBlocked('bad.example.com')).toBe(true)
    expect(detector.isTargetBlocked('bad.example.com')).toBe(true)
  })

  it('reset clears all blocked and failed targets', () => {
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')
    detector.trackFailedTarget('https://bad.example.com', 'Connection refused')
    expect(detector.isTargetBlocked('bad.example.com')).toBe(true)

    detector.reset()
    expect(detector.isTargetBlocked('bad.example.com')).toBe(false)
    expect(detector.failedTargets.size).toBe(0)
    expect(detector.blockedTargets.size).toBe(0)
  })
})
