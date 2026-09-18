/**
 * Capability Effects Registry (Phase 7).
 *
 * Static effect metadata for all tools. The compiler uses this to aggregate
 * effects across a worker's compiled tool set, enabling the Execution Compiler
 * to make better decisions from explicit metadata rather than guessing from
 * tool names.
 */

import type { CapabilityEffects } from './types'

/** Static effect classification of tool IDs */
export const TOOL_EFFECTS: Record<string, CapabilityEffects> = {
  // Worker universal
  queryGraph: { network: false, reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },
  getTargetSummary: { network: false, reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },
  getEndpointsWithParams: { network: false, reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },
  getCapturedHeaders: { readsSecrets: true, reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 20 },
  encodeDecode: { network: false, reversibility: 'read-only', estimatedLatencyMs: 1, estimatedTokenCost: 10 },
  askUser: { network: false, reversibility: 'read-only', estimatedLatencyMs: 0, estimatedTokenCost: 0 },
  getOastUrlTool: { network: false, reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 10 },

  // HTTP tools
  httpRequest: { network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 2000, estimatedTokenCost: 40 },
  followRedirects: { network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 3000, estimatedTokenCost: 40 },
  multipartUpload: { network: true, externallyVisible: true, createsArtifact: true, reversibility: 'read-only', estimatedLatencyMs: 5000, estimatedTokenCost: 50 },

  // Browser tools
  stagehand_navigate: { browser: true, network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 5000, estimatedTokenCost: 30 },
  stagehand_act: { browser: true, network: true, externallyVisible: true, reversibility: 'reversible', estimatedLatencyMs: 3000, estimatedTokenCost: 40 },
  stagehand_extract: { browser: true, reversibility: 'read-only', estimatedLatencyMs: 2000, estimatedTokenCost: 30 },
  stagehand_observe: { browser: true, reversibility: 'read-only', estimatedLatencyMs: 1000, estimatedTokenCost: 20 },
  stagehand_screenshot: { browser: true, createsArtifact: true, reversibility: 'read-only', estimatedLatencyMs: 2000, estimatedTokenCost: 10 },

  // Session tools
  storeSession: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 10, estimatedTokenCost: 10 },
  useSession: { readsSecrets: true, reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 10 },
  extractSessionCookie: { readsSecrets: true, reversibility: 'read-only', estimatedLatencyMs: 100, estimatedTokenCost: 10 },

  // Graph tools
  getGraphSchema: { reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 50 },
  getCaptureOverview: { reversibility: 'read-only', estimatedLatencyMs: 100, estimatedTokenCost: 40 },
  queryRelations: { reversibility: 'read-only', estimatedLatencyMs: 100, estimatedTokenCost: 40 },
  getGraphNeighborhood: { reversibility: 'read-only', estimatedLatencyMs: 100, estimatedTokenCost: 40 },
  updateGraph: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 50, estimatedTokenCost: 20 },

  // Evidence tools
  recordEvidence: { writesState: true, createsArtifact: true, reversibility: 'reversible', estimatedLatencyMs: 10, estimatedTokenCost: 10 },
  linkEvidenceToClaim: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 10, estimatedTokenCost: 10 },

  // Execution tools
  writeFinding: { writesState: true, createsArtifact: true, reversibility: 'reversible', estimatedLatencyMs: 100, estimatedTokenCost: 30 },
  runPrimitive: { mutatesTarget: true, network: true, externallyVisible: true, reversibility: 'irreversible', estimatedLatencyMs: 10000, estimatedTokenCost: 50 },
  runCampaign: { mutatesTarget: true, network: true, spawnsWorker: true, externallyVisible: true, reversibility: 'irreversible', estimatedLatencyMs: 60000, estimatedTokenCost: 60 },
  runRecon: { network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 5000, estimatedTokenCost: 40 },
  listCapturedRequests: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 20 },
  replayCapturedRequest: { network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 3000, estimatedTokenCost: 40 },
  recordOutcome: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 10, estimatedTokenCost: 10 },
  recordFindingCandidate: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 50, estimatedTokenCost: 20 },
  assessCandidateReportability: { reversibility: 'read-only', estimatedLatencyMs: 100, estimatedTokenCost: 30 },

  // Planner discovery
  listSkills: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 20 },
  searchSkills: { reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },
  loadSkillBody: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 100 },
  loadSkillReference: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 50 },
  manageSkills: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 100, estimatedTokenCost: 30 },

  // Planner bookkeeping
  getDialogEvidence: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 20 },
  getRecentChanges: { reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },
  getResearchStatus: { reversibility: 'read-only', estimatedLatencyMs: 50, estimatedTokenCost: 30 },

  // Worker spawning
  spawnWorker: { spawnsWorker: true, reversibility: 'irreversible', estimatedLatencyMs: 1000, estimatedTokenCost: 20 },
  spawnSwarm: { spawnsWorker: true, reversibility: 'irreversible', estimatedLatencyMs: 2000, estimatedTokenCost: 30 },
  executeDirect: { network: true, externallyVisible: true, reversibility: 'irreversible', estimatedLatencyMs: 5000, estimatedTokenCost: 40 },
  runAdvancedPlaybook: { mutatesTarget: true, network: true, reversibility: 'irreversible', estimatedLatencyMs: 30000, estimatedTokenCost: 60 },

  // Crawl tools
  startCrawl: { network: true, browser: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 10000, estimatedTokenCost: 30 },
  getCrawlStatus: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 10 },
  stopCrawl: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 10 },

  // Scope tools
  checkScope: { reversibility: 'read-only', estimatedLatencyMs: 1, estimatedTokenCost: 5 },
  setScopeConfig: { writesState: true, reversibility: 'reversible', estimatedLatencyMs: 1, estimatedTokenCost: 5 },

  // Model selection tools
  getModelRecommendation: { reversibility: 'read-only', estimatedLatencyMs: 10, estimatedTokenCost: 10 },

  // Web search
  webSearch: { network: true, externallyVisible: true, reversibility: 'read-only', estimatedLatencyMs: 3000, estimatedTokenCost: 30 },
}

