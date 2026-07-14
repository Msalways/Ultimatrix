import { describe, it, expect, beforeEach } from 'vitest'
import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import { getPrimitive, runPrimitive, claimFor, type AttackStep, type StepExecutionResult } from '../../src/primitives/framework'
import { authBypass } from '../../src/primitives/authBypass'
// Importing the index registers all primitives (incl. authBypass) into the
// shared registry used by getPrimitive().
import '../../src/primitives'

const gate = new EvidenceGate()
beforeEach(() => gate.clear())

function executorFor(map: (step: AttackStep) => Partial<StepExecutionResult>) {
  return async (step: AttackStep): Promise<StepExecutionResult> => ({
    step,
    ok: true,
    status: 200,
    headers: {},
    body: '',
    ...map(step),
  })
}

const SUCCESS = { status: 200, headers: { 'set-cookie': 'session=abc123' }, body: 'welcome to your dashboard' }

describe('authBypass primitive (WS-B depth)', () => {
  it('is registered', () => {
    expect(getPrimitive('authBypass')).toBe(authBypass)
  })

  it('generates SQLi-login, default-creds, and (when sample provided) jwt-none steps', () => {
    const p = getPrimitive('authBypass')!
    const noJwt = p.generate({ url: 'https://t.example/login', method: 'POST' })
    expect(noJwt.some((s) => s.metadata?.technique === 'sqli-login')).toBe(true)
    expect(noJwt.some((s) => s.metadata?.technique === 'default-creds')).toBe(true)
    expect(noJwt.some((s) => s.metadata?.technique === 'jwt-none')).toBe(false)

    // A sample token yields a jwt-none replay step.
    const jwt = p.generate({ url: 'https://t.example/admin', method: 'GET', metadata: { sampleToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature' } })
    expect(jwt.some((s) => s.metadata?.technique === 'jwt-none')).toBe(true)
  })

  it('confirms authentication bypass when a session is issued for default creds', async () => {
    const p = getPrimitive('authBypass')!
    const res = await runPrimitive(p, { target: 'https://t.example/login', endpoint: { url: 'https://t.example/login', method: 'POST' } }, executorFor(() => SUCCESS), gate)
    expect(res.confirmed).toBe(true)
    expect(res.finding?.category).toBe('auth_bypass')
  })

  it('does NOT confirm when credentials are rejected', async () => {
    const p = getPrimitive('authBypass')!
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/login', endpoint: { url: 'https://t.example/login', method: 'POST' } },
      executorFor(() => ({ status: 401, body: 'invalid credentials' })),
      gate,
    )
    expect(res.confirmed).toBe(false)
  })

  it('forges and replays a JWT alg:none token (sample provided)', async () => {
    const p = getPrimitive('authBypass')!
    const ex = async (step: AttackStep): Promise<StepExecutionResult> => {
      if (step.metadata?.technique === 'jwt-none') return { step, ok: true, status: 200, headers: { 'set-cookie': 'session=abc' }, body: 'dashboard' }
      return { step, ok: true, status: 401, body: 'invalid credentials' }
    }
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/admin', endpoint: { url: 'https://t.example/admin', method: 'GET' }, metadata: { sampleToken: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.signature' } },
      ex,
      gate,
    )
    expect(res.confirmed).toBe(true)
  })

  it('confirms a custom localized success page (non-English, no keyword) when a session cookie is issued', async () => {
    // Anti-rigidity: body has no English 'welcome'/'dashboard'/'logout', yet the
    // session cookie is the authoritative positive signal.
    const p = getPrimitive('authBypass')!
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/login', endpoint: { url: 'https://t.example/login', method: 'POST' } },
      executorFor(() => ({ status: 200, headers: { 'set-cookie': 'session=abc123' }, body: 'Connexion réussie' })),
      gate,
    )
    expect(res.confirmed).toBe(true)
  })

  it('does NOT confirm a bare empty 200 (no cookie, no keyword) — avoids over-fire', async () => {
    const p = getPrimitive('authBypass')!
    const res = await runPrimitive(
      p,
      { target: 'https://t.example/login', endpoint: { url: 'https://t.example/login', method: 'POST' } },
      executorFor(() => ({ status: 200, headers: {}, body: '' })),
      gate,
    )
    expect(res.confirmed).toBe(false)
  })
})
