import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenBucket, Semaphore, getSharedBucket, getSharedSemaphore, resetSharedInstances } from '../../src/models/rate-limiter'

describe('TokenBucket', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows immediate acquisition when tokens available', async () => {
    const bucket = new TokenBucket(10)
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(9)
  })

  it('consumes tokens sequentially', async () => {
    const bucket = new TokenBucket(5)
    await bucket.acquire()
    await bucket.acquire()
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(2)
  })

  it('blocks when tokens exhausted', async () => {
    const bucket = new TokenBucket(2)
    await bucket.acquire()
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(0)

    let resolved = false
    const promise = bucket.acquire().then(() => { resolved = true })

    await vi.advanceTimersByTimeAsync(50)
    expect(resolved).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)
    await promise
    expect(resolved).toBe(true)
  })

  it('refills tokens over time', async () => {
    const bucket = new TokenBucket(60)
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(59)

    vi.advanceTimersByTime(1000)
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(59)
  })

  it('never exceeds max tokens', async () => {
    const bucket = new TokenBucket(5)
    vi.advanceTimersByTime(60_000)
    await bucket.acquire()
    expect(bucket.getAvailable()).toBe(4)
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

  it('returns same bucket instance', () => {
    const b1 = getSharedBucket(30)
    const b2 = getSharedBucket(30)
    expect(b1).toBe(b2)
  })

  it('returns same semaphore instance', () => {
    const s1 = getSharedSemaphore(3)
    const s2 = getSharedSemaphore(3)
    expect(s1).toBe(s2)
  })

  it('resetSharedInstances creates new instances', () => {
    const b1 = getSharedBucket(30)
    resetSharedInstances()
    const b2 = getSharedBucket(30)
    expect(b1).not.toBe(b2)
  })
})
