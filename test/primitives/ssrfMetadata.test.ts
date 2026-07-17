import { describe, it, expect } from 'vitest'
import { ssrfMetadata } from '../../src/primitives/ssrfMetadata'
import { runPrimitive } from '../../src/primitives/framework'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import type { AttackStep, StepExecutionResult, TechniqueContext } from '../../src/primitives/framework'

const METADATA_IP = '169.254.169.254'

/** Fake executor: when vulnerable, return a 200 with a metadata signature. */
function fakeExecutor(vulnerable: boolean, mode: 'basic' | 'creds' = 'basic'): (step: AttackStep) => Promise<StepExecutionResult> {
  return async (step: AttackStep): Promise<StepExecutionResult> => {
    if (!vulnerable) {
      return { step, ok: true, status: 403, body: 'blocked: outbound request denied' }
    }
    const kind = (step.metadata as any)?.kind as string
    if (kind === 'ssrf-imdsv2-creds' && mode === 'creds') {
      return {
        step,
        ok: true,
        status: 200,
        body:
          '{"Code":"Success","LastUpdated":"...","Type":"AWS-HMAC","AccessKeyId":"AKIAIOSFODNN7EXAMPLE","SecretAccessKey":"wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY","Token":"..."}',
      }
    }
    if (kind === 'ssrf-basic' || kind === 'ssrf-basic-meta' || kind === 'ssrf-imdsv2-token') {
      return { step, ok: true, status: 200, body: `instance-id i-1234; local-ipv4 ${METADATA_IP} ami-id` }
    }
    return { step, ok: true, status: 200, body: `reachable ${METADATA_IP}` }
  }
}

const ctx: TechniqueContext = {
  endpoint: { url: 'https://api.example.com/fetch', method: 'GET' },
  sessionHeaders: { Authorization: 'Bearer ACTOR' },
}

describe('ssrfMetadata', () => {
  it('appliesTo returns true for any endpoint/target context', () => {
    expect(ssrfMetadata.appliesTo(ctx)).toBe(true)
    expect(ssrfMetadata.appliesTo({ target: 'https://api.example.com' } as TechniqueContext)).toBe(true)
  })

  it('generates the three expected metadata attack steps', async () => {
    const steps = await ssrfMetadata.generate(ctx)
    const ids = steps.map((s) => s.id)
    expect(ids).toContain('ssrf-basic')
    expect(ids).toContain('ssrf-imdsv2-token')
    expect(ids).toContain('ssrf-imdsv2-creds')
    const basic = steps.find((s) => s.id === 'ssrf-basic')!
    expect(basic.request.url).toContain('169.254.169.254')
    expect(basic.request.url).toContain('url=')
    const creds = steps.find((s) => s.id === 'ssrf-imdsv2-creds')!
    expect(creds.request.headers?.['X-aws-ec2-metadata-token']).toBeTruthy()
  })

  it('confirms SSRF + high severity when the metadata IP is reflected (no creds)', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(ssrfMetadata, ctx, fakeExecutor(true, 'basic'), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('high')
    expect(res.finding?.category).toBe('ssrf')
    expect(res.finding?.cwe).toBe('CWE-918')
    expect(res.note).toContain('verified=true')
  })

  it('confirms critical severity when IAM credential material is exfiltrated', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(ssrfMetadata, ctx, fakeExecutor(true, 'creds'), gate)
    expect(res.confirmed).toBe(true)
    expect(res.severity).toBe('critical')
    expect(res.note).toContain('credsExposed=true')
  })

  it('does not confirm when all steps are blocked (no signature)', async () => {
    const gate = new EvidenceGate()
    const res = await runPrimitive(ssrfMetadata, ctx, fakeExecutor(false), gate)
    expect(res.confirmed).toBe(false)
    expect(res.finding).toBeUndefined()
  })
})
