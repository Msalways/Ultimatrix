/**
 * Draft-Skill Synthesis (Phase D, spec 05 â€” self-evolving knowledge base).
 *
 * When a technique CONFIRMED a finding AND has a replayed/confirmed exploit
 * proof, but NO bundled or imported skill covers its primitive, a draft
 * SKILL.md is synthesized deterministically from the typed proof recipe
 * (method/url/headers/body/repro steps â€” evidence, not prose invention).
 *
 * Drafts land in workspace/skills-drafts/ marked `unvalidated: true`. They are
 * NEVER auto-loaded; the user promotes them through the standard skill-import
 * validation gate (same drift guards as manual imports).
 */

import { join, resolve } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import type { GraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import { getAllSkills } from '../solver/skills/loader'

export interface DraftSkill {
  techniqueId: string
  primitiveId?: string
  dir: string
  skillPath: string
}

export interface DraftSynthesisResult {
  created: DraftSkill[]
  skippedCovered: string[]
}

/** Same chain mapping the exploitation loop uses (single source of truth). */
const TECHNIQUE_TO_PRIMITIVE: Record<string, string> = {
  idor: 'bolaFuzzer',
  bola: 'bolaFuzzer',
  ssrf: 'ssrfMetadata',
  injection: 'rceClass',
  'auth-bypass': 'authBypass',
  auth_bypass: 'authBypass',
  'workflow-bypass': 'workflowBypass',
  'config-trust': 'configTrust',
}

function stableHash(input: string): string {
  let h = 0
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) - h + input.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36)
}

function isConfirmedFinding(props: Record<string, unknown>): boolean {
  const confirmed = props.confirmed === true || (typeof props.confidence === 'number' && props.confidence >= 0.7)
  const status = String(props.lifecycleStatus ?? '')
  return confirmed && status !== 'disproven' && status !== 'false-positive'
}

function skillCovers(primitiveId: string | undefined, techniqueToken: string): boolean {
  for (const skill of getAllSkills()) {
    if (primitiveId && (skill.primitives ?? []).includes(primitiveId)) return true
    if (skill.id.toLowerCase() === techniqueToken.toLowerCase()) return true
    if (skill.triggers?.some((t) => t.toLowerCase().includes(techniqueToken.toLowerCase()))) return true
  }
  return false
}

function renderDraft(input: {
  techniqueId: string
  primitiveId?: string
  title: string
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  reproSteps: string[]
  expectedVulnerableResponse?: string
}): string {
  const primitiveLine = input.primitiveId ? `primitives: [${input.primitiveId}]` : 'primitives: []'
  const headersBlock = input.headers && Object.keys(input.headers).length > 0
    ? `\n**Captured request headers:**\n\n\`\`\`\n${Object.entries(input.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\`\`\`\n`
    : ''
  const bodyBlock = input.body
    ? `\n**Request body:**\n\n\`\`\`\n${input.body.slice(0, 2000)}\n\`\`\`\n`
    : ''
  const expectedBlock = input.expectedVulnerableResponse
    ? `\n## Expected Vulnerable Response\n\n\`\`\`\n${input.expectedVulnerableResponse.slice(0, 800)}\n\`\`\`\n`
    : ''
  return `---
name: auto-draft-${input.techniqueId}-${stableHash(input.url)}
description: "Auto-synthesized draft from a confirmed ${input.techniqueId} engagement finding. UNVALIDATED â€” requires human review before promotion."
domain: auto-drafts
category: auto-drafts
tier: fast
unvalidated: true
toolRefs: [httpRequest, parseResponse, recordEvidence, writeFinding]
${primitiveLine}
triggers: ["${input.techniqueId}", "auto draft"]
---

# Auto-Draft: ${input.title}

> **UNVALIDATED DRAFT** â€” synthesized automatically from an exploit proof captured
> during engagement. Review, edit, and promote through the skill-import gate before
> relying on it.

## Provenance

- Technique: \`${input.techniqueId}\`${input.primitiveId ? ` (primitive: \`${input.primitiveId}\`)` : ''}
- Source: exploit proof recorded at engagement time
- Target surface: \`${input.method} ${input.url}\`

## Reproduction Recipe

\`\`\`http
${input.method} ${input.url} HTTP/1.1
${Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')}

${input.body ?? ''}
\`\`\`
${headersBlock}${bodyBlock}${expectedBlock}
## Steps

${input.reproSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Promotion Checklist

- [ ] Verify the payload generalizes beyond the original target shape
- [ ] Add detection guidance and edge cases
- [ ] Run the skill-import validation gate
`
}

/**
 * Synthesize draft skills for confirmed techniques that have replayed proofs
 * and no existing skill coverage.
 */
export async function synthesizeDraftSkills(
  store: GraphStore,
  draftsDir: string,
): Promise<DraftSynthesisResult> {
  const result: DraftSynthesisResult = { created: [], skippedCovered: [] }

  const findings = store.queryNodes(NodeType.FINDING) as unknown as Array<{
    id: string
    properties: { technique?: string; findingId?: string; title?: string; confirmed?: boolean; confidence?: number; lifecycleStatus?: string }
  }>
  const proofs = store.queryNodes(NodeType.EXPLOIT_PROOF) as unknown as Array<{
    properties: {
      findingId: string
      title?: string
      method: string
      url: string
      headers?: Record<string, string>
      body?: string
      reproSteps: string[]
      expectedVulnerableResponse?: string
      status: string
    }
  }>
  const provenByFinding = new Map(proofs.filter(p => p.properties.status === 'replayed' || p.properties.status === 'confirmed').map(p => [p.properties.findingId, p]))

  const seenTechniques = new Set<string>()
  for (const finding of findings) {
    const technique = String(finding.properties.technique ?? '').trim()
    if (!technique || seenTechniques.has(technique)) continue
    const proof = provenByFinding.get(finding.properties.findingId ?? finding.id)
    if (!proof) continue

    seenTechniques.add(technique)
    const primitiveId =
      TECHNIQUE_TO_PRIMITIVE[technique] ??
      TECHNIQUE_TO_PRIMITIVE[Object.keys(TECHNIQUE_TO_PRIMITIVE).find(k => technique.includes(k)) ?? '']

    if (skillCovers(primitiveId, technique)) {
      result.skippedCovered.push(technique)
      continue
    }

    const markdown = renderDraft({
      techniqueId: technique,
      primitiveId: primitiveId && !skillCovers(primitiveId, technique) ? primitiveId : undefined,
      title: proof.properties.title ?? `${technique} on ${proof.properties.url}`,
      url: proof.properties.url,
      method: proof.properties.method,
      headers: proof.properties.headers,
      body: proof.properties.body,
      reproSteps: proof.properties.reproSteps ?? [],
      expectedVulnerableResponse: proof.properties.expectedVulnerableResponse,
    })

    const dirName = `auto-draft-${technique}-${stableHash(proof.properties.url)}`
    const dir = resolve(draftsDir, dirName)
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'SKILL.md'), markdown, 'utf8')
      result.created.push({ techniqueId: technique, primitiveId, dir, skillPath: join(dir, 'SKILL.md') })
    }
  }

  return result
}
