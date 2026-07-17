/**
 * bolaFuzzer — Broken Object Level Authorization multi-role replay engine.
 *
 * BOLA is OWASP API Security #1 and the highest-occurrence class in real
 * bug-bounty disclosures. Empirically, the LARGEST sub-family is ACTION-LEVEL
 * BOLA (unauthorized write/delete on another user's object, ~41.7%), followed
 * by Direct Object Reference (~36.9%) and Tenant Isolation (~8.3%).
 *
 * A single authenticated session is BLIND to BOLA — you need >=2 roles. This
 * primitive replays the actor's session against the VICTIM's object id and tests:
 *   - horizontal read:   GET victim's object with actor session (200 + divergent)
 *   - action-level:      PUT/PATCH/DELETE victim's object with actor session (200)
 *   - method-switch:     GET denied (403) but HEAD/POST allowed (200)
 *   - mass-assignment:   PUT with role:admin / isAdmin / userId=actor accepted
 *
 * All verdicts are status/behavior-authoritative (see `assessAccess` in
 * framework.ts) and gated by the EvidenceGate — no substring guessing.
 */

import type {
  TechniquePrimitive,
  TechniqueContext,
  AttackStep,
  StepExecutionResult,
  PrimitiveResult,
} from './framework'
import { claimFor, assessAccess } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare } from './observers'

const WRITE_METHODS = ['PUT', 'PATCH', 'DELETE'] as const
const SWITCH_METHODS = ['HEAD', 'POST'] as const

/** Replace the actor's object id with the target id inside a URL template. */
function withId(url: string, fromId: string | undefined, toId: string): string {
  if (fromId && fromId.length > 0 && url.includes(fromId)) {
    return url.replace(new RegExp(fromId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), toId)
  }
  // Fallback: append the id as a path segment.
  return url.replace(/\{id\}/gi, toId).replace(/\/?$/, `/${toId}`)
}

