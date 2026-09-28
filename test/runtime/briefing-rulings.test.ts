/**
 * The operator's rulings are engagement state, not chat scrollback.
 *
 * `/brief` and the REPL header are the only places the operator can see what the
 * system believes it already knows. If a correction is not visible there, the
 * relationship stays one-directional regardless of what the prompt says.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GraphStore } from '../../src/graph/store'

// Read through a mutable holder so each test gets a clean store. The factory is
// hoisted, so it must not capture a value at hoist time.
let store: GraphStore

vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => ({
    getGraphStore: () => store,
    getCurrentTarget: () => 'https://shop.example',
    getTargetDir: () => 'C:/nonexistent-target-dir',
  }),
}))

vi.mock('../../src/capture/captured-request-store', () => ({
  getCapturedRequestStore: () => ({ size: 0 }),
}))

vi.mock('../../src/intelligence/evolution', () => ({
  getEvolutionSummary: () => ({ techniques: [], promoted: [], demoted: [] }),
}))

async function brief() {
  const { buildBriefing } = await import('../../src/runtime/briefing')
  return buildBriefing()
}

describe('briefing surfaces the operator\'s rulings', () => {
  beforeEach(() => {
    store = new GraphStore()
  })

  it('says plainly that nothing has been ruled on yet', async () => {
    const b = await brief()
    expect(b.stats.humanRulings).toBe(0)
    expect(b.stats.contested).toBe(0)
    expect(b.prose).not.toMatch(/will not re-raise/i)
  })

  it('tells the operator their "expected" rulings will not be re-raised', async () => {
    store.addDisposition({
      claimRef: 'invoice-sharing',
      claimKind: 'behaviour',
      origin: 'human',
      value: 'expected',
      reason: 'shared between tenants by design',
    })
    const b = await brief()
    expect(b.stats.humanRulings).toBe(1)
    expect(b.prose).toContain('invoice-sharing')
    expect(b.prose).toMatch(/will not re-raise/i)
  })

  it('refuses to settle a disagreement itself and asks the operator', async () => {
    const claim = 'idor:https://shop.example/api/orders/1:id'
    store.addDisposition({ claimRef: claim, origin: 'agent', value: 'verified', reason: 'replay reproduced it' })
    store.addDisposition({ claimRef: claim, origin: 'human', value: 'rejected', reason: 'intentionally shared' })
    const b = await brief()
    expect(b.stats.contested).toBe(1)
    expect(b.prose).toMatch(/disagree/i)
    expect(b.prose).toMatch(/not going to settle it myself/i)
    expect(b.prose).toMatch(/record it/i)
  })

  it('does not call a same-origin re-verdict a disagreement', async () => {
    const claim = 'xss:https://shop.example/search:q'
    store.addDisposition({ claimRef: claim, origin: 'agent', value: 'proposed', reason: 'first look' })
    store.addDisposition({ claimRef: claim, origin: 'agent', value: 'verified', reason: 'confirmed on replay' })
    const b = await brief()
    expect(b.stats.contested).toBe(0)
  })
})
