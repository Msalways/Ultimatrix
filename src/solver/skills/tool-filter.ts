import { initSkillIndex } from './loader'

// ─── Tool sets ─────────────────────────────────────────────────────────────

/**
 * Full core tool set used by the brain/council/strategist.
 * Workers do NOT receive this — they get WORKER_UNIVERSAL + skillRefs.
 */
/**
 * Tools the brain always receives, regardless of which skills are selected.
 *
 * Membership here is a statement that a capability is part of the agent's
 * standing contract, not merely something it may fetch. A tool the prompt
 * instructs the agent to use belongs here: verified live, a mandate that named
 * a load-on-demand tool was silently unenforceable.
 */
export const CORE_TOOLS = [
  'listSkills',
  'discoverSkillsForTarget',
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
  'observeHumanActions',
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
  // Rulings are a core capability, not an optional one. Verified live: with
  // these absent, the brain could still reach them via loadTool, so the wiring
  // looked correct — but on a casual turn ("those reflected-parameter things
  // are just how it is built, stop bringing them up") the model never needed a
  // tool, never loaded one, and simply PROMISED to comply. Nothing was recorded.
  // A mandate that depends on a tool the agent does not already carry is not a
  // mandate; these sit beside recordEvidence/askUser for the same reason.
  'recordDisposition',
  'getDispositions',
  // Delegation, same reasoning as in brain-tools BOOTSTRAP_TOOL_IDS. Kept in
  // step deliberately: the two sets are separate gates, and a capability added
  // to only one of them is invisible half the time — which is precisely how the
  // worker path stayed dead while every other check looked green.
  'spawnWorker',
  'runTaskGraph',
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
  'executePlannedExperiment',
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
