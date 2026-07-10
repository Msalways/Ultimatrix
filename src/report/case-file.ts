import { NodeType } from '../graph/schema'
import type { FindingNode, EndpointNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ForensicLog } from '../logging/forensic-log'

export interface CaseFileFinding {
  id: string
  type: string
  endpoint: string
  method: string
  severity: string
  confidence: number
  evidence: string[]
  lifecycleStatus: string
  evidenceLevel: string
  cwe?: string
  remediation?: string
}

export interface CaseFileDecision {
  timestamp: number
  phase: string
  toolName?: string
  reason?: string
}

export interface CaseFile {
  metadata: {
    target: string
    generatedAt: string
    durationMs?: number
    totalFindings: number
    totalEndpoints: number
  }
  findings: CaseFileFinding[]
  decisionLog: CaseFileDecision[]
  endpoints: Array<{
    url: string
    method: string
    authRequired: boolean
    authType?: string
  }>
}

export function generateCaseFile(
  graphStore: GraphStore,
  target: string,
  forensicLog?: ForensicLog,
  durationMs?: number,
): CaseFile {
  const findings = graphStore.queryNodes(NodeType.FINDING) as FindingNode[]
  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]

  const caseFindings: CaseFileFinding[] = findings.map(f => ({
    id: f.properties.findingId ?? f.id,
    type: f.properties.technique,
    endpoint: f.properties.endpoint,
    method: 'GET',
    severity: f.properties.severity,
    confidence: f.properties.confidence ?? 0,
    evidence: f.properties.evidence ?? [],
    lifecycleStatus: f.properties.lifecycleStatus ?? 'unknown',
    evidenceLevel: f.properties.evidenceLevel ?? 'L1',
    ...(f.properties.cwe ? { cwe: f.properties.cwe } : {}),
    ...(f.properties.remediation ? { remediation: f.properties.remediation } : {}),
  }))

  const decisions: CaseFileDecision[] = []
  if (forensicLog) {
    const entries = forensicLog.getEntries?.() ?? []
    for (const entry of entries) {
      if (entry.type === 'solver-phase' || entry.type === 'tool-call') {
        decisions.push({
          timestamp: entry.timestamp ?? Date.now(),
          phase: entry.phase ?? entry.type,
          toolName: entry.tool,
          reason: entry.reason,
        })
      }
    }
  }

  return {
    metadata: {
      target,
      generatedAt: new Date().toISOString(),
      durationMs,
      totalFindings: caseFindings.length,
      totalEndpoints: endpoints.length,
    },
    findings: caseFindings,
    decisionLog: decisions,
    endpoints: endpoints.map(ep => ({
      url: ep.properties.url,
      method: ep.properties.method,
      authRequired: ep.properties.authRequired ?? false,
      authType: ep.properties.authType,
    })),
  }
}
