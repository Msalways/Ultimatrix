import { initSkillIndex } from './loader'

// ─── Tool sets ─────────────────────────────────────────────────────────────

/**
 * Full core tool set used by the brain/council/strategist.
 * Workers do NOT receive this — they get WORKER_UNIVERSAL + skillRefs.
 */
const CORE_TOOLS = [
  'listSkills',
  'loadSkillBody',
  'askUser',
  'manageSkills',
  'loadSkillReference',
  'searchSkills',
  'encodeDecode',
  'queryGraph',
  'getGraphSchema',
  'getCaptureOverview',
  'queryRelations',
  'getGraphNeighborhood',
  'getWorkflowAround',
  'traceValue',
  'explainReachability',
  'getUntestedWorkarounds',
  'verifyChains',
  'recordEvidence',
  'getDialogEvidence',
  'getRecentChanges',
  'getTargetSummary',
  'getEndpointsWithParams',
  'saveSession',
  'restoreSession',
  'getCapturedHeaders',
  'storeSession',
  'useSession',
  'extractSessionCookie',
  'getResearchStatus',
  'getOastUrlTool',
]

/**
 * Tools every worker receives regardless of skill. Deliberately minimal:
 * graph query, target context, evidence capture, auth context, encoding, HITL, OAST.
 * Workers get everything else via their skill's `toolRefs` declaration.
 */
const WORKER_UNIVERSAL = [
  'queryGraph',         // core graph access
  'getTargetSummary',   // target context
  'getEndpointsWithParams', // attack surface
  'getCapturedHeaders', // auth context (most skills need this)
  'encodeDecode',       // payload manipulation
  'askUser',            // HITL — always available
  'getOastUrlTool',     // out-of-band detection
]

const EXECUTION_TOOLS = [
  'writeFinding',
  'runPrimitive',
  'runCampaign',
  'runRecon',
  'listCapturedRequests',
  'replayCapturedRequest',
  'graphqlIntrospect',
  'jwtDecode',
  'frameworkFingerprint',
  'cloudMetadataProbe',
  'recordOutcome',
  'recordFindingCandidate',
  'assessCandidateReportability',
  'buildResearchMap',
  'planResearchExperiments',
  'compareResearchResponses',
  'evaluateResearchExperiment',
  'detectReactions',
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
]

// ─── Brain/Council tool resolution (unchanged) ─────────────────────────────

/** Brain/council: full CORE_TOOLS + skill toolRefs. */
export function resolveToolsForSkills(skillIds: string[]): string[] {
  const tools = new Set<string>(CORE_TOOLS)
  const index = initSkillIndex()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (!meta) {
      throw new Error(`Skill not found: ${id}`)
    }
    for (const t of meta.toolRefs) {
      tools.add(t)
    }
  }

  return [...tools]
}

// ─── Worker tool resolution (Phase 2: reduced surface) ─────────────────────

/**
 * Worker: WORKER_UNIVERSAL (8 tools) + skill toolRefs only.
 * No planner discovery, no bookkeeping, no session plumbing — those are
 * available to the brain/council only, or explicitly declared in a skill's
 * toolRefs.
 *
 * This cuts a worker's CORE_TOOLS from 33 to 8 (~76% reduction), so the
 * model sees far fewer bookkeeping tools and focuses on attack execution.
 */
export function resolveToolsForSkillsWorker(skillIds: string[]): string[] {
  const tools = new Set<string>(WORKER_UNIVERSAL)
  const index = initSkillIndex()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (!meta) {
      throw new Error(`Skill not found: ${id}`)
    }
    for (const t of meta.toolRefs) {
      tools.add(t)
    }
  }

  return [...tools]
}

export function getCoreTools(): string[] {
  return [...CORE_TOOLS]
}

export function getWorkerUniversal(): string[] {
  return [...WORKER_UNIVERSAL]
}

export function getExecutionTools(): string[] {
  return [...EXECUTION_TOOLS]
}

// ─── Phase 1: Resolve which primitives a skill is authorized to use ────────

/**
 * Read `meta.primitives` from the skill index for each given skill ID and
 * return the union of all declared primitive IDs. Skills that don't declare
 * `primitives` contribute nothing — they get an empty set (no scoped
 * runPrimitive).
 *
 * Used by WorkerFactory to compile a scoped `runPrimitive` tool whose schema
 * is limited to only the declared primitives.
 */
export function resolvePrimitivesForSkills(skillIds: string[]): string[] {
  const primitives = new Set<string>()
  const index = initSkillIndex()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (!meta) {
      throw new Error(`Skill not found: ${id}`)
    }
    for (const p of meta.primitives) {
      primitives.add(p)
    }
  }

  return [...primitives]
}
