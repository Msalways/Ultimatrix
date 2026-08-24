import { NodeType } from '../graph/schema'
import type { FindingNode, EndpointNode, ExperimentNode, ExploitProofNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { ForensicLog } from '../logging/forensic-log'
import { redactHeaders, redactObject, redactString, redactUrl } from '../security/secret-vault'
import type { EvidenceOracle, ExperimentOutcome, ExperimentRetest } from '../research/types'
import packageJson from '../../package.json'

export const CASE_FILE_SCHEMA_VERSION = 1

export interface CaseFileExperiment {
  id: string
  setup: string[]
  baselineRequest: Record<string, unknown>
  mutation: string
  oracle: EvidenceOracle
  outcome: ExperimentOutcome
  retest: ExperimentRetest
}

export interface CaseFileReplay {
  method: string
  url: string
  headers?: Record<string, string>
  body?: string
  expectedVulnerableResponse?: string
  reproSteps: string[]
}

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
  proofCheck: NonNullable<FindingNode['properties']['proofCheck']>
  experiments: CaseFileExperiment[]
  replay: CaseFileReplay
  verifiedAt: string
}

export interface CaseFileDecision {
  timestamp: number
  phase: string
  toolName?: string
  reason?: string
}

export interface CaseFile {
  schemaVersion: typeof CASE_FILE_SCHEMA_VERSION
  metadata: {
    target: string
    generatedAt: string
    durationMs?: number
    totalFindings: number
    totalEndpoints: number
    toolVersions: { ultimatrix: string }
  }
  findings: CaseFileFinding[]
  incompleteCandidates: Array<{ id: string; reasons: string[] }>
  decisionLog: CaseFileDecision[]
  endpoints: Array<{
    url: string
    method: string
    authRequired: boolean
    authType?: string
  }>
}

export interface CaseFileValidation {
  valid: boolean
  errors: string[]
}

function completeFinding(store: GraphStore, finding: FindingNode): { finding?: CaseFileFinding; reasons: string[] } {
  const p = finding.properties
  const reasons: string[] = []
  if (p.lifecycleStatus !== 'verified') reasons.push('finding is not verified')
  if (!p.proofCheck?.passed) reasons.push('proof floor did not pass')
  if (!p.verifiedAt) reasons.push('verifiedAt is missing')

  const experimentIds = p.experimentIds ?? []
  if (experimentIds.length === 0) reasons.push('proven experiment is missing')
  const experiments: CaseFileExperiment[] = []
  for (const id of experimentIds) {
    const node = store.getNode(id) as ExperimentNode | undefined
    if (!node || node.type !== NodeType.EXPERIMENT) {
      reasons.push(`experiment ${id} is missing`)
      continue
    }
    const experiment = node.properties
    if (!experiment.baselineRequest) reasons.push(`experiment ${id} baseline request is missing`)
    if (!experiment.oracle) reasons.push(`experiment ${id} oracle is missing`)
    if (experiment.outcome?.status !== 'proven') reasons.push(`experiment ${id} is not proven`)
    if (experiment.retest?.outcome.status !== 'proven') reasons.push(`experiment ${id} has no proven retest`)
    if (experiment.outcome?.status === 'proven' && experiment.retest?.outcome.status === 'proven') {
      const initial = new Set(experiment.outcome.proof.evidenceRefs)
      if (experiment.retest.outcome.proof.evidenceRefs.some(ref => initial.has(ref))) {
        reasons.push(`experiment ${id} retest reuses initial evidence`)
      }
    }
    if (experiment.baselineRequest && experiment.oracle && experiment.outcome && experiment.retest) {
      experiments.push({
        id,
        setup: experiment.setup,
        baselineRequest: redactObject(experiment.baselineRequest) as Record<string, unknown>,
        mutation: experiment.mutation,
        oracle: experiment.oracle,
        outcome: experiment.outcome,
        retest: experiment.retest,
      })
    }
  }

  const proof = store.getExploitProof(p.findingId).find(item => item.properties.replayable)
  if (!proof) reasons.push('replayable exploit proof is missing')
  if (proof && !proof.properties.url) reasons.push('replay target is missing')
  if (reasons.length > 0 || !p.proofCheck || !p.verifiedAt || !proof) return { reasons }

  return {
    reasons,
    finding: {
      id: p.findingId ?? finding.id,
      type: p.technique,
      endpoint: redactUrl(p.endpoint),
      method: proof.properties.method,
      severity: p.severity,
      confidence: p.confidence ?? 0,
      evidence: p.evidence.map(redactString),
      lifecycleStatus: p.lifecycleStatus,
      evidenceLevel: p.evidenceLevel,
      ...(p.cwe ? { cwe: p.cwe } : {}),
      ...(p.remediation ? { remediation: redactString(p.remediation) } : {}),
      proofCheck: p.proofCheck,
      experiments,
      replay: replayDefinition(proof),
      verifiedAt: p.verifiedAt,
    },
  }
}

