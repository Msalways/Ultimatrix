/**
 * Identity & Reachability — Slice 06.
 *
 * Typed identity labels and reachability records. A crawl tracks the ACTIVE
 * identity context (anonymous by default) as it changes over time; every
 * discovered resource (page/endpoint/form/workflow) is attributed to the
 * identity under which it was reached. Persistence stores typed records only —
 * no prose, no substring inference. Role/tenant labels come from typed input
 * (LLM-declared auth flows, held sessions), never from string matching.
 */

export type IdentityKind = 'anonymous' | 'authenticated' | 'admin' | 'tenant' | 'role'

/** The identity under which a set of discoveries were made. */
export interface IdentityContext {
  id: string
  kind: IdentityKind
  label: string
  tenantId?: string
  roleName?: string
}

/** A single observation: identity X reached resource Y at time T. */
export interface ReachabilityRecord {
  workflowId: string
  identityId: string
  resourceId: string
  resourceType: 'page' | 'endpoint' | 'form' | 'workflow'
  reachedAt: string
}

/**
 * A typed auth transition: the active identity moved from `from` to `to`
 * (anonymous → authenticated, authenticated → anonymous, role swap, ...).
 * `sourceRef` ties the transition to the graph node that caused it (e.g. an
 * AUTH_FLOW node id) when one exists.
 */
export interface AuthTransition {
  workflowId: string
  from: IdentityContext
  to: IdentityContext
  url?: string
  at: number
  sourceRef?: string
}
