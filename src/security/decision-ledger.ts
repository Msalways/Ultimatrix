/**
 * Decision Ledger — post-run inspectability for why Ultimatrix chose the
 * tools, models, workers, browser actions, and scope classifications it did.
 *
 * Slice 07: every decision-producing subsystem writes a `DecisionRecord`; every
 * durable discovery or evidence item links to `ProvenanceRecord`s. Records are
 * best-effort and silently fail (never throw into the decision site).
 *
 * Security: `pageUrl`/`requestId`/`responseId`/`actionId`/`reason` are
 * redacted before storage (Browser-action provenance must not leak secrets —
 * slice 07 failure mode). `routingReason` is preserved verbatim because it is
 * model-routing reasoning, never raw target data.
 *
 * No regex/substring behavioral detection — this is a shape-based redaction
 * pass on top of the shared secret vault.
 */

import { randomUUID } from 'node:crypto'
import { redactString, redactUrl } from './secret-vault'

export type ProvenanceSource =
  | 'user'
  | 'browser'
  | 'connector'
  | 'web'
  | 'tool'
  | 'generated_code'
  | 'model'

export interface DecisionRecord {
  id: string
  workflowId: string
  kind: string
  reason: string
  routingReason?: string
  provider?: string
  model?: string
  sourceRefs: string[]
  createdAt: string
}

export interface ProvenanceRecord {
  id: string
  workflowId: string
  source: ProvenanceSource
  pageUrl?: string
  actionId?: string
  requestId?: string
  responseId?: string
  provider?: string
  createdAt: string
}

export interface RecordDecisionOptions {
  workflowId?: string
  kind: string
  reason: string
  routingReason?: string
  provider?: string
  model?: string
  sourceRefs?: string[]
}

export interface RecordProvenanceOptions {
  workflowId?: string
  source: ProvenanceSource
  pageUrl?: string
  actionId?: string
  requestId?: string
  responseId?: string
  provider?: string
}

class DecisionLedger {
  private decisions = new Map<string, DecisionRecord>()
  private provenance = new Map<string, ProvenanceRecord>()
  private currentWorkflowId = 'session'

  setWorkflowId(id: string | null): void {
    this.currentWorkflowId = id ?? 'session'
  }

  getWorkflowId(): string {
    return this.currentWorkflowId
  }

  recordDecision(opts: RecordDecisionOptions): DecisionRecord {
    const record: DecisionRecord = {
      id: `decision:${opts.kind}:${randomUUID()}`,
      workflowId: opts.workflowId ?? this.currentWorkflowId,
      kind: opts.kind,
      reason: redactString(opts.reason),
      ...(opts.routingReason ? { routingReason: opts.routingReason } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      sourceRefs: opts.sourceRefs ?? [],
      createdAt: new Date().toISOString(),
    }
    this.decisions.set(record.id, record)
    return record
  }

  recordProvenance(opts: RecordProvenanceOptions): ProvenanceRecord {
    const record: ProvenanceRecord = {
      id: `provenance:${opts.source}:${randomUUID()}`,
      workflowId: opts.workflowId ?? this.currentWorkflowId,
      source: opts.source,
      ...(opts.pageUrl ? { pageUrl: redactUrl(opts.pageUrl) } : {}),
      ...(opts.actionId ? { actionId: redactString(opts.actionId) } : {}),
      ...(opts.requestId ? { requestId: redactString(opts.requestId) } : {}),
      ...(opts.responseId ? { responseId: redactString(opts.responseId) } : {}),
      ...(opts.provider ? { provider: opts.provider } : {}),
      createdAt: new Date().toISOString(),
    }
    this.provenance.set(record.id, record)
    return record
  }

  getDecision(id: string): DecisionRecord | undefined {
    return this.decisions.get(id)
  }

  getProvenance(id: string): ProvenanceRecord | undefined {
    return this.provenance.get(id)
  }

  listDecisions(kind?: string): DecisionRecord[] {
    const all = Array.from(this.decisions.values())
    return kind ? all.filter(r => r.kind === kind) : all
  }

  listProvenance(source?: ProvenanceSource): ProvenanceRecord[] {
    const all = Array.from(this.provenance.values())
    return source ? all.filter(r => r.source === source) : all
  }

  decisionsForWorkflow(workflowId?: string): DecisionRecord[] {
    const id = workflowId ?? this.currentWorkflowId
    return Array.from(this.decisions.values()).filter(r => r.workflowId === id)
  }

  provenanceForWorkflow(workflowId?: string): ProvenanceRecord[] {
    const id = workflowId ?? this.currentWorkflowId
    return Array.from(this.provenance.values()).filter(r => r.workflowId === id)
  }

  clear(): void {
    this.decisions.clear()
    this.provenance.clear()
  }
}

let _ledger: DecisionLedger | null = null

export function getGlobalDecisionLedger(): DecisionLedger {
  if (!_ledger) _ledger = new DecisionLedger()
  return _ledger
}
