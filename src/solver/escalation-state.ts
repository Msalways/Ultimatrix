import { NodeType, type AnyNodeData, type FindingNode, type ExploitProofNode } from '../graph/schema'

/**
 * W0.1 — Exploitation escalation spine.
 *
 * Tracks, per finding, how far exploitation has progressed and what the next
 * escalation step should be. This is a typed state machine — no hardcoded
 * vuln-class names, no keyword scanning. The next-step agenda is derived from
 * graph state (has a proof? has held session? demonstrated impact?) so the
 * solver loop and brain can drive weaponization without guessing vocab.
 */

export enum ExploitStage {
  Detected = 'detected',
  Confirmed = 'confirmed',
  ProofBuilt = 'proof_built',
  ImpactShown = 'impact_shown',
  AccessHeld = 'access_held',
  Chained = 'chained',
  Reported = 'reported',
}

export enum EscalationKind {
  /** Build a reproducible EXPLOIT_PROOF node from captured request/response. */
  BuildProof = 'build_proof',
  /** Threat-model the flow and pick the highest-impact next target. */
  ThreatModel = 'threat_model',
  /** Reuse a held session to reach an in-scope role/endpoint. */
  ReuseSession = 'reuse_session',
  /** Capture concrete impact (read victim data, escalate role). */
  CaptureImpact = 'capture_impact',
  /** Pivot from a confirmed finding to a related in-scope endpoint. */
  Pivot = 'pivot',
  /** Emit a Markdown report for this finding. */
  Report = 'report',
}

export interface EscalationAgendaItem {
  kind: EscalationKind
  findingId: string
  /** LLM-free, state-derived rationale (what graph fact triggers this). */
  rationale: string
  /** In-scope target the step should act on, if known. */
  targetEndpoint?: string
}

export interface FindingProgress {
  findingId: string
  stage: ExploitStage
  /** Whether a first-class EXPLOIT_PROOF node exists for this finding. */
  hasProof: boolean
  /** Whether the proof demonstrates concrete impact. */
  impactShown: boolean
  /** Role/session currently held and reusable for pivots. */
  heldRole?: string
  /** In-scope endpoints reachable with the held role (from SESSION_REACHES). */
  reachableEndpoints: string[]
  /** Highest CVSS-like severity observed, used for impact-prioritized ordering. */
  severity: string
  /** Anomalies surfaced against this finding's flow (Two-Eye pass). */
  anomalies: string[]
}

/**
 * Single source of truth for escalation state. Backed by the graph store so it
 * survives re-entry across solver turns and requires no separate persistence.
 */
export class ExploitationTracker {
  private readonly store: {
    queryNodes: (t: NodeType) => AnyNodeData[] | undefined
    getNode: (id: string) => AnyNodeData | undefined
    queryEdges?: (opts: { type?: string; fromId?: string; toId?: string }) => any[] | undefined
  }

  constructor(store: ExploitationTracker['store']) {
    this.store = store
  }

  /** Derive current progress for every finding from graph state. */
  getProgress(): FindingProgress[] {
    const findings = (this.store.queryNodes(NodeType.FINDING) as FindingNode[] | undefined) ?? []
    const proofs = (this.store.queryNodes(NodeType.EXPLOIT_PROOF) as ExploitProofNode[] | undefined) ?? []

    return findings.map((f) => {
      const proof = proofs.find((p) => p.properties.findingId === f.properties.findingId)
      return this.toProgress(f, proof)
    })
  }

  getProgressFor(findingId: string): FindingProgress | undefined {
    const findings = (this.store.queryNodes(NodeType.FINDING) as FindingNode[] | undefined) ?? []
    const f = findings.find((x) => x.properties.findingId === findingId)
    if (!f) return undefined
    const proofs = (this.store.queryNodes(NodeType.EXPLOIT_PROOF) as ExploitProofNode[] | undefined) ?? []
    const proof = proofs.find((p) => p.properties.findingId === findingId)
    return this.toProgress(f, proof)
  }

