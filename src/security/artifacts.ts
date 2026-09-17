import { randomUUID } from 'node:crypto'
import { redactArtifactMetadata } from './secret-vault'
import { getEngagementServices } from '../runtime/engagement-context'

export type ArtifactKind =
  | 'screenshot'
  | 'har'
  | 'report'
  | 'download'
  | 'trace'
  | 'generated_test'
  | 'finding'
  | 'session'
  | 'exchange'

export type ArtifactStatus = 'created' | 'redacted' | 'linked' | 'reported' | 'deleted'

export interface ProvenanceRef {
  source: string
  ref?: string
  detail?: string
}

export interface ArtifactRecord {
  id: string
  workflowId: string
  kind: ArtifactKind
  status: ArtifactStatus
  path?: string
  createdAt: string
  redactedAt?: string
  provenance: ProvenanceRef[]
}

export interface CreateArtifactOptions {
  path?: string
  provenance?: ProvenanceRef[]
  workflowId?: string
  initialStatus?: ArtifactStatus
  metadata?: Record<string, unknown>
}

const REDACTION_NOTES: Partial<Record<ArtifactKind, string>> = {
  har: 'redactHarJson applied before durable write',
  report: 'redactHeaders + redactString applied before render',
  screenshot: 'context sanitized (redactString) before filename',
  session: 'exposure paths redacted; operational store retained for restore',
}

export class ArtifactRegistry {
  private records = new Map<string, ArtifactRecord>()
  private currentWorkflowId = 'session'
  private createListener: ((record: ArtifactRecord) => void) | null = null

  constructor(workflowId?: string, listener?: (record: ArtifactRecord) => void) {
    this.currentWorkflowId = workflowId ?? 'session'
    this.createListener = listener ?? null
  }

  setCreateListener(listener: ((record: ArtifactRecord) => void) | null): void {
    this.createListener = listener
  }

  setWorkflowId(id: string | null): void {
    this.currentWorkflowId = id ?? 'session'
  }

  getWorkflowId(): string {
    return this.currentWorkflowId
  }

  create(kind: ArtifactKind, options: CreateArtifactOptions = {}): ArtifactRecord {
    const createdAt = new Date().toISOString()
    const record: ArtifactRecord = {
      id: `artifact:${kind}:${randomUUID()}`,
      workflowId: options.workflowId ?? this.currentWorkflowId,
      kind,
      status: options.initialStatus ?? 'created',
      path: typeof options.path === 'string' ? redactArtifactMetadata({ path: options.path }).path as string : undefined,
      createdAt,
      provenance: [
        ...(options.provenance ?? []),
        ...(REDACTION_NOTES[kind] ? [{ source: 'redaction', detail: REDACTION_NOTES[kind] }] : []),
      ],
    }
    if (options.initialStatus === 'redacted') {
      record.redactedAt = createdAt
    }
    if (options.metadata) {
      record.provenance.push({
        source: 'metadata',
        detail: JSON.stringify(redactArtifactMetadata(options.metadata)),
      })
    }
    this.records.set(record.id, record)
    this.createListener?.(record)
    return record
  }

  get(id: string): ArtifactRecord | undefined {
    return this.records.get(id)
  }

  list(kind?: ArtifactKind): ArtifactRecord[] {
    const all = Array.from(this.records.values())
    return kind ? all.filter(r => r.kind === kind) : all
  }

  setStatus(id: string, status: ArtifactStatus): ArtifactRecord | undefined {
    const record = this.records.get(id)
    if (!record) return undefined
    record.status = status
    if (status === 'redacted' && !record.redactedAt) {
      record.redactedAt = new Date().toISOString()
    }
    return record
  }

  markRedacted(id: string): ArtifactRecord | undefined {
    return this.setStatus(id, 'redacted')
  }

  markLinked(id: string): ArtifactRecord | undefined {
    return this.setStatus(id, 'linked')
  }

  markReported(id: string): ArtifactRecord | undefined {
    return this.setStatus(id, 'reported')
  }

  markDeleted(id: string): ArtifactRecord | undefined {
    return this.setStatus(id, 'deleted')
  }
}

let _registry: ArtifactRegistry | null = null

export function getGlobalArtifactRegistry(): ArtifactRegistry {
  const owned = getEngagementServices()?.artifacts
  if (owned) return owned
  if (!_registry) _registry = new ArtifactRegistry()
  return _registry
}

/**
 * Subscribe to artifact creation (slice 02). Used by the workflow persistence
 * boundary to fold new artifacts into `WorkflowState.artifacts`. Single slot,
 * set by the session/web/solve wiring. Typed seam — no string inspection.
 */
export function setArtifactCreateListener(fn: ((record: ArtifactRecord) => void) | null): void {
  const owned = getEngagementServices()?.artifacts
  if (owned) owned.setCreateListener(fn)
  else getGlobalArtifactRegistry().setCreateListener(fn)
}

// ─── ExchangeArtifact (Strix Adaptation Phase F) ────────────────────────────
/**
 * Cross-links the three recording sinks so any finding can be traced back
 * to its originating request/response and forensic log entry.
 *
 * Sink mapping:
 * - CapturedRequestStore: `cap-*` IDs (HTTP request/response pairs)
 * - EvidenceLedger: `ev-*` IDs (structured evidence items)
 * - ForensicLog: tool-call events with timestamps
 * - ResultStore: `tool-result:*` IDs (bounded results)
 */
export interface ExchangeArtifact {
  /** Unique exchange ID: `ex-*` */
  exchangeId: string
  /** Captured request ID from CapturedRequestStore */
  capturedRequestId?: string
  /** Evidence ID from EvidenceLedger */
  evidenceId?: string
  /** ForensicLog event timestamp (ms) for correlation */
  forensicTimestamp?: number
  /** Result store reference (from BoundedResult) */
  resultRef?: string
  /** Artifact kind for the ArtifactRegistry */
  artifactId?: string
  /** When the exchange was created */
  createdAt: number
  /** Free-text note about what this exchange represents */
  note?: string
}

/** In-memory store of exchange artifacts for the current session */
const exchanges = new Map<string, ExchangeArtifact>()

/** Create a new cross-linked exchange artifact */
export function createExchangeArtifact(links: {
  capturedRequestId?: string
  evidenceId?: string
  forensicTimestamp?: number
  resultRef?: string
  artifactId?: string
  note?: string
}): ExchangeArtifact {
  const id = `ex-${randomUUID()}`
  const exchange: ExchangeArtifact = {
    exchangeId: id,
    ...links,
    createdAt: Date.now(),
  }
  exchanges.set(id, exchange)
  return exchange
}

/** Look up an exchange by ID */
export function getExchangeArtifact(exchangeId: string): ExchangeArtifact | undefined {
  return exchanges.get(exchangeId)
}

/** Find exchanges by any linked ID (reverse lookup) */
export function findExchangesByLink(
  linkType: 'capturedRequestId' | 'evidenceId' | 'resultRef' | 'artifactId',
  linkValue: string,
): ExchangeArtifact[] {
  return [...exchanges.values()].filter(e => e[linkType] === linkValue)
}

/** Find exchanges by forensic timestamp range */
export function findExchangesByTimeRange(startMs: number, endMs: number): ExchangeArtifact[] {
  return [...exchanges.values()].filter(
    e => e.forensicTimestamp !== undefined && e.forensicTimestamp >= startMs && e.forensicTimestamp <= endMs,
  )
}

/** Clear all exchanges (for tests) */
export function clearExchangeArtifacts(): void {
  exchanges.clear()
}
