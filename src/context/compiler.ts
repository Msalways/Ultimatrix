/**
 * Context Compiler (Phase 3).
 *
 * Compiles the smallest useful investigation context for a worker.
 * The model should not receive all graph nodes, all evidence, all HTTP
 * exchanges, or all previous findings. It should receive a task-specific view.
 *
 * Selection is deterministic and budget-aware — no LLM involvement.
 */

import type {
  CompileContextInput,
  ResearchContextView,
  SourceView,
  ContextOmission,
} from './types'
import { TOKEN_ESTIMATES } from './types'
import {
  scoreExchange,
  scoreFact,
  scoreExperiment,
  scoreFinding,
  sortByRelevance,
  previewExchange,
  previewFact,
} from './selectors'

/**
 * Compile a task-specific investigation context.
 *
 * Selection layers (in priority order):
 * 1. Identity — objective, skill, target (always included)
 * 2. Direct evidence — exchanges directly linked to the task
 * 3. Relevant graph facts — high-relevance facts about the target
 * 4. Previous experiments — same hypothesis family
 * 5. Historical lessons — sanitized reusable lessons (omitted by default)
 * 6. Raw artifacts — loaded JIT (omitted by default)
 *
 * Budget enforcement: layers are added until token budget is exhausted.
 * When budget is exceeded, remaining sources are recorded as omissions.
 */
export function compileContext(input: CompileContextInput): ResearchContextView {
  const sourceViews: SourceView[] = []
  const omissions: ContextOmission[] = []
  let tokensUsed = 0

  // ─── Layer 0: Identity (always included) ────────────────────────────
  const identityPreview = buildIdentityPreview(input)
  const identityTokens = TOKEN_ESTIMATES.identity
  sourceViews.push({
    ref: `task:${input.taskId}`,
    type: 'identity',
    preview: identityPreview,
    relevance: 1.0,
  })
  tokensUsed += identityTokens

  // ─── Layer 1: Direct evidence (exchanges) ───────────────────────────
  if (input.exchangeRefs && input.exchangeRefs.length > 0) {
    const { included, omitted } = addSources(
      input.exchangeRefs.map(ref => ({
        ref,
        type: 'exchange',
        preview: ref, // Preview is just the ref ID; full content loaded JIT
        relevance: scoreExchange({ endpointUrl: input.objective, skillId: input.skillId }),
      })),
      tokensUsed,
      input.tokenBudget,
      'exchange',
    )
    sourceViews.push(...included)
    tokensUsed += included.reduce((s, v) => s + estimateSourceTokens(v), 0)
    if (omitted > 0) {
      omissions.push({ type: 'exchange', count: omitted, reason: 'budget exceeded' })
    }
  }

  // ─── Layer 2: Previous experiments ──────────────────────────────────
  if (input.experimentRefs && input.experimentRefs.length > 0) {
    const { included, omitted } = addSources(
      input.experimentRefs.map(ref => ({
        ref,
        type: 'experiment',
        preview: ref,
        relevance: scoreExperiment({ sameHypothesisFamily: true }),
      })),
      tokensUsed,
      input.tokenBudget,
      'experiment',
    )
    sourceViews.push(...included)
    tokensUsed += included.reduce((s, v) => s + estimateSourceTokens(v), 0)
    if (omitted > 0) {
      omissions.push({ type: 'experiment', count: omitted, reason: 'budget exceeded' })
    }
  }

  // ─── Layer 3: Candidate findings ────────────────────────────────────
  if (input.candidateRefs && input.candidateRefs.length > 0) {
    const { included, omitted } = addSources(
      input.candidateRefs.map(ref => ({
        ref,
        type: 'finding',
        preview: ref,
        relevance: scoreFinding({ sameEndpoint: true }),
      })),
      tokensUsed,
      input.tokenBudget,
      'finding',
    )
    sourceViews.push(...included)
    tokensUsed += included.reduce((s, v) => s + estimateSourceTokens(v), 0)
    if (omitted > 0) {
      omissions.push({ type: 'finding', count: omitted, reason: 'budget exceeded' })
    }
  }

  // ─── Layer 4: Historical lessons (omitted by default — JIT load) ───
  // Lessons are only included if explicitly requested via experimentRefs
  // This prevents context bloat from cross-engagement memory

  // ─── Layer 5: Raw artifacts (always omitted — JIT load) ─────────────
  if (input.exchangeRefs && input.exchangeRefs.length > 0) {
    omissions.push({
      type: 'artifact',
      count: input.exchangeRefs.length,
      reason: 'raw artifacts loaded on demand',
    })
  }

  // ─── Build summary ──────────────────────────────────────────────────
  const summary = buildSummary(sourceViews, omissions, input)

  // ─── Collect refs ───────────────────────────────────────────────────
  const graphRefs = sourceViews.filter(s => s.type === 'fact').map(s => s.ref)
  const opportunityRefs: string[] = [] // Phase 2 will populate
  const experimentRefs = sourceViews.filter(s => s.type === 'experiment').map(s => s.ref)
  const evidenceRefs = sourceViews.filter(s => s.type === 'exchange').map(s => s.ref)
  const artifactRefs: string[] = [] // Artifacts are JIT-loaded
  const findingRefs = sourceViews.filter(s => s.type === 'finding').map(s => s.ref)

  return {
    objective: input.objective,
    summary,
    graphRefs,
    opportunityRefs,
    experimentRefs,
    evidenceRefs,
    artifactRefs,
    findingRefs,
    sourceViews: sortByRelevance(sourceViews),
    omissions,
    tokenEstimate: tokensUsed,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildIdentityPreview(input: CompileContextInput): string {
  const parts = [`Objective: ${input.objective}`]
  if (input.skillId) parts.push(`Skill: ${input.skillId}`)
  return parts.join('\n')
}

function buildSummary(
  sources: SourceView[],
  omissions: ContextOmission[],
  input: CompileContextInput,
): string {
  const lines: string[] = []
  lines.push(`## Context: ${input.objective}`)
  if (input.skillId) lines.push(`Skill: ${input.skillId}`)
  lines.push('')

  const byType = groupBy(sources, 'type')
  for (const [type, items] of Object.entries(byType)) {
    lines.push(`### ${capitalize(type)} (${items.length})`)
    for (const item of items.slice(0, 5)) {
      lines.push(`- ${item.preview}`)
    }
    if (items.length > 5) lines.push(`- ... and ${items.length - 5} more`)
    lines.push('')
  }

  if (omissions.length > 0) {
    lines.push('### Omitted')
    for (const om of omissions) {
      lines.push(`- ${om.count} ${om.type} (${om.reason})`)
    }
  }

  return lines.join('\n')
}

function addSources(
  candidates: SourceView[],
  tokensUsed: number,
  tokenBudget: number,
  typeName: string,
): { included: SourceView[]; omitted: number } {
  const sorted = sortByRelevance(candidates)
  const included: SourceView[] = []
  let omitted = 0

  for (const source of sorted) {
    const sourceTokens = estimateSourceTokens(source)
    if (tokensUsed + sourceTokens <= tokenBudget) {
      included.push(source)
      tokensUsed += sourceTokens
    } else {
      omitted++
    }
  }

  return { included, omitted }
}

function estimateSourceTokens(source: SourceView): number {
  // Rough estimate: ~1 token per word in preview
  const words = source.preview.split(/\s+/).length
  return Math.max(words, TOKEN_ESTIMATES[source.type] ?? 30)
}

function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  const result: Record<string, T[]> = {}
  for (const item of items) {
    const k = String(item[key])
    if (!result[k]) result[k] = []
    result[k].push(item)
  }
  return result
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