  /** The next escalation steps, highest-impact first (state-derived, no vocab). */
  nextAgenda(): EscalationAgendaItem[] {
    const progress = this.getProgress()
    const rank: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 }
    const sevOf = (id: string) => progress.find((p) => p.findingId === id)?.severity ?? 'info'
    const items: EscalationAgendaItem[] = []
    for (const p of progress) {
      items.push(...this.agendaFor(p))
    }
    return items.sort((a, b) => rank[sevOf(b.findingId)] - rank[sevOf(a.findingId)])
  }

  /** Two-Eye anomaly pass: flag state inconsistencies worth escalating. */
  detectAnomalies(): string[] {
    const anomalies: string[] = []
    for (const p of this.getProgress()) {
      for (const a of p.anomalies) {
        anomalies.push(`[${p.findingId}] ${a}`)
      }
    }
    return anomalies
  }

  private agendaFor(p: FindingProgress): EscalationAgendaItem[] {
    const out: EscalationAgendaItem[] = []
    if (!p.hasProof) {
      out.push({
        kind: EscalationKind.BuildProof,
        findingId: p.findingId,
        rationale: 'confirmed but no EXPLOIT_PROOF node — capture reproducible request/response',
      })
    } else if (!p.impactShown) {
      out.push({
        kind: EscalationKind.CaptureImpact,
        findingId: p.findingId,
        rationale: 'proof exists but no demonstrated impact — capture concrete data/escalation',
      })
    } else if (p.stage === ExploitStage.ImpactShown && !p.heldRole && p.reachableEndpoints.length === 0) {
      out.push({
        kind: EscalationKind.ThreatModel,
        findingId: p.findingId,
        rationale: 'impact shown — threat-model the flow to pick highest-impact next target',
      })
    } else if (p.heldRole) {
      for (const ep of p.reachableEndpoints) {
        out.push({
          kind: EscalationKind.ReuseSession,
          findingId: p.findingId,
          rationale: `held role ${p.heldRole} can reach in-scope ${ep}`,
          targetEndpoint: ep,
        })
      }
    }
    out.push({ kind: EscalationKind.Report, findingId: p.findingId, rationale: 'ensure a deliverable report exists' })
    return out
  }

  private toProgress(f: FindingNode, proof?: ExploitProofNode): FindingProgress {
    const stage = computeStage(f, proof)
    const reach = this.reachableFor(f.properties.findingId)
    return {
      findingId: f.properties.findingId,
      stage,
      hasProof: Boolean(proof),
      impactShown: Boolean(proof?.properties?.impact),
      heldRole: reach.role,
      reachableEndpoints: reach.endpoints,
      severity: f.properties.severity,
      anomalies: collectAnomalies(f, proof),
    }
  }

  /**
   * Held-session reachability comes from typed SESSION_REACHES edges only.
   * The edge carries `role` and `findingId` as structured properties — no
   * string parsing of notes.
   */
  private reachableFor(findingId: string): { role?: string; endpoints: string[] } {
    if (!this.store.queryEdges) return { endpoints: [] }
    const edges = (this.store.queryEdges({ type: 'SESSION_REACHES' }) ?? []).filter(
      (e) => e.properties?.findingId === findingId,
    )
    const endpoints = edges.map((e) => e.toId).filter(Boolean)
    const role = edges.map((e) => e.properties?.role).find((r): r is string => typeof r === 'string')
    return { role, endpoints }
  }
}

function computeStage(f: FindingNode, proof?: ExploitProofNode): ExploitStage {
  // Reported is not a lifecycle status in this schema; a finding is "reported"
  // once an exploit-proof with impact exists (the deliverable is produced).
  if (proof?.properties?.impact) return ExploitStage.ImpactShown
  if (proof && proof.properties.status === 'confirmed') return ExploitStage.ProofBuilt
  if (f.properties.lifecycleStatus === 'verified') return ExploitStage.Confirmed
  if (f.properties.lifecycleStatus === 'rejected') return ExploitStage.Detected
  return ExploitStage.Detected
}

/** Surface Two-Eye anomalies from typed fields — never keyword scanning. */
function collectAnomalies(f: FindingNode, proof?: ExploitProofNode): string[] {
  const out: string[] = []
  if (f.properties.confidence < 0.5) {
    out.push('low-confidence finding — worth re-validation against alternate role/session')
  }
  if (proof && proof.properties.status === 'rejected') {
    out.push('proof rejected — divergence between expected and observed response')
  }
  if ((f.properties.evidenceLevel === 'L1' || f.properties.evidenceLevel === 'L2') && f.properties.severity !== 'info') {
    out.push('high severity but low evidence level — prioritize capture of concrete proof')
  }
  return out
}
