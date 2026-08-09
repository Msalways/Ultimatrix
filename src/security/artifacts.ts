import { randomUUID } from 'node:crypto'
import { redactArtifactMetadata } from './secret-vault'

export type ArtifactKind =
  | 'screenshot'
  | 'har'
  | 'report'
  | 'download'
  | 'trace'
  | 'generated_test'
  | 'finding'
  | 'session'

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

class ArtifactRegistry {
  private records = new Map<string, ArtifactRecord>()
  private currentWorkflowId = 'session'

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
  if (!_registry) _registry = new ArtifactRegistry()
  return _registry
}
