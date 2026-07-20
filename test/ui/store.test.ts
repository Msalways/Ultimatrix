import { describe, it, expect, beforeEach } from 'vitest'
import { UiStore, getUiStore, resetUiStore } from '../../src/ui/store'
import type { SolverStreamMessage } from '../../src/solver/solver'

function makeStore(): UiStore {
  resetUiStore()
  return getUiStore()
}

describe('UiStore — single source of truth for the console', () => {
  beforeEach(() => {
    makeStore()
  })

  it('folds a solver message into the live model exactly once', () => {
    const store = makeStore()
    const msg: SolverStreamMessage = {
      kind: 'answer',
      text: 'hello',
      index: 0,
    }
    store.dispatchSolver(msg)
    expect(store.model.answer).toContain('hello')
  })

  it('commitTurn snapshots the live model into history and resets', () => {
    const store = makeStore()
    store.dispatchSolver({ kind: 'answer', text: 'turn one', index: 0 })
    store.commitTurn()
    expect(store.turns).toHaveLength(1)
    expect(store.turns[0].answer).toContain('turn one')
    expect(store.model.answer).toBe('')
  })

  it('addFinding upserts by id', () => {
    const store = makeStore()
    store.addFinding({ id: 'f1', severity: 'high', technique: 'idor', title: 'IDOR' })
    store.addFinding({ id: 'f1', severity: 'critical', technique: 'idor', title: 'IDOR' })
    expect(store.findings).toHaveLength(1)
    expect(store.findings[0].severity).toBe('critical')
  })

  it('recordTool upserts by name', () => {
    const store = makeStore()
    store.recordTool({ name: 'runPrimitive', lastResult: 'ok', lastState: 'ok' })
    store.recordTool({ name: 'runPrimitive', lastResult: 'err', lastState: 'err' })
    expect(store.tools).toHaveLength(1)
    expect(store.tools[0].lastState).toBe('err')
  })

  it('setSpiderCounts merges', () => {
    const store = makeStore()
    store.setSpiderCounts({ endpoints: 3 })
    store.setSpiderCounts({ pages: 2 })
    expect(store.spiderCounts).toMatchObject({ endpoints: 3, pages: 2 })
  })

  it('requestApproval resolves through the waiter promise', async () => {
    const store = makeStore()
    const p = store.requestApproval({
      id: 'a1',
      name: 'deleteAll',
      description: 'wipe',
      risk: 'high',
    })
    expect(store.approval?.id).toBe('a1')
    store.resolveApproval('approve')
    expect(await p).toBe('approve')
    expect(store.approval).toBeNull()
  })

  it('setTab notifies and changes active tab', () => {
    const store = makeStore()
    store.setTab('findings')
    expect(store.activeTab).toBe('findings')
  })

  it('subscribers are notified on mutation', () => {
    const store = makeStore()
    let calls = 0
    const off = store.subscribe(() => { calls++ })
    store.setStatus({ step: 1 })
    off()
    store.setStatus({ step: 2 })
    expect(calls).toBe(1)
  })

  it('pushLog keeps a bounded buffer', () => {
    const store = makeStore()
    for (let i = 0; i < 250; i++) store.pushLog(`line ${i}`)
    expect(store.logLines.length).toBe(200)
    expect(store.logLines[199]).toBe('line 249')
  })
})
