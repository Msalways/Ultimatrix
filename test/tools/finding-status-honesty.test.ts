/**
 * A finding is not 'verified' because nothing stopped it from being verified.
 *
 * Verified live against OWASP Juice Shop (own container, 2026-09-28). The system
 * produced 29 capture-only secret leads and every one came out marked:
 *
 *   lifecycleStatus = 'verified'   confirmed = undefined
 *   evidenceLevel   = 'L4'         evidence   = ["[HAR entry 2] {method,url,status}"]
 *
 * The evidence proves a URL was fetched. It does not prove a secret exists in
 * it — the sample read `api_key = api_key`, a keyword match on a JS file that
 * merely contains the string "api_key", including two false positives on a
 * translation file.
 *
 * The defect was one expression: 'verified' was assigned to everything that was
 * not 'pending_verification', so it meant "not pending", not "proven". These
 * tests pin the corrected decision directly, with no evidence-pipeline plumbing,
 * because the whole point of the change is that the decision is now explicit.
 */
import { describe, it, expect } from 'vitest'
import { deriveBornLifecycleStatus } from '../../src/tools/control-tools'

const capture = (type: string) => [{ type }]
const harCapture = capture('har_entry')
const provenImpact = [...harCapture, ...capture('browser_effect')]

describe('what status a finding is born with', () => {
  it('a capture-only claim is a lead, not a verified finding', () => {
    // The live defect: every one of these came out 'verified'.
    expect(deriveBornLifecycleStatus('info', 'L4', harCapture)).toBe('candidate')
    expect(deriveBornLifecycleStatus('low', 'L4', harCapture)).toBe('candidate')
    expect(deriveBornLifecycleStatus('medium', 'L3', harCapture)).toBe('candidate')
  })

  it('a claim that demonstrated consequence in the app is verified', () => {
    expect(deriveBornLifecycleStatus('info', 'L4', provenImpact)).toBe('verified')
    expect(deriveBornLifecycleStatus('medium', 'L4', provenImpact)).toBe('verified')
  })

  it('a screenshot counts as demonstrated consequence', () => {
    expect(deriveBornLifecycleStatus('low', 'L3', [...harCapture, ...capture('screenshot')]))
      .toBe('verified')
  })

  it('high or critical with no evidence at all is pending, never verified', () => {
    expect(deriveBornLifecycleStatus('high', 'L1', [])).toBe('pending_verification')
    expect(deriveBornLifecycleStatus('critical', 'L1', [])).toBe('pending_verification')
  })

  it('high or critical routes to the verifier even with proven impact', () => {
    // Promotion on a serious claim is the verifier's independent replay, not the
    // writer's own belief — otherwise "verified" would just mean "confident".
    expect(deriveBornLifecycleStatus('critical', 'L4', provenImpact)).toBe('verified')
    expect(deriveBornLifecycleStatus('high', 'L4', provenImpact)).toBe('verified')
    // ...but a serious claim resting on nothing is still pending.
    expect(deriveBornLifecycleStatus('critical', 'L1', harCapture)).toBe('pending_verification')
  })

  it('text-only evidence never reaches verified', () => {
    // Prose is an assertion, not an observation.
    expect(deriveBornLifecycleStatus('info', 'L2', capture('text'))).toBe('candidate')
    expect(deriveBornLifecycleStatus('medium', 'L2', capture('text'))).toBe('candidate')
  })

  it('a request/response pair is still only a capture', () => {
    // raw_request and raw_response are the strongest thing a passive observer
    // produces, and they are still not proof that the application misbehaved.
    const pair = [...capture('raw_request'), ...capture('raw_response')]
    expect(deriveBornLifecycleStatus('info', 'L4', pair)).toBe('candidate')
    expect(deriveBornLifecycleStatus('medium', 'L4', pair)).toBe('candidate')
  })
})
