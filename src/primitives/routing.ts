/**
 * Typed endpoint routing for attack primitives.
 *
 * Root-cause design: endpoint *semantics* are classified ONCE by the analyser
 * (`inferUseCase`) and stored as the typed `EndpointNode.useCase` / `authType` /
 * `authRequired` fields. Primitives MUST route on those structured signals — not
 * by re-deriving purpose from URL substrings (a divergent second classifier that
 * silently drifts from the analyser). When the brain dispatches a primitive it
 * already supplies `ctx.param` / `ctx.state` as typed intent, so name-scanning is
 * both redundant and a bandaid.
 */

import type { TechniqueContext } from './framework'

export interface RoutableEndpoint {
  url: string
  method: string
  params?: Array<{ name: string; type?: string; in?: string; required?: boolean }>
  authRequired?: boolean
  authType?: string
  /** Typed use-case assigned by the analyser (e.g. "authentication operation"). */
  useCase?: string
  tags?: string[]
}

function endpointOf(ctx: TechniqueContext): RoutableEndpoint | undefined {
  return ctx.endpoint
}

function useCaseHas(ep: RoutableEndpoint | undefined, needles: string[]): boolean {
  const uc = (ep?.useCase ?? '').toLowerCase()
  if (!uc) return false
  return needles.some(n => uc.includes(n))
}

function tagHas(ep: RoutableEndpoint | undefined, needles: string[]): boolean {
  const tags = (ep?.tags ?? []).map(t => t.toLowerCase())
  return needles.some(n => tags.includes(n) || tags.some(t => t.includes(n)))
}

/** An auth-bearing endpoint per its typed metadata (no URL name scanning). */
export function isAuthEndpoint(ctx: TechniqueContext): boolean {
  const ep = endpointOf(ctx)
  if (!ep) return false
  if (ep.authRequired === true) return true
  if (ep.authType && ep.authType.length > 0) return true
  return useCaseHas(ep, ['login', 'auth', 'session', 'token', 'credential', 'password', 'registration', 'reset', 'account'])
    || tagHas(ep, ['auth', 'login', 'session', 'token'])
}

/** A state-changing / workflow endpoint via typed use-case or supplied steps. */
export function isWorkflowEndpoint(ctx: TechniqueContext): boolean {
  const ep = endpointOf(ctx)
  if ((ctx.workflowSteps?.length ?? 0) > 1) return true
  if (!ep) return false
  return useCaseHas(ep, [
    'checkout', 'payment', 'order', 'transfer', 'redeem', 'reset', 'verify',
    'activate', 'upgrade', 'finalize', 'submission', 'registration', 'credential reset',
  ]) || tagHas(ep, ['workflow', 'checkout', 'payment', 'order', 'transfer'])
}

/** A concurrent-state-mutating endpoint (resource creation / balance / stock etc.). */
export function isStateMutatingEndpoint(ctx: TechniqueContext): boolean {
  const ep = endpointOf(ctx)
  if (!ep) return false
  const method = (ep.method ?? 'POST').toUpperCase()
  if (method === 'GET') return false
  return useCaseHas(ep, [
    'resource creation', 'resource update', 'resource deletion', 'payment operation',
    'order operation', 'cart operation', 'checkout operation', 'data export',
    'account operation', 'profile management', 'settings management',
    'file upload', 'form submission', 'submission',
  ]) || tagHas(ep, ['mutation', 'create', 'update', 'payment', 'order'])
}

/**
 * SSRF-prone endpoint: route on a brain-supplied param (typed intent) or a
 * server-side-fetch use-case. The analyser assigns use-cases like "file upload",
 * "resource retrieval", "webhook operation"; those are the structural signals.
 * A URL-name scan is a redundant second classifier and is intentionally avoided.
 */
export function isSsrfProneEndpoint(ctx: TechniqueContext): boolean {
  if (ctx.param && ctx.param.length > 0) return true
  const ep = endpointOf(ctx)
  if (!ep) return false
  return useCaseHas(ep, [
    'file upload', 'resource retrieval', 'data import', 'webhook operation',
    'token operation', 'file download', 'data export',
  ]) || tagHas(ep, ['ssrf', 'fetch', 'proxy', 'webhook', 'import', 'upload'])
}

/** AI-feature endpoint via typed state flag or a typed param/use-case signal. */
export function isAiEndpoint(ctx: TechniqueContext): boolean {
  if (ctx.payloads && ctx.payloads.length > 0) return true
  if (ctx.state?.['aiFeature'] === true) return true
  if (ctx.param && ctx.param.toLowerCase().includes('prompt')) return true
  const ep = endpointOf(ctx)
  if (!ep) return false
  return useCaseHas(ep, ['ai', 'llm', 'agent', 'prompt']) || tagHas(ep, ['ai', 'llm', 'agent', 'prompt'])
}

/** True when no endpoint metadata exists but a target was supplied (apply broadly). */
export function hasTarget(ctx: TechniqueContext): boolean {
  return Boolean(ctx.endpoint || ctx.target)
}
