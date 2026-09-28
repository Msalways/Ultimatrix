import { describe, expect, it } from 'vitest'
import { LazySolverServices } from '../../src/runtime/lazy-services'

function services() {
  return new LazySolverServices({
    config: {} as any,
    target: 'https://t.example',
    skillRegistry: {} as any,
    extensionRegistry: {} as any,
  })
}

describe('LazySolverServices crawl abort', () => {
  it('abortCrawl is a no-op when no crawl is running', () => {
    const svc = services()
    expect(() => svc.abortCrawl()).not.toThrow()
  })

  it('abortCrawl aborts the in-flight crawl controller', () => {
    const svc = services()
    const controller = new AbortController()
    ;(svc as any).crawlController = controller
    svc.abortCrawl('test timeout')
    expect(controller.signal.aborted).toBe(true)
  })

  it('close() stops a roaming crawl', async () => {
    const svc = services()
    const controller = new AbortController()
    ;(svc as any).crawlController = controller
    await svc.close()
    expect(controller.signal.aborted).toBe(true)
    expect((svc as any).crawlController === controller).toBe(true)
  })
})
