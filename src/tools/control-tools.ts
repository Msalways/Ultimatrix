import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, EdgeType, type FindingNode, type ExploitProofNode, validateNodeProperties } from '../graph/schema'
import { getGlobalWorkspace } from '../workspace'
import { generateFromFinding, type Finding } from '../generation/test-generator'
import { TestStorage } from '../generation/test-storage'
import { log } from '../utils/logger'
import { captureScreenshot } from '../browser/manager'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import {emitFindingDiscovered} from '../events/emitter'
import type { EvidenceLevel } from '../types/shared'
import { isUrlInScope } from '../safety/scope-guard'
import {
  verifyFindingClaim,
  type EvidenceItem,
  type EvidenceItemType,
  type FindingClaim,
  type ObservedFacts,
  type VerificationResult,
} from '../intelligence/evidence-ledger'
import { coreEvidenceLedger } from '../core/evidence'
import { getGlobalArtifactRegistry } from '../security/artifacts'
import { getGlobalDecisionLedger } from '../security/decision-ledger'
import { redactUrl } from '../security/secret-vault'
import { checkProof, combineFindingEvidence, type ProofCheckResult } from '../intelligence/proof-rules'
import { upsertCandidate } from '../research/candidate-store'
import { stableId } from '../research/utils'
import { getEngagementServices, type BufferedFindingEvidence, type FindingRuntimeState } from '../runtime/engagement-context'

const legacyFindingState: FindingRuntimeState = { evidenceBuffer: new Map(), evidenceGate: null }

function getFindingState(): FindingRuntimeState {
  return getEngagementServices()?.findingState ?? legacyFindingState
}

/** Global structured ledger of what actually happened (auto-captured by tools). */
const structuredLedger = coreEvidenceLedger

export function setEvidenceGateForFindings(gate: EvidenceGate): void {
  getFindingState().evidenceGate = gate
}

export function getGlobalEvidenceGate(): EvidenceGate | null {
  return getFindingState().evidenceGate
}

/**
 * Record a structured evidence item captured directly by a tool (not via the
 * LLM-facing recordEvidence tool). This is the source of truth for claim
 * verification. No substring scanning — items carry typed observed facts.
 */
export function recordStructuredEvidence(item: {
  type: EvidenceItemType
  data: string
  label: string
  observed?: ObservedFacts
  session?: string
}): void {
  structuredLedger.record(item)
}

/** Verify a finding claim against the global structured ledger. */
export function verifyClaimStructured(claim: FindingClaim): VerificationResult {
  return structuredLedger.verify(claim)
}

/** Clear the structured ledger (per-session / per-target isolation). */
export function resetStructuredLedger(): void {
  structuredLedger.clear()
}