/**
 * Aggregate effects from a set of tools.
 * Merges boolean flags (any true → true), sums numeric values, picks worst reversibility.
 */
export function aggregateEffects(toolIds: string[]): CapabilityEffects {
  const result: CapabilityEffects = {
    network: false,
    browser: false,
    filesystem: false,
    readsSecrets: false,
    writesState: false,
    createsArtifact: false,
    mutatesTarget: false,
    spawnsWorker: false,
    externallyVisible: false,
    estimatedLatencyMs: 0,
    estimatedTokenCost: 0,
    reversibility: 'read-only',
  }

  const reversibilityOrder = { 'read-only': 0, 'reversible': 1, 'irreversible': 2 }

  for (const toolId of toolIds) {
    const effects = TOOL_EFFECTS[toolId]
    if (!effects) continue

    if (effects.network) result.network = true
    if (effects.browser) result.browser = true
    if (effects.filesystem) result.filesystem = true
    if (effects.readsSecrets) result.readsSecrets = true
    if (effects.writesState) result.writesState = true
    if (effects.createsArtifact) result.createsArtifact = true
    if (effects.mutatesTarget) result.mutatesTarget = true
    if (effects.spawnsWorker) result.spawnsWorker = true
    if (effects.externallyVisible) result.externallyVisible = true

    result.estimatedLatencyMs = (result.estimatedLatencyMs ?? 0) + (effects.estimatedLatencyMs ?? 0)
    result.estimatedTokenCost = (result.estimatedTokenCost ?? 0) + (effects.estimatedTokenCost ?? 0)

    if (effects.reversibility) {
      const current = reversibilityOrder[result.reversibility ?? 'read-only']
      const incoming = reversibilityOrder[effects.reversibility]
      if (incoming > current) {
        result.reversibility = effects.reversibility
      }
    }
  }

  return result
}

/**
 * Get effects for a single tool (returns empty object if unknown).
 */
export function getToolEffects(toolId: string): CapabilityEffects {
  return TOOL_EFFECTS[toolId] ?? {}
}
