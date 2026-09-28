/**
 * Dispositions: the seam where operator and agent rule on the same claims.
 *
 * The two tests named in the design discussion are the real acceptance criteria
 * for "buddy" being genuine rather than tone. If either stops being possible,
 * the assistant is a slave (or the operator is decorative), regardless of how
 * friendly the prompt reads.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { GraphStore } from '../../src/graph/store'
import { NodeType, deriveLifecycle, type DispositionNode } from '../../src/graph/schema'

function store() {
  const s = new GraphStore()
  return s
}

describe('deriveLifecycle', () => {
  const at = (n: number) => ({ origin: 'agent' as const, value: 'verified' as const, reason: 'r', createdAt: n })

  it('keeps the baseline when there is no history (no migration needed)', () => {
    expect(deriveLifecycle([], 'candidate').status).toBe('candidate')
    expect(deriveLifecycle([], 'verified').status).toBe('verified')
  })

  it('maps a terminal ruling onto the lifecycle', () => {
    expect(deriveLifecycle([{ ...at(1), value: 'disproven' }], 'verified').status).toBe('disproven')
    expect(deriveLifecycle([{ ...at(1), value: 'rejected' }], 'verified').status).toBe('rejected')
  })

  it('does NOT treat expected behaviour as a rejection', () => {
    // "This is how it works" is knowledge, not a verdict against the claim.
    const r = deriveLifecycle([{ origin: 'human', value: 'expected', reason: 'invoices are shared by design', createdAt: 1 }], 'candidate')
    expect(r.expected).toBe(true)
    expect(r.status).toBe('candidate')
    expect(r.status).not.toBe('rejected')
  })

  it('lets the operator reject a finding — the path that did not exist before', () => {
    const r = deriveLifecycle([{ origin: 'human', value: 'rejected', reason: 'by design', createdAt: 1 }], 'verified')
    expect(r.status).toBe('rejected')
    expect(r.contributors).toContain('human')
    expect(r.lastReason).toBe('by design')
  })

  it('surfaces cross-origin conflict instead of silently picking a winner', () => {
    const r = deriveLifecycle([
      { origin: 'agent', value: 'verified', reason: 'proved', createdAt: 1 },
      { origin: 'human', value: 'rejected', reason: 'not a bug', createdAt: 2 },
    ], 'candidate')
    expect(r.contested).toBe(true)
    expect(r.status).toBe('needs_review')
  })

  it('allows the operator to overrule the agent without deleting the history', () => {
    const r = deriveLifecycle([
      { origin: 'agent', value: 'verified', reason: 'replay reproduced it', createdAt: 1 },
      { origin: 'human', value: 'rejected', reason: 'we allow that by policy', createdAt: 2 },
    ], 'candidate')
    expect(r.status).toBe('needs_review')
  })

  it('lets the latest ruling per origin supersede an earlier one from the same side', () => {
    const r = deriveLifecycle([
      { origin: 'human', value: 'rejected', reason: 'initially thought not a bug', createdAt: 1 },
      { origin: 'human', value: 'verified', reason: 'on reflection it is real', createdAt: 2 },
    ], 'candidate')
    expect(r.status).toBe('verified')
    expect(r.lastReason).toBe('on reflection it is real')
  })

  it('treats a lone contested marker as needing review, not as agreement', () => {
    expect(deriveLifecycle([{ origin: 'agent', value: 'contested', reason: 'conflicting evidence', createdAt: 1 }], 'candidate').status)
      .toBe('needs_review')
  })
})

describe('GraphStore dispositions', () => {
  let s: GraphStore
  beforeEach(() => { s = store() })

  it('records operator and agent rulings in one append-only history', () => {
    s.addDisposition({ claimRef: 'finding:x', origin: 'agent', value: 'proposed', reason: 'worth a look' })
    s.addDisposition({ claimRef: 'finding:x', origin: 'human', value: 'expected', reason: 'normal for our design' })
    const all = s.getDispositions('finding:x')
    expect(all).toHaveLength(2)
    expect(all.map((d) => d.properties.origin).sort()).toEqual(['agent', 'human'])
    expect(s.queryNodes(NodeType.DISPOSITION)).toHaveLength(2)
  })

  it('does not gate execution on a disposition — rulings are advisory', () => {
    // Recording a ruling must not throw, block, or change any capability.
    expect(() => s.addDisposition({ claimRef: 'anything', origin: 'human', value: 'rejected', reason: 'no' })).not.toThrow()
  })

  it('accepts a slug claim with no node behind it', () => {
    const d = s.addDisposition({
      claimRef: 'normal-500-on-upload',
      claimKind: 'behaviour',
      origin: 'human',
      value: 'expected',
      reason: 'that endpoint has always 500ed',
      claimLabel: 'upload endpoint 500',
    })
    expect(d.properties.claimKind).toBe('behaviour')
    expect(d.properties.claimLabel).toBe('upload endpoint 500')
  })

  it('projects a human rejection onto the finding lifecycle so existing consumers see it', () => {
    const finding = s.addFinding({ endpoint: 'https://t/x', technique: 'idor', lifecycleStatus: 'verified' as never })
    s.addDisposition({ claimRef: finding.id, origin: 'human', value: 'rejected', reason: 'shared by design' })
    const derived = s.applyDispositions(finding.id)
    expect(derived?.status).toBe('rejected')
    expect(derived?.lastReason).toBe('shared by design')
    const reread = s.getNode(finding.id) as { properties: Record<string, unknown> }
    expect(reread.properties.lifecycleStatus).toBe('rejected')
  })

  it('marks expected behaviour without downgrading the finding', () => {
    const finding = s.addFinding({ endpoint: 'https://t/y', technique: 'xss', lifecycleStatus: 'verified' as never })
    s.addDisposition({ claimRef: finding.id, origin: 'human', value: 'expected', reason: 'sanitised on purpose' })
    const derived = s.applyDispositions(finding.id)
    expect(derived?.expected).toBe(true)
    expect(derived?.status).toBe('verified')
  })

  it('returns dispositions oldest-first and filters by claim', () => {
    s.addDisposition({ claimRef: 'a', origin: 'human', value: 'proposed', reason: '1' })
    s.addDisposition({ claimRef: 'b', origin: 'agent', value: 'proposed', reason: '2' })
    s.addDisposition({ claimRef: 'a', origin: 'agent', value: 'verified', reason: '3' })
    expect(s.getDispositions('a')).toHaveLength(2)
    expect(s.getDispositions()).toHaveLength(3)
    const all = s.getDispositions() as DispositionNode[]
    expect(all.every((d, i, arr) => i === 0 || arr[i - 1].createdAt <= d.createdAt)).toBe(true)
  })

  it('applyDispositions on an unknown claim is a no-op, not a crash', () => {
    expect(s.applyDispositions('does-not-exist')).toBeUndefined()
  })
})
