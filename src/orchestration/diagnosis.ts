/**
 * Diagnosis subsystem — Phase 9 (ORCHESTRATION-LAYER-FIX.md T2).
 *
 * Reads the current graph/capture state and emits a structured `DiagnosisProfile`:
 * known context, missing context, attack-surface signals, ranked techniques, and
 * recommended skills/primitives/workers.
 *
 * Hard rules:
 *  - Diagnosis NEVER executes tests and NEVER writes findings.
 *  - Signals are produced from STRUCTURED/typed graph data and shape patterns
 *    (mirroring the analyser's use-case producer and the retained id-shape
 *    exception) — never from free-text routing.
 *  - Missing context is explicit and actionable, not a weak finding.
 */

import { NodeType, EdgeType } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import { getGlobalGraphStore } from '../graph/store'
import { looksLikeId } from '../research/utils'
import { listPrimitiveMetadata } from '../primitives/framework'
import { getAllSkills, type SkillMeta } from '../solver/skills/loader'
import { getOastUrl } from '../oast/server'
import { rankTechniqueCandidates } from './technique-planner'
import type {
  AttackSurfaceSignal,
  DiagnosedEndpoint,
  DiagnosisProfile,
  MissingContextRequirement,
  TechniqueCandidate,
} from './types'

export interface DiagnosisInput {
  target?: string
  includeSkills?: boolean
  includePrimitives?: boolean
  maxCandidates?: number
  graphStore?: GraphStore
  /** Override OAST availability (e.g. from config.oast.externalHost). */
  oastHost?: string
}

// ─── Structural producers (mirror analyser USECASE_MAP precedent) ────

/** URL-field param shapes. Produces the url-like-param signal. */
const URL_FIELD_SHAPES = [
  'url', 'uri', 'href', 'redirect', 'return', 'callback', 'webhook', 'host',
  'image', 'file', 'import', 'metadata', 'fetch', 'link', 'target',
]

/** Tenant/org scoping param shapes. Produces the tenant signal. */
const TENANT_FIELD_SHAPES = [
  'tenant', 'org', 'organization', 'account', 'workspace', 'team', 'project', 'company',
]

/** Standard headers that do NOT constitute a custom-header surface. */
const STANDARD_HEADERS = new Set([
  'accept', 'accept-encoding', 'accept-language', 'authorization', 'cache-control',
  'connection', 'content-length', 'content-type', 'cookie', 'host', 'origin',
  'pragma', 'referer', 'user-agent',
])

/** Proxy/forwarding header shapes. Produces the proxy signal. */
function isProxyHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower === 'forwarded' ||
    lower === 'via' ||
    lower === 'x-real-ip' ||
    lower.startsWith('x-forwarded-') ||
    lower.startsWith('x-original-')
  )
}

function isStateChanging(method: string): boolean {
  const m = (method ?? '').toUpperCase()
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE'
}

function isGraphqlEndpoint(url: string, tags?: string[], useCase?: string): boolean {
  try {
    const path = new URL(url).pathname
    const last = path.split('/').filter(Boolean).pop()?.toLowerCase()
    if (last === 'graphql') return true
  } catch { /* not a URL */ }
  // Typed-field membership only (no free-text substring routing).
  if (Array.isArray(tags) && tags.includes('graphql')) return true
  return (useCase ?? '').trim().toLowerCase() === 'graphql'
}

/** Split a param name on separators AND camelCase boundaries (userId → user,id). */
function paramTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[_\-.\s]+/)
    .filter(Boolean)
}

/** Object-id-shaped param: name ends in an id token or the name itself is id-shaped. */
function isObjectIdParam(name: string): boolean {
  const tokens = paramTokens(name)
  const last = tokens[tokens.length - 1]
  if (last === 'id' || last === 'ids' || last === 'uuid' || last === 'guid') return true
  return looksLikeId(name)
}

/** URL-shaped param: trailing token is a URL-field shape. */
function isUrlLikeParam(name: string): boolean {
  const tokens = paramTokens(name)
  const last = tokens[tokens.length - 1]
  return URL_FIELD_SHAPES.includes(last)
}

/** Tenant-scoped param: trailing token is a tenant shape. */
function isTenantParam(name: string): boolean {
  const tokens = paramTokens(name)
  const last = tokens[tokens.length - 1]
  return TENANT_FIELD_SHAPES.includes(last)
}

