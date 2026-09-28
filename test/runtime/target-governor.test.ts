import { describe, expect, it } from 'vitest'
import { TargetTransportGovernor } from '../../src/runtime/target-governor'

describe('TargetTransportGovernor', () => {
  it('enforces per-origin concurrency while allowing independent origins', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 100, maxConcurrent: 2 })
    let activeA = 0
    let maxA = 0
    await Promise.all(Array.from({ length: 6 }, () => governor.run('https://target.example/a', async () => {
      activeA += 1
      maxA = Math.max(maxA, activeA)
      await new Promise((resolve) => setTimeout(resolve, 5))
      activeA -= 1
    })))
    expect(maxA).toBeLessThanOrEqual(2)
    expect(governor.stats('https://target.example/a').requestsInWindow).toBe(6)
  })

  it('keeps separate origins on separate budgets', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 100, maxConcurrent: 1 })
    await governor.run('https://a.example/', async () => undefined)
    await governor.run('https://b.example/', async () => undefined)
    expect(governor.stats('https://a.example/').requestsInWindow).toBe(1)
    expect(governor.stats('https://b.example/').requestsInWindow).toBe(1)
  })

  it('paces consecutive same-origin requests but never blocks a different origin', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 60, maxConcurrent: 4, minIntervalMs: 120 })

    const firstStart = Date.now()
    ;(await governor.acquire('https://paced.example/x'))()
    expect(Date.now() - firstStart).toBeLessThan(60)

    const sameStart = Date.now()
    ;(await governor.acquire('https://paced.example/x'))()
    expect(Date.now() - sameStart).toBeGreaterThanOrEqual(100)

    const otherStart = Date.now()
    ;(await governor.acquire('https://other.example/x'))()
    expect(Date.now() - otherStart).toBeLessThan(60)
  })

  it('exposes a non-zero nextAvailableInMs while the pacing floor is open', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 60, maxConcurrent: 4, minIntervalMs: 500 })
    ;(await governor.acquire('https://paced.example/x'))()
    expect(governor.stats('https://paced.example/x').nextAvailableInMs).toBeGreaterThan(0)
  })
})
