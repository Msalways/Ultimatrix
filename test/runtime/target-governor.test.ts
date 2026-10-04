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

  it('enforces a hard engagement request cap across origins', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 100, maxConcurrent: 2, maxRequests: 2 })
    await governor.run('https://a.example/one', async () => undefined)
    await governor.run('https://b.example/two', async () => undefined)
    await expect(governor.acquire('https://a.example/three')).rejects.toThrow(/request budget reached \(2\/2\)/)
    expect(governor.stats('https://a.example/').requestsUsed).toBe(2)
  })

  it('aborts a queued resource claim without sending or reserving a request', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 100, maxConcurrent: 1, maxRequests: 5, minIntervalMs: 0 })
    const release = await governor.acquire('https://target.example/first')
    const controller = new AbortController()
    const pending = governor.acquire('https://target.example/queued', 'http-tool', controller.signal)
    controller.abort(new Error('turn deadline'))

    await expect(pending).rejects.toThrow('turn deadline')
    release()
    expect(governor.stats('https://target.example/').requestsUsed).toBe(1)
    expect(governor.stats('https://target.example/').active).toBe(0)
  })

  it('caps repeated exact URLs in the model HTTP lane without constraining browser traffic', async () => {
    const governor = new TargetTransportGovernor({ requestsPerMinute: 100, maxConcurrent: 2, maxRequests: 10, maxRequestsPerUrl: 2 })
    for (let index = 0; index < 4; index++) await governor.run('https://target.example/', async () => undefined)
    for (let index = 0; index < 2; index++) (await governor.acquire('https://target.example/', 'http-tool'))()
    await expect(governor.acquire('https://target.example/', 'http-tool')).rejects.toThrow(/Repeated-request budget/)
  })
})
