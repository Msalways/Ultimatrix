/**
 * secondOrderSqli — second-order SQL injection.
 *
 * Stage 1 stores a payload via an input that persists it (profile/settings),
 * Stage 2 triggers it from a separate code path (search/display) that reads the
 * stored value and concatenates it into a query. Confirmed when the TRIGGER
 * response leaks a DB error or diverges (blind) from a control — proven via the
 * shared observation oracles, evidence-gated.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { observeCompare, observeParse } from './observers'
import { getPayloadStore } from '../payloads/store'

const SQLI_ERROR_MARKERS = () => getPayloadStore().getMarkers('sqli/second-order')

function urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

export const secondOrderSqli: TechniquePrimitive = {
  id: 'secondOrderSqli',
  name: 'Second-Order SQL Injection',
  description: 'Store a SQLi payload via one input, then trigger it from a separate code path that reads the stored value.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.state?.storeEndpoint && ctx.state?.triggerEndpoint)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const storeUrl = String(ctx.state?.storeEndpoint)
    const triggerUrl = String(ctx.state?.triggerEndpoint)
    const storeParam = String(ctx.state?.storeParam ?? 'name')
    const triggerParam = String(ctx.state?.triggerParam ?? 'id')
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const steps: AttackStep[] = []
    const payloads = ctx.payloadSet ?? getPayloadStore().getPayloads('sqli/second-order')
    for (const p of payloads) {
      // Stage 1: store payload.
      steps.push({
        id: `so-store-${steps.length}`,
        description: `Store payload into ${storeParam} at ${storeUrl}`,
        request: { method: 'POST', url: storeUrl, headers, body: JSON.stringify({ [storeParam]: p }) },
        expectedSignal: 'payload stored',
        metadata: { kind: 'store', param: storeParam, payload: p },
      })
      // Stage 2: trigger (control then payload via stored id).
      steps.push({
        id: `so-trigger-${steps.length}`,
        description: `Trigger stored payload at ${triggerUrl}`,
        request: { method: 'GET', url: urlWithParam(triggerUrl, triggerParam, '1'), headers },
        expectedSignal: 'DB error / divergence on trigger',
        metadata: { kind: 'trigger', param: triggerParam, payload: p },
      })
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const triggers = results.filter((r) => r.step.metadata?.kind === 'trigger')
    let hit = false
    const evidence: PrimitiveResult['evidence'] = []
    for (const r of triggers) {
      const lower = (r.body ?? '').toLowerCase()
      const markers = SQLI_ERROR_MARKERS()
      const leaked = markers.some((m) => lower.includes(m))
      const parsed = await observeParse(r.body ?? '', r.headers ?? {}, r.status ?? 0)
      const errLeak = parsed.textSnippets.some((s) => markers.some((m) => s.toLowerCase().includes(m)))
      if ((leaked || errLeak) && (r.status ?? 500) < 500) {
        hit = true
        evidence.push({ kind: 'response', label: `2nd-order SQLi triggered ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1200) })
        break
      }
    }
    const rep = triggers[0] ?? results[0]
    const { verified } = evidenceGate.verifyClaim(claimFor('second_order_sqli', rep?.step.request.url, rep?.status, rep?.step.request.method))
    const confirmed = hit && verified
    return {
      confirmed, confidence: confirmed ? 0.85 : hit ? 0.4 : 0.05, evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed ? { category: 'sql_injection', description: `Second-order SQL injection confirmed on ${rep?.step.request.url}.`, cwe: 'CWE-89' } : undefined,
      note: `hit=${hit} verified=${verified}`,
    }
  },
}
