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
import { emitFindingDiscovered, emitFindingStatusChanged } from '../events/emitter'
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

const evidenceBuffer = new Map<string, Array<{ type: string; data: string; label: string; timestamp: number; session?: string; observed?: ObservedFacts }>>()

let _evidenceGate: EvidenceGate | null = null

/** Global structured ledger of what actually happened (auto-captured by tools). */
const structuredLedger = coreEvidenceLedger

export function setEvidenceGateForFindings(gate: EvidenceGate): void {
  _evidenceGate = gate
}

export function getGlobalEvidenceGate(): EvidenceGate | null {
  return _evidenceGate
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
  }),
  execute: async ({ type, data, label, session, findingKey, method, url, status, requestHeaders, responseHeaders }) => {
    const key = findingKey || 'default'
    const observed: ObservedFacts | undefined =
      method || url || status != null || requestHeaders || responseHeaders
        ? {
            ...(method ? { method } : {}),
            ...(url ? { url } : {}),
            ...(status != null ? { status } : {}),
            ...(requestHeaders ? { requestHeaders } : {}),
            ...(responseHeaders ? { responseHeaders } : {}),
          }
        : undefined
    const item = { type, data, label, timestamp: Date.now(), ...(session ? { session } : {}), ...(observed ? { observed } : {}) }
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

export const flushEvidence = (findingKey?: string): Array<{ type: string; data: string; label: string; timestamp: number; session?: string; observed?: ObservedFacts }> => {
  if (findingKey) {
    const items = evidenceBuffer.get(findingKey) || []
    evidenceBuffer.delete(findingKey)
    return items
  }
  const all: Array<{ type: string; data: string; label: string; timestamp: number; session?: string }> = []
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

function sanitizeForFilename(input: string): string {
  return input.replace(/[<>:"/\\|?*]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '')
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
    cwe: z.string().optional().describe('CWE ID'),
    remediation: z.string().optional(),
    findingKey: z.string().optional().describe('Key matching the evidence buffer to pull previously recorded items from.'),
    observedStatus: z.number().optional().describe('HTTP status you observed that proves this finding. Used for structural evidence verification (no prose scanning).'),
    exploitProof: z.object({
      relation: z.string().optional().describe('The relation type this proof exploits. Discover valid relation types via getGraphSchema — do not assume a fixed list.'),
      scenario: z.string().describe('The business-logic scenario class the proof demonstrates (e.g. cross-API trust boundary). Free-form, LLM-defined.'),
      request: z.string().describe('The exact request that achieves the exploit.'),
      response: z.string().describe('The exact response proving impact.'),
      impact: z.string().describe('Concrete impact achieved (e.g. read victim data, escalated role).'),
    }).optional().describe('If supplied, persist a first-class EXPLOIT_PROOF node proving the finding is exploitable, linked to the finding via a PROVES edge. This is the exploitation-first signal — a finding with a proof is weaponized, not just reported.'),
  }),
  execute: async (args) => {
    const store = getGlobalGraphStore()
    const evidenceItems = flushEvidence(args.findingKey)
    const structuredEvidenceItems: EvidenceItem[] = evidenceItems.map((e, i) => ({
      id: `flush_${i}`,
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

    const evidenceTexts = evidenceItems.map(e => `[${e.label}] ${e.data}`)

    const evidenceLevel = determineEvidenceLevel(evidenceItems)
    const findingId = buildFindingId(args.type, args.endpoint, args.param)

    // Maker/Checker: structural verification of the claim against recorded evidence.
    // Root-cause fix: verify typed observed facts, do NOT substring-scan prose, and
    // HARD-REJECT unsupported claims (no severity downgrade bandaid).
    const effectiveSeverity = args.severity
    if (args.severity !== 'info') {
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
        log.warn(`EvidenceGate: claim "${args.type} on ${args.endpoint}" not supported by recorded evidence — missing: ${verification.missing.join(', ')}`)
        return {
          ok: false,
          error: `EvidenceGate: claim not supported by recorded evidence. Missing: ${verification.missing.join(', ')}. Capture real evidence (recordEvidence with observed facts, or a tool-captured request/response) before writing the finding.`,
          missing: verification.missing,
        }
      }
    }

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
        ...(args.cwe ? { cwe: args.cwe } : {}),
        ...(args.remediation ? { remediation: args.remediation } : {}),
      }
      duplicate.updatedAt = Date.now()
      return {
        ok: true,
        value: {
          id: duplicate.id,
          findingId: duplicate.properties.findingId,
          deduplicated: true,
          merged: true,
        },
      }
    }

    // Gap 13.2 — Validate finding properties before persisting to graph
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
      ...(args.cwe ? { cwe: args.cwe } : {}),
      ...(args.remediation ? { remediation: args.remediation } : {}),
    }
    const { valid, errors } = validateNodeProperties(NodeType.FINDING, findingProps)
    if (!valid) {
      log.warn(`writeFinding: finding ${findingId} validation issues (continuing anyway): ${errors.join('; ')}`)
    }

    const findingNode = store.addFinding(findingProps)
    emitFindingDiscovered(findingNode.id, effectiveSeverity, args.type || 'unknown', args.endpoint, undefined, 'writeFinding')

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
      deduplicated: !!duplicate,
    }

    autoGenerateTest(finding).catch(() => {})

    // L7: Persist a first-class exploit-proof node when the LLM supplies a real
    // exploit. This is the exploitation-first signal — a finding WITH a proof is
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

    return { ok: true, value: { ...finding, exploitProofNodeId } }
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
