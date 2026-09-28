/**
 * The disposition tool must not accumulate noise.
 *
 * Live finding: the same origin recording the same value and reason repeatedly
 * produced six identical rows, which buried the one ruling that actually
 * suppressed a finding and made the operator-facing history unreadable.
 *
 * The fix is idempotence, NOT deletion. The log stays append-only — history is
 * never rewritten, because a superseding ruling is itself history. But a write
 * that adds no information is not history, and the store is the only place that
 * can tell the difference.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GraphStore } from '../../src/graph/store'
import * as storeModule from '../../src/graph/store'

const TARGET = 'https://shop.example/api/orders/1'

async function callTool(input: Record<string, unknown>) {
  const { recordDisposition } = await import('../../src/tools/disposition-tools')
  return (recordDisposition as unknown as {
    execute: (i: unknown) => Promise<{ ok: boolean; value?: Record<string, unknown> }>
  }).execute(input)
}

describe('recordDisposition is idempotent', () => {
  let s: GraphStore

  beforeEach(() => {
    s = new GraphStore()
    s.addFinding({ technique: 'idor', endpoint: TARGET, findingId: `idor:${TARGET}:id` })
    vi.spyOn(storeModule, 'getGlobalGraphStore').mockReturnValue(s as never)
  })
  afterEach(() => { vi.restoreAllMocks() })

  it('a repeated identical ruling is not duplicated', async () => {
    const input = {
      endpoint: TARGET,
      technique: 'idor',
      origin: 'human',
      value: 'expected',
      claimKind: 'finding',
      reason: 'shared by design',
    }
    const first = await callTool(input)
    const second = await callTool(input)
    const third = await callTool(input)

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(third.ok).toBe(true)
    expect(s.getDispositions(`idor:${TARGET}:id`)).toHaveLength(1)

    // The repeat is reported honestly rather than claiming new work.
    const claims = second.value?.claims as Array<{ alreadyOnRecord?: boolean }>
    expect(claims[0].alreadyOnRecord).toBe(true)
    expect(String(second.value?.note)).toMatch(/already on record/i)
  })

  it('a genuinely different reason is a new ruling, not a duplicate', async () => {
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'expected', claimKind: 'finding', reason: 'shared by design' })
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'expected', claimKind: 'finding', reason: 'actually it is scoped per-tenant' })
    expect(s.getDispositions(`idor:${TARGET}:id`)).toHaveLength(2)
  })

  it('a different origin is a different ruling', async () => {
    // Origin-symmetry means the operator and the agent never collapse into one
    // another, so identical value+reason from a different origin is new history.
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'expected', claimKind: 'finding', reason: 'by design' })
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'agent', value: 'expected', claimKind: 'finding', reason: 'by design' })
    expect(s.getDispositions(`idor:${TARGET}:id`)).toHaveLength(2)
  })

  it('a changed value supersedes rather than duplicates', async () => {
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'expected', claimKind: 'finding', reason: 'by design' })
    await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'verified', claimKind: 'finding', reason: 'it really is exploitable' })
    const r = await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'verified', claimKind: 'finding', reason: 'it really is exploitable' })
    expect(s.getDispositions(`idor:${TARGET}:id`)).toHaveLength(2)
    const claims = r.value?.claims as Array<{ lifecycle?: string }>
    expect(claims[0].lifecycle).toBe('verified')
  })

  it('names which half of the match failed, so the caller can correct itself', async () => {
    // Verified live: the model put a param value in `technique`, narrowing to
    // nothing, and was told "No finding exists at <endpoint>" — false, since the
    // endpoint does have findings. Wrong guidance costs calls; on the real run it
    // took five attempts to land a correctly-phrased ruling.
    const r = await callTool({
      endpoint: TARGET, technique: 'q', origin: 'human',
      value: 'expected', claimKind: 'finding', reason: 'by design',
    })
    expect(r.ok).toBe(false)
    const err = String((r as { error?: string }).error)
    expect(err).toMatch(/none has technique "q"/i)
    expect(err).toMatch(/Available there:/)
    expect(err).toMatch(/Omit technique/)
    expect(err).not.toMatch(/^No finding exists at/i)
  })

  it('says the endpoint is unknown only when it genuinely has no findings', async () => {
    const r = await callTool({
      endpoint: 'https://shop.example/not-modelled', origin: 'human',
      value: 'expected', claimKind: 'finding', reason: 'by design',
    })
    expect(r.ok).toBe(false)
    expect(String((r as { error?: string }).error)).toMatch(/No finding exists at/i)
  })

  it('never loses a write when two rulings land in the same millisecond', async () => {
    // Caught by this file. The node id was `…:${Date.now()}`, so two rulings on
    // the same claim from the same origin inside one millisecond — which a
    // fan-out across findings or a model retrying a call both produce — resolved
    // to the same id and the second silently overwrote the first. A log that can
    // lose writes is not a log.
    const ids = new Set<string>()
    for (let i = 0; i < 25; i++) {
      const node = s.addDisposition({ claimRef: 'c', origin: 'human', value: 'proposed', reason: `distinct ${i}` })
      ids.add(node.id)
    }
    expect(ids.size).toBe(25)
    expect(s.getDispositions('c')).toHaveLength(25)
  })

  it('idempotence never suppresses the first write or breaks attachment', async () => {
    const r = await callTool({ endpoint: TARGET, technique: 'idor', origin: 'human', value: 'expected', claimKind: 'finding', reason: 'by design' })
    expect(r.value?.attachedCount).toBe(1)
    expect(s.resolveFindingByClaim(`idor:${TARGET}:id`)?.properties.expectedBehaviour).toBe(true)
  })
})
