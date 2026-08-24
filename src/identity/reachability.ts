/**
 * Identity & Reachability helpers — Slice 06.
 *
 * Pure, typed helpers for building identity contexts and reachability records,
 * plus the typed mapping from AUTH_FLOW flow types to identity kinds. No
 * substring/keyword detection: `flowType` is a typed enum (AuthFlowType) and is
 * mapped to a typed `IdentityKind` only for flow types that semantically
 * change identity.
 */

import type { AuthFlowType } from '../types/shared'
import type { IdentityContext, IdentityKind, ReachabilityRecord } from './types'

export const ANONYMOUS_IDENTITY: IdentityContext = {
  id: 'anonymous',
  kind: 'anonymous',
  label: 'Anonymous',
}

export function anonymousIdentity(): IdentityContext {
  return { ...ANONYMOUS_IDENTITY }
}

/** Build a typed identity context from explicit fields. */
export function makeIdentity(
  kind: IdentityKind,
  label: string,
  opts: { id?: string; tenantId?: string; roleName?: string } = {},
): IdentityContext {
  const roleKey = opts.roleName ? opts.roleName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : undefined
  return {
    id: opts.id ?? (kind === 'anonymous' ? 'anonymous' : `${kind}:${roleKey ?? label}`),
    kind,
    label,
    ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
    ...(opts.roleName ? { roleName: opts.roleName } : {}),
  }
}

/**
 * Auth flows that change identity. Typed enum → typed kind mapping: a login-like
 * flow authenticates; a logout flow returns to anonymous. Flows absent from this
 * map do NOT change identity (e.g. token refresh while already authenticated,
 * form-fill on an anonymous page) and are deliberately skipped.
 */
export const AUTH_FLOW_IDENTITY_KINDS: Partial<Record<AuthFlowType, IdentityKind>> = {
  login: 'authenticated',
  oauth: 'authenticated',
  saml: 'authenticated',
  mfa: 'authenticated',
  logout: 'anonymous',
}

export type ReachabilityResourceType = ReachabilityRecord['resourceType']

/**
 * Identity for an auth-driven transition. Returns `undefined` when the flow
 * type does not change identity (absent from the typed map), so callers treat
 * the flow as a no-op rather than fabricating a new identity.
 */
export function identityForAuthFlow(flowType: AuthFlowType, label: string, url?: string): IdentityContext | undefined {
  const kind = AUTH_FLOW_IDENTITY_KINDS[flowType]
  if (!kind) return undefined
  if (kind === 'anonymous') return anonymousIdentity()
  return makeIdentity(kind, label || flowType, { id: `auth:${flowType}:${url ?? label}` })
}

export function createReachability(
  workflowId: string,
  identity: IdentityContext,
  resourceType: ReachabilityResourceType,
  resourceId: string,
  reachedAt = new Date().toISOString(),
): ReachabilityRecord {
  return {
    workflowId,
    identityId: identity.id,
    resourceId,
    resourceType,
    reachedAt,
    identity: {
      id: identity.id,
      kind: identity.kind,
      ...(identity.roleName ? { roleName: identity.roleName } : {}),
      ...(identity.tenantId ? { tenantId: identity.tenantId } : {}),
    },
    observedAt: reachedAt,
  }
}

/** Dedupe key — one reachability record per (identity, resource). */
export function reachabilityKey(record: Pick<ReachabilityRecord, 'identityId' | 'resourceType' | 'resourceId'>): string {
  return `${record.identityId}:${record.resourceType}:${record.resourceId}`
}

/** Push a record, dropping exact duplicates (same identity + resource). */
export function pushReachability(
  records: ReachabilityRecord[],
  record: ReachabilityRecord,
): ReachabilityRecord[] {
  if (records.some((r) => reachabilityKey(r) === reachabilityKey(record))) return records
  return [...records, record]
}