/** Serialized-payload surface: a typed content-type on any endpoint header. */
function hasSerializedContent(ep: DiagnosedEndpoint): boolean {
  if (!ep.paramTypes) return false
  for (const p of Object.values(ep.paramTypes)) {
    if (!p) continue
    const lower = p.toLowerCase()
    if (lower.includes('json') || lower.includes('xml') || lower.includes('yaml') || lower.includes('pickle')) return true
  }
  return false
}

// ─── Graph reads ─────────────────────────────────────────────────────

function readEndpoints(store: GraphStore, target?: string): DiagnosedEndpoint[] {
  const nodes = (store.queryNodes(NodeType.ENDPOINT) as Array<any>) ?? []
  return nodes
    .filter((n) => {
      if (!n?.properties?.url) return false
      if (!target) return true
      try {
        return new URL(n.properties.url).origin === new URL(target).origin
      } catch {
        return true
      }
    })
    .map((n) => {
      const props = n.properties ?? {}
      const params: string[] = ((props.params ?? []) as Array<{ name?: string }>)
        .map((p) => (typeof p?.name === 'string' ? p.name : ''))
        .filter(Boolean)
      const paramTypes: Record<string, string | undefined> = {}
      for (const p of (props.params ?? []) as Array<{ name?: string; type?: unknown }>) {
        if (p?.name) paramTypes[p.name] = typeof p.type === 'string' ? p.type : undefined
      }
      const headers = Object.keys(props.headers ?? {}).filter(Boolean)
      return {
        id: n.id,
        url: props.url,
        method: props.method ?? 'GET',
        params: [...new Set(params)],
        paramTypes,
        headers,
        authRequired: props.authRequired,
        authType: props.authType,
        useCase: props.useCase,
        tags: Array.isArray(props.tags) ? props.tags : undefined,
      }
    })
}

function readRelations(store: GraphStore): Array<{
  type: string
  fromId: string
  toId: string
  fromUrl?: string
  toUrl?: string
}> {
  const edges = store.getAllEdges?.() ?? []
  const nodeUrl = new Map<string, string>()
  try {
    const eps = store.queryNodes(NodeType.ENDPOINT) as Array<any>
    for (const e of eps ?? []) nodeUrl.set(e.id, e.properties?.url)
  } catch { /* ignore */ }
  const interesting = new Set<string>([
    EdgeType.REINGESTS, EdgeType.ORDERED_BEFORE, EdgeType.VALUE_ORIGIN,
    EdgeType.SESSION_REACHES, EdgeType.REACHES,
  ])
  return edges
    .filter((e) => interesting.has(e.type as EdgeType))
    .map((e) => ({
      type: e.type,
      fromId: e.fromId,
      toId: e.toId,
      fromUrl: nodeUrl.get(e.fromId),
      toUrl: nodeUrl.get(e.toId),
    }))
}

// ─── Signal building ─────────────────────────────────────────────────

