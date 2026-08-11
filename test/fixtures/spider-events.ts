/**
 * Shared spider-event parity fixtures.
 *
 * ONE representative `SpiderRuntimeEvent` per typed event type, plus the exact
 * line/phase the shared renderer must produce. CLI and Web parity tests both
 * import this module and assert the SAME input produces the SAME output on
 * both surfaces.
 */

import type { PhaseEvent } from '../../src/solver/solver'
import type { SpiderRuntimeEvent } from '../../src/spider/runtime'
import type { IdentityContext } from '../../src/identity/types'

export const WORKFLOW_ID = 'parity-workflow'

const anonymous: IdentityContext = { id: 'anon', kind: 'anonymous', label: 'anonymous' }
const authenticated: IdentityContext = { id: 'user-1', kind: 'authenticated', label: 'alice' }

function base(type: SpiderRuntimeEvent['type']): SpiderRuntimeEvent {
  return { type, workflowId: WORKFLOW_ID, timestamp: 1_700_000_000_000 }
}

/** Every typed spider event exactly once. */
export const spiderEventFixtures: SpiderRuntimeEvent[] = [
  base('crawl_started'),
  {
    ...base('page_seen'),
    url: 'https://example.com/app',
    scope: 'allowed',
    pages: 1,
    forms: 0,
    identity: anonymous,
  },
  {
    ...base('endpoint_seen'),
    method: 'GET',
    url: 'https://example.com/api/users',
    params: ['id'],
    scope: 'allowed',
    identity: anonymous,
  },
  {
    ...base('form_seen'),
    url: 'https://example.com/login',
    method: 'POST',
    forms: 1,
    identity: anonymous,
  },
  {
    ...base('auth_detected'),
    url: 'https://example.com/login',
    message: 'login form detected',
  },
  {
    ...base('auth_transition'),
    url: 'https://example.com/session',
    from: anonymous,
    to: authenticated,
    authTransition: { workflowId: WORKFLOW_ID, from: anonymous, to: authenticated, at: 1_700_000_000_000 },
  },
  {
    ...base('scope_proposed'),
    url: 'https://cdn.example.net/app.js',
    scope: 'proposed',
    reason: 'origin not in scope',
  },
  {
    ...base('crawl_progress'),
    pages: 12,
    endpoints: 34,
    forms: 5,
  },
  {
    ...base('crawl_stalled'),
    reason: 'stale',
  },
  {
    ...base('crawl_completed'),
    reason: 'frontier_exhausted',
    pages: 12,
    endpoints: 34,
    forms: 5,
  },
]

/** Expected renderer output — the parity contract. */
export const spiderEventLineExpectations: Record<SpiderRuntimeEvent['type'], string> = {
  crawl_started: '[Spider] Crawl started',
  page_seen: '[Spider] Page: https://example.com/app',
  endpoint_seen: '[Spider] Endpoint: GET https://example.com/api/users',
  form_seen: '[Spider] Form: https://example.com/login',
  auth_detected: '[Spider] Auth detected: https://example.com/login',
  auth_transition: '[Spider] Auth transition: anonymous -> alice',
  scope_proposed: '[Spider] Scope proposed: https://cdn.example.net/app.js',
  crawl_progress: '[Spider] Progress: 12 pages, 34 endpoints, 5 forms',
  crawl_stalled: '[Spider] Stalled - no new endpoints for several rounds (stale)',
  crawl_completed: '[Spider] Crawl complete (frontier_exhausted)',
}

/** Expected phase bridge — every type must map (parity: nothing dropped). */
export const spiderEventPhaseExpectations: Record<SpiderRuntimeEvent['type'], PhaseEvent> = {
  crawl_started: { phase: 'observe', step: 0, text: spiderEventLineExpectations.crawl_started },
  page_seen: { phase: 'observe', step: 0, text: spiderEventLineExpectations.page_seen },
  endpoint_seen: { phase: 'observe', step: 0, text: spiderEventLineExpectations.endpoint_seen },
  form_seen: { phase: 'observe', step: 0, text: spiderEventLineExpectations.form_seen },
  auth_detected: { phase: 'observe', step: 0, text: spiderEventLineExpectations.auth_detected },
  auth_transition: { phase: 'observe', step: 0, text: spiderEventLineExpectations.auth_transition },
  scope_proposed: { phase: 'observe', step: 0, text: spiderEventLineExpectations.scope_proposed },
  crawl_progress: { phase: 'observe', step: 0, text: spiderEventLineExpectations.crawl_progress },
  crawl_stalled: { phase: 'stale', step: 0, reason: 'stale' },
  crawl_completed: { phase: 'observe', step: 0, text: spiderEventLineExpectations.crawl_completed },
}
