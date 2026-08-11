/**
 * Spider event renderer — the single source of truth for turning a typed
 * `SpiderRuntimeEvent` into human-facing output. Both the CLI (session
 * lifecycle) and the Web UI (engine phase bridge + SSE client) consume this
 * module, so every event type renders identically on both surfaces.
 *
 * No substring detection: the mapping keys off the typed `event.type`
 * discriminant only.
 *
 * NOTE: keep imports `import type`-only from server modules so this module
 * stays safe to import from Next.js client components.
 */

import type { PhaseEvent } from '../solver/solver'
import type { SpiderRuntimeEvent } from './runtime'

/** Solver phase assigned to each typed spider event (solver-stream compat). */
export const SPIDER_EVENT_PHASE: Record<SpiderRuntimeEvent['type'], 'observe' | 'stale'> = {
  crawl_started: 'observe',
  page_seen: 'observe',
  endpoint_seen: 'observe',
  form_seen: 'observe',
  auth_detected: 'observe',
  auth_transition: 'observe',
  scope_proposed: 'observe',
  crawl_progress: 'observe',
  crawl_stalled: 'stale',
  crawl_completed: 'observe',
}

/**
 * Render a typed spider event to a single display line. Covers the full typed
 * event set — no event type is dropped by the CLI or the Web UI.
 */
export function spiderEventLine(event: SpiderRuntimeEvent): string {
  switch (event.type) {
    case 'crawl_started':
      return '[Spider] Crawl started'
    case 'page_seen':
      return `[Spider] Page: ${event.url ?? 'unknown'}`
    case 'endpoint_seen':
      return `[Spider] Endpoint: ${event.method ?? ''} ${event.url ?? ''}`.trim()
    case 'form_seen':
      return `[Spider] Form: ${event.url ?? 'unknown'}`
    case 'auth_detected':
      return `[Spider] Auth detected: ${event.url ?? 'unknown'}`
    case 'auth_transition': {
      const from = event.from?.label ?? event.from?.id ?? 'unknown'
      const to = event.to?.label ?? event.to?.id ?? 'unknown'
      return `[Spider] Auth transition: ${from} -> ${to}`
    }
    case 'scope_proposed':
      return `[Spider] Scope proposed: ${event.url ?? 'unknown'}`
    case 'crawl_progress':
      return `[Spider] Progress: ${event.pages ?? 0} pages, ${event.endpoints ?? 0} endpoints, ${event.forms ?? 0} forms`
    case 'crawl_stalled':
      return `[Spider] Stalled - no new endpoints for several rounds (${event.reason ?? 'stale'})`
    case 'crawl_completed':
      return `[Spider] Crawl complete (${event.reason ?? 'unknown'})`
  }
}

/**
 * Bridge a typed spider event into the solver `PhaseEvent` stream. Every type
 * maps (previously only crawl_progress/crawl_stalled/scope_proposed did), so
 * consumers of `onPhase` see the same discovery flow as the typed stream.
 */
export function spiderEventToPhase(event: SpiderRuntimeEvent): PhaseEvent {
  const phase = SPIDER_EVENT_PHASE[event.type]
  if (event.type === 'crawl_stalled') {
    return { phase, step: 0, reason: String(event.reason ?? 'stale') }
  }
  return { phase, step: 0, text: spiderEventLine(event) }
}
