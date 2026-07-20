import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getConsoleLine } from '../../src/session/lifecycle'
import { uiGoalEmitter, uiInputEmitter, setConsoleInputResolver, isConsoleInputActive, waitForInput, askUserConfirm } from '../../src/tools/interaction-tools'
import { UiStore, getUiStore, resetUiStore } from '../../src/ui/store'

function makeStore(): UiStore {
  resetUiStore()
  return getUiStore()
}

describe('console input — single-owner invariant', () => {
  afterEach(() => {
    setConsoleInputResolver(null)
  })

  it('getConsoleLine resolves ONLY from the Ink emitter, with no readline listener', async () => {
    const p = getConsoleLine()
    // The promise must be pending (not already resolved) before the emit.
    let settled = false
    p.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    uiGoalEmitter.emit('goal', 'scan the login form')
    expect(await p).toBe('scan the login form')
  })

  it('store.requestInput / resolveInput round-trips through the single input surface', async () => {
    const store = makeStore()
    const p = store.requestInput('What is the CAPTCHA?')
    expect(store.pendingInput).toBe('What is the CAPTCHA?')
    store.resolveInput('abc123')
    expect(await p).toBe('abc123')
    expect(store.pendingInput).toBeNull()
  })

  it('console resolver is active only while set', () => {
    expect(isConsoleInputActive()).toBe(false)
    setConsoleInputResolver(async () => 'ignored')
    expect(isConsoleInputActive()).toBe(true)
    setConsoleInputResolver(null)
    expect(isConsoleInputActive()).toBe(false)
  })

  it('waitForInput delegates to the console resolver when active (no readline)', async () => {
    const store = makeStore()
    setConsoleInputResolver(async (q) => {
      expect(q).toContain('credentials')
      return store.requestInput(q)
    })
    const p = waitForInput(1000, 'enter credentials')
    // The resolver surfaced the question to the store; resolve it.
    expect(store.pendingInput).toContain('credentials')
    store.resolveInput('admin:pass')
    expect(await p).toBe('admin:pass')
  })

  it('askUserConfirm maps console resolver answers to boolean', async () => {
    const store = makeStore()
    setConsoleInputResolver(async (q) => {
      expect(q).toContain('approve')
      return store.requestInput(q)
    })
    const p = askUserConfirm('please approve risky proposal?')
    expect(store.pendingInput).toContain('approve')
    store.resolveInput('yes')
    expect(await p).toBe(true)
  })

  it('uiInputEmitter remains a separate channel from uiGoalEmitter', async () => {
    // Goals and answers are distinct queues; emitting a goal must not resolve an
    // input waiter. This locks the "one input surface, routed by context" design.
    const store = makeStore()
    setConsoleInputResolver(async (q) => store.requestInput(q))
    const inputP = waitForInput(1000, 'answer me')
    uiGoalEmitter.emit('goal', 'this is a goal not an answer')
    // inputP must still be pending.
    let settled = false
    inputP.then(() => { settled = true })
    expect(store.pendingInput).toContain('answer me')
    expect(settled).toBe(false)
    store.resolveInput('final answer')
    expect(settled).toBe(false) // resolves async
    expect(await inputP).toBe('final answer')
  })
})
