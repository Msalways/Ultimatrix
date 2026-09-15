/**
 * Graph Summarizer — compress large graph into context-friendly summaries.
 *
 * When graph exceeds context budget, auto-aggregate:
 *   - Endpoints by path shape (/api/users/:id → count)
 *   - Findings by severity (Critical: list all, High: count, Med/Low: aggregate)
 *   - Tests by result (passed/failed/pending counts)
 *
 * Purpose: Stay under context limits without losing actionable information.
 */

import { NodeType, type EndpointNode, type FindingNode } from '../graph/schema'

export interface GraphSummary {
  endpoints: {
    total: number
    byShape: Array<{ pattern: string; count: number; methods: string[] }>
    topHosts: Array<{ host: string; count: number }>
  }
  findings: {
    total: number
    bySeverity: Record<string, number>
    critical: Array<{ title: string; endpoint: string; technique: string }>
    highCount: number
    mediumLowCount: number
  }
  attacks: {
    total: number
    byTechnique: Record<string, number>
  }
  contextTokens: number // estimated token count for the summary
}

function extractPathPattern(path: string): string {
  // /api/users/123 → /api/users/:id
  return path
    .replace(/\/[0-9a-f]{24,}/g, '/:id')  // MongoDB ObjectId
    .replace(/\/\d+/g, '/:id')             // Numeric IDs
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:uuid')
}

function extractHost(url: string): string {
  try { return new URL(url).host } catch { return 'unknown' }
}

export function summarizeGraph(
  endpoints: EndpointNode[],
  findings: FindingNode[],
  attacks: any[],
): GraphSummary {
  // ── Endpoints ──
  const shapeMap = new Map<string, { count: number; methods: Set<string> }>()
  const hostMap = new Map<string, number>()

  for (const ep of endpoints) {
    const props = ep.properties as Record<string, unknown>
    const url = String(props.url ?? '')
    const method = String(props.method ?? 'GET')
    const shape = extractPathPattern(url)
    const host = extractHost(url)

    const existing = shapeMap.get(shape) ?? { count: 0, methods: new Set() }
    existing.count++
    existing.methods.add(method)
    shapeMap.set(shape, existing)

    hostMap.set(host, (hostMap.get(host) ?? 0) + 1)
  }

  const byShape = Array.from(shapeMap.entries())
    .map(([pattern, { count, methods }]) => ({ pattern, count, methods: [...methods] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  const topHosts = Array.from(hostMap.entries())
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)

  // ── Findings ──
  const severityMap: Record<string, number> = {}
  const criticalFindings: GraphSummary['findings']['critical'] = []
  let highCount = 0
  let mediumLowCount = 0

  for (const f of findings) {
    const props = f.properties as Record<string, unknown>
    const sev = String(props.severity ?? 'unknown')
    severityMap[sev] = (severityMap[sev] ?? 0) + 1

    const entry = {
      title: String(props.title ?? f.label),
      endpoint: String(props.endpoint ?? ''),
      technique: String(props.technique ?? ''),
    }

    if (sev === 'critical') criticalFindings.push(entry)
    else if (sev === 'high') highCount++
    else mediumLowCount++
  }

  // ── Attacks ──
  const techniqueMap: Record<string, number> = {}
  for (const a of attacks) {
    const props = a.properties as Record<string, unknown>
    const tech = String(props.technique ?? 'unknown')
    techniqueMap[tech] = (techniqueMap[tech] ?? 0) + 1
  }

  const summary: GraphSummary = {
    endpoints: { total: endpoints.length, byShape, topHosts },
    findings: {
      total: findings.length,
      bySeverity: severityMap,
      critical: criticalFindings,
      highCount,
      mediumLowCount,
    },
    attacks: { total: attacks.length, byTechnique: techniqueMap },
    contextTokens: 0,
  }

  // Rough token estimate: ~4 chars/token
  summary.contextTokens = JSON.stringify(summary).length / 4
  return summary
}

export function formatGraphSummary(summary: GraphSummary): string {
  const lines: string[] = []

  lines.push(`## Graph Summary (${summary.endpoints.total} endpoints, ${summary.findings.total} findings)`)
  lines.push('')

  if (summary.endpoints.byShape.length > 0) {
    lines.push('### Top Endpoint Patterns')
    for (const s of summary.endpoints.byShape.slice(0, 10)) {
      lines.push(`  ${s.pattern} (${s.count}x) [${s.methods.join(', ')}]`)
    }
    lines.push('')
  }

  if (summary.findings.total > 0) {
    lines.push(`### Findings: ${Object.entries(summary.findings.bySeverity).map(([k, v]) => `${k}:${v}`).join(', ')}`)
    if (summary.findings.critical.length > 0) {
      lines.push('  CRITICAL:')
      for (const c of summary.findings.critical) {
        lines.push(`    - ${c.title} @ ${c.endpoint} [${c.technique}]`)
      }
    }
    if (summary.findings.highCount > 0) lines.push(`  ${summary.findings.highCount} high-severity findings (details in graph)`)
    if (summary.findings.mediumLowCount > 0) lines.push(`  ${summary.findings.mediumLowCount} medium/low findings`)
    lines.push('')
  }

  if (summary.attacks.total > 0) {
    lines.push(`### Attacks: ${summary.attacks.total}`)
    for (const [tech, count] of Object.entries(summary.attacks.byTechnique)) {
      lines.push(`  ${tech}: ${count}`)
    }
    lines.push('')
  }

  lines.push(`[~${summary.contextTokens} tokens]`)
  return lines.join('\n')
}
