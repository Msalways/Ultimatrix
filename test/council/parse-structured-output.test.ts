import { describe, it, expect } from 'vitest'
import { parseStructuredOutput } from '../../src/council/factory'

describe('parseStructuredOutput — claim extraction (B1)', () => {
  it('extracts a finding claim from a propose block', () => {
    const raw = [
      'I found SQL injection on the login endpoint.',
      '```json',
      JSON.stringify({
        intent: 'propose',
        proposal: {
          action: 'Exploit SQLi on /login',
          skillId: 'injection',
          endpointId: 'ep-1',
          complexity: 'high',
          impact: 'high',
          reasoning: 'reflected',
          evidenceRequired: [],
        },
        claim: {
          type: 'vuln',
          endpoint: 'https://x/login',
          param: 'user',
          method: 'POST',
          observed: { method: 'POST', url: 'https://x/login', status: 200 },
        },
      }),
      '```',
    ].join('\n')

    const out = parseStructuredOutput(raw)
    expect(out.intent).toBe('propose')
    expect(out.claim).toBeDefined()
    expect(out.claim!.type).toBe('vuln')
    expect(out.claim!.endpoint).toBe('https://x/login')
    expect(out.claim!.param).toBe('user')
    expect(out.claim!.method).toBe('POST')
    expect(out.claim!.observed?.url).toBe('https://x/login')
    expect(out.claim!.observed?.status).toBe(200)
  })

  it('leaves claim undefined for action-only proposals (no claim emitted)', () => {
    const raw = JSON.stringify({
      intent: 'propose',
      proposal: { action: 'recon', skillId: 'recon', complexity: 'low', impact: 'low', reasoning: '', evidenceRequired: [] },
    })
    const out = parseStructuredOutput(raw)
    expect(out.claim).toBeUndefined()
  })

  it('falls back to propose when JSON is malformed (claim not fabricated)', () => {
    const out = parseStructuredOutput('no json here')
    expect(out.intent).toBe('propose')
    expect(out.claim).toBeUndefined()
  })

  it('C2: fail-closed defaults when propose fields are missing (no fabricated claim)', () => {
    const raw = JSON.stringify({
      intent: 'propose',
      proposal: { action: 'recon' },
    })
    const out = parseStructuredOutput(raw)
    expect(out.intent).toBe('propose')
    // Missing impact → safe default 'low'; missing complexity → 'medium'.
    expect(out.proposal?.impact).toBe('low')
    expect(out.proposal?.complexity).toBe('medium')
    // Missing claim is NOT invented.
    expect(out.claim).toBeUndefined()
  })

  it('C4: parses intent=escalate with reflection (no free-text scanning)', () => {
    const raw = JSON.stringify({
      intent: 'escalate',
      reflection: { whatWorked: ['x'], whatFailed: [], whatLearned: [], nextSteps: [] },
    })
    const out = parseStructuredOutput(raw)
    expect(out.intent).toBe('escalate')
    expect(out.reflection).toBeDefined()
    expect(out.reflection?.whatWorked).toEqual(['x'])
  })

  it('C4: invalid intent fails closed to propose (rigid, no meaning detection)', () => {
    const raw = JSON.stringify({ intent: 'please-run-this-now', proposal: { action: 'recon', skillId: 'recon', complexity: 'low', impact: 'low', reasoning: '', evidenceRequired: [] } })
    const out = parseStructuredOutput(raw)
    expect(out.intent).toBe('propose')
  })

  it('C4: invalid complexity fails closed to medium → balanced tier', () => {
    const raw = JSON.stringify({
      intent: 'propose',
      proposal: { action: 'recon', skillId: 'recon', complexity: 'BOGUS', impact: 'low', reasoning: '', evidenceRequired: [] },
    })
    const out = parseStructuredOutput(raw)
    expect(out.proposal?.complexity).toBe('medium')
  })
})
