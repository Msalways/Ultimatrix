/**
 * Shared skill revision proposals.
 *
 * Technique outcomes are useful as common knowledge, but silently rewriting a
 * bundled skill from one engagement would be unsafe and impossible to audit.
 * This module turns repeated, target-independent outcomes into immutable
 * proposal files.  Promotion is a separate, explicit operation through the
 * skill validation/import gate.
 */

import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getGlobalWorkspace } from '../workspace'
import { getAllSkills, readSkillMarkdown, type SkillMeta } from '../solver/skills/loader'
import { validateSkillMarkdown } from '../solver/skills/validate'
import { getSkillKnowledgeStore, type SkillKnowledgeRecord } from './skill-knowledge'

export interface SkillRevisionProposal {
  skillId: string
  path: string
  confirmed: number
  failed: number
  inconclusive: number
  sourceRecords: number
  createdAt: string
}

export interface SkillRevisionSynthesisResult {
  created: SkillRevisionProposal[]
  skipped: Array<{ skillId: string; reason: string }>
}

function stableHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) h = ((h << 5) - h + input.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'skill'
}

function normalise(value: string): string {
  return value.trim().toLowerCase()
}

/** Match a technique to a skill using only registry metadata, never target data. */
function skillMatchesRecord(skill: SkillMeta, record: SkillKnowledgeRecord): boolean {
  if (record.skillId && record.skillId === skill.id) return true
  const technique = normalise(record.techniqueId)
  if (!technique) return false
  const fields = [skill.id, skill.name, skill.category, ...(skill.triggers ?? []), ...(skill.contextBoosts ?? [])]
    .map(normalise)
    .filter(Boolean)
  return fields.some(field => field === technique || field.includes(technique) || technique.includes(field))
}

function aggregateRecords(records: SkillKnowledgeRecord[]): SkillKnowledgeRecord[] {
  const grouped = new Map<string, SkillKnowledgeRecord>()
  for (const record of records) {
    const key = record.techniqueId.toLowerCase()
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, {
        ...record,
        contextTags: [...record.contextTags],
      })
      continue
    }
    existing.confirmed += record.confirmed
    existing.failed += record.failed
    existing.inconclusive += record.inconclusive
    existing.evidenceCount += record.evidenceCount
    existing.contextTags = [...new Set([...existing.contextTags, ...record.contextTags])].slice(0, 8).sort()
    if (record.lastSeenAt > existing.lastSeenAt) existing.lastSeenAt = record.lastSeenAt
  }
  return [...grouped.values()].sort((a, b) => b.confirmed - a.confirmed || a.techniqueId.localeCompare(b.techniqueId))
}

function renderProposal(source: string, records: SkillKnowledgeRecord[], hash: string): string {
  const lines = records.map(record => {
    const tags = record.contextTags.map(tag => `\`${safeName(tag)}\``).join(', ')
    const context = tags ? `; contexts: ${tags}` : ''
    return `- \`${record.techniqueId}\`: confirmed ${record.confirmed}, failed ${record.failed}, inconclusive ${record.inconclusive}${context}`
  })
  const fence = '```'
  return `${source.trimEnd()}

## Shared Knowledge Revision Proposal

<!-- UNVALIDATED REVISION PROPOSAL ${hash} -->
> This section is generated from target-independent outcome counts. It is not
> active until a reviewer promotes it through the skill import validation gate.
> It intentionally contains no target URL, hostname, credential, request body,
> header, or response payload.

### Evolved heuristics

${lines.join('\n')}

${fence}text
revision-signal: repeated target-independent outcomes
confidence-rule: confirmed outcomes must exceed failed outcomes
review-required: true
${fence}

### Promotion checklist

- Confirm the heuristic generalizes to the skill's declared scope.
- Add or update a falsifiable baseline, mutation, and oracle.
- Retain the least-privilege and rate-limit constraints in the parent skill.
- Promote only through the manageSkills tool after validation and review.
`
}

/**
 * Materialize revisions from repeated shared outcomes.  The default output is
 * global and reviewable; callers can provide a test directory or a custom
 * threshold without changing production policy.
 */
export async function synthesizeSharedSkillRevisions(opts: {
  outDir?: string
  minConfirmed?: number
  skills?: SkillMeta[]
  records?: SkillKnowledgeRecord[]
} = {}): Promise<SkillRevisionSynthesisResult> {
  const outDir = opts.outDir ?? resolve(getGlobalWorkspace().getGlobalMemoryDir(), 'skill-revisions')
  const minConfirmed = Math.max(2, Math.floor(opts.minConfirmed ?? 2))
  const records = opts.records ?? await getSkillKnowledgeStore().list()
  const skills = (opts.skills ?? getAllSkills()).filter(skill => !skill.id.startsWith('user/'))
  const result: SkillRevisionSynthesisResult = { created: [], skipped: [] }

  for (const skill of skills) {
    const source = readSkillMarkdown(skill.id)
    if (!source) {
      result.skipped.push({ skillId: skill.id, reason: 'canonical source unavailable' })
      continue
    }
    if (source.includes('UNVALIDATED REVISION PROPOSAL')) {
      result.skipped.push({ skillId: skill.id, reason: 'existing proposal is already present in source' })
      continue
    }

    const related = aggregateRecords(records.filter(record => skillMatchesRecord(skill, record)))
    const qualified = related.filter(record => record.confirmed >= minConfirmed && record.confirmed > record.failed)
    if (qualified.length === 0) continue

    const hash = stableHash(JSON.stringify(qualified.map(record => ({
      techniqueId: record.techniqueId,
      confirmed: record.confirmed,
      failed: record.failed,
      inconclusive: record.inconclusive,
      contextTags: record.contextTags,
      lastSeenAt: record.lastSeenAt,
    }))))
    const markdown = renderProposal(source, qualified, hash)
    const validation = validateSkillMarkdown(markdown)
    if (!validation.valid) {
      result.skipped.push({ skillId: skill.id, reason: `generated proposal failed validation: ${validation.errors.join('; ')}` })
      continue
    }

    // The folder is named after the canonical skill so promotion can preserve
    // its identity. A content hash in the filename gives every proposal a
    // durable audit trail without overwriting the canonical source.
    const proposalDir = resolve(outDir, safeName(skill.id))
    const path = resolve(proposalDir, `revision-${hash}.md`)
    if (existsSync(path)) {
      result.skipped.push({ skillId: skill.id, reason: 'identical revision proposal already exists' })
      continue
    }
    if (!existsSync(proposalDir)) await mkdir(proposalDir, { recursive: true })
    await writeFile(path, markdown, 'utf8')
    result.created.push({
      skillId: skill.id,
      path,
      confirmed: qualified.reduce((sum, record) => sum + record.confirmed, 0),
      failed: qualified.reduce((sum, record) => sum + record.failed, 0),
      inconclusive: qualified.reduce((sum, record) => sum + record.inconclusive, 0),
      sourceRecords: qualified.length,
      createdAt: new Date().toISOString(),
    })
  }

  return result
}
