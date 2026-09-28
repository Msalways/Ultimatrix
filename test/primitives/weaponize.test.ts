import { describe, it, expect, vi, beforeEach } from 'vitest'

// W2 — weaponization seam tests: a confirmed primitive that emits session/data
// artifacts must (a) carry them on the PrimitiveResult, and (b) have the runner
// persist a reusable AUTH_FLOW node + fold the data into the proof's impact via
// the single commit seam (no per-primitive graph calls).

const addAuthFlow = vi.fn()
const writeFinding = vi.fn(async () => ({ ok: true }))
const recordEvidence = vi.fn(async () => ({ ok: true }))
const fakeStore: any = {
  addAuthFlow,
  queryNodes: vi.fn(() => []),
  addRenderedElement: vi.fn(),
}

vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => fakeStore }))
vi.mock('../../src/workspace', () => ({
  getGlobalWorkspace: () => ({
    getCurrentTarget: () => 'https://t.example',
    getTargetDir: () => '/tmp',
    getGraphStore: () => fakeStore,
  }),
}))
vi.mock('../../src/tools/control-tools', () => ({
  setEvidenceGateForFindings: vi.fn(),
  recordEvidence: { execute: (...a: any[]) => (recordEvidence as any)(...a) },
  writeFinding: { execute: (...a: any[]) => (writeFinding as any)(...a) },
}))
vi.mock('../../src/tools/http-tools', () => ({
  httpRequest: {
    execute: async (req: any) => ({
      ok: true,
      status: req?.method === 'POST' ? 200 : 200,
      headers: { 'set-cookie': 'sess=abc123; Path=/; HttpOnly' },
      body: '{"role":"admin","data":"VICTIM_SECRET"}',
    }),
  },
}))

import { EvidenceGate } from '../../src/intelligence/evidence-gate'
import {
  getPrimitive,
  registerPrimitive,
  runPrimitive,
  type TechniquePrimitive,
  type AttackStep,
  type TechniqueContext,
  type PrimitiveResult,
} from '../../src/primitives/framework'
import { runPrimitiveById } from '../../src/primitives/index'

const gate = new EvidenceGate()

beforeEach(() => {
  gate.clear()
  addAuthFlow.mockClear()
  writeFinding.mockClear()
  recordEvidence.mockClear()
})

const weaponPrim: TechniquePrimitive = {
  id: 'w2-weapon',
  name: 'w2 weapon',
  description: 'emits session + data artifacts',
  appliesTo: () => true,
  generate: async () => [
    {
      id: 's1',
      description: 'login as admin',
      request: {
        method: 'POST',
        url: 'https://t.example/login',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ user: 'admin', pass: 'x' }),
      },
      expectedSignal: 'admin session',
      metadata: { kind: 'login' },
    },
  ],
  oracle: async (results, g) => {
    const r = results[0]
    // Back the claim with the structured ledger (evidence-gate contract).
    g.recordObserved({
      endpoint: r.step.request.url,
      request: { method: r.step.request.method, url: r.step.request.url, headers: r.step.request.headers, body: r.step.request.body },
      response: { status: r.status ?? 200, headers: r.headers, body: r.body },
      observed: { method: r.step.request.method, url: r.step.request.url, status: r.status ?? 200, headers: r.headers },
    })
    const { verified } = g.verifyClaim({
      type: 'auth_bypass',
      statement: 'recovered admin session',
      endpoint: r.step.request.url,
      method: r.step.request.method,
      observed: { status: r.status ?? 200 },
    })
    const res: PrimitiveResult = {
      confirmed: verified,
      confidence: verified ? 0.9 : 0,
      evidence: [{ kind: 'response', label: 'admin session', data: r.body ?? '' }],
      severity: 'critical',
      finding: verified
        ? {
            category: 'auth_bypass',
            description: 'recovered admin session',
            request: r.step.request,
            response: { status: r.status ?? 200, body: r.body ?? '' },
            cwe: 'CWE-287',
          }
        : undefined,
      exploitProof: verified
        ? {
            scenario: 'auth bypass',
            request: `${r.step.request.method} ${r.step.request.url}`,
            response: `HTTP ${r.status}\n${r.body}`,
            impact: 'Obtained an authenticated admin session.',
          }
        : undefined,
      // W2 artifacts
      sessionArtifact: verified
        ? { flowType: 'login', reusable: true, headers: { cookie: 'sess=abc123' }, credentialHash: 'deadbeef' }
        : undefined,
      dataArtifact: verified
        ? { kind: 'victim-data', label: 'admin object', data: 'ROLE=admin; SECRET=VICTIM_SECRET' }
        : undefined,
    }
    return res
  },
}

