/**
 * Context Selectors (Phase 3).
 *
 * Deterministic selection functions for building a task-specific context.
 * NO LLM involvement — pure programmatic selection by relevance scoring.
 */

import type { SourceView, ContextOmission, TOKEN_ESTIMATES } from './types'

/** Score an exchange artifact for relevance to a task */
export function scoreExchange(opts: {
  url?: string
  method?: string
  status?: number
  endpointUrl?: string
  skillId?: string
}): number {
  let score = 0.5 // base relevance

  // Direct endpoint match = high relevance
  if (opts.url && opts.endpointUrl) {
    if (opts.url === opts.endpointUrl) score += 0.4
    else if (opts.url.startsWith(opts.endpointUrl)) score += 0.2
  }

  // Auth-related skill + auth responses are relevant
  if (opts.skillId === 'authorization' || opts.skillId === 'jwt-advanced') {
    if (opts.status === 200 || opts.status === 401 || opts.status === 403) {
      score += 0.1
    }
  }

  // Successful responses are more informative for comparison
  if (opts.status === 200) score += 0.05

  return Math.min(score, 1.0)
}

/** Score a graph fact for relevance */
export function scoreFact(opts: {
  type: string
  endpointUrl?: string
  relatedToTask?: boolean
}): number {
  let score = 0.3

  // Endpoint and action facts are most relevant
  if (opts.type === 'Endpoint' || opts.type === 'Action') score += 0.3
  if (opts.type === 'Finding') score += 0.2
  if (opts.type === 'AuthFlow') score += 0.15
  if (opts.type === 'Fact') score += 0.1

  if (opts.relatedToTask) score += 0.2

  return Math.min(score, 1.0)
}

/** Score an experiment for relevance */
export function scoreExperiment(opts: {
  hypothesis?: string
  sameHypothesisFamily?: boolean
  hasResult?: boolean
}): number {
  let score = 0.4

  if (opts.sameHypothesisFamily) score += 0.3
  if (opts.hasResult) score += 0.1

  return Math.min(score, 1.0)
}

/** Score a finding for relevance */
export function scoreFinding(opts: {
  severity?: string
  sameEndpoint?: boolean
  sameTechnique?: boolean
}): number {
  let score = 0.4

  if (opts.sameEndpoint) score += 0.3
  if (opts.sameTechnique) score += 0.2
  if (opts.severity === 'critical' || opts.severity === 'high') score += 0.1

  return Math.min(score, 1.0)
}

/** Sort source views by relevance (descending) */
export function sortByRelevance(views: SourceView[]): SourceView[] {
  return [...views].sort((a, b) => b.relevance - a.relevance)
}

/** Estimate token count for a set of source views */
export function estimateTokens(views: SourceView[]): number {
  return views.reduce((sum, v) => sum + v.preview.split(/\s+/).length, 0)
}

/** Build a compact preview for an exchange */
export function previewExchange(opts: {
  url?: string
  method?: string
  status?: number
  bodyPreview?: string
}): string {
  const parts: string[] = []
  if (opts.method) parts.push(opts.method)
  if (opts.url) parts.push(opts.url)
  if (opts.status) parts.push(`→ ${opts.status}`)
  if (opts.bodyPreview) parts.push(`(${opts.bodyPreview.slice(0, 100)}...)`)
  return parts.join(' ') || '(empty exchange)'
}

/** Build a compact preview for a graph fact */
export function previewFact(opts: {
  type: string
  properties: Record<string, unknown>
}): string {
  const p = opts.properties
  if (opts.type === 'Endpoint') return `Endpoint: ${p.method} ${p.url}`
  if (opts.type === 'Finding') return `Finding: ${p.severity} ${p.technique} at ${p.endpoint}`
  if (opts.type === 'Action') return `Action: ${p.actionType} on ${p.url ?? 'page'}`
  if (opts.type === 'AuthFlow') return `Auth: ${p.authType} at ${p.url}`
  return `${opts.type}: ${JSON.stringify(p).slice(0, 100)}`
}