export const recordEvidence = createTool({
  id: 'recordEvidence',
  description: 'Record an evidence item to attach to a subsequently emitted finding.',
  inputSchema: z.object({
    type: z.enum(['text', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
    data: z.string(),
    label: z.string(),
    session: z.string().optional(),
    findingKey: z.string().optional().describe('Key to group evidence items. Defaults to "default".'),
    method: z.string().optional().describe('HTTP method observed for this evidence item'),
    url: z.string().optional().describe('URL observed for this evidence item'),
    status: z.number().optional().describe('HTTP status observed for this evidence item'),
    requestHeaders: z.record(z.string(), z.string()).optional(),
    responseHeaders: z.record(z.string(), z.string()).optional(),
    responseTimeMs: z.number().nonnegative().optional(),
    correlationToken: z.string().optional(),
    state: z.record(z.string(), z.string()).optional(),
    browserEffects: z.record(z.string(), z.string()).optional(),
  }),
  execute: async ({ type, data, label, session, findingKey, method, url, status, requestHeaders, responseHeaders, responseTimeMs, correlationToken, state, browserEffects }) => {
    const key = findingKey || 'default'
    const observed: ObservedFacts | undefined =
      method || url || status != null || requestHeaders || responseHeaders || responseTimeMs != null || correlationToken || state || browserEffects
        ? {
            ...(method ? { method } : {}),
            ...(url ? { url } : {}),
            ...(status != null ? { status } : {}),
            ...(requestHeaders ? { requestHeaders } : {}),
            ...(responseHeaders ? { responseHeaders } : {}),
            ...(responseTimeMs != null ? { responseTimeMs } : {}),
            ...(correlationToken ? { correlationToken } : {}),
            ...(state ? { state } : {}),
            ...(browserEffects ? { browserEffects } : {}),
          }
        : undefined
    const item = { type, data, label, timestamp: Date.now(), ...(session ? { session } : {}), ...(observed ? { observed } : {}) }
    const evidenceBuffer = getFindingState().evidenceBuffer
    const existing = evidenceBuffer.get(key) || []
    existing.push(item)
    evidenceBuffer.set(key, existing)
    // Manual evidence also feeds the global structured ledger so claim verification
    // works regardless of findingKey. Typed observed facts only — no prose scanning.
    recordStructuredEvidence({ type, data, label, observed, ...(session ? { session } : {}) })
    return {
      ok: true,
      value: {
        recorded: true,
        timestamp: item.timestamp,
        evidence: item,
        bufferedCount: existing.length,
      },
    }
  },
})

export const flushEvidence = (findingKey?: string): BufferedFindingEvidence[] => {
  const evidenceBuffer = getFindingState().evidenceBuffer
  if (findingKey) {
    const items = evidenceBuffer.get(findingKey) || []
    evidenceBuffer.delete(findingKey)
    return items
  }
  const all: BufferedFindingEvidence[] = []
  for (const [, items] of evidenceBuffer) {
    all.push(...items)
  }
  evidenceBuffer.clear()
  return all
}

function determineEvidenceLevel(items: Array<{ type: string }>): EvidenceLevel {
  if (items.length === 0) return 'L1'
  const hasHarOrRaw = items.some(e => e.type === 'har_entry' || e.type === 'raw_request' || e.type === 'raw_response')
  if (hasHarOrRaw) return 'L4'
  const hasNonText = items.some(e => e.type !== 'text')
  if (hasNonText) return 'L3'
  return 'L2'
}

function buildFindingId(type: string, endpoint: string, param?: string): string {
  return `${type}:${endpoint}:${param || '*'}`
}

function _sanitizeForFilename(input: string): string {
  return input.replace(/[<>:"/\\|?*]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '')
}
// ─── Slice 13 / F1 - shared finding-commit gate ────────────────
// Every surface that persists a Finding routes through this ONE
// gate so a claim can never reach the graph or a report without structural
// verification against recorded evidence AND a deterministic proof floor for
// its severity. A bandaid would patch each caller; this moves the invariant to
// its owner - the single place that writes Finding nodes.

export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info'

export interface CommitEvidenceInput {
  type: EvidenceItemType
  data: string
  label: string
  timestamp?: number
  session?: string
  observed?: ObservedFacts
}

export interface PromoteFindingInput {
  candidateId?: string
  experimentIds?: string[]
  type: string
  endpoint: string
  param?: string
  method?: string
  payload?: string
  description?: string
  severity: FindingSeverity
  confidence: number
  cwe?: string
  remediation?: string
  observedStatus?: number
  exploitProof?: {
    relation?: string
    scenario: string
    request: string
    response: string
    impact: string
  }
  /**
   * Assertion origin.
   *  - 'llm' / 'captured' - the claim is structurally verified against recorded
   *    evidence (typed observed facts), then the severity floor is enforced.
   *  - 'human' - a human assertion is trusted, but the deterministic proof
   *    floor STILL applies (fail-closed; no severity downgrade bandaid).
   */
  source: 'llm' | 'captured' | 'human'
  /** Pre-captured evidence attached to this finding. */
  evidence?: CommitEvidenceInput[]
  tags?: string[]
  /** Originating tool/component for forensic attribution. */
  tool?: string
}

export interface PromotedFinding {
  id: string
  type: string
  endpoint: string
  param: string
  method: string
  payload: string
  description: string
  severity: FindingSeverity
  confidence: number
  confirmed: boolean
  evidence: CommitEvidenceInput[]
  graphNodeId: string
  lifecycleStatus: FindingNode['properties']['lifecycleStatus']
  evidenceLevel: EvidenceLevel
  findingId: string
  candidateId: string
  experimentIds: string[]
  proofCheck: ProofCheckResult
  deduplicated: boolean
  merged?: boolean
  exploitProofNodeId?: string
}

export type PromoteFindingResult =
  | { ok: true; value: PromotedFinding }
  | { ok: false; error: string; missing?: string[]; proofCheck?: ProofCheckResult }

export async function promoteFindingCandidate(input: PromoteFindingInput): Promise<PromoteFindingResult> {
  const args = input
  const store = getGlobalGraphStore()
  const evidenceItems: Array<{ type: EvidenceItemType; data: string; label: string; timestamp: number; session?: string; observed?: ObservedFacts }> =
    (args.evidence ?? []).map((e, i) => ({
      type: e.type,
      data: e.data,
      label: e.label,
      timestamp: e.timestamp ?? Date.now() + i,
      ...(e.session ? { session: e.session } : {}),
      ...(e.observed ? { observed: e.observed } : {}),
    }))
  const structuredEvidenceItems: EvidenceItem[] = evidenceItems.map((e, i) => ({
    id: `attached_${i}`,
    type: e.type,
    data: e.data,
    label: e.label,
    timestamp: e.timestamp,
    ...(e.session ? { session: e.session } : {}),
    ...(e.observed ? { observed: e.observed } : {}),
  }))

  const evidenceTexts = evidenceItems.map(e => `[${e.label}] ${e.data}`)

  const evidenceLevel = determineEvidenceLevel(evidenceItems)
  const findingId = buildFindingId(args.type, args.endpoint, args.param)
  const candidateId = args.candidateId ?? stableId('candidate', [findingId])
  const persistCandidate = (status: 'candidate' | 'needs-more-evidence' | 'verified', blockers: string[] = []) =>
    upsertCandidate(store, {
      id: candidateId,
      title: args.description || `${args.type} on ${args.endpoint}`,
      signalType: args.type,
      endpoint: args.endpoint,
      evidence: evidenceTexts,
      experimentIds: args.experimentIds ?? [],
      confidence: args.confidence,
      nextVerificationSteps: status === 'verified' ? [] : ['Capture typed evidence that satisfies the proof rule.'],
      blockers,
      status,
      severity: args.severity,
    })
  persistCandidate('candidate')
  if (args.severity !== 'info' && !args.experimentIds?.length) {
    const blockers = ['experiment-required']
    persistCandidate('needs-more-evidence', blockers)
    await store.save()
    return {
      ok: false,
      error: 'Finding promotion requires at least one proven experiment. Run and evaluate a replayable experiment, then submit its ID.',
      missing: blockers,
    }
  }
  if (args.experimentIds?.length) {
    const invalid = args.experimentIds.filter(id => {
      const experiment = store.getNode(id) as import('../graph/schema').ExperimentNode | undefined
      const outcome = experiment?.type === NodeType.EXPERIMENT ? experiment.properties.outcome : undefined
      const retest = experiment?.type === NodeType.EXPERIMENT ? experiment.properties.retest?.outcome : undefined
      return outcome?.status !== 'proven' || outcome.proof.experimentId !== id || outcome.proof.evidenceRefs.length === 0 ||
        retest?.status !== 'proven' || retest.proof.experimentId !== id || retest.proof.phase !== 'retest' ||
        retest.proof.evidenceRefs.length === 0 || retest.proof.evidenceRefs.some(ref => outcome.proof.evidenceRefs.includes(ref))
    })
    if (invalid.length) {
      const blockers = invalid.map(id => `experiment-not-proven:${id}`)
      persistCandidate('needs-more-evidence', blockers)
      await store.save()
      return { ok: false, error: `Finding promotion requires proven experiments: ${invalid.join(', ')}`, missing: blockers }
    }
  }

  // Maker/Checker: structural verification of the claim against recorded evidence.
  // Root-cause fix: verify typed observed facts, do NOT substring-scan prose, and
  // HARD-REJECT unsupported claims (no severity downgrade bandaid).
  // Human-reported assertions skip claim verification (the human is the authority),
  // but the deterministic proof floor below still applies to every source.
  const effectiveSeverity = args.severity
  if (args.severity !== 'info' && args.source !== 'human') {
    const claim: FindingClaim = {
      type: args.type,
      endpoint: args.endpoint,
      param: args.param,
      method: args.method,
      observed: args.observedStatus != null ? { status: args.observedStatus } : undefined,
    }
    const globalCheck = verifyClaimStructured(claim)
    const localCheck = verifyFindingClaim(claim, structuredEvidenceItems)
    const verification: VerificationResult =
      globalCheck.verified || localCheck.verified
        ? { verified: true, missing: [], supporting: [...globalCheck.supporting, ...localCheck.supporting] }
        : {
            verified: false,
            missing: globalCheck.missing.length ? globalCheck.missing : localCheck.missing,
            supporting: [],
          }
    if (!verification.verified) {
      persistCandidate('needs-more-evidence', verification.missing)
      await store.save()
      log.warn(`EvidenceGate: claim "${args.type} on ${args.endpoint}" not supported by recorded evidence - missing: ${verification.missing.join(', ')}`)
      return {
        ok: false,
        error: `EvidenceGate: claim not supported by recorded evidence. Missing: ${verification.missing.join(', ')}. Capture real evidence (recordEvidence with observed facts, or a tool-captured request/response) before writing the finding.`,
        missing: verification.missing,
      }
    }
  }

  // Slice 09 - deterministic proof floor. Fails CLOSED: a finding that cannot
  // meet the minimum evidence floor for its severity is never promoted to the
  // graph or a report, even when its claim is structurally supported.
  const proofItems = combineFindingEvidence(args.endpoint, structuredEvidenceItems, structuredLedger.all())
  for (const e of evidenceItems) {
    if (e.type === 'screenshot' && !proofItems.some(p => p.data === e.data)) {
      proofItems.push({ id: `attached:${e.data}`, type: 'screenshot', data: e.data, label: e.label, timestamp: e.timestamp })
    }
  }
  const proofCheck: ProofCheckResult = checkProof({
    findingType: args.type,
    endpoint: args.endpoint,
    severity: effectiveSeverity,
    observedStatus: args.observedStatus,
    findingId,
    items: proofItems,
  })
  if (!proofCheck.passed) {
    persistCandidate('needs-more-evidence', [...proofCheck.missingEvidence, ...proofCheck.conflicts])
    await store.save()
    log.warn(`ProofRules: "${args.type} on ${args.endpoint}" fails closed - missing: ${proofCheck.missingEvidence.join('; ')} conflicts: ${proofCheck.conflicts.join('; ')}`)
    getGlobalDecisionLedger().recordDecision({
      kind: 'finding.proof',
      reason: `proof check blocked ${args.type} on ${redactUrl(args.endpoint)}`,
      routingReason: `rule=${proofCheck.ruleId} passed=false`,
      sourceRefs: proofCheck.evidenceRefs,
    })
    return {
      ok: false,
      error: `ProofRules: finding does not meet the minimum evidence floor for ${effectiveSeverity}. ${proofCheck.missingEvidence.join('; ')}${proofCheck.conflicts.length ? ` Conflicts: ${proofCheck.conflicts.join('; ')}` : ''} Capture real evidence before writing the finding.`,
      proofCheck,
      missing: proofCheck.missingEvidence,
    }
  }
  getGlobalDecisionLedger().recordDecision({
    kind: 'finding.proof',
    reason: `proof check passed for ${args.type} on ${redactUrl(args.endpoint)}`,
    routingReason: `rule=${proofCheck.ruleId} sources=${proofCheck.evidenceRefs.length}`,
    sourceRefs: proofCheck.evidenceRefs,
  })
  const screenshotPaths = evidenceItems.filter(e => e.type === 'screenshot').map(e => e.data)

  const lifecycleStatus: FindingNode['properties']['lifecycleStatus'] =
    (effectiveSeverity === 'high' || effectiveSeverity === 'critical') && evidenceLevel === 'L1'
      ? 'pending_verification'
      : 'verified'

  const existingNodes = store.queryNodes(NodeType.FINDING) as FindingNode[]
  const duplicate = existingNodes.find(n => n.properties.findingId === findingId)

  if (duplicate) {
    log.warn(`Duplicate finding detected: ${findingId}, merging into existing node`)
    duplicate.properties = {
      ...duplicate.properties,
      severity: effectiveSeverity,
      evidence: evidenceTexts,
      screenshots: screenshotPaths,
      confidence: args.confidence,
      lifecycleStatus,
      evidenceLevel,
      proofCheck,
      candidateId,
      experimentIds: args.experimentIds ?? [],
      ...(args.cwe ? { cwe: args.cwe } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.remediation ? { remediation: args.remediation } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
    }
    duplicate.updatedAt = Date.now()
    persistCandidate('verified')
    await store.save()
    return {
      ok: true,
      value: {
        id: duplicate.id,
        type: args.type,
        endpoint: args.endpoint,
        param: args.param || '',
        method: args.method || 'GET',
        payload: args.payload || '',
        description: args.description || '',
        severity: effectiveSeverity,
        confidence: args.confidence,
        confirmed: args.confidence >= 0.7,
        evidence: evidenceItems,
        graphNodeId: duplicate.id,
        lifecycleStatus,
        evidenceLevel,
        findingId: duplicate.properties.findingId,
        candidateId,
        experimentIds: args.experimentIds ?? [],
        proofCheck,
        deduplicated: true,
        merged: true,
      },
    }
  }

  // Gap 13.2 - Validate finding properties before persisting to graph
  const findingProps = {
    severity: effectiveSeverity,
    technique: args.type,
    endpoint: args.endpoint,
    evidence: evidenceTexts,
    screenshots: screenshotPaths,
    confidence: args.confidence,
    lifecycleStatus,
    evidenceLevel,
    findingId,
    candidateId,
    experimentIds: args.experimentIds ?? [],
    proofCheck,
    ...(args.cwe ? { cwe: args.cwe } : {}),
    ...(args.description ? { description: args.description } : {}),
    ...(args.remediation ? { remediation: args.remediation } : {}),
    ...(args.tags ? { tags: args.tags } : {}),
  }
  const { valid, errors } = validateNodeProperties(NodeType.FINDING, findingProps)
  if (!valid) {
    log.warn(`writeFinding: finding ${findingId} validation issues (continuing anyway): ${errors.join('; ')}`)
  }

  const findingNode = store.addFinding(findingProps)
  persistCandidate('verified')
  emitFindingDiscovered(findingNode.id, effectiveSeverity, args.type || 'unknown', args.endpoint, undefined, args.tool ?? 'writeFinding')
  // Self-evolution (spec 05): a committed finding is a confirmed technique
  // outcome — feeds runtime weight overrides for future selection.
  import('../intelligence/evolution').then(({ recordTechniqueConfirmed }) => {
    if (args.type) recordTechniqueConfirmed(args.type)
  }).catch(() => { /* evolution never breaks the finding path */ })

  const finding = {
    id: findingNode.id,
    type: args.type,
    endpoint: args.endpoint,
    param: args.param || '',
    method: args.method || 'GET',
    payload: args.payload || '',
    description: args.description || '',
    severity: effectiveSeverity,
    confidence: args.confidence,
    confirmed: args.confidence >= 0.7,
    evidence: evidenceItems,
    graphNodeId: findingNode.id,
    lifecycleStatus,
    evidenceLevel,
    findingId,
    candidateId,
    experimentIds: args.experimentIds ?? [],
    proofCheck,
    deduplicated: false,
  }

  autoGenerateTest(finding).catch(() => {})

  // L7: Persist a first-class exploit-proof node when the LLM supplies a real
  // exploit. This is the exploitation-first signal - a finding WITH a proof is
  // weaponized, not just reported. Linked to the finding via a PROVES edge.
  let exploitProofNodeId: string | undefined
  if (args.exploitProof) {
    const proof = store.addExploitProof({
      scenario: args.exploitProof.scenario,
      relation: args.exploitProof.relation,
      request: args.exploitProof.request,
      response: args.exploitProof.response,
      impact: args.exploitProof.impact,
      findingId: findingNode.id,
      title: args.exploitProof.scenario,
      method: args.method ?? 'GET',
      url: args.endpoint,
      reproSteps: [args.exploitProof.request, `observe response: ${args.exploitProof.response.slice(0, 200)}`],
      status: 'proposed',
    })
    store.addEdge({
      type: EdgeType.PROVES,
      fromId: proof.id,
      toId: findingNode.id,
      properties: {},
    })
    exploitProofNodeId = proof.id
  }

  // Slice 07 - track artifacts with provenance for any finding committed here.
  getGlobalArtifactRegistry().create('finding', {
    initialStatus: 'linked',
    provenance: [
      { source: 'tool', ref: args.tool ?? 'writeFinding', detail: args.type },
      { source: 'graph', ref: candidateId, detail: 'CandidateFinding' },
      { source: 'graph', ref: findingNode.id },
      ...(exploitProofNodeId ? [{ source: 'graph', ref: exploitProofNodeId, detail: 'EXPLOIT_PROOF (PROVES)' }] : []),
      { source: 'evidence', detail: `evidenceItems=${evidenceItems.length}` },
    ],
    metadata: { endpoint: args.endpoint, severity: effectiveSeverity, evidenceLevel },
  })

  // Slice 07: record the finding-creation decision, linking evidence provenance.
  getGlobalDecisionLedger().recordDecision({
    kind: 'finding.create',
    reason: `create finding ${args.type} on ${redactUrl(args.endpoint)}`,
    routingReason: `confidence=${args.confidence} level=${evidenceLevel}`,
    sourceRefs: [candidateId, findingNode.id, ...structuredEvidenceItems.map(e => e.id), ...(exploitProofNodeId ? [exploitProofNodeId] : [])],
  })

  await store.save()
  return { ok: true, value: { ...finding, exploitProofNodeId } }
}

/**
 * Adapter for legacy text-evidence surfaces. Prose strings become typed observed facts
 * attached to the claimed endpoint so they participate in structural
 * verification + the endpoint-scoped proof floor. They remain `text` kind -
 * they can never satisfy a non-text floor (high/critical) on their own.
 */
export function buildTextEvidence(
  evidence: string[] | undefined,
  endpoint: string,
  method?: string,
): CommitEvidenceInput[] {
  return (evidence ?? []).map((e, i) => ({
    type: 'text',
    data: e,
    label: `evidence ${i + 1}`,
    timestamp: Date.now() + i,
    observed: { url: endpoint, ...(method ? { method } : {}) },
  }))
}

export const writeFinding = createTool({
  id: 'writeFinding',
  description: 'Emit a finalized finding with accumulated evidence and persist it to the knowledge graph.',
  inputSchema: z.object({
    type: z.string().describe('Vulnerability class (e.g. "sql_injection", "idor", "xss")'),
    endpoint: z.string().describe('Affected endpoint URL'),
    param: z.string().optional().describe('Affected parameter name'),
    method: z.string().optional().describe('HTTP method'),
    payload: z.string().optional().describe('Payload that triggered the finding'),
    description: z.string().optional().describe('Human-readable description'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    confidence: z.number().min(0).max(1),
    candidateId: z.string().optional().describe('Existing CandidateFinding ID to promote. Omit to create one from this submission.'),
    experimentIds: z.array(z.string()).optional().describe('Proven replayable experiment IDs. Required for every non-informational finding.'),
    cwe: z.string().optional().describe('CWE ID'),
    remediation: z.string().optional(),
    findingKey: z.string().optional().describe('Key matching the evidence buffer to pull previously recorded items from.'),
    observedStatus: z.number().optional().describe('HTTP status you observed that proves this finding. Used for structural evidence verification (no prose scanning).'),
    exploitProof: z.object({
      relation: z.string().optional().describe('The relation type this proof exploits. Discover valid relation types via getGraphSchema - do not assume a fixed list.'),
      scenario: z.string().describe('The business-logic scenario class the proof demonstrates (e.g. cross-API trust boundary). Free-form, LLM-defined.'),
      request: z.string().describe('The exact request that achieves the exploit.'),
      response: z.string().describe('The exact response proving impact.'),
      impact: z.string().describe('Concrete impact achieved (e.g. read victim data, escalated role).'),
    }).optional().describe('If supplied, persist a first-class EXPLOIT_PROOF node proving the finding is exploitable, linked to the finding via a PROVES edge. This is the exploitation-first signal - a finding with a proof is weaponized, not just reported.'),
  }),
  execute: async (args) => {
    const evidenceItems: CommitEvidenceInput[] = flushEvidence(args.findingKey).map(e => ({
      type: e.type as EvidenceItemType,
      data: e.data,
      label: e.label,
      timestamp: e.timestamp,
      ...(e.session ? { session: e.session } : {}),
      ...(e.observed ? { observed: e.observed } : {}),
    }))

    // Phase E: Auto-screenshot on finding confirmation
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    const outputDir = target ? workspace.getTargetDir(target) : undefined
    const screenshotPath = await captureScreenshot(`finding-${args.type}`, outputDir)
    if (screenshotPath) {
      evidenceItems.push({ type: 'screenshot', data: screenshotPath, label: `Screenshot: ${args.type}`, timestamp: Date.now() })
    }

    return promoteFindingCandidate({
      ...args,
      source: 'llm',
      tool: 'writeFinding',
      evidence: evidenceItems,
    })
  },
})

async function autoGenerateTest(finding: {
  id: string
  type: string
  endpoint: string
  param?: string
  method?: string
  payload?: string
  description?: string
  severity: string
  confidence: number
  evidence: Array<{ type: string; data: string; label: string; timestamp: number }>
}): Promise<void> {
  try {
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    if (!target) return

    const testFinding: Finding = {
      id: finding.id,
      title: `${finding.type} on ${finding.endpoint}`,
      severity: finding.severity as Finding['severity'],
      category: finding.type,
      description: finding.description || `${finding.type} vulnerability at ${finding.endpoint}`,
      evidence: finding.evidence.map(e => ({
        request: { method: finding.method || 'GET', url: finding.endpoint },
        response: { status: 200, body: e.data },
        description: e.label,
      })),
      request: {
        method: finding.method || 'GET',
        url: finding.endpoint,
      },
      firstSeen: new Date(),
      lastSeen: new Date(),
      status: 'open',
      payload: finding.payload ? { data: finding.payload } : undefined,
      param: finding.param ? { name: finding.param } : undefined,
      evidenceMarkers: finding.evidence.map(e => e.label),
    }

    const test = generateFromFinding(testFinding)
    const storage = new TestStorage(workspace.getTargetDir(target))
    await storage.save([test])
    log.dim('Test generated: ' + test.id)
  } catch (err) {
    log.dim('Test generation skipped: ' + (err instanceof Error ? err.message : String(err)))
  }
}

/**
 * W3 — replay a stored EXPLOIT_PROOF against the live target and decide
 * whether the demonstrated impact still holds. This is the exploitation-first
 * verifier: it re-runs the REAL request (method + url + headers + body) the
 * proof captured, never a synthetic bare GET.
 *
 * Comparison is structural: the replayed response must reproduce the stored
 * vulnerable signal. A proof with no captured request is skipped (not killed),
 * so a POST+body finding is never "disproven" by a failing GET. When a replay
 * actually runs and the signal does not reproduce, the finding is marked
 * 'disproven' (distinct from 'rejected', which means the replay could not run).
 */
export async function replayExploitProof(
  proof: ExploitProofNode,
  options?: { timeoutMs?: number },
): Promise<{ ok: boolean; replayed: boolean; status?: number; note: string }> {
  const timeout = options?.timeoutMs ?? 30_000
  const method = proof.properties.method || 'GET'
  const url = proof.properties.url
  if (!url) return { ok: false, replayed: false, note: 'proof has no target url' }

  const scopeCheck = isUrlInScope(url)
  if (!scopeCheck.allowed) {
    return { ok: false, replayed: false, note: `out of scope: ${scopeCheck.reason}` }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const headers: Record<string, string> = { 'User-Agent': 'Ultimatrix-Verifier/1.0', ...(proof.properties.headers ?? {}) }
    const res = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' && method !== 'HEAD' ? proof.properties.body : undefined,
      signal: controller.signal,
      redirect: 'manual',
    }).catch(() => null)
    clearTimeout(timer)
    if (!res) return { ok: false, replayed: true, note: 'no response (timeout/network)' }

    const body = await res.text().catch(() => '')
    // Structural check: the previously observed vulnerable signal must persist.
    // expectedVulnerableResponse is the substring we recorded proving impact.
    const expected = proof.properties.expectedVulnerableResponse
    const holds = expected
      ? body.includes(expected) || String(res.status) === expected
      : res.status >= 200 && res.status < 500
    return {
      ok: holds,
      replayed: true,
      status: res.status,
      note: holds ? 'impact reproduced' : `signal not reproduced (status ${res.status})`,
    }
  } catch (e: any) {
    clearTimeout(timer)
    return { ok: false, replayed: true, note: `replay error: ${e?.message ?? String(e)}` }
  }
}

/**
 * Maker/Checker: re-verify pending_verification findings by replaying their
 * stored exploit proof (W3). Promotes to 'verified', downgrades to 'disproven'
 * when a replay actually runs and the vulnerable signal no longer reproduces,
 * or leaves pending (skipped) when the replay could not run — never a bare GET
 * that would wrongly kill a POST+body finding.
 */
export async function verifyPendingFindings(options?: {
  maxPerRound?: number
  timeoutMs?: number
}): Promise<{ verified: string[]; rejected: string[]; skipped: string[] }> {
  const store = getGlobalGraphStore()
  const allFindings = (store.queryNodes(NodeType.FINDING) as FindingNode[] | undefined) ?? []
  const pending = allFindings.filter(f => f.properties.lifecycleStatus === 'pending_verification')

  const max = options?.maxPerRound ?? 5
  const timeout = options?.timeoutMs ?? 30_000
  const verified: string[] = []
  const rejected: string[] = []
  const skipped: string[] = []

  for (const finding of pending.slice(0, max)) {
    try {
      const proofs = store.getExploitProof(finding.properties.findingId)
      if (proofs.length === 0) {
        // No reproducible proof captured yet — keep pending, do not kill.
        skipped.push(finding.id)
        log.warn(`Verifier: skipping ${finding.id} — no exploit proof to replay`)
        continue
      }
      const replay = await replayExploitProof(proofs[0], { timeoutMs: timeout })
      if (replay.ok) {
        finding.properties.lifecycleStatus = 'verified'
        finding.updatedAt = Date.now()
        verified.push(finding.id)
        log.info(`Verifier: ${finding.id} → verified (${replay.note})`)
      } else if (replay.replayed) {
        // We actually re-ran the captured proof and the vulnerable signal did
        // not reproduce — the demonstrated impact no longer holds.
        finding.properties.lifecycleStatus = 'disproven'
        finding.properties.evidence = [
          ...(finding.properties.evidence ?? []),
          `[Verifier] Replay failed: ${replay.note}`,
        ]
        finding.updatedAt = Date.now()
        rejected.push(finding.id)
        log.info(`Verifier: ${finding.id} → disproven (${replay.note})`)
      } else {
        // Could not run the replay (out of scope / no response) — do not kill
        // the finding; leave it pending for a later, in-scope re-check.
        skipped.push(finding.id)
        log.warn(`Verifier: skipping ${finding.id} — replay not run (${replay.note})`)
      }
    } catch {
      skipped.push(finding.id)
    }
  }

  if (verified.length > 0 || rejected.length > 0) {
    store.save().catch(err => log.error('Graph save failed after verification: ' + String(err)))
  }

  return { verified, rejected, skipped }
}
