import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'
import type { FindingNode } from '../graph/schema'

export interface ChainRule {
  name: string
  sourceTechnique: string
  targetTechnique: string
  description: string
  severity: 'critical' | 'high' | 'medium'
}

const CHAIN_RULES: ChainRule[] = [
  { name: 'xss-to-session-hijack', sourceTechnique: 'xss', targetTechnique: 'session-hijack', description: 'XSS + session cookies exposed allows session hijacking', severity: 'critical' },
  { name: 'session-hijack-to-idor', sourceTechnique: 'session-hijack', targetTechnique: 'idor', description: 'Session hijack + admin panel access enables IDOR', severity: 'critical' },
  { name: 'idor-to-privilege-escalation', sourceTechnique: 'idor', targetTechnique: 'privilege-escalation', description: 'IDOR + user data access leads to privilege escalation', severity: 'high' },
  { name: 'open-redirect-to-token-theft', sourceTechnique: 'open-redirect', targetTechnique: 'token-theft', description: 'Open redirect + auth callback enables token theft', severity: 'high' },
  { name: 'sqli-to-data-exfiltration', sourceTechnique: 'sqli', targetTechnique: 'data-exfiltration', description: 'SQL injection allows data extraction', severity: 'critical' },
  { name: 'ssrf-to-internal-scan', sourceTechnique: 'ssrf', targetTechnique: 'internal-scan', description: 'SSRF enables internal network scanning', severity: 'high' },
  { name: 'idor-to-mass-assignment', sourceTechnique: 'idor', targetTechnique: 'mass-assignment', description: 'IDOR may enable mass assignment attacks', severity: 'medium' },
]

export function detectChains(findings: FindingNode[]): Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> {
  const chains: Array<{ source: FindingNode; target: FindingNode; rule: ChainRule }> = []

  for (const source of findings) {
    const sourceTech = source.properties.technique.toLowerCase()

    for (const rule of CHAIN_RULES) {
      if (sourceTech.includes(rule.sourceTechnique)) {
        const targetsByType = findings.filter(f => {
          const t = f.properties.technique.toLowerCase()
          return t.includes(rule.targetTechnique)
        })

        for (const target of targetsByType) {
          if (source.id !== target.id) {
            chains.push({ source, target, rule })
          }
        }
      }
    }
  }

  for (const chain of chains) {
    const store = getGlobalGraphStore()
    store.chainFindings(chain.source.id, chain.target.id)
  }

  return chains
}

export function suggestFollowUp(finding: FindingNode): string[] {
  const tech = finding.properties.technique.toLowerCase()
  const suggestions: string[] = []

  if (tech.includes('sqli')) {
    suggestions.push('Extract data using UNION-based SQL injection')
    suggestions.push('Test for blind SQL injection with time-based payloads')
    suggestions.push('Attempt to write webshell via INTO OUTFILE')
  }
  if (tech.includes('xss')) {
    suggestions.push('Steal session cookies via document.cookie')
    suggestions.push('Test for stored XSS in other user-facing areas')
    suggestions.push('Attempt keylogging via XSS payload')
  }
  if (tech.includes('idor')) {
    suggestions.push('Test horizontal IDOR to other users')
    suggestions.push('Test vertical IDOR to escalate privileges')
    suggestions.push('Use IDOR to access admin functionality')
  }
  if (tech.includes('ssrf')) {
    suggestions.push('Scan internal network via SSRF')
    suggestions.push('Access cloud metadata endpoints (169.254.169.254)')
    suggestions.push('Test for blind SSRF with OAST callbacks')
  }
  if (tech.includes('jwt') || tech.includes('jot')) {
    suggestions.push('Test JWT algorithm confusion (none, HS256)')
    suggestions.push('Brute force JWT secret')
    suggestions.push('Test expired JWT token reuse')
  }

  return suggestions
}