function replayDefinition(proof: ExploitProofNode): CaseFileReplay {
  return {
    method: proof.properties.method,
    url: redactUrl(proof.properties.url),
    headers: redactHeaders(proof.properties.headers),
    body: proof.properties.body ? redactString(proof.properties.body) : undefined,
    expectedVulnerableResponse: proof.properties.expectedVulnerableResponse
      ? redactString(proof.properties.expectedVulnerableResponse)
      : undefined,
    reproSteps: proof.properties.reproSteps.map(redactString),
  }
}

export function validateCaseFile(value: unknown): CaseFileValidation {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { valid: false, errors: ['case file must be an object'] }
  const candidate = value as Partial<CaseFile>
  if (candidate.schemaVersion !== CASE_FILE_SCHEMA_VERSION) errors.push('unsupported schemaVersion')
  if (!candidate.metadata || typeof candidate.metadata.target !== 'string' || !candidate.metadata.target) errors.push('metadata.target is required')
  if (!Array.isArray(candidate.findings)) errors.push('findings must be an array')
  if (!Array.isArray(candidate.incompleteCandidates)) errors.push('incompleteCandidates must be an array')
  if (!Array.isArray(candidate.decisionLog)) errors.push('decisionLog must be an array')
  if (!Array.isArray(candidate.endpoints)) errors.push('endpoints must be an array')
  const findings = Array.isArray(candidate.findings) ? candidate.findings : []
  for (const finding of findings) {
    if (!finding || typeof finding !== 'object' || typeof finding.id !== 'string') {
      errors.push('finding must be an object with an id')
      continue
    }
    if (!finding.proofCheck?.passed) errors.push(`${finding.id}: proof floor did not pass`)
    if (!finding.verifiedAt) errors.push(`${finding.id}: verifiedAt is missing`)
    if (!finding.replay?.url) errors.push(`${finding.id}: replay target is missing`)
    const experiments = Array.isArray(finding.experiments) ? finding.experiments : []
    if (experiments.length === 0) errors.push(`${finding.id}: proven experiment is missing`)
    for (const experiment of experiments) {
      if (!experiment || typeof experiment !== 'object' || typeof experiment.id !== 'string') {
        errors.push(`${finding.id}: experiment must be an object with an id`)
        continue
      }
      if (!experiment.baselineRequest || typeof experiment.baselineRequest !== 'object' || Array.isArray(experiment.baselineRequest) || Object.keys(experiment.baselineRequest).length === 0) errors.push(`${finding.id}: experiment ${experiment.id} baseline request is missing`)
      if (!experiment.oracle) errors.push(`${finding.id}: experiment ${experiment.id} oracle is missing`)
      if (experiment.outcome?.status !== 'proven') errors.push(`${finding.id}: experiment ${experiment.id} is not proven`)
      if (experiment.retest?.outcome?.status !== 'proven') errors.push(`${finding.id}: experiment ${experiment.id} retest is not proven`)
      if (experiment.outcome?.status === 'proven' && experiment.retest?.outcome?.status === 'proven') {
        const initial = new Set(experiment.outcome.proof.evidenceRefs)
        if (experiment.retest.outcome.proof.evidenceRefs.some(ref => initial.has(ref))) {
          errors.push(`${finding.id}: experiment ${experiment.id} retest reuses initial evidence`)
        }
      }
    }
  }
  return { valid: errors.length === 0, errors }
}

export function generateCaseFile(
  graphStore: GraphStore,
  target: string,
  forensicLog?: ForensicLog,
  durationMs?: number,
): CaseFile {
  const findings = graphStore.queryNodes(NodeType.FINDING) as FindingNode[]
  const endpoints = graphStore.queryNodes(NodeType.ENDPOINT) as EndpointNode[]

  const completed = findings.map(finding => ({ source: finding, result: completeFinding(graphStore, finding) }))
  const caseFindings = completed.flatMap(item => item.result.finding ? [item.result.finding] : [])
  const incompleteCandidates = completed.flatMap(item => item.result.finding ? [] : [{
    id: item.source.properties.findingId ?? item.source.id,
    reasons: item.result.reasons,
  }])

  const decisions: CaseFileDecision[] = []
  if (forensicLog) {
    const entries = forensicLog.getEvents?.() ?? []
    for (const entry of entries) {
      if (entry.type === 'solver-phase' || entry.type === 'tool-call') {
        decisions.push({
          timestamp: entry.timestamp ?? Date.now(),
          phase: (entry as any).phase ?? entry.type,
          toolName: entry.tool,
          reason: (entry as any).reason,
        })
      }
    }
  }

  return {
    schemaVersion: CASE_FILE_SCHEMA_VERSION,
    metadata: {
      target: redactUrl(target),
      generatedAt: new Date().toISOString(),
      durationMs,
      totalFindings: caseFindings.length,
      totalEndpoints: endpoints.length,
      toolVersions: { ultimatrix: packageJson.version },
    },
    findings: caseFindings,
    incompleteCandidates,
    decisionLog: decisions,
    endpoints: endpoints.map(ep => ({
      url: redactUrl(ep.properties.url),
      method: ep.properties.method,
      authRequired: ep.properties.authRequired ?? false,
      authType: ep.properties.authType,
    })),
  }
}
