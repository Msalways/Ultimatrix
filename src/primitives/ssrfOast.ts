/**
 * ssrfOast — Server-Side Request Forgery confirmed via OAST callback.
 *
 * Injects an OAST callback URL into likely SSRF parameters (url, target, host,
 * file, image, webhook, etc.) of the endpoint. Generator produces one step per
 * candidate parameter. Oracle consults the OAST store: if the target made an
 * outbound request to our callback, SSRF is CONFIRMED with real evidence.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { getOastUrl } from '../oast/server'
import { getGlobalOastStore } from '../oast/store'

const SSRF_PARAMS = ['url', 'target', 'host', 'file', 'path', 'image', 'img', 'avatar', 'logo', 'redirect', 'webhook', 'callback', 'proxy', 'src', 'link', 'site', 'page', 'resource', 'endpoint', 'ip']

export const ssrfOast: TechniquePrimitive = {
  id: 'ssrfOast',
  name: 'SSRF OAST Probe',
  description: 'Inject an OAST callback URL into SSRF-prone parameters and confirm SSRF via an outbound callback to our listener.',
  technique: 'ssrf',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    const params = ctx.endpoint?.params ?? []
    const hasSsrfParam = params.some(p => SSRF_PARAMS.includes(p.name.toLowerCase())) || !!ctx.param
    return hasSsrfParam || /(fetch|proxy|import|load|render|convert|webhook|download|preview|scan)/.test((ctx.endpoint?.url ?? ctx.target ?? '').toLowerCase())
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const oast = getOastUrl()
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method && ctx.endpoint.method !== 'GET' ? ctx.endpoint.method : 'GET'
    const headers = { ...(ctx.sessionHeaders ?? {}) }

    const params = (ctx.endpoint?.params ?? []).map(p => p.name)
    if (ctx.param && !params.includes(ctx.param)) params.push(ctx.param)
    if (params.length === 0) params.push(...SSRF_PARAMS.slice(0, 4))

    const candidateParams = params.filter(p => SSRF_PARAMS.includes(p.toLowerCase())).slice(0, 6)
    const used = candidateParams.length > 0 ? candidateParams : params.slice(0, 4)

    return used.map((p, i) => {
      let stepUrl = url
      try {
        const u = new URL(url)
        u.searchParams.set(p, oast)
        stepUrl = u.toString()
      } catch {
        // ignore
      }
      const body = method !== 'GET' ? JSON.stringify({ [p]: oast }) : undefined
      return {
        id: `ssrf-${i}-${p}`,
        description: `Inject OAST URL into parameter "${p}" of ${url}`,
        request: { method, url: stepUrl, headers, ...(body ? { body } : {}) },
        expectedSignal: `target makes an outbound request to ${oast}`,
        metadata: { kind: 'ssrf', param: p, oast },
      } as AttackStep
    })
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const oast = getOastUrl()
    let oastHost = ''
    try {
      oastHost = new URL(oast).host
    } catch {
      oastHost = oast.replace(/^https?:\/\//, '').split('/')[0]
    }

    const store = getGlobalOastStore()
    const callbacks = store.getAll()
    const hit = callbacks.find(cb =>
      (cb.url && (cb.url.includes(oastHost) || cb.url.includes(oast))) ||
      Object.values(cb.query ?? {}).some(v => String(v).includes(oastHost) || String(v).includes(oast)),
    )

    // Record any real callback into the proof layer.
    if (hit) {
      evidenceGate.recordToolOutput(`[OAST] callback received: ${hit.method} ${hit.url} body=${hit.body ?? ''}`)
      // Structured fact so the claim co-occurs with a recorded evidence item.
      evidenceGate.recordObserved({
        type: 'text',
        data: `url=${hit.url} body=${hit.body ?? ''}`,
        label: `OAST callback ${hit.method} ${hit.url}`,
        observed: { url: oastHost ?? oast },
      })
    }

    const { verified } = evidenceGate.verifyClaim(claimFor('ssrf', oastHost ?? oast))
    const confirmed = !!hit && verified

    const evidence = hit
      ? [{
          kind: 'oast' as const,
          label: `OAST callback ${hit.method} ${hit.url}`,
          data: `url=${hit.url} headers=${JSON.stringify(hit.headers)} body=${hit.body ?? ''} sourceIp=${hit.sourceIp}`,
          ref: hit.id,
        }]
      : []

    return {
      confirmed,
      confidence: confirmed ? 0.95 : hit ? 0.6 : 0.05,
      evidence,
      severity: confirmed ? 'critical' : undefined,
      finding: confirmed
        ? {
            category: 'ssrf',
            description: `SSRF confirmed on ${results[0]?.step.request.url ?? ''}: outbound OAST callback received from ${hit.sourceIp} (${hit.method} ${hit.url}).`,
            request: results[0]?.step.request,
            cwe: 'CWE-918',
          }
        : undefined,
      note: hit ? `OAST callback id=${hit.id} from ${hit.sourceIp}` : `no OAST callback; oastHost=${oastHost}`,
    }
  },
}
