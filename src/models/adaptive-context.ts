/**
 * Adaptive Context Engine — fits any model by compressing instructions + tools.
 *
 * When the model context window is too small for the full payload:
 *   1. Compress brain instructions (progressive detail levels)
 *   2. Reduce tool surface (core-only when tight)
 *   3. Only then truncate the goal (last resort)
 *
 * This makes Ultimatrix work with ANY model — small context models get
 * compact prompts + minimal tools; large context models get full detail.
 */

import type { ContextWindowRegistry } from '../models/context-window-registry'

export type DetailLevel = 'full' | 'compact' | 'minimal'

export interface AdaptivePlan {
  detailLevel: DetailLevel
  toolBudget: number         // max number of tool schemas to include
  compressEvidence: boolean  // strip EVIDENCE_DISCIPLINE section
  compressAssumptions: boolean // strip ASSUMPTION_VERIFICATION section
  stripWorkflow: boolean     // strip workflow/output format rules
  compactBrainMd: boolean    // use only the first paragraph of each brain section
}

export interface AdaptiveContextParams {
  contextWindow: number         // from registry or fallback
  systemPromptTokens: number    // estimated tokens of full brain instructions
  toolSchemasTokens: number     // estimated tokens of all tool schemas
  goalTokens: number
  historyTokens: number
  reservedOutputTokens: number  // expected output budget
}

/**
 * Determine what level of compression is needed based on available context.
 */
export function planAdaptiveContext(params: AdaptiveContextParams): AdaptivePlan {
  const { contextWindow, systemPromptTokens, toolSchemasTokens, goalTokens, historyTokens, reservedOutputTokens } = params

  const totalNeeded = systemPromptTokens + toolSchemasTokens + goalTokens + historyTokens + reservedOutputTokens

  if (totalNeeded <= contextWindow * 0.80) {
    // Plenty of room — full detail
    return {
      detailLevel: 'full',
      toolBudget: 999,      // all tools
      compressEvidence: false,
      compressAssumptions: false,
      stripWorkflow: false,
      compactBrainMd: false,
    }
  }

  if (totalNeeded <= contextWindow * 0.95) {
    // Tight but workable — compact detail, fewer tools
    return {
      detailLevel: 'compact',
      toolBudget: Math.max(15, Math.floor(toolSchemasTokens / (totalNeeded / contextWindow * 0.9) * 0.6)),
      compressEvidence: false,
      compressAssumptions: true,   // strip assumption verification (lower priority)
      stripWorkflow: false,
      compactBrainMd: false,
    }
  }

  if (systemPromptTokens + goalTokens + reservedOutputTokens <= contextWindow * 0.90) {
    // Very tight — minimal brain, core tools only
    return {
      detailLevel: 'minimal',
      toolBudget: 10,       // core tools only
      compressEvidence: true,
      compressAssumptions: true,
      stripWorkflow: true,
      compactBrainMd: true,
    }
  }

  // Extreme pressure — absolute minimum
  return {
    detailLevel: 'minimal',
    toolBudget: 5,
    compressEvidence: true,
    compressAssumptions: true,
    stripWorkflow: true,
    compactBrainMd: true,
  }
}

/**
 * Compress brain instructions based on the adaptive plan.
 * Single source of truth: the same brain.md is compressed differently per model.
 */
export function compressBrainInstructions(
  fullInstructions: string,
  plan: AdaptivePlan,
): string {
  if (plan.detailLevel === 'full') return fullInstructions

  let text = fullInstructions

  // Strip evidence discipline section
  if (plan.compressEvidence) {
    text = stripSection(text, 'Evidence & Integrity')
  }

  // Strip assumption verification section
  if (plan.compressAssumptions) {
    text = stripSection(text, 'Assumption Verification')
  }

  // Strip workflow/output format rules (keep only safety + core rules)
  if (plan.stripWorkflow) {
    text = stripSection(text, 'Output Format')
    text = stripSection(text, 'Workflow')
    text = stripSection(text, 'Tool Usage')
  }

  // Compact brain: keep first paragraph of each ### section
  if (plan.compactBrainMd) {
    text = compactSections(text)
  }

  return text.trim()
}

/**
 * Filter tool schemas to fit within the budget.
 * Prioritizes core security tools over auxiliary ones.
 */
export function filterToolsToBudget(
  allToolEntries: Array<[string, any]>,
  budget: number,
): Record<string, any> {
  if (allToolEntries.length <= budget) {
    return Object.fromEntries(allToolEntries)
  }

  // Priority tiers: lower index = higher priority
  const PRIORITY: Record<string, number> = {
    // Tier 1: core security (always keep)
    httpRequest: 0,
    writeFinding: 0,
    queryGraph: 0,
    runPrimitive: 0,
    addEndpoint: 0,
    getTargetSummary: 0,
    // Tier 2: reconnaissance
    followRedirects: 1,
    getGraphSchema: 1,
    getCaptureOverview: 1,
    queryRelations: 1,
    recordEvidence: 1,
    // Tier 3: browser + session
    stagehand_navigate: 2,
    stagehand_observe: 2,
    stagehand_extract: 2,
    stagehand_act: 2,
    useSession: 2,
    extractSessionCookie: 2,
    // Tier 4: research + orchestration
    buildResearchMap: 3,
    planResearchExperiments: 3,
    getResearchStatus: 3,
    diagnoseTarget: 3,
    runCampaign: 3,
    // Tier 5: auxiliary (first to drop)
    spawnWorker: 4,
    spawnSwarm: 4,
    runTaskGraph: 4,
    executeDirect: 4,
    observeHumanActions: 5,
    detectReactions: 5,
    getDialogEvidence: 5,
    getRecentChanges: 5,
    askUser: 5,
    recordOutcome: 5,
    getOastUrlTool: 5,
    checkOastCallbacks: 5,
    listSkills: 5,
    searchSkills: 5,
    loadSkillReference: 5,
    loadSkillBody: 5,
    manageSkills: 5,
    selectModel: 5,
  }

  const scored = allToolEntries
    .map(([name, tool]) => ({ name, tool, priority: PRIORITY[name] ?? 3 }))
    .sort((a, b) => a.priority - b.priority)

  const result: Record<string, any> = {}
  let count = 0
  for (const entry of scored) {
    if (count >= budget) break
    result[entry.name] = entry.tool
    count++
  }
  return result
}

// ─── Helpers ────────────────────────────────────────────────────────

function stripSection(text: string, heading: string): string {
  // Match ### heading to next ### or ## or end
  const regex = new RegExp(`\\n### ${escapeRegex(heading)}\\n[\\s\\S]*?(?=\\n### |\\n## |$)`, 'i')
  return text.replace(regex, '')
}

function compactSections(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let inSection = false
  let foundContent = false
  let skipContent = false

  for (const line of lines) {
    if (line.startsWith('### ') || line.startsWith('## ')) {
      inSection = line.startsWith('### ')
      foundContent = false
      skipContent = false
      out.push(line)
      continue
    }

    if (inSection) {
      const isBlank = line.trim() === ''

      // Skip blank lines right after heading (before content)
      if (isBlank && !foundContent) continue

      // Found first non-blank content line
      if (!isBlank && !foundContent) {
        foundContent = true
        out.push(line)
        continue
      }

      // After first paragraph: blank line = end of first para → skip rest
      if (isBlank && foundContent) {
        skipContent = true
        continue
      }

      if (skipContent) continue
      out.push(line)
    } else {
      out.push(line)
    }
  }

  return out.join('\n')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
