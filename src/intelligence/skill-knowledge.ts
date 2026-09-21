/**
 * Shared skill knowledge — the safe bridge between confirmed outcomes and
 * future skill selection.
 *
 * This is deliberately not a mutable prompt cache.  It is an append/merge
 * store of target-independent technique outcomes.  Every write passes through
 * the global memory policy, so a URL, host, credential, request payload, or
 * other target-sensitive value cannot become common knowledge.  Canonical
 * skill markdown is still changed only through the validated skill import
 * path; this store supplies evidence-backed priors until a revision is
 * explicitly reviewed and promoted.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'
import {
  evaluateMemoryWrite,
  recordMemoryPolicyDecision,
  MemoryPolicyError,
} from '../memory/policy'

export type SkillKnowledgeOutcome = 'confirmed' | 'failed' | 'inconclusive'

export interface SkillKnowledgeEvent {
  /** Optional canonical skill id. Omit when the technique is cross-skill. */
  skillId?: string
  techniqueId: string
  outcome: SkillKnowledgeOutcome
  /** Only low-cardinality structural tags are accepted here. */
  contextTags?: string[]
  /** Number of independent evidence items supporting this event. */
  evidenceCount?: number
}

export interface SkillKnowledgeRecord {
  skillId?: string
  techniqueId: string
  contextTags: string[]
  confirmed: number
  failed: number
  inconclusive: number
  evidenceCount: number
  firstSeenAt: string
  lastSeenAt: string
}

export interface SkillKnowledgeFile {
  version: 1
  updatedAt: string
  records: SkillKnowledgeRecord[]
}

function emptyFile(): SkillKnowledgeFile {
  return { version: 1, updatedAt: new Date().toISOString(), records: [] }
}

function normaliseTags(tags: string[] | undefined): string[] {
  return [...new Set((tags ?? [])
    .filter(tag => typeof tag === 'string')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 8))].sort()
}

function recordKey(record: Pick<SkillKnowledgeRecord, 'skillId' | 'techniqueId' | 'contextTags'>): string {
  return `${record.skillId ?? ''}\u0000${record.techniqueId}\u0000${record.contextTags.join(',')}`
}

function safeTechniqueId(id: string): string {
  return id.trim().slice(0, 120)
}

/**
 * Global store for reusable, anonymized skill outcomes.  Writes are serialized
 * so concurrent finding callbacks cannot lose increments.
 */
export class SkillKnowledgeStore {
  private readonly path: string
  private file: SkillKnowledgeFile = emptyFile()
  private loaded = false
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(opts?: { path?: string }) {
    this.path = opts?.path ?? resolve(getGlobalWorkspace().getGlobalMemoryDir(), 'skill-knowledge.json')
  }

  getPath(): string {
    return this.path
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (existsSync(this.path)) {
      try {
        const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<SkillKnowledgeFile>
        const records = Array.isArray(parsed.records) ? parsed.records : []
        this.file = {
          ...emptyFile(),
          ...parsed,
          records: records.filter((record): record is SkillKnowledgeRecord => Boolean(record && typeof record === 'object')),
        }
      } catch {
        this.file = emptyFile()
      }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    const dir = resolve(this.path, '..')
    if (!existsSync(dir)) await mkdir(dir, { recursive: true })
    this.file.updatedAt = new Date().toISOString()
    await writeFile(this.path, JSON.stringify(this.file, null, 2), 'utf8')
  }

  /** Record one target-independent outcome after the memory-policy check. */
  async record(event: SkillKnowledgeEvent): Promise<SkillKnowledgeRecord> {
    const techniqueId = safeTechniqueId(event.techniqueId)
    if (!techniqueId) throw new Error('skill knowledge requires a techniqueId')

    const skillId = event.skillId?.trim().slice(0, 160) || undefined
    const contextTags = normaliseTags(event.contextTags)
    const value = { skillId, techniqueId, outcome: event.outcome, contextTags, evidenceCount: event.evidenceCount ?? 0 }
    const policyRequest = { scope: 'global' as const, kind: 'technique_pattern' as const, key: 'skill-knowledge', value }
    const policy = evaluateMemoryWrite(policyRequest)
    recordMemoryPolicyDecision(policyRequest, policy)
    if (!policy.allowed || policy.destination !== 'global') throw new MemoryPolicyError(policy)

    let result!: SkillKnowledgeRecord
    this.writeQueue = this.writeQueue.then(async () => {
      await this.ensureLoaded()
      const key = recordKey({ skillId, techniqueId, contextTags })
      const now = new Date().toISOString()
      const existing = this.file.records.find(record => recordKey(record) === key)
      if (existing) {
        existing[event.outcome] += 1
        existing.evidenceCount += Math.max(0, Math.floor(event.evidenceCount ?? 0))
        existing.lastSeenAt = now
        result = { ...existing, contextTags: [...existing.contextTags] }
      } else {
        const created: SkillKnowledgeRecord = {
          skillId,
          techniqueId,
          contextTags,
          confirmed: event.outcome === 'confirmed' ? 1 : 0,
          failed: event.outcome === 'failed' ? 1 : 0,
          inconclusive: event.outcome === 'inconclusive' ? 1 : 0,
          evidenceCount: Math.max(0, Math.floor(event.evidenceCount ?? 0)),
          firstSeenAt: now,
          lastSeenAt: now,
        }
        this.file.records.push(created)
        result = { ...created, contextTags: [...created.contextTags] }
      }
      await this.persist()
    })
    await this.writeQueue
    return result
  }

  async list(): Promise<SkillKnowledgeRecord[]> {
    await this.ensureLoaded()
    return this.file.records.map(record => ({ ...record, contextTags: [...record.contextTags] }))
  }

  async listForSkill(skillId: string): Promise<SkillKnowledgeRecord[]> {
    const records = await this.list()
    return records.filter(record => record.skillId === skillId)
  }
}

let sharedStore: SkillKnowledgeStore | null = null

export function getSkillKnowledgeStore(): SkillKnowledgeStore {
  return sharedStore ??= new SkillKnowledgeStore()
}

/** Test seam; production callers keep one shared store per process. */
export function resetSkillKnowledgeStore(): void {
  sharedStore = null
}