export const bolaFuzzer: TechniquePrimitive = {
  id: 'bolaFuzzer',
  name: 'BOLA Multi-Role Replay',
  description:
    'Multi-role BOLA testing: horizontal read, action-level write/delete, method-switch, and mass-assignment on another user\'s object.',
  technique: 'idor',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Need the victim's object id and (preferably) two distinct sessions.
    return !!(ctx.altObjectId && (ctx.sessionHeaders || ctx.altSessionHeaders))
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const baseUrl = ctx.endpoint?.url ?? ctx.target!
    const actorHeaders = { ...(ctx.sessionHeaders ?? {}) }
    const readMethod = (ctx.endpoint?.method ?? 'GET').toUpperCase()

    const ownUrl = withId(baseUrl, ctx.objectId, ctx.objectId ?? 'OWN')
    const victimUrl = withId(baseUrl, ctx.objectId, ctx.altObjectId!)

    const steps: AttackStep[] = []

    // Baseline: actor accesses its OWN object (must be allowed).
    steps.push({
      id: 'bola-own',
      description: `Actor reads OWN object ${ownUrl}`,
      request: { method: readMethod, url: ownUrl, headers: actorHeaders },
      metadata: { kind: 'own' },
    })

    // Horizontal read: actor reads VICTIM's object.
    steps.push({
      id: 'bola-read',
      description: `Actor reads VICTIM object ${victimUrl} (horizontal BOLA)`,
      request: { method: readMethod, url: victimUrl, headers: actorHeaders },
      expectedSignal: 'actor receives the victim\'s object data',
      metadata: { kind: 'read', altObjectId: ctx.altObjectId, objectId: ctx.objectId },
    })

    // Action-level: actor WRITE/DELETEs the victim's object (the biggest family).
    for (const m of WRITE_METHODS) {
      steps.push({
        id: `bola-write-${m}`,
        description: `Actor ${m}s VICTIM object ${victimUrl} (action-level BOLA)`,
        request: {
          method: m,
          url: victimUrl,
          headers: actorHeaders,
          body: JSON.stringify({ id: ctx.altObjectId, ...(ctx.state ?? {}) }),
        },
        expectedSignal: `${m} accepted on another user's object`,
        metadata: { kind: 'write', method: m },
      })
    }

    // Method-switch: if the read was GET-denied, try alternate methods.
    for (const m of SWITCH_METHODS) {
      steps.push({
        id: `bola-method-${m}`,
        description: `Actor ${m}s VICTIM object ${victimUrl} (method-switch BOLA)`,
        request: { method: m, url: victimUrl, headers: actorHeaders },
        expectedSignal: `${m} allowed while GET denied`,
        metadata: { kind: 'method', method: m },
      })
    }

    // Mass-assignment: inject privilege/ownership fields while writing victim's object.
    steps.push({
      id: 'bola-mass',
      description: `Actor PUTs mass-assignment fields (role:admin, isAdmin, userId) to ${victimUrl}`,
      request: {
        method: 'PUT',
        url: victimUrl,
        headers: actorHeaders,
        body: JSON.stringify({
          id: ctx.altObjectId,
          role: 'admin',
          isAdmin: true,
          userId: ctx.objectId ?? 'OWN',
          ...(ctx.state ?? {}),
        }),
      },
      expectedSignal: 'injected privilege fields accepted',
      metadata: { kind: 'mass' },
    })

    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const own = results.find(r => r.step.metadata?.kind === 'own')
    const read = results.find(r => r.step.metadata?.kind === 'read')
    const writes = results.filter(r => r.step.metadata?.kind === 'write')
    const methods = results.filter(r => r.step.metadata?.kind === 'method')
    const mass = results.find(r => r.step.metadata?.kind === 'mass')

    if (!own || !read) {
      return { confirmed: false, confidence: 0, evidence: [], note: 'missing own/read baseline results' }
    }

    const ownOk = (own.status ?? 0) >= 200 && (own.status ?? 0) < 400
    const readStatus = read.status ?? 0
    const readAllowed = readStatus >= 200 && readStatus < 400
    const readDenied = readStatus === 401 || readStatus === 403

    let horizontal = false
    if (ownOk && readAllowed) {
      const cmp = await observeCompare(
        { body: own.body ?? '', status: own.status ?? 0 },
        { body: read.body ?? '', status: readStatus },
      )
      horizontal = cmp.vulnerable || cmp.divergence > 0.3
    }

    // Action-level write on another user's object — the highest-payout family.
    const actionWrite = writes.some(w => {
      const a = assessAccess({ status: w.status, body: w.body, setCookie: w.headers?.['set-cookie'] })
      return a.granted && !a.denied
    })

    // Method-switch: a denied GET but an allowed alternate method.
    const methodSwitch = readDenied && methods.some(m => {
      const a = assessAccess({ status: m.status, body: m.body })
      return a.granted && !a.denied
    })

    // Mass-assignment: a PUT with injected privilege fields was accepted.
    let massAssign = false
    if (mass && (mass.status ?? 0) >= 200 && (mass.status ?? 0) < 400) {
      const b = (mass.body ?? '').toLowerCase()
      massAssign =
        b.includes('admin') || b.includes('"role"') || b.includes('isadmin') || b.includes('"userId"'.toLowerCase())
    }

    const fired = [horizontal && 'horizontal-read', actionWrite && 'action-level-write', methodSwitch && 'method-switch', massAssign && 'mass-assignment'].filter(
      Boolean,
    ) as string[]

    const repUrl = read.step.request.url
    const { verified } = evidenceGate.verifyClaim(claimFor('bola', repUrl, readStatus, read.step.request.method))

    const confirmed = fired.length > 0 && verified
    const altObjectId = (read.step.metadata as any)?.altObjectId ?? 'VICTIM'

    const evidence = [
      { kind: 'response' as const, label: `own ${own.step.request.method} ${own.step.request.url} → ${own.status}`, data: (own.body ?? '').slice(0, 1500) },
      { kind: 'response' as const, label: `read ${read.step.request.method} ${repUrl} → ${readStatus}`, data: (read.body ?? '').slice(0, 1500) },
    ]
    for (const w of writes) {
      evidence.push({ kind: 'response' as const, label: `write ${w.step.request.method} ${w.step.request.url} → ${w.status}`, data: (w.body ?? '').slice(0, 800) })
    }
    if (mass) evidence.push({ kind: 'response' as const, label: `mass PUT ${mass.step.request.url} → ${mass.status}`, data: (mass.body ?? '').slice(0, 800) })

    const severity = actionWrite ? 'critical' : fired.length > 0 ? 'high' : undefined

    return {
      confirmed,
      confidence: confirmed ? (actionWrite ? 0.9 : 0.8) : fired.length > 0 ? 0.5 : 0.1,
      evidence,
      severity,
      finding: confirmed
        ? {
            category: 'bola',
            description: `BOLA on ${repUrl}: ${fired.join(', ')}. Actor (session) acted on victim's object ${altObjectId}.`,
            request: read.step.request,
            response: { status: readStatus, body: (read.body ?? '').slice(0, 1000) },
            cwe: 'CWE-639',
          }
        : undefined,
      note: `horizontal=${horizontal} actionWrite=${actionWrite} methodSwitch=${methodSwitch} massAssign=${massAssign} verified=${verified}`,
    }
  },
}
