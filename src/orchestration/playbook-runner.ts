/**
 * Playbook runner — Phase 9 (ORCHESTRATION-LAYER-FIX.md T5).
 *
 * Executes an `AdvancedPlaybook` produced from a diagnosis:
 *  - primitive candidates → `runPrimitiveById` (evidence-gated; confirmed
 *    findings commit through the existing maker/checker path)
 *  - worker candidates → optional delegate seam (LLM reasoning/exploration);
 *    when no delegate is configured they are reported as skipped (never run
 *    silently as direct primitives).
 *
 * Never fabricates findings: confirmation comes only from the EvidenceGate.
 */

import { diagnoseTargetState, type DiagnosisInput } from './diagnosis'
import { buildAdvancedPlaybook, type PlaybookOptions } from './technique-planner'
import { runPrimitiveById } from '../primitives'
import { withEndpointClaim } from '../runtime/claim-registry'
import { getOastUrl } from '../oast/server'
import type {
  AdvancedPlaybook,
  DiagnosisProfile,
  PlaybookExecution,
  PlaybookRunResult,
  TechniqueCandidate,
} from './types'

export interface PlaybookRunInput {
  candidateIds?: string[]
  maxCandidates?: number
  /** Persist evidence-gated confirmed findings (default true). */
  commit?: boolean
}

export interface DelegateWorkerResult {
  ok: boolean
  note?: string
}

export interface PlaybookRunnerDeps {
  diagnosis?: (input: DiagnosisInput) => DiagnosisProfile
  buildPlaybook?: (profile: DiagnosisProfile, opts: PlaybookOptions) => AdvancedPlaybook
  runPrimitive?: (
    id: string,
    ctx: Record<string, unknown>,
    opts: { commit?: boolean },
  ) => Promise<{ ok: boolean; skipped?: boolean; reason?: string; result?: { confirmed: boolean } }>
  /** Optional worker-delegation seam (default: not configured → skipped). */
  delegateWorker?: (candidate: TechniqueCandidate, profile: DiagnosisProfile) => Promise<DelegateWorkerResult>
}

function contextFor(candidate: TechniqueCandidate, profile: DiagnosisProfile): Record<string, unknown> {
  const ep = profile.knownContext.endpoints.find((e) => e.id === candidate.endpointId)
  const ctx: Record<string, unknown> = {}
  if (profile.target) ctx.target = profile.target
  if (ep) {
    ctx.endpointUrl = ep.url
    ctx.endpointMethod = ep.method
    ctx.params = ep.params.map((name) => ({ name, type: ep.paramTypes[name] }))
    ctx.authRequired = ep.authRequired
    ctx.authType = ep.authType
    ctx.useCase = ep.useCase
    ctx.tags = ep.tags
  }
  if (candidate.param) ctx.param = candidate.param
  if (profile.knownContext.hasOast) {
    try {
      const url = getOastUrl()
      if (url && url !== 'http://oast-not-started') ctx.oastHost = url
    } catch {
      /* no OAST host */
    }
  }
  return ctx
}

export async function runAdvancedPlaybook(
  input: PlaybookRunInput,
  deps: PlaybookRunnerDeps = {},
): Promise<PlaybookRunResult> {
  const diagnose = deps.diagnosis ?? diagnoseTargetState
  const build = deps.buildPlaybook ?? buildAdvancedPlaybook

  const profile = diagnose({ includeSkills: true, includePrimitives: true })
  const playbook = build(profile, {
    selectedCandidateIds: input.candidateIds,
    maxCandidates: input.maxCandidates,
  })

  const executed: PlaybookExecution[] = []
  const skipped: PlaybookRunResult['skipped'] = []
  const commit = input.commit !== false

  for (const candidate of playbook.candidates) {
    if (candidate.execution === 'primitive' && candidate.primitiveId) {
      const run = deps.runPrimitive ?? runPrimitiveById
      const primitiveId = candidate.primitiveId
      // F4 — claim before fire when the candidate targets a known endpoint.
      const claimCtx = contextFor(candidate, profile)
      const claimEndpoint = claimCtx?.endpoint as { url?: string; method?: string } | undefined
      const claimUrl = claimEndpoint?.url ?? profile.target ?? ''
      const attempt = await withEndpointClaim(
        { method: claimEndpoint?.method, url: claimUrl, owner: `playbook:${candidate.id}`, purpose: primitiveId },
        () => run(primitiveId, claimCtx, { commit }),
      )
      const res = attempt.executed ? attempt.value : { ok: false, skipped: true, reason: `endpoint claimed by ${attempt.holder}` }
      executed.push({
        candidateId: candidate.id,
        primitiveId: candidate.primitiveId,
        skillId: candidate.skillId,
        ok: res.ok,
        confirmed: res.result?.confirmed ?? false,
        note: res.reason,
      })
      continue
    }

    if (candidate.execution === 'worker' && candidate.workerId) {
      if (deps.delegateWorker) {
        const dr = await deps.delegateWorker(candidate, profile)
        executed.push({
          candidateId: candidate.id,
          workerId: candidate.workerId,
          skillId: candidate.skillId,
          ok: dr.ok,
          confirmed: false,
          note: dr.note,
        })
      } else {
        skipped.push({
          candidateId: candidate.id,
          reason: `worker delegation required (skill: ${candidate.workerId}); no delegate configured`,
        })
      }
      continue
    }

    skipped.push({ candidateId: candidate.id, reason: 'no executable path (primitive/worker missing)' })
  }

  const confirmed = executed.filter((e) => e.confirmed).length
  return {
    executed,
    skipped,
    confirmed,
    unconfirmed: executed.length - confirmed,
    missingContext: playbook.missingContext,
    loadedSkills: [...new Set(executed.map((e) => e.skillId).filter((s): s is string => !!s))],
  }
}
