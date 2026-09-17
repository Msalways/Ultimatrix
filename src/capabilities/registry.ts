/**
 * Capability Registry — tool category taxonomy + risk classification.
 *
 * Classifies every tool into named categories and risk tiers. The compiler
 * uses this to enforce policy constraints. The registry is static — it does
 * NOT depend on the runtime tool registry.
 */

import type { CapabilityRisk } from '../extensions/grants'

/** Tool categories used by the compiler */
export type ToolCategory =
  | 'worker-universal'     // Always available to workers
  | 'skill-specific'       // From skill toolRefs
  | 'planner-discovery'    // listSkills, searchSkills, etc. — brain only
  | 'planner-bookkeeping'  // getDialogEvidence, getRecentChanges — brain only
  | 'session-plumbing'     // saveSession, restoreSession, etc. — brain only
  | 'graph-analysis'       // queryRelations, getGraphSchema, etc. — brain only
  | 'execution'            // writeFinding, runPrimitive — per-skill
  | 'evidence'             // linkEvidenceToClaim — per-skill

/** Static classification of tool IDs to categories */
const TOOL_CATEGORIES: Record<string, ToolCategory> = {
  // Worker universal
  queryGraph: 'worker-universal',
  getTargetSummary: 'worker-universal',
  getEndpointsWithParams: 'worker-universal',
  getCapturedHeaders: 'worker-universal',
  encodeDecode: 'worker-universal',
  askUser: 'worker-universal',
  getOastUrlTool: 'worker-universal',

  // Planner discovery
  listSkills: 'planner-discovery',
  loadSkillBody: 'planner-discovery',
  searchSkills: 'planner-discovery',
  manageSkills: 'planner-discovery',
  loadSkillReference: 'planner-discovery',

  // Planner bookkeeping
  getDialogEvidence: 'planner-bookkeeping',
  getRecentChanges: 'planner-bookkeeping',
  getResearchStatus: 'planner-bookkeeping',

  // Session plumbing
  saveSession: 'session-plumbing',
  restoreSession: 'session-plumbing',
  storeSession: 'session-plumbing',
  useSession: 'session-plumbing',
  extractSessionCookie: 'session-plumbing',

  // Graph analysis
  getGraphSchema: 'graph-analysis',
  getCaptureOverview: 'graph-analysis',
  queryRelations: 'graph-analysis',
  getGraphNeighborhood: 'graph-analysis',
  getWorkflowAround: 'graph-analysis',
  traceValue: 'graph-analysis',
  explainReachability: 'graph-analysis',
  getUntestedWorkarounds: 'graph-analysis',
  verifyChains: 'graph-analysis',

  // Execution
  writeFinding: 'execution',
  runPrimitive: 'execution',
  runCampaign: 'execution',
  runRecon: 'execution',
  listCapturedRequests: 'execution',
  replayCapturedRequest: 'execution',
  recordOutcome: 'execution',
  recordFindingCandidate: 'execution',
  assessCandidateReportability: 'execution',

  // Evidence
  recordEvidence: 'evidence',
  linkEvidenceToClaim: 'evidence',
}

/** Categories that are always blocked for workers */
export const WORKER_BLOCKED_CATEGORIES: ToolCategory[] = [
  'planner-discovery',
  'planner-bookkeeping',
]

/** Categories that require explicit policy opt-in */
export const POLICY_CONTROLLED_CATEGORIES: Record<ToolCategory, keyof import('./types').CompilerPolicy> = {
  'session-plumbing': 'allowSessionTools',
  'graph-analysis': 'allowGraphAnalysisTools',
  'evidence': 'allowManualEvidence',
  'worker-universal': 'allowManualEvidence', // not actually controlled, placeholder
  'skill-specific': 'allowManualEvidence',   // not actually controlled, placeholder
  'execution': 'allowManualEvidence',         // not actually controlled, placeholder
  'planner-discovery': 'allowManualEvidence', // not actually controlled, placeholder
  'planner-bookkeeping': 'allowManualEvidence', // not actually controlled, placeholder
}

/**
 * Look up the category for a tool ID.
 * Returns 'skill-specific' for unknown tools (they come from skill toolRefs).
 */
export function getToolCategory(toolId: string): ToolCategory {
  return TOOL_CATEGORIES[toolId] ?? 'skill-specific'
}

/**
 * Check if a tool is allowed by policy.
 */
export function isToolAllowedByPolicy(
  toolId: string,
  policy: Required<import('./types').CompilerPolicy>,
): boolean {
  const category = getToolCategory(toolId)

  // Worker-blocked categories are never allowed
  if (WORKER_BLOCKED_CATEGORIES.includes(category)) return false

  // Policy-controlled categories
  if (category === 'session-plumbing' && !policy.allowSessionTools) return false
  if (category === 'graph-analysis' && !policy.allowGraphAnalysisTools) return false
  if (category === 'evidence' && !policy.allowManualEvidence) return false

  return true
}

// ─── Risk Classification (Strix Adaptation Phase C) ────────────────────────

/** Static risk classification for known tools. Unknown tools default to 'network' (conservative). */
const TOOL_RISK_MAP: Record<string, CapabilityRisk> = {
  // read — zero risk, no side effects
  queryGraph: 'read',
  getTargetSummary: 'read',
  getEndpointsWithParams: 'read',
  getGraphSchema: 'read',
  getCaptureOverview: 'read',
  queryRelations: 'read',
  getGraphNeighborhood: 'read',
  getWorkflowAround: 'read',
  traceValue: 'read',
  explainReachability: 'read',
  getUntestedWorkarounds: 'read',
  listSkills: 'read',
  searchSkills: 'read',
  loadSkillReference: 'read',
  loadSkillBody: 'read',
  getCapturedHeaders: 'read',
  encodeDecode: 'read',
  getDialogEvidence: 'read',
  getRecentChanges: 'read',
  getResearchStatus: 'read',
  getToolResult: 'read',
  measureTiming: 'read',
  compareResponses: 'read',
  inspectArtifact: 'read',
  listTools: 'read',
  loadTool: 'read',

  // network — makes external requests
  httpRequest: 'network',
  followRedirects: 'network',
  multipartUpload: 'network',
  getOastUrlTool: 'network',
  checkOastCallbacks: 'network',
  requestAsActor: 'network',
  crawlTarget: 'network',
  runRecon: 'network',
  omitHeader: 'network',

  // mutate — changes state
  writeFinding: 'mutate',
  runPrimitive: 'mutate',
  recordEvidence: 'mutate',
  linkEvidenceToClaim: 'mutate',
  updateGraph: 'mutate',
  upsertPage: 'mutate',
  addAction: 'mutate',
  addInput: 'mutate',
  addEndpoint: 'mutate',
  saveSession: 'mutate',
  restoreSession: 'mutate',
  storeSession: 'mutate',
  useSession: 'mutate',
  extractSessionCookie: 'mutate',
  extractCsrfToken: 'mutate',
  recordTestCase: 'mutate',
  recordOutcome: 'mutate',
  manageSkills: 'mutate',
  askUser: 'mutate',

  // delegate — spawns other agents
  spawnWorker: 'delegate',
  spawnSwarm: 'delegate',
  runCampaign: 'delegate',
  runAdvancedPlaybook: 'delegate',
  executeDirect: 'delegate',
  runTaskGraph: 'delegate',
  requestCapability: 'delegate',
}

/**
 * Classify a tool's risk tier.
 * Returns 'network' for unknown tools (conservative default).
 */
export function classifyToolRisk(toolId: string): CapabilityRisk {
  return TOOL_RISK_MAP[toolId] ?? 'network'
}