function buildSignals(eps: DiagnosedEndpoint[], relations: Array<{ type: string }>): {
  signals: AttackSurfaceSignal[]
  objectIdParams: string[]
  urlLikeParams: string[]
  graphqlEndpoints: string[]
  stateChangingEndpoints: string[]
} {
  const objectIdParams = new Set<string>()
  const urlLikeParams = new Set<string>()
  const graphqlEndpoints = new Set<string>()
  const stateChangingEndpoints = new Set<string>()

  const push = (map: Map<string, AttackSurfaceSignal>, signal: AttackSurfaceSignal) => {
    const existing = map.get(signal.name)
    if (existing) {
      existing.endpointIds = [...new Set([...existing.endpointIds, ...signal.endpointIds])]
      existing.paramNames = [...new Set([...(existing.paramNames ?? []), ...(signal.paramNames ?? [])])]
      existing.confidence = Math.max(existing.confidence, signal.confidence)
    } else {
      map.set(signal.name, signal)
    }
  }

  const signals = new Map<string, AttackSurfaceSignal>()

  for (const ep of eps) {
    for (const p of ep.params) {
      if (isObjectIdParam(p)) {
        objectIdParams.add(p)
        push(signals, {
          name: 'object-id-param',
          kind: 'param',
          endpointIds: [ep.id],
          paramNames: [p],
          detail: `param ${p} on ${ep.method} ${ep.url} is object-id-shaped`,
          confidence: ep.authRequired ? 0.9 : 0.6,
        })
      }
      if (isUrlLikeParam(p)) {
        urlLikeParams.add(p)
        push(signals, {
          name: 'url-like-param',
          kind: 'param',
          endpointIds: [ep.id],
          paramNames: [p],
          detail: `param ${p} on ${ep.method} ${ep.url} is URL-field-shaped`,
          confidence: 0.8,
        })
      }
      if (isTenantParam(p)) {
        push(signals, {
          name: 'tenant-scoped-param',
          kind: 'param',
          endpointIds: [ep.id],
          paramNames: [p],
          detail: `param ${p} on ${ep.method} ${ep.url} is tenant/org-scoped`,
          confidence: 0.7,
        })
      }
    }

    if (ep.authRequired || ep.authType) {
      push(signals, {
        name: 'auth-bound',
        kind: 'auth',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} requires auth${ep.authType ? ` (${ep.authType})` : ''}`,
        confidence: 0.9,
      })
    }

    if (isGraphqlEndpoint(ep.url, ep.tags, ep.useCase)) {
      graphqlEndpoints.add(ep.url)
      push(signals, {
        name: 'graphql',
        kind: 'endpoint',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} is a GraphQL surface`,
        confidence: 0.85,
      })
    }

    if (isStateChanging(ep.method)) {
      stateChangingEndpoints.add(ep.url)
      push(signals, {
        name: 'state-changing',
        kind: 'endpoint',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} mutates server state`,
        confidence: 0.8,
      })
    }

    if (hasSerializedContent(ep)) {
      push(signals, {
        name: 'serialized-content',
        kind: 'param',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} carries a serialized content type`,
        confidence: 0.6,
      })
    }

    // Custom header / proxy surfaces come from the graph's captured headers.
    const custom = (ep.headers ?? []).filter((h) => !STANDARD_HEADERS.has(h.toLowerCase()))
    if (custom.length > 0) {
      push(signals, {
        name: 'custom-header',
        kind: 'header',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} has non-standard headers: ${custom.slice(0, 5).join(', ')}`,
        confidence: 0.7,
      })
    }
    const proxied = (ep.headers ?? []).filter((h) => isProxyHeader(h))
    if (proxied.length > 0) {
      push(signals, {
        name: 'proxy-hint',
        kind: 'header',
        endpointIds: [ep.id],
        detail: `${ep.method} ${ep.url} has forwarding headers: ${proxied.slice(0, 5).join(', ')}`,
        confidence: 0.7,
      })
    }
  }

  if (relations.some((r) => r.type === EdgeType.REINGESTS || r.type === EdgeType.VALUE_ORIGIN)) {
    push(signals, {
      name: 'second-order',
      kind: 'relation',
      endpointIds: [],
      detail: 'cross-endpoint value reuse (REINGESTS/VALUE_ORIGIN) present',
      confidence: 0.8,
    })
  }
  if (relations.some((r) => r.type === EdgeType.ORDERED_BEFORE)) {
    push(signals, {
      name: 'workflow-order',
      kind: 'relation',
      endpointIds: [],
      detail: 'ordered endpoint sequencing (ORDERED_BEFORE) present',
      confidence: 0.8,
    })
  }
  if (relations.some((r) => r.type === EdgeType.SESSION_REACHES || r.type === EdgeType.REACHES)) {
    push(signals, {
      name: 'session-reach',
      kind: 'relation',
      endpointIds: [],
      detail: 'held-session reachability recorded',
      confidence: 0.7,
    })
  }

  return {
    signals: [...signals.values()],
    objectIdParams: [...objectIdParams],
    urlLikeParams: [...urlLikeParams],
    graphqlEndpoints: [...graphqlEndpoints],
    stateChangingEndpoints: [...stateChangingEndpoints],
  }
}

// ─── Missing context ─────────────────────────────────────────────────

function buildMissingContext(
  eps: DiagnosedEndpoint[],
  signalInfo: {
    objectIdParams: string[]
    urlLikeParams: string[]
    graphqlEndpoints: string[]
    stateChangingEndpoints: string[]
  },
  hasAuth: boolean,
  roles: string[],
  hasOast: boolean,
  workflows: Array<{ steps: string[] }>,
): MissingContextRequirement[] {
  const missing: MissingContextRequirement[] = []

  if (eps.length === 0) {
    missing.push({
      context: 'discovery',
      reason: 'No endpoints recorded yet. Discovery/capture must come first.',
      priority: 'high',
    })
    return missing
  }

  if (hasAuth && roles.length <= 1) {
    missing.push({
      context: 'second-user',
      reason: 'Authenticated surfaces exist but only one role/session is known. Authorization/IDOR testing needs a second user.',
      priority: 'high',
      techniqueIds: ['authz', 'idor', 'bola'],
    })
  }
  if (hasAuth) {
    missing.push({
      context: 'session-headers',
      reason: 'Authenticated endpoints exist. Captured session headers for each role are required for real-context testing.',
      priority: 'high',
      techniqueIds: ['authz', 'idor'],
    })
  }
  if (signalInfo.objectIdParams.length > 0 && !hasAuth) {
    missing.push({
      context: 'alternate-object-id',
      reason: `Object-id-shaped params found (${signalInfo.objectIdParams.join(', ')}) but no second session to compare against.`,
      priority: 'medium',
      techniqueIds: ['idor', 'bola'],
    })
  }
  if (signalInfo.urlLikeParams.length > 0 && !hasOast) {
    missing.push({
      context: 'oast-host',
      reason: 'URL-shaped params found (SSRF/blind candidates) but no OAST callback host is configured.',
      priority: 'medium',
      techniqueIds: ['ssrf', 'oast', 'cloud'],
    })
  }
  if (workflows.length > 0 && workflows.some((w) => w.steps.length > 1)) {
    missing.push({
      context: 'workflow-steps',
      reason: 'Multi-step workflows exist. Confirm the expected order and actor per step before testing ordering logic.',
      priority: 'medium',
      techniqueIds: ['workflow', 'business', 'logic'],
    })
  }
  if (signalInfo.graphqlEndpoints.length > 0) {
    missing.push({
      context: 'graphql-schema',
      reason: `GraphQL surface(s) found (${signalInfo.graphqlEndpoints.length}). Introspect the schema before mutation-level testing.`,
      priority: 'low',
      techniqueIds: ['graphql'],
    })
  }

  return missing
}

// ─── Skills ──────────────────────────────────────────────────────────

function recommendSkills(
  signals: AttackSurfaceSignal[],
  allSkills: SkillMeta[],
): Array<{ id: string; name: string; domain: string; reason: string }> {
  const signalTokens = new Set<string>()
  for (const s of signals) {
    for (const tok of s.name.split('-')) {
      if (tok.length > 2) signalTokens.add(tok)
    }
  }
  const out: Array<{ id: string; name: string; domain: string; reason: string }> = []
  for (const skill of allSkills) {
    const hay = `${skill.id} ${skill.name} ${skill.domain} ${skill.description}`.toLowerCase()
    for (const tok of signalTokens) {
      if (hay.includes(tok)) {
        out.push({
          id: skill.id,
          name: skill.name,
          domain: skill.domain,
          reason: `matches signal: ${tok}`,
        })
        break
      }
    }
  }
  return out.slice(0, 12)
}

// ─── Entry point ─────────────────────────────────────────────────────

export function diagnoseTargetState(input: DiagnosisInput): DiagnosisProfile {
  const store = input.graphStore ?? (getGlobalGraphStore() as GraphStore)
  const eps = readEndpoints(store, input.target)
  const relations = readRelations(store)

  const authFlows = (store.queryNodes(NodeType.AUTH_FLOW) as Array<any>) ?? []
  const rbacRoles = (store.queryNodes(NodeType.RBAC_ROLE) as Array<any>) ?? []
  const findings = (store.queryNodes(NodeType.FINDING) as Array<any>) ?? []
  const candidates = (store.queryNodes(NodeType.CANDIDATE_FINDING) as Array<any>) ?? []
  const workflows = ((store.queryNodes(NodeType.WORKFLOW) as Array<any>) ?? []).map((w) => ({
    id: w.id,
    name: w.properties?.name,
    steps: Array.isArray(w.properties?.steps) ? (w.properties.steps as any[]).map((s) => s?.action ?? String(s)) : [],
    relatedEndpoints: Array.isArray(w.properties?.relatedEndpoints) ? w.properties.relatedEndpoints : [],
    requiredAuth: w.properties?.requiredAuth,
  }))

  const roles = [...new Set<string>(rbacRoles.map((r) => r.properties?.roleName).filter(Boolean))]
  const authTypes = [...new Set<string>(eps.flatMap((e) => (e.authType ? [e.authType] : [])))]
  const hasAuth = eps.some((e) => e.authRequired || e.authType) || authFlows.length > 0

  const signalInfo = buildSignals(eps, relations)
  let oastConfigured = !!input.oastHost
  if (!oastConfigured) {
    try {
      const url = getOastUrl()
      oastConfigured = !!url && url !== 'http://oast-not-started'
    } catch {
      oastConfigured = false
    }
  }

  const missingContext = buildMissingContext(
    eps,
    signalInfo,
    hasAuth,
    roles,
    oastConfigured,
    workflows,
  )

  const includeSkills = input.includeSkills ?? true
  const includePrimitives = input.includePrimitives ?? true
  const allSkills = includeSkills ? getAllSkills() : []

  let ranked: TechniqueCandidate[] = []
  if (includePrimitives) {
    const primitiveMeta = listPrimitiveMetadata()
    ranked = rankTechniqueCandidates(
      {
        signals: signalInfo.signals,
        objectIdParams: signalInfo.objectIdParams,
        urlLikeParams: signalInfo.urlLikeParams,
        graphqlEndpoints: signalInfo.graphqlEndpoints,
        stateChangingEndpoints: signalInfo.stateChangingEndpoints,
        authBound: eps.filter((e) => e.authRequired || e.authType).length > 0,
        hasSecondOrder: relations.some((r) => r.type === EdgeType.REINGESTS || r.type === EdgeType.VALUE_ORIGIN),
        hasWorkflowOrder: relations.some((r) => r.type === EdgeType.ORDERED_BEFORE),
        hasOast: oastConfigured,
        hasSerialized: signalInfo.signals.some((s) => s.name === 'serialized-content'),
        hasCustomHeader: signalInfo.signals.some((s) => s.name === 'custom-header' || s.name === 'proxy-hint'),
        workflows: workflows.length,
        missingContext,
      },
      primitiveMeta,
      { maxCandidates: input.maxCandidates },
    )
  }

  return {
    target: input.target,
    summary: {
      endpointCount: eps.length,
      authFlowCount: authFlows.length,
      rbacRoleCount: rbacRoles.length,
      findingCount: findings.length,
      candidateFindingCount: candidates.length,
      workflowCount: workflows.length,
      relationCount: relations.length,
      hasEndpoints: eps.length > 0,
      hasAuth,
    },
    knownContext: {
      endpoints: eps,
      authTypes,
      roles,
      authFlows: authFlows.map((f: any) => f.properties?.flowType ?? f.id).filter(Boolean),
      workflows,
      relations: relations.map((r) => ({
        type: r.type,
        fromId: r.fromId,
        toId: r.toId,
        fromUrl: r.fromUrl,
        toUrl: r.toUrl,
      })),
      findings: findings.map((f: any) => ({
        id: f.id,
        technique: f.properties?.technique ?? f.properties?.type ?? 'unknown',
        endpoint: f.properties?.endpoint,
        severity: f.properties?.severity ?? 'info',
      })),
      objectIdParams: signalInfo.objectIdParams,
      urlLikeParams: signalInfo.urlLikeParams,
      graphqlEndpoints: signalInfo.graphqlEndpoints,
      stateChangingEndpoints: signalInfo.stateChangingEndpoints,
      hasOast: oastConfigured,
      hasReachability: relations.some((r) => r.type === EdgeType.REACHES || r.type === EdgeType.SESSION_REACHES),
    },
    missingContext,
    attackSurfaces: signalInfo.signals,
    rankedTechniques: ranked,
    recommendedSkills: recommendSkills(signalInfo.signals, allSkills),
    recommendedPrimitives: ranked.map((c) => c.primitiveId).filter((p): p is string => !!p),
    recommendedWorkers: ranked.filter((c) => c.execution === 'worker').map((c) => c.workerId).filter((w): w is string => !!w),
  }
}
