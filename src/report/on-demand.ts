import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Finding } from '../generation/test-generator'
import { generateReport } from './generator'
import { getGlobalWorkspace } from '../workspace'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, type ExploitProofNode, type FindingNode } from '../graph/schema'

export type ReportScope = 'finding' | 'engagement'

export interface OnDemandReportResult {
  ok: boolean
  path?: string
  findingCount?: number
  error?: string
}

/** Adapt a graph FindingNode (+ its ExploitProof) into the report generator's Finding shape. */
function toReportFinding(node: FindingNode, proofs: ExploitProofNode[]): Finding {
  const p = node.properties
  const proof = proofs[0]
  const evidence: Finding['evidence'] = (p.evidence ?? []).map((e) => ({
    request: { method: 'GET', url: p.endpoint },
    response: { status: 200, body: e },
    description: e.slice(0, 200),
  }))
  if (proof) {
    evidence.push({
      request: { method: proof.properties.method, url: proof.properties.url, body: proof.properties.request },
      response: { status: 200, body: proof.properties.response ?? '' },
      description: `Exploit proof — ${proof.properties.scenario}`,
    })
  }
  const now = new Date()
  return {
    id: p.findingId,
    title: `${p.technique} on ${p.endpoint}`,
    severity: p.severity,
    category: p.technique,
    description: p.remediation ? `${p.remediation}` : `${p.technique} at ${p.endpoint}`,
    evidence,
    request: proof
      ? { method: proof.properties.method, url: proof.properties.url, headers: proof.properties.headers, body: proof.properties.request }
      : { method: 'GET', url: p.endpoint },
    response: proof?.properties.response ? { status: 200, body: proof.properties.response } : undefined,
    screenshots: p.screenshots,
    remediation: p.remediation,
    cwe: p.cwe,
    impact: proof?.properties.impact ?? p.impact,
    reproductionSteps: proof?.properties.reproSteps,
    firstSeen: now,
    lastSeen: now,
    status: p.lifecycleStatus === 'rejected' ? 'false-positive' : 'open',
  }
}

function collectFindings(scope: ReportScope, findingId?: string): { findings: Finding[]; count: number } {
  const store = getGlobalGraphStore()
  const all = (store.queryNodes(NodeType.FINDING) as FindingNode[] | undefined) ?? []
  const filtered = findingId
    ? all.filter((f) => f.properties.findingId === findingId)
    : all
  const findings = filtered.map((f) => toReportFinding(f, store.getExploitProof(f.properties.findingId)))
  return { findings, count: filtered.length }
}

/**
 * W-R — write a Markdown report to disk on demand.
 * Scope 'finding' requires findingId; scope 'engagement' covers all findings.
 * Returns the file path so callers (REPL / brain tool) can surface it in chat.
 */
export function writeOnDemandReport(scope: ReportScope, findingId?: string): OnDemandReportResult {
  const workspace = getGlobalWorkspace()
  const target = workspace.getCurrentTarget()
  if (!target) {
    return { ok: false, error: 'no active target — start an engagement first' }
  }
  const { findings, count } = collectFindings(scope, findingId)
  if (count === 0) {
    return { ok: false, error: findingId ? `no finding with id ${findingId}` : 'no findings to report' }
  }

  const dir = resolve(workspace.getTargetDir(target), 'reports')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const base = scope === 'finding' && findingId ? `report-${findingId}` : 'report-engagement'
  const path = resolve(dir, `${base}-${ts}.md`)

  const md = generateReport(findings, [], {
    format: 'markdown',
    title: scope === 'finding' ? `Ultimatrix — Finding ${findingId}` : `Ultimatrix — Engagement Report (${target})`,
    target,
  })
  writeFileSync(path, md, 'utf8')
  return { ok: true, path, findingCount: count }
}
