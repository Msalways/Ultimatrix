import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SlidingWindowLimiter, Semaphore, getSharedLimiter, getSharedSemaphore, resetSharedInstances } from '../../src/models/rate-limiter'

describe('SlidingWindowLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows immediate acquisition when under limit', async () => {
    const limiter = new SlidingWindowLimiter(10)
    await limiter.acquire()
    expect(limiter.getUsed()).toBe(1)
    expect(limiter.getAvailable()).toBe(9)
  })

  it('tracks multiple acquisitions', async () => {
    const limiter = new SlidingWindowLimiter(5)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()
    expect(limiter.getUsed()).toBe(3)
    expect(limiter.getAvailable()).toBe(2)
  })

  it('blocks when window capacity reached', async () => {
    const limiter = new SlidingWindowLimiter(2)
    await limiter.acquire()
    await limiter.acquire()
    expect(limiter.getUsed()).toBe(2)
    expect(limiter.getAvailable()).toBe(0)

    let resolved = false
    const promise = limiter.acquire().then(() => { resolved = true })

    // Should NOT resolve immediately — window is full
    await vi.advanceTimersByTimeAsync(50)
    expect(resolved).toBe(false)

    // After 60s the oldest call expires, freeing a slot
    await vi.advanceTimersByTimeAsync(60_000)
    await promise
    expect(resolved).toBe(true)
  })

  it('evicts old timestamps as window slides', async () => {
    const limiter = new SlidingWindowLimiter(2)
    await limiter.acquire()

    // Advance 30s — still in window
    vi.advanceTimersByTime(30_000)
    await limiter.acquire()
    expect(limiter.getUsed()).toBe(2)

    // Advance another 31s — first call (61s ago) falls outside window
    vi.advanceTimersByTime(31_000)
    expect(limiter.getUsed()).toBe(1) // only the second call remains
    expect(limiter.getAvailable()).toBe(1)

    // Third call should succeed without blocking
    let resolved = false
    const p = limiter.acquire().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(10)
    expect(resolved).toBe(true)
    await p
  })

  it('never exceeds max requests per window', async () => {
    const limiter = new SlidingWindowLimiter(3)
    await limiter.acquire()
    await limiter.acquire()
    await limiter.acquire()

    // All slots used
    expect(limiter.getUsed()).toBe(3)
    expect(limiter.getAvailable()).toBe(0)

    // Even after a short wait, still blocked
    let resolved = false
    const p = limiter.acquire().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(resolved).toBe(false)
  })

  it('cooldown pauses all callers for specified duration', async () => {
    const limiter = new SlidingWindowLimiter(60)

    limiter.cooldown(5_000)

    let resolved = false
    const p = limiter.acquire().then(() => { resolved = true })

    // Should NOT resolve during cooldown
    await vi.advanceTimersByTimeAsync(4_000)
    expect(resolved).toBe(false)

    // Should resolve after cooldown
    await vi.advanceTimersByTimeAsync(1_001)
    await p
    expect(resolved).toBe(true)
  })

  it('acquire respects both window limit and cooldown', async () => {
    const limiter = new SlidingWindowLimiter(2)
    await limiter.acquire()
    await limiter.acquire()

    // Window full AND cooldown active — cooldown takes precedence
    limiter.cooldown(60_000)

    let resolved = false
    const p = limiter.acquire().then(() => { resolved = true })

    // Even after window would slide, cooldown blocks
    await vi.advanceTimersByTimeAsync(61_000)
    await p
    expect(resolved).toBe(true)
  })

  it('concurrent acquire calls are queued properly', async () => {
    const limiter = new SlidingWindowLimiter(1)
    await limiter.acquire()

    let p1Resolved = false
    let p2Resolved = false
    const p1 = limiter.acquire().then(() => { p1Resolved = true })
    const p2 = limiter.acquire().then(() => { p2Resolved = true })

    // Both should be blocked initially
    await vi.advanceTimersByTimeAsync(100)
    expect(p1Resolved).toBe(false)
    expect(p2Resolved).toBe(false)

    // After 60s, first slot frees up
    await vi.advanceTimersByTimeAsync(60_000)
    await p1
    expect(p1Resolved).toBe(true)

    // Second one still needs to wait for the first acquired slot to expire
    await vi.advanceTimersByTimeAsync(60_000)
    await p2
    expect(p2Resolved).toBe(true)
  })
})

describe('Semaphore', () => {
  it('allows concurrent access up to limit', async () => {
    const sem = new Semaphore(2)
    const r1 = await sem.acquire()
    const r2 = await sem.acquire()
    expect(sem.getAvailable()).toBe(0)
    expect(sem.getWaiting()).toBe(0)
    r1()
    expect(sem.getAvailable()).toBe(1)
    r2()
    expect(sem.getAvailable()).toBe(2)
  })

  it('queues callers beyond limit', async () => {
    const sem = new Semaphore(1)
    const release1 = await sem.acquire()

    let secondResolved = false
    const p2 = sem.acquire().then(r => { secondResolved = true; return r })

    await new Promise(r => setTimeout(r, 10))
    expect(secondResolved).toBe(false)
    expect(sem.getWaiting()).toBe(1)

    release1()
    const release2 = await p2
    expect(secondResolved).toBe(true)
    release2()
  })

  it('release frees next waiter', async () => {
    const sem = new Semaphore(1)
    const release1 = await sem.acquire()

    let resolved = false
    const p2 = sem.acquire().then(r => { resolved = true; return r })

    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(false)

    release1()
    await new Promise(r => setTimeout(r, 10))
    expect(resolved).toBe(true)
  })
})

describe('Shared instances', () => {
  beforeEach(() => {
    resetSharedInstances()
  })

  it('returns same limiter instance', () => {
    const l1 = getSharedLimiter(30)
    const l2 = getSharedLimiter(30)
    expect(l1).toBe(l2)
  })

  it('returns same semaphore instance', () => {
    const s1 = getSharedSemaphore(3)
    const s2 = getSharedSemaphore(3)
    expect(s1).toBe(s2)
  })

  it('resetSharedInstances creates new instances', () => {
    const l1 = getSharedLimiter(30)
    resetSharedInstances()
    const l2 = getSharedLimiter(30)
    expect(l1).not.toBe(l2)
  })
})
