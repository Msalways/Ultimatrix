import type { SwarmResult } from './builder'

export function detectCrossWorkerChains(results: SwarmResult[]): any[] {
  const allFindings = results.flatMap(r => r.findings)
  if (allFindings.length === 0) return []

  // Import existing chain detection from intelligence module
  try {
    // Dynamic import to avoid circular dependency
    const { detectChains } = require('../intelligence/chaining')
    return detectChains(allFindings)
  } catch {
    // Fallback: simple chain detection
    return simpleChainDetection(allFindings)
  }
}

function simpleChainDetection(findings: any[]): any[] {
  const chains: any[] = []
  const findingsByType = new Map<string, any[]>()

  for (const f of findings) {
    const type = f.type || 'unknown'
    if (!findingsByType.has(type)) findingsByType.set(type, [])
    findingsByType.get(type)!.push(f)
  }

  // XSS + Session → Session Hijack
  const xssFindings = findingsByType.get('xss') || []
  const sessionFindings = findingsByType.get('session') || findingsByType.get('cookie') || []
  if (xssFindings.length > 0 && sessionFindings.length > 0) {
    chains.push({
      rule: { name: 'XSS → Session Hijack', severity: 'critical' },
      findings: [...xssFindings, ...sessionFindings],
    })
  }

  // SQLi → Data Extraction
  const sqliFindings = findingsByType.get('sqli') || findingsByType.get('sql-injection') || []
  if (sqliFindings.length > 0) {
    chains.push({
      rule: { name: 'SQLi → Data Extraction', severity: 'critical' },
      findings: sqliFindings,
    })
  }

  // IDOR + Auth → Privilege Escalation
  const idorFindings = findingsByType.get('idor') || []
  const authFindings = findingsByType.get('auth') || findingsByType.get('authentication') || []
  if (idorFindings.length > 0 && authFindings.length > 0) {
    chains.push({
      rule: { name: 'IDOR + Auth → Privilege Escalation', severity: 'high' },
      findings: [...idorFindings, ...authFindings],
    })
  }

  return chains
}
