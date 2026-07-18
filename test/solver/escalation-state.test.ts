import { describe, it, expect } from 'vitest'
import {
  ExploitationTracker,
  ExploitStage,
  EscalationKind,
} from '../../src/solver/escalation-state'
import { NodeType, type AnyNodeData } from '../../src/graph/schema'

// Minimal in-memory graph implementing only the surface the tracker reads.
function makeStore(nodes: AnyNodeData[], edges: any[] = []) {
  return {
    queryNodes: (t: NodeType) => nodes.filter((n) => n.type === t),
    getNode: (id: string) => nodes.find((n) => n.id === id),
    queryEdges: (opts: { type?: string }) =>
      edges.filter((e) => !opts.type || e.type === opts.type),
  }
}

const finding = (id: string, severity: any, status: any, evidenceLevel: any): AnyNodeData =>
  ({
    id: `finding:${id}`,
    type: NodeType.FINDING,
    label: id,
    properties: {
      findingId: id,
      severity,
      technique: 'auth_bypass',
      endpoint: 'https://t.example/a',
      evidence: ['e1'],
      confidence: 0.9,
      lifecycleStatus: status,
      evidenceLevel,
    },
  }) as any

const proof = (findingId: string, impact?: string, status = 'confirmed'): AnyNodeData =>
  ({
    id: `proof:${findingId}`,
    type: NodeType.EXPLOIT_PROOF,
    label: findingId,
    properties: {
      findingId,
      status,
      impact,
      request: 'POST /a',
      response: 'HTTP 200',
      method: 'POST',
      url: 'https://t.example/a',
      title: 'p',
      reproSteps: [],
      replayable: true,
    },
  }) as any

describe('ExploitationTracker', () => {
  it('detects a confirmed finding with no proof → BuildProof agenda (highest impact first)', () => {
    const store = makeStore([
      finding('f1', 'medium', 'verified', 'L3'),
      finding('f2', 'critical', 'verified', 'L3'),
    ])
    const tracker = new ExploitationTracker(store)
    const progress = tracker.getProgress()
    expect(progress).toHaveLength(2)
    expect(progress.every((p) => p.stage === ExploitStage.Confirmed)).toBe(true)

    const agenda = tracker.nextAgenda()
    expect(agenda[0].kind).toBe(EscalationKind.BuildProof)
    expect(agenda[0].findingId).toBe('f2') // critical sorted first
  })

  it('derives ImpactShown stage when a proof carries impact', () => {
    const store = makeStore([finding('f1', 'critical', 'verified', 'L3'), proof('f1', 'read victim PII')])
    const tracker = new ExploitationTracker(store)
    const p = tracker.getProgressFor('f1')
    expect(p?.stage).toBe(ExploitStage.ImpactShown)
    expect(p?.hasProof).toBe(true)
    expect(p?.impactShown).toBe(true)
  })

  it('surfaces held role + reachable endpoints from typed SESSION_REACHES edges (no string parsing)', () => {
    const store = makeStore(
      [finding('f1', 'high', 'verified', 'L3'), proof('f1', 'escalated')],
      [{ type: 'SESSION_REACHES', fromId: 'proof:f1', toId: 'https://t.example/admin', properties: { findingId: 'f1', role: 'admin' } }],
    )
    const tracker = new ExploitationTracker(store)
    const p = tracker.getProgressFor('f1')
    expect(p?.heldRole).toBe('admin')
    expect(p?.reachableEndpoints).toContain('https://t.example/admin')

    const agenda = tracker.nextAgenda()
    const reuse = agenda.find((a) => a.kind === EscalationKind.ReuseSession)
    expect(reuse?.targetEndpoint).toBe('https://t.example/admin')
  })

  it('Two-Eye pass flags low-confidence + low-evidence anomalies', () => {
    const store = makeStore([finding('f1', 'high', 'candidate', 'L1')])
    const tracker = new ExploitationTracker(store)
    const anomalies = tracker.detectAnomalies()
    expect(anomalies.length).toBeGreaterThan(0)
    expect(anomalies.join(' ')).toMatch(/low evidence level|low-confidence/)
  })

  it('every finding gets a Report agenda item (deliverable exists)', () => {
    const store = makeStore([finding('f1', 'low', 'verified', 'L3')])
    const tracker = new ExploitationTracker(store)
    const report = tracker.nextAgenda().filter((a) => a.kind === EscalationKind.Report)
    expect(report).toHaveLength(1)
  })
})
