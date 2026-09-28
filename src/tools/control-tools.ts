import { createTool } from '@mastra/core/tools'
import { isBountyProfile } from '../safety/bounty-policy'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType, EdgeType, buildClaimKey, type FindingNode, type ExploitProofNode, type DerivedLifecycle, validateNodeProperties } from '../graph/schema'
import { getGlobalWorkspace } from '../workspace'
import { generateFromFinding, type Finding } from '../generation/test-generator'
import { TestStorage } from '../generation/test-storage'
import { log } from '../utils/logger'
import { captureScreenshot, getActiveBrowser } from '../browser/manager'
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

function getFindingState(): FindingRuntimeState {
  const services = getEngagementServices()
  if (!services) throw new Error('getFindingState() called outside engagement context')
  return services.findingState
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
}): EvidenceItem {
  return structuredLedger.record(item)
}

/**
 * Record a browser-runtime observation. Unlike model-authored text evidence,
 * this entry is tagged as a browser_effect and carries the action correlation
 * and typed effect map needed by the browser-effect oracle.
 */
export function recordBrowserEffectEvidence(input: {
  data: string
  label: string
  url?: string
  effects: Record<string, string>
  correlationToken?: string
  executionId?: string
  session?: string
}): EvidenceItem {
  return recordStructuredEvidence({
    type: 'browser_effect',
    data: input.data,
    label: input.label,
    ...(input.session ? { session: input.session } : {}),
    observed: {
      ...(input.url ? { url: input.url } : {}),
      browserEffects: input.effects,
      ...(input.correlationToken ? { correlationToken: input.correlationToken } : {}),
      ...(input.executionId ? { executionId: input.executionId } : {}),
    },
  })
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
  description: `Attach ADDITIONAL evidence to a finding claim — for observations NOT already captured by tool execution. httpRequest, runPrimitive, and other tools auto-record their request/response evidence into the structured ledger. Use this tool only for extra evidence: screenshots, manual observations, browser effects, DOM snapshots, or any observation the model makes outside a tool call. Do NOT re-enter request/response data that httpRequest already captured.`,
  inputSchema: z.object({
    type: z.enum(['text', 'browser_effect', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
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
    if (isBountyProfile() && type === 'text') {
      return { ok: false, value: { recorded: false }, error: 'Bounty mode does not accept prose-only evidence; record typed request/response or browser-effect evidence.' }
    }
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
    // Record first so the buffer and the public result share one stable id.
    const recorded = recordStructuredEvidence({ type, data, label, observed, ...(session ? { session } : {}) })
    existing.push({ ...item, id: recorded.id })
    evidenceBuffer.set(key, existing)
    return {
      ok: true,
      value: {
        recorded: true,
        evidenceId: recorded.id,
        timestamp: recorded.timestamp,
        evidence: recorded,
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

/**
 * The canonical claim key for a finding.
 *
 * Delegates to the single builder in the graph schema. It must not be
 * re-implemented here: this value is the join key between the finding and the
 * disposition log, and the two diverging is exactly what made an operator's
 * ruling fail to attach during the first live run.
 */
export function buildFindingId(type: string, endpoint: string, param?: string): string {
  return buildClaimKey(type, endpoint, param)
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
  /** Stable ledger id when the evidence came from a runtime capture. */
  id?: string
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
    /** Structured replay material; prose alone is never marked replayable. */
    method?: string
    headers?: Record<string, string>
    body?: string
    expectedVulnerableResponse?: string
    transport?: 'http' | 'browser'
    browserSteps?: Array<{ toolId: string; input: Record<string, unknown> }>
    browserEffectKey?: string
    browserEffectValue?: string
    actor?: string
    altActor?: string
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
  const evidenceItems: Array<{ id?: string; type: EvidenceItemType; data: string; label: string; timestamp: number; session?: string; observed?: ObservedFacts }> =
    (args.evidence ?? []).map((e, i) => ({
      ...(e.id ? { id: e.id } : {}),
      type: e.type,
      data: e.data,
      label: e.label,
      timestamp: e.timestamp ?? Date.now() + i,
      ...(e.session ? { session: e.session } : {}),
      ...(e.observed ? { observed: e.observed } : {}),
    }))
  const structuredEvidenceItems: EvidenceItem[] = evidenceItems.map((e, i) => ({
    id: e.id ?? `attached_${i}`,
    type: e.type,
    data: e.data,
    label: e.label,
    timestamp: e.timestamp,
    ...(e.session ? { session: e.session } : {}),
    ...(e.observed ? { observed: e.observed } : {}),
  }))

  const evidenceTexts = evidenceItems.map(e => `[${e.label}] ${e.data}`)

  if (isBountyProfile() && args.severity !== 'info' && evidenceItems.length > 0) {
    const canonicalIds = new Set(coreEvidenceLedger.all().map((item) => item.id))
    const ungrounded = evidenceItems.filter((item) => !item.id || !canonicalIds.has(item.id))
    if (ungrounded.length > 0) {
      return {
        ok: false,
        error: 'Bounty findings must reference canonical runtime evidence IDs; prose or unattached evidence cannot promote a claim.',
        missing: ungrounded.map((item) => item.id ?? 'missing-id'),
      }
    }
  }

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

  const gateLifecycleStatus: FindingNode['properties']['lifecycleStatus'] =
    (effectiveSeverity === 'high' || effectiveSeverity === 'critical') && evidenceLevel === 'L1'
      ? 'pending_verification'
      : 'verified'

  // A prior ruling on this claim outranks a fresh verdict computed from evidence
  // alone. Without this the machine would resurrect a finding the operator had
  // already killed, because re-derivation never consulted the log — which is
  // exactly the "same false positive every session" failure the log exists to end.
  // The evidence gate still runs above and can still refuse the write outright;
  // this only decides what status an accepted finding is born with.
  const prior: DerivedLifecycle = typeof (store as any).derivePriorLifecycle === 'function'
    ? store.derivePriorLifecycle(findingId, gateLifecycleStatus)
    : { status: gateLifecycleStatus, contested: false, expected: false, contributors: [] }
  const lifecycleStatus = prior.status
  if (prior.lastReason) {
    getGlobalDecisionLedger().recordDecision({
      kind: 'finding.proof',
      reason: `prior ruling applied to ${args.type} on ${redactUrl(args.endpoint)}: ${prior.contested ? 'contested' : prior.status}`,
      routingReason: `disposition contributors=${prior.contributors.join('+')}`,
      sourceRefs: proofCheck.evidenceRefs,
    })
  }

  const attachExploitProof = (findingNode: FindingNode): string | undefined => {
    if (!args.exploitProof) return undefined
    const proofInput = args.exploitProof
    const existingProofs = typeof (store as any).getExploitProof === 'function'
      ? store.getExploitProof(findingId)
      : []
    const existing = existingProofs.find((proofNode) =>
      proofNode.properties.request === proofInput.request
      && (proofNode.properties.method ?? 'GET').toUpperCase() === (proofInput.method ?? args.method ?? 'GET').toUpperCase()
      && proofNode.properties.expectedVulnerableResponse === proofInput.expectedVulnerableResponse
      && proofNode.properties.browserEffectKey === proofInput.browserEffectKey
      && proofNode.properties.browserEffectValue === proofInput.browserEffectValue
      && JSON.stringify(proofNode.properties.browserSteps ?? []) === JSON.stringify(proofInput.browserSteps ?? []),
    )
    if (existing) return existing.id
    const proof = store.addExploitProof({
      scenario: proofInput.scenario,
      relation: proofInput.relation,
      request: proofInput.request,
      response: proofInput.response,
      impact: proofInput.impact,
      // The logical finding id is the stable join key. The graph edge carries
      // the physical node identity; consumers must not guess between them.
      findingId,
      title: proofInput.scenario,
      method: proofInput.method ?? args.method ?? 'GET',
      url: args.endpoint,
      ...(proofInput.headers ? { headers: proofInput.headers } : {}),
      ...(proofInput.body !== undefined ? { body: proofInput.body } : {}),
      ...(proofInput.expectedVulnerableResponse ? { expectedVulnerableResponse: proofInput.expectedVulnerableResponse } : {}),
      ...(proofInput.transport ? { transport: proofInput.transport } : {}),
      ...(proofInput.browserSteps ? { browserSteps: proofInput.browserSteps } : {}),
      ...(proofInput.browserEffectKey ? { browserEffectKey: proofInput.browserEffectKey } : {}),
      ...(proofInput.browserEffectValue ? { browserEffectValue: proofInput.browserEffectValue } : {}),
      ...(proofInput.actor ? { actor: proofInput.actor } : {}),
      ...(proofInput.altActor ? { altActor: proofInput.altActor } : {}),
      reproSteps: [proofInput.request, `observe response: ${proofInput.response.slice(0, 200)}`],
      replayable: Boolean(proofInput.expectedVulnerableResponse || (proofInput.browserSteps?.length && proofInput.browserEffectValue !== undefined)),
      status: 'proposed',
    })
    store.addEdge({
      type: EdgeType.PROVES,
      fromId: proof.id,
      toId: findingNode.id,
      properties: { findingId },
    })
    return proof.id
  }

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
      confirmed: lifecycleStatus === 'verified' && args.confidence >= 0.7,
      ...(lifecycleStatus === 'verified' ? { verifiedAt: duplicate.properties.verifiedAt ?? new Date().toISOString() } : {}),
      candidateId,
      experimentIds: args.experimentIds ?? [],
      ...(args.cwe ? { cwe: args.cwe } : {}),
      ...(args.description ? { description: args.description } : {}),
      ...(args.remediation ? { remediation: args.remediation } : {}),
      ...(args.tags ? { tags: args.tags } : {}),
    }
    duplicate.updatedAt = Date.now()
    const exploitProofNodeId = attachExploitProof(duplicate)
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
        confirmed: lifecycleStatus === 'verified' && args.confidence >= 0.7,
        evidence: evidenceItems,
        graphNodeId: duplicate.id,
        lifecycleStatus,
        evidenceLevel,
        findingId: duplicate.properties.findingId,
        candidateId,
        experimentIds: args.experimentIds ?? [],
        proofCheck,
        deduplicated: true,
         exploitProofNodeId,
        merged: true,
      },
    }
  }

  // Gap 13.2 - Validate finding properties before persisting to graph
  const findingProps = {
    severity: effectiveSeverity,
    technique: args.type,
    endpoint: args.endpoint,
    // Proven sink shape travels with the finding so weaponization targets
    // the demonstrated sink instead of re-deriving (or guessing) it.
    ...(args.param ? { param: args.param } : {}),
    ...(args.method ? { method: args.method } : {}),
    evidence: evidenceTexts,
    screenshots: screenshotPaths,
    confidence: args.confidence,
    lifecycleStatus,
    evidenceLevel,
    findingId,
    confirmed: lifecycleStatus === 'verified' && args.confidence >= 0.7,
    ...(lifecycleStatus === 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
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

  // G8: Record per-payload effectiveness when a finding has a payload.
  // This feeds the payload history so the brain can see what's historically
  // effective on similar targets.
  if (args.payload && args.type) {
    import('../intelligence/outcome-feedback').then(({ getOutcomeFeedbackStore }) => {
      getOutcomeFeedbackStore().recordPayloadOutcome({
        payload: args.payload!,
        vulnType: args.type!,
        source: 'llm',
        worked: true,
      })
    }).catch(() => { /* payload tracking never breaks the finding path */ })
  }

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
    confirmed: lifecycleStatus === 'verified' && args.confidence >= 0.7,
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
  const exploitProofNodeId = attachExploitProof(findingNode)

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
     evidence: z.array(z.object({
       id: z.string().optional(),
       type: z.enum(['text', 'browser_effect', 'screenshot', 'har_entry', 'raw_request', 'raw_response']),
       data: z.string(),
       label: z.string(),
       timestamp: z.number().optional(),
       session: z.string().optional(),
       observed: z.record(z.string(), z.any()).optional(),
     })).optional().describe('Runtime evidence items returned by a tool, including stable ledger ids.'),
    observedStatus: z.number().optional().describe('HTTP status you observed that proves this finding. Used for structural evidence verification (no prose scanning).'),
    exploitProof: z.object({
      relation: z.string().optional().describe('The relation type this proof exploits. Discover valid relation types via getGraphSchema - do not assume a fixed list.'),
      scenario: z.string().describe('The business-logic scenario class the proof demonstrates (e.g. cross-API trust boundary). Free-form, LLM-defined.'),
      request: z.string().describe('The exact request that achieves the exploit.'),
      response: z.string().describe('The exact response proving impact.'),
      impact: z.string().describe('Concrete impact achieved (e.g. read victim data, escalated role).'),
      method: z.string().optional().describe('Structured replay method when this is an HTTP proof.'),
      headers: z.record(z.string(), z.string()).optional().describe('Structured replay headers when this is an HTTP proof.'),
      body: z.string().optional().describe('Structured replay body when this is an HTTP proof.'),
      expectedVulnerableResponse: z.string().optional().describe('Deterministic response signal required for replay verification.'),
      transport: z.enum(['http', 'browser']).optional(),
      browserSteps: z.array(z.object({ toolId: z.string(), input: z.record(z.string(), z.unknown()) })).optional(),
      browserEffectKey: z.string().optional(),
      browserEffectValue: z.string().optional(),
      actor: z.string().optional().describe('Primary session identity used by the proof.'),
      altActor: z.string().optional().describe('Alternate session identity used by the proof.'),
    }).optional().describe('If supplied, persist a first-class EXPLOIT_PROOF node proving the finding is exploitable, linked to the finding via a PROVES edge. This is the exploitation-first signal - a finding with a proof is weaponized, not just reported.'),
  }),
  execute: async (args) => {
    const explicitEvidence: CommitEvidenceInput[] = (args.evidence ?? []).map((e) => ({
      ...(e.id ? { id: e.id } : {}),
      type: e.type,
      data: e.data,
      label: e.label,
      ...(e.timestamp !== undefined ? { timestamp: e.timestamp } : {}),
      ...(e.session ? { session: e.session } : {}),
      ...(e.observed ? { observed: e.observed as ObservedFacts } : {}),
    }))
    const bufferedEvidence: CommitEvidenceInput[] = flushEvidence(args.findingKey).map(e => ({
      ...(e.id ? { id: e.id } : {}),
      type: e.type as EvidenceItemType,
      data: e.data,
      label: e.label,
      timestamp: e.timestamp,
      ...(e.session ? { session: e.session } : {}),
      ...(e.observed ? { observed: e.observed } : {}),
    }))
    const evidenceItems = [...explicitEvidence, ...bufferedEvidence]
    const seenEvidenceIds = new Set<string>()
    const uniqueEvidenceItems = evidenceItems.filter((item) => {
      if (!item.id) return true
      if (seenEvidenceIds.has(item.id)) return false
      seenEvidenceIds.add(item.id)
      return true
    })

    // Phase E: Auto-screenshot on finding confirmation
    const workspace = getGlobalWorkspace()
    const target = workspace.getCurrentTarget()
    const outputDir = target ? workspace.getTargetDir(target) : undefined
    const screenshotPath = await captureScreenshot(`finding-${args.type}`, outputDir)
    if (screenshotPath) {
      uniqueEvidenceItems.push({ type: 'screenshot', data: screenshotPath, label: `Screenshot: ${args.type}`, timestamp: Date.now() })
    }

    return promoteFindingCandidate({
      ...args,
      source: 'llm',
      tool: 'writeFinding',
      evidence: uniqueEvidenceItems,
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

async function replayBrowserProof(
  proof: ExploitProofNode,
): Promise<{ ok: boolean; replayed: boolean; status?: number; note: string }> {
  const steps = proof.properties.browserSteps ?? []
  const effectKey = proof.properties.browserEffectKey
  const effectValue = proof.properties.browserEffectValue
  if (steps.length === 0 || !effectKey || effectValue === undefined) {
    return { ok: false, replayed: false, note: 'browser proof has no typed browser steps/effect oracle' }
  }
  if (proof.properties.actor) {
    const { getGlobalSessionManager } = await import('../http/session-manager')
    if (!getGlobalSessionManager().listSessions().includes(proof.properties.actor)) {
      return { ok: false, replayed: false, note: 'recorded browser actor session is unavailable; refusing replay on the active page' }
    }
  }
  let browser: any
  try { browser = getActiveBrowser() } catch { return { ok: false, replayed: false, note: 'no active browser for replay' } }
  if (!browser) return { ok: false, replayed: false, note: 'no active browser for replay' }
  const { wrapStagehandTools } = await import('../browser/dialog-inject')
  const tools = wrapStagehandTools(browser)
  const evidenceIds: string[] = []
  for (const step of steps) {
    const tool = tools[step.toolId]
    if (!tool || typeof tool.execute !== 'function') {
      return { ok: false, replayed: false, note: `browser replay tool unavailable: ${step.toolId}` }
    }
    let result: any
    try {
      result = await tool.execute(step.input, { agent: { threadId: `proof-replay:${proof.id}` } })
    } catch (error) {
      return { ok: false, replayed: false, note: error instanceof Error ? error.message : String(error) }
    }
    if (result?.success === false) {
      return { ok: false, replayed: true, note: `browser step failed: ${result.error ?? 'unknown error'}` }
    }
    const ids = Array.isArray(result?.browserAction?.evidenceIds) ? result.browserAction.evidenceIds : []
    evidenceIds.push(...ids.filter((id: unknown): id is string => typeof id === 'string'))
  }
  const observed = coreEvidenceLedger.all().find((item) =>
    evidenceIds.includes(item.id) && item.observed?.browserEffects?.[effectKey] === effectValue,
  )
  if (!observed) {
    return { ok: false, replayed: true, note: `browser effect not reproduced: ${effectKey}` }
  }
  return { ok: true, replayed: true, note: `browser effect reproduced: ${effectKey}` }
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
  const method = String(proof.properties.method || 'GET').toUpperCase()
  const url = proof.properties.url
  if (!url) return { ok: false, replayed: false, note: 'proof has no target url' }
  if (!proof.properties.replayable) {
    return { ok: false, replayed: false, note: 'proof is not marked replayable' }
  }
  if (proof.properties.transport === 'browser' || (proof.properties.browserSteps?.length ?? 0) > 0) {
    return replayBrowserProof(proof)
  }
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
    return { ok: false, replayed: false, note: `unsupported proof method: ${method}` }
  }
  if (!proof.properties.expectedVulnerableResponse) {
    return { ok: false, replayed: false, note: 'proof has no deterministic response oracle' }
  }

  const scopeCheck = isUrlInScope(url)
  if (!scopeCheck.allowed) {
    return { ok: false, replayed: false, note: `out of scope: ${scopeCheck.reason}` }
  }

  // Replay through the same scoped/rate-limited/evidence-producing HTTP
  // path as every other request. A direct fetch here would bypass policy and
  // make proof verification an uncaptured side channel.
  const { httpRequest } = await import('./http-tools')
  if (!httpRequest.execute) return { ok: false, replayed: false, note: 'http replay tool is unavailable' }
  const result = await httpRequest.execute({
    method: method as 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    url,
    headers: proof.properties.headers ?? {},
    ...(proof.properties.body !== undefined && method !== 'GET' ? { body: proof.properties.body } : {}),
    timeoutMs: timeout,
  }, {} as never) as any
  if (!result?.ok) {
    // A policy/network failure means the proof was not replayed; do not turn it
    // into a disproven finding.
    return { ok: false, replayed: false, note: result?.error ?? 'replay request failed' }
  }

  const response = result.value ?? {}
  const body = String(response.body ?? '')
  const expected = proof.properties.expectedVulnerableResponse
  const holds = body.includes(expected) || String(response.status ?? '') === expected
  return {
    ok: holds,
    replayed: true,
    status: response.status,
    note: holds ? 'impact reproduced' : `signal not reproduced (status ${response.status})`,
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
      const proof = proofs.find((candidate) => candidate.properties.replayable && (candidate.properties.expectedVulnerableResponse || candidate.properties.browserEffectValue))
        ?? proofs[0]
      const replay = await replayExploitProof(proof, { timeoutMs: timeout })
      if (replay.ok) {
        // Route the verdict through the disposition log rather than poking
        // lifecycleStatus directly, so an operator ruling and this replay land
        // in ONE history and the reason survives alongside the status.
        store.addDisposition({
          claimRef: finding.id,
          claimKind: 'finding',
          origin: 'agent',
          value: 'verified',
          reason: `Independent replay reproduced the stored signal: ${replay.note}`,
        })
        store.applyDispositions(finding.id)
        finding.properties.confirmed = true
        finding.properties.verifiedAt = new Date().toISOString()
        finding.updatedAt = Date.now()
        proof.properties.status = 'confirmed'
        proof.properties.resultSummary = replay.note
        proof.updatedAt = Date.now()
        store.updateNode(proof)
        verified.push(finding.id)
        log.info(`Verifier: ${finding.id} → verified (${replay.note})`)
      } else if (replay.replayed) {
        // We actually re-ran the captured proof and the vulnerable signal did
        // not reproduce — the demonstrated impact no longer holds.
        store.addDisposition({
          claimRef: finding.id,
          claimKind: 'finding',
          origin: 'agent',
          value: 'disproven',
          reason: `Independent replay did not reproduce the stored signal: ${replay.note}`,
        })
        store.applyDispositions(finding.id)
        finding.properties.confirmed = false
        finding.properties.evidence = [
          ...(finding.properties.evidence ?? []),
          `[Verifier] Replay failed: ${replay.note}`,
        ]
        finding.updatedAt = Date.now()
        proof.properties.status = 'rejected'
        proof.properties.resultSummary = replay.note
        proof.updatedAt = Date.now()
        store.updateNode(proof)
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

// ─── Phase 3: Semantic alias ───────────────────────────────────────────────

/**
 * `linkEvidenceToClaim` is the preferred name for the manual evidence
 * attachment tool. `recordEvidence` is kept as the primary ID for backward
 * compat with 30+ skill toolRefs. Both point to the same execute function.
 */
export const linkEvidenceToClaim = createTool({
  id: 'linkEvidenceToClaim',
  description: `Preferred name for recordEvidence. Attach ADDITIONAL evidence to a finding claim — for observations NOT already captured by tool execution. httpRequest, runPrimitive, and other tools auto-record their request/response evidence. Use this tool only for extra evidence: screenshots, manual observations, browser effects, DOM snapshots, or any observation outside a tool call.`,
  inputSchema: recordEvidence.inputSchema,
  execute: (recordEvidence as any).execute,
})
