/**
 * Rulings reach the model, and survive the derivation.
 *
 * The whole mechanism is worthless if the operator's correction lives only in a
 * transcript, so these assert the two properties that make it durable:
 *  1. `writeFinding` honours a prior ruling instead of resurrecting a killed claim.
 *  2. The runtime envelope shows the model what was ruled on, and what is contested.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { GraphStore } from '../../src/graph/store'
import { buildRuntimeEnvelope } from '../../src/runtime/context-envelope'
import { buildFindingId } from '../../src/tools/control-tools'
import { buildClaimKey } from '../../src/graph/schema'

const ORG = 'https://shop.example'

function envelopeFor(store: GraphStore): string {
  return buildRuntimeEnvelope({
    target: ORG,
    contextWindow: 200_000,
    graph: store,
  })
}

describe('rulings reach the model', () => {
  let s: GraphStore
  beforeEach(() => { s = new GraphStore() })
  afterEach(() => { void s.clear?.() })

  it('always shows the rulings block, even on a completely fresh engagement', () => {
    const env = envelopeFor(s)
    expect(env).toContain('runtime-index')
    // Deliberate change: the block used to be omitted entirely when the log was
    // empty, which left the model with no basis for "you have not ruled on
    // this". The guidance is now unconditional.
    expect(env).toContain('"rulings":{')
    expect(env).toContain('"expectedByOperator":null')
    expect(env).toContain('"unruled":null')
  })

  it('tells the model a behaviour is normal and to stop re-proposing it', () => {
    s.addDisposition({
      claimRef: 'invoice-sharing',
      claimKind: 'behaviour',
      origin: 'human',
      value: 'expected',
      reason: 'invoices are shared between tenants by design',
      claimLabel: 'invoice shared across tenants',
    })
    const env = envelopeFor(s)
    expect(env).toContain('expectedByOperator')
    // The reason must travel with the reference: naming the ruling without the
    // knowledge behind it is worse than not mentioning it.
    expect(env).toContain('invoices are shared between tenants by design')
    expect(env).toContain('invoice shared across tenants')
    expect(env).toContain('by')
    expect(env).toContain('human')
  })

  it('marks a claim the operator rejected so it is not re-derived', () => {
    s.addDisposition({
      claimRef: buildFindingId('idor', `${ORG}/api/orders/1`, 'id'),
      origin: 'human',
      value: 'rejected',
      reason: 'that endpoint is scoped to the caller by design',
    })
    const env = envelopeFor(s)
    expect(env).toContain('rejectedByOperator')
    expect(env).toContain('scoped to the caller by design')
  })

  it('surfaces a cross-origin disagreement as contested rather than settling it', () => {
    const claim = buildFindingId('idor', `${ORG}/api/orders/1`, 'id')
    s.addDisposition({ claimRef: claim, origin: 'agent', value: 'verified', reason: 'replay reproduced cross-tenant read' })
    s.addDisposition({ claimRef: claim, origin: 'human', value: 'rejected', reason: 'orders are intentionally shared' })
    const env = envelopeFor(s)
    expect(env).toContain('contested')
    expect(env).toContain('do not resolve it yourself')
  })

  it('invites the agent to RECORD a differing verdict, not just analyse it', () => {
    // Verified live: asked to confirm a finding the operator had ruled expected,
    // the model analysed it, declared [PATH: vulnerability_verdict], concluded
    // "this meets the technical definition of a reflected XSS vulnerability" —
    // and never wrote its verdict down. It disagreed in prose while the log
    // stayed one-sided. That is the mirror of confabulation: both hide the
    // disagreement, one by inventing a ruling, the other by never recording it.
    const claim = buildClaimKey('reflected_xss', `${ORG}/reflected/parameter/title`, 'q')
    s.addDisposition({ claimRef: claim, origin: 'human', value: 'expected', reason: 'demo range' })
    const env = envelopeFor(s)
    // The note is embedded as JSON, so quotes arrive backslash-escaped.
    expect(env).toMatch(/record it with origin=agent/i)
    expect(env).toMatch(/puts the claim in .contested./i)
    expect(env).toMatch(/leaving the log one-sided/i)
  })

  it('instructs the model not to re-propose settled claims', () => {
    s.addDisposition({ claimRef: 'x', origin: 'human', value: 'expected', reason: 'normal' })
    const env = envelopeFor(s)
    expect(env).toContain('Do not re-propose')
  })

  it('lists claims with NO ruling, so absence is never inferred', () => {
    // The model told the operator an unruled finding "falls under your general
    // ruling" — a ruling that did not exist, invented to be agreeable. It could
    // only do that because the index showed what HAD been ruled and left
    // coverage to inference. Absence is exactly what a model fills in, so
    // absence has to be shown explicitly.
    s.addFinding({ technique: 'xss', endpoint: 'https://t/a', findingId: 'xss:https://t/a:*' })
    s.addFinding({ technique: 'sqli', endpoint: 'https://t/b', findingId: 'sqli:https://t/b:*' })
    s.addDisposition({ claimRef: 'xss:https://t/a:*', origin: 'human', value: 'expected', reason: 'by design' })
    const env = envelopeFor(s)
    expect(env).toContain('unruled')
    expect(env).toContain('sqli @ https://t/b')
    expect(env).not.toContain('xss @ https://t/a')
  })

  it('forbids assuming a general ruling, and states that agreeing is not recording', () => {
    s.addFinding({ technique: 'xss', endpoint: 'https://t/a', findingId: 'xss:https://t/a:*' })
    const env = envelopeFor(s)
    expect(env).toMatch(/never assume a general or standing ruling covers it/i)
    expect(env).toMatch(/agreeing in words does not record anything/i)
  })

  it('shows the rulings block even when nothing has ever been ruled on', () => {
    // The early `if (!dispositions.length) return null` is half the original
    // bug: with an empty log the model was told nothing at all, so it had no
    // basis for "you have not ruled on this".
    s.addFinding({ technique: 'xss', endpoint: 'https://t/a', findingId: 'xss:https://t/a:*' })
    const env = envelopeFor(s)
    expect(env).toContain('"rulings":{')
    expect(env).toContain('unruled')
  })

  it('keeps a same-origin sequence out of the contested list', () => {
    // Two agent rulings that differ over time are a re-verdict, not a dispute.
    const claim = buildFindingId('xss', `${ORG}/x`, 'q')
    s.addDisposition({ claimRef: claim, origin: 'agent', value: 'proposed', reason: 'first look' })
    s.addDisposition({ claimRef: claim, origin: 'agent', value: 'verified', reason: 'confirmed later' })
    const env = envelopeFor(s)
    // The word "contested" appears in the standing guidance, so assert on the
    // list, not the token.
    expect(env).toContain('"contested":null')
  })

  it('truncates an over-long reason so one ruling cannot crowd out the index', () => {
    s.addDisposition({ claimRef: 'x', origin: 'human', value: 'expected', reason: 'y'.repeat(5000) })
    const env = envelopeFor(s)
    expect(env).toContain('expectedByOperator')
    // The index stays bounded; a wall of text here would blow the token budget.
    expect(env.length).toBeLessThan(20_000)
  })
})

describe('a ruling about a finding must actually attach to it', () => {
  // Live finding, 2026-09-26: the first real run persisted a Disposition node
  // whose claimRef was an ad-hoc slug ("reflected-parameter-expected") rather
  // than the finding's claim key. It wrote to disk, the model reported success,
  // and BOTH findings stayed lifecycleStatus=verified. The ruling was recorded
  // and did nothing — the exact failure the whole feature exists to prevent.
  let s: GraphStore
  beforeEach(() => { s = new GraphStore() })

  it('the derived key is the same one writeFinding stores', () => {
    expect(buildClaimKey('idor', 'https://t/api/o/1', 'id'))
      .toBe(buildFindingId('idor', 'https://t/api/o/1', 'id'))
  })

  it('a typed ruling attaches and suppresses the finding', () => {
    const claim = buildClaimKey('reflected_output_sink', 'https://t/reflected/parameter/body', '*')
    s.addFinding({
      technique: 'reflected_output_sink',
      endpoint: 'https://t/reflected/parameter/body',
      findingId: claim,
      lifecycleStatus: 'verified' as never,
    })
    s.addDisposition({ claimRef: claim, claimKind: 'finding', origin: 'human', value: 'expected', reason: 'by design' })
    const derived = s.applyDispositions(claim)
    expect(derived?.attached).toBe(true)
    expect(derived?.expected).toBe(true)
    const node = s.resolveFindingByClaim(claim)
    expect(node?.properties.expectedBehaviour).toBe(true)
  })

  it('reports the authoritative unruled COUNT, not just a bounded list', () => {
    // Reporting a truncated list with no count lets the model read it as the
    // complete set and conclude the missing claims must be covered by some
    // general ruling — the exact confabulation `unruled` exists to prevent.
    for (let i = 0; i < 20; i++) {
      s.addFinding({ technique: `t${i}`, endpoint: `https://t/${i}`, findingId: `t${i}:https://t/${i}:*` })
    }
    const env = envelopeFor(s)
    expect(env).toContain('"unruledCount":20')
    // The list stays bounded so one engagement cannot flood the index — the
    // oldest entries are the ones dropped.
    expect(env).not.toContain('t0 @ https://t/0')
    expect(env).toContain('t19 @ https://t/19')
    // ...and the note tells the model which number to believe.
    expect(env).toMatch(/trust unruledCount over the list length/i)
  })

  it('the STORE stays append-only; idempotence is the tool\'s decision', () => {
    // Pinned deliberately. The store is the log: it must never silently drop a
    // write, because it cannot know the caller's intent. Dedupe lives in
    // recordDisposition, which does know whether this is a repeat of the
    // operator's statement or a genuinely new ruling. See
    // test/tools/disposition-idempotence.test.ts.
    s.addDisposition({ claimRef: 'c', origin: 'human', value: 'expected', reason: 'normal' })
    s.addDisposition({ claimRef: 'c', origin: 'human', value: 'expected', reason: 'normal' })
    expect(s.getDispositions('c')).toHaveLength(2)
  })

  it('a slug ruling is retained but does NOT pretend to have attached', () => {
    // The honest outcome: keep the operator's knowledge, report no attachment,
    // so the system never claims a suppression that did not happen.
    s.addDisposition({ claimRef: 'some-slug', origin: 'human', value: 'expected', reason: 'normal' })
    expect(s.applyDispositions('some-slug')).toBeUndefined()
    expect(s.getDispositions('some-slug')).toHaveLength(1)
  })
})

describe('ruling resolution is owned by the system, not the caller', () => {
  let s: GraphStore
  beforeEach(() => { s = new GraphStore() })

  const seed = (technique: string, endpoint: string) =>
    s.addFinding({ technique, endpoint, findingId: buildClaimKey(technique, endpoint), lifecycleStatus: 'verified' as never })

  it('an endpoint-anchored ruling covers every finding on that endpoint', () => {
    // "The reflections on that page are normal" is the operator's actual
    // sentence. It names no technique and no id, and must still bind.
    const url = 'https://t/reflected/parameter/body'
    seed('reflected_output_sink', url)
    seed('reflected_xss', url)
    const found = s.findingsForEndpoint(url)
    expect(found).toHaveLength(2)
    for (const f of found) {
      const claim = f.properties.findingId as string
      s.addDisposition({ claimRef: claim, origin: 'human', value: 'expected', reason: 'by design' })
      expect(s.applyDispositions(claim)?.expected).toBe(true)
      expect(s.resolveFindingByClaim(claim)?.properties.expectedBehaviour).toBe(true)
    }
  })

  it('an endpoint with no finding retains the ruling without pretending to attach', () => {
    const url = 'https://t/not-yet-modelled'
    expect(s.findingsForEndpoint(url)).toHaveLength(0)
    s.addDisposition({ claimRef: `endpoint:${url}`, origin: 'human', value: 'expected', reason: 'normal' })
    expect(s.applyDispositions(`endpoint:${url}`)).toBeUndefined()
    expect(s.getDispositions(`endpoint:${url}`)).toHaveLength(1)
  })

  it('does not leak across endpoints', () => {
    seed('xss', 'https://t/a')
    seed('sqli', 'https://t/b')
    expect(s.findingsForEndpoint('https://t/a').map(f => f.properties.technique)).toEqual(['xss'])
  })
})

describe('a prior ruling outranks a fresh verdict', () => {
  let s: GraphStore
  beforeEach(() => { s = new GraphStore() })

  /** Mirror what writeFinding does: a node whose findingId IS the claim key. */
  const seedFinding = (type: string, endpoint: string, param: string, status: string) => {
    const claim = buildFindingId(type, endpoint, param)
    s.addFinding({ technique: type, endpoint, findingId: claim, lifecycleStatus: status as never })
    return claim
  }

  it('a killed claim is born rejected, not verified again', () => {
    // This is the acceptance property from the design: the human can permanently
    // kill a finding and it never returns. Re-derivation must not resurrect it.
    const claim = seedFinding('idor', `${ORG}/api/orders/1`, 'id', 'verified')
    s.addDisposition({ claimRef: claim, origin: 'human', value: 'rejected', reason: 'by design' })
    const derived = s.applyDispositions(claim)
    expect(derived?.status).toBe('rejected')
    expect(derived?.lastReason).toBe('by design')
    const node = s.resolveFindingByClaim(claim)
    expect(node?.properties.lifecycleStatus).toBe('rejected')
  })

  it('resolves the claim whether given the node id or the logical key', () => {
    // Both keys name the same finding; a caller holds whichever it saw.
    const claim = seedFinding('idor', `${ORG}/api/orders/2`, 'id', 'verified')
    s.addDisposition({ claimRef: claim, origin: 'human', value: 'rejected', reason: 'by design' })
    const node = s.resolveFindingByClaim(claim)
    expect(node).toBeDefined()
    expect(s.applyDispositions(node!.id)?.status).toBe('rejected')
  })

  it('an operator ruling outranks a later agent verification', () => {
    const claim = seedFinding('idor', `${ORG}/api/orders/1`, 'id', 'candidate')
    s.addDisposition({ claimRef: claim, origin: 'agent', value: 'verified', reason: 'machine proved it' })
    s.addDisposition({ claimRef: claim, origin: 'human', value: 'rejected', reason: 'we allow this' })
    const derived = s.applyDispositions(claim)
    // Disagreement, not a silent override — the human must be able to win, but
    // the system must not pretend the two sides agree.
    expect(derived?.contested).toBe(true)
    expect(derived?.status).toBe('needs_review')
  })

  it('a ruling with no finding behind it is retained, not discarded', () => {
    // The operator may rule on something not yet modelled (a slug, a behaviour).
    s.addDisposition({ claimRef: 'upload-500', origin: 'human', value: 'expected', reason: 'always 500s' })
    expect(s.applyDispositions('upload-500')).toBeUndefined()
    expect(s.getDispositions('upload-500')).toHaveLength(1)
  })
})