describe('W2 weaponization seam', () => {
  it('primitive emits sessionArtifact + dataArtifact on confirmation (oracle layer)', async () => {
    registerPrimitive(weaponPrim)
    const res = await runPrimitive(weaponPrim, {}, async (s: AttackStep) => {
      const headers: Record<string, string> = { 'set-cookie': 'sess=abc123; Path=/; HttpOnly' }
      return {
        step: s,
        ok: true,
        status: 200,
        headers,
        body: '{"role":"admin","data":"VICTIM_SECRET"}',
      }
    }, gate)
    expect(res.confirmed).toBe(true)
    expect(res.sessionArtifact?.reusable).toBe(true)
    expect(res.sessionArtifact?.headers.cookie).toContain('sess=abc123')
    expect(res.dataArtifact?.kind).toBe('victim-data')
    expect(res.dataArtifact?.data).toContain('VICTIM_SECRET')
  })

  it('does not report a primitive confirmation when the commit gate rejects persistence', async () => {
    registerPrimitive(weaponPrim)
    writeFinding.mockResolvedValueOnce({ ok: false, error: 'proven experiment required' })
    const out = await runPrimitiveById('w2-weapon', { target: 'https://t.example/login' }, { commit: true, gate })
    expect(out.ok).toBe(false)
    expect(out.reason).toContain('proven experiment required')
  })

  it('runner persists reusable AUTH_FLOW + folds data into proof impact (commit seam, no per-primitive graph calls)', async () => {
    registerPrimitive(weaponPrim)
    const out = await runPrimitiveById('w2-weapon', { target: 'https://t.example/login' }, { commit: true, gate })
    expect(out.ok).toBe(true)
    expect(out.result?.confirmed).toBe(true)
    // single persistence seam: AUTH_FLOW node created for the reusable session
    expect(addAuthFlow).toHaveBeenCalledTimes(1)
    const flowArg = addAuthFlow.mock.calls[0][0]
    expect(flowArg.flowType).toBe('login')
    expect(flowArg.reusable).toBe(true)
    expect(flowArg.credentialHash).toBe('deadbeef')
    // writeFinding received the proof with victim data folded into impact
    expect(writeFinding).toHaveBeenCalled()
    const wf = writeFinding.mock.calls[0][0]
    expect(wf.exploitProof).toBeTruthy()
    expect(wf.exploitProof.impact).toContain('VICTIM_SECRET')
  })
})

describe('nested endpoint context survival (loop → primitive)', () => {  it('a nested endpoint object (url/method/params) arrives intact at the primitive', async () => {
    let seen: TechniqueContext | undefined
    const probe: TechniquePrimitive = {
      id: 'w2-ctx-probe',
      name: 'ctx probe',
      description: 'captures context',
      appliesTo: (ctx) => Boolean(ctx.param && ctx.endpoint?.params?.length),
      generate: async (ctx) => {
        seen = ctx
        return []
      },
      oracle: async (_r, _g) => ({ confirmed: false, confidence: 0, evidence: [] }),
    }
    registerPrimitive(probe)
    const out = await runPrimitiveById('w2-ctx-probe', {
      target: 'https://t.example/r',
      endpoint: { url: 'https://t.example/r', method: 'POST', params: [{ name: 'a' }] },
      param: 'a',
    }, { commit: false, gate })
    expect(out.ok).toBe(true)
    expect(seen?.endpoint).toMatchObject({ url: 'https://t.example/r', method: 'POST', params: [{ name: 'a' }] })
    expect(seen?.param).toBe('a')
  })

  it('flat endpoint keys keep precedence over the nested object', async () => {
    let seen: TechniqueContext | undefined
    const probe: TechniquePrimitive = {
      id: 'w2-ctx-probe2',
      name: 'ctx probe 2',
      description: 'captures context',
      appliesTo: () => true,
      generate: async (ctx) => {
        seen = ctx
        return []
      },
      oracle: async (_r, _g) => ({ confirmed: false, confidence: 0, evidence: [] }),
    }
    registerPrimitive(probe)
    await runPrimitiveById('w2-ctx-probe2', {
      target: 'https://t.example/r',
      endpointUrl: 'https://t.example/flat',
      endpointMethod: 'PUT',
      endpoint: { url: 'https://t.example/nested', method: 'POST', params: [{ name: 'a' }] },
    }, { commit: false, gate })
    expect(seen?.endpoint?.url).toBe('https://t.example/flat')
    expect(seen?.endpoint?.method).toBe('PUT')
  })
})

describe('classicInjection payload-class gating (precision fire)', () => {
  const base = {
    endpoint: { url: 'https://t.example/r', method: 'GET' },
    param: 'q',
    technique: 'xss',
  } as any

  it('pinned xss fires only its class: no blind/time/canonical-sqli steps', async () => {
    const { classicInjection } = await import('../../src/primitives/classicInjection')
    const steps = await classicInjection.generate({ ...base, payloadSet: { category: 'xss/reflected' } })
    const ids = steps.map(s => s.id)
    expect(ids.some(id => id.startsWith('xss-'))).toBe(true)
    expect(ids.filter(id => id.startsWith('sqli-blind') || id === 'sqli-time' || id === 'sqli-multipart')).toEqual([])
    const bodies = steps.map(s => `${s.request.url} ${s.request.body ?? ''}`.toLowerCase())
    expect(bodies.some(b => /union|sleep|order by|group by|'\s*or\s*'/i.test(b))).toBe(false)
  })

  it('pinned sqli fires only its class: no reflection steps', async () => {
    const { classicInjection } = await import('../../src/primitives/classicInjection')
    const steps = await classicInjection.generate({ ...base, payloadSet: { category: 'sqli/union-based' } })
    const ids = steps.map(s => s.id)
    expect(ids.some(id => id.startsWith('sqli-'))).toBe(true)
    expect(ids.filter(id => id.startsWith('xss-'))).toEqual([])
  })

  it('unpinned callers keep the exact historical volley', async () => {
    const { classicInjection } = await import('../../src/primitives/classicInjection')
    const steps = await classicInjection.generate(base)
    const ids = steps.map(s => s.id)
    expect(ids).toContain('sqli-multipart')
    expect(ids).toContain('sqli-blind-true')
    expect(ids).toContain('sqli-time')
    expect(ids.some(id => id.startsWith('xss-'))).toBe(true)
    expect(ids.some(id => id.startsWith('waf-sqli-'))).toBe(true)
  })
})
