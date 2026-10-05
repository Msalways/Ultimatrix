/** Mastra dispatch tool and deterministic solve hook for coverage campaigns. */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { DEFAULTS, type UltimatrixConfig, type BudgetPolicy } from '../config'
import { getGlobalGraphStore } from '../graph/store'
import { executeCampaign } from './executor'
import { recordTechniqueConfirmed, recordTechniqueFailed } from '../intelligence/evolution'
import { createPrimitiveRunner } from './runner'
import { listPrimitiveMetadata } from '../primitives'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { setEvidenceGateForFindings } from '../tools/control-tools'
import { getOutcomeFeedbackStore } from '../intelligence/outcome-feedback'
import { getAllSkills } from '../solver/skills/loader'
import type { CampaignResult } from './types'
import { getEngagementServices } from '../runtime/engagement-context'
import { hasActorIdentityHeader } from '../http/auth-headers'

function defaultCampaignConfig(): UltimatrixConfig {
  return {
    provider: 'groq', model: 'llama3-8b-8192', depth: DEFAULTS.depth, timeout: DEFAULTS.timeout,
    creds: {}, browser: DEFAULTS.browser, memory: DEFAULTS.memory, agent: DEFAULTS.agent,
    rateLimit: { ...DEFAULTS.rateLimit, backoffSteps: [...DEFAULTS.rateLimit.backoffSteps] },
    engine: DEFAULTS.engine, budgetPolicy: DEFAULTS.budgetPolicy as unknown as BudgetPolicy,
  }
}

export async function runCampaignAssessment(
  config: UltimatrixConfig,
  gate = new EvidenceGate(),
  settings: {
    maxSlices?: number
    maxConcurrency?: number
    maxRequests?: number
    maxDurationMs?: number
    includeAnonymous?: boolean
    roleFilter?: string[]
    techniqueFilter?: string[]
  } = {},
): Promise<CampaignResult> {
  const graphStore = getGlobalGraphStore()
  setEvidenceGateForFindings(gate)
  const skills = getAllSkills()
  const domains = [...new Set(skills.map(skill => skill.domain))].sort()
  const actorSessions: Record<string, string[]> = {}
  const sessionManager = getEngagementServices()?.httpSessions
  const sessionRefs = sessionManager?.listSessions().filter(ref => {
    try {
      return hasActorIdentityHeader(sessionManager.getAllHeaders(ref))
    } catch { return false }
  }) ?? []
  if (sessionRefs.length) actorSessions.authenticated = sessionRefs
  for (const ref of sessionRefs) {
    actorSessions[ref] = [...(actorSessions[ref] ?? []), ref]
    const role = ref.split(':', 1)[0]
    actorSessions[role] = [...(actorSessions[role] ?? []), ref]
  }
  const domainsByPrimitive = new Map<string, Set<string>>()
  const primitiveIdsByDomain = Object.fromEntries(domains.map(domain => [
    domain,
    [...new Set(skills.filter(skill => skill.domain === domain).flatMap(skill => skill.primitives))],
  ]))
  for (const skill of skills) {
    for (const primitive of skill.primitives) {
      const mapped = domainsByPrimitive.get(primitive) ?? new Set<string>()
      mapped.add(skill.domain)
      domainsByPrimitive.set(primitive, mapped)
    }
  }
  const primitives = listPrimitiveMetadata()
    .filter(primitive => domainsByPrimitive.has(primitive.id))
    .map(primitive => ({
      id: primitive.id,
      description: primitive.description,
      tags: primitive.tags,
      domains: [...domainsByPrimitive.get(primitive.id)!],
    }))
  const executor = createPrimitiveRunner(graphStore, config, gate)
  return executeCampaign(graphStore, config, {
    executor,
    primitives,
    evidenceGate: gate,
    maxConcurrency: settings.maxConcurrency,
    maxRequests: settings.maxRequests ?? config.campaign?.maxRequests,
    maxDurationMs: settings.maxDurationMs ?? config.campaign?.maxDurationMs,
    onSliceComplete: async outcome => {
      const feedback = getOutcomeFeedbackStore()
      for (const result of outcome.results) {
        if (result.confirmed && outcome.persistedPrimitiveIds?.includes(result.primitiveId)) {
          feedback.recordOutcome(`finding:${outcome.slice.endpoint.url}:${result.primitiveId}`, result.primitiveId, { accepted: true })
          recordTechniqueConfirmed(result.primitiveId)
        } else recordTechniqueFailed(result.primitiveId)
      }
    },
    planOptions: {
      maxSlices: settings.maxSlices ?? config.campaign?.maxSlices,
      includeAnonymous: settings.includeAnonymous,
      roleFilter: settings.roleFilter,
      techniqueFilter: settings.techniqueFilter,
      domainNames: domains,
      actorSessions,
      domainPrimitiveIds: primitiveIdsByDomain,
    },
  })
}

export function createCampaignTool(config: UltimatrixConfig = defaultCampaignConfig()) {
  return createTool({
    id: 'runCampaign',
    description: 'Run deterministic, bounded coverage over discovered endpoint inputs and roles. Positives remain candidates until a proven replayable experiment and independent retest authorize promotion.',
    inputSchema: z.object({
      maxSlices: z.number().int().positive().optional(),
      maxConcurrency: z.number().int().positive().optional(),
      maxRequests: z.number().int().positive().optional(),
      maxDurationMs: z.number().int().positive().optional(),
      includeAnonymous: z.boolean().optional().default(true),
      roleFilter: z.array(z.string()).optional(),
      techniqueFilter: z.array(z.string()).optional(),
    }),
    execute: async settings => {
      const result = await runCampaignAssessment(config, new EvidenceGate(), settings)
      return {
        ok: true,
        findings: result.findings,
        coverage: result.coverage,
        budgetExceeded: result.budgetExceeded,
        slicesRun: result.slicesRun,
        requestsUsed: result.requestsUsed,
        status: result.status,
        remainingSlices: result.remainingSlices,
        domains: result.domains,
        units: result.units,
      }
    },
  })
}

/** Default-config instance for global registries (brain passes its own config). */
export const runCampaignTool = createCampaignTool()
