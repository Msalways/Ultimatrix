/**
 * Capability Compiler (Phase 6).
 *
 * Compiles a narrow, typed tool surface for a worker from skill declarations
 * + policy constraints. Single source of truth for what a worker can do.
 *
 * Replaces the ad-hoc resolveToolsForSkillsWorker() + resolvePrimitivesForSkills()
 * pattern with a single, testable, policy-enforced operation.
 */

import type {
  CompiledCapabilitySet,
  CompilerInput,
  CompilerPolicy,
  EvidencePolicy,
  CapabilityCoverageValidation,
} from './types'
import { DEFAULT_COMPILER_POLICY, TOKENS_PER_TOOL } from './types'
import { isToolAllowedByPolicy, getToolCategory } from './registry'
import { initSkillIndex } from '../solver/skills/loader'

/**
 * Capability-to-tool mapping.
 * Maps semantic capability IDs (from SkillContract) to the tool IDs that
 * satisfy them. Multiple tools can satisfy the same capability.
 */
const CAPABILITY_TOOL_MAP: Record<string, string[]> = {
  'network.request': ['httpRequest', 'followRedirects', 'multipartUpload'],
  'response.compare': ['compareResponses', 'measureTiming'],
  'session.actor-context': ['getCapturedHeaders', 'storeSession', 'useSession', 'extractSessionCookie'],
  'primitive.execute': ['runPrimitive'],
  'evidence.capture': ['recordEvidence', 'linkEvidenceToClaim'],
  'finding.write': ['writeFinding'],
  'graph.query': ['queryGraph', 'getGraphSchema', 'getEndpointsWithParams'],
  'graph.update': ['updateGraph'],
  'skill.discovery': ['listSkills', 'searchSkills', 'loadSkillReference'],
  'browser.interact': ['stagehand_navigate', 'stagehand_act', 'stagehand_extract'],
  'browser.observe': ['stagehand_observe', 'stagehand_screenshot'],
}

/** Merge user policy with defaults */
function resolvePolicy(overrides?: CompilerPolicy): Required<CompilerPolicy> {
  return { ...DEFAULT_COMPILER_POLICY, ...(overrides ?? {}) }
}

/**
 * Compile a capability set for the given skill IDs and policy.
 *
 * The compilation is deterministic: same inputs → same output.
 * Order of tools: worker-universal first, then skill-specific, then execution.
 */
export function compileCapabilities(input: CompilerInput): CompiledCapabilitySet {
  const policy = resolvePolicy(input.policy)
  const index = initSkillIndex()

  // Collect all skill metadata
  const skills = input.skillIds.map(id => {
    const meta = index.get(id)
    if (!meta) throw new Error(`Skill not found: ${id}`)
    return meta
  })

  // Primary skill (first) is the "owner" of this compilation
  const primarySkill = skills[0]

  // ─── Compile tools ───────────────────────────────────────────────────
  const tools = new Set<string>()

  // 1. Worker-universal tools (always included)
  for (const [toolId, category] of Object.entries({
    queryGraph: 'worker-universal',
    getTargetSummary: 'worker-universal',
    getEndpointsWithParams: 'worker-universal',
    getCapturedHeaders: 'worker-universal',
    encodeDecode: 'worker-universal',
    askUser: 'worker-universal',
    getOastUrlTool: 'worker-universal',
  })) {
    if (isToolAllowedByPolicy(toolId, policy)) {
      tools.add(toolId)
    }
  }

  // 2. Skill-declared tools (from toolRefs) — filtered by policy
  for (const skill of skills) {
    for (const toolId of skill.toolRefs) {
      if (isToolAllowedByPolicy(toolId, policy)) {
        tools.add(toolId)
      }
    }
  }

  // 3. Enforce max tools
  if (tools.size > policy.maxTools) {
    // Keep worker-universal + execution tools, drop excess skill-specific
    const sorted = [...tools].sort((a, b) => {
      const catA = getToolCategory(a)
      const catB = getToolCategory(b)
      const priority: Record<string, number> = {
        'worker-universal': 0,
        'execution': 1,
        'evidence': 2,
        'skill-specific': 3,
      }
      return (priority[catA] ?? 99) - (priority[catB] ?? 99)
    })
    tools.clear()
    for (const id of sorted.slice(0, policy.maxTools)) {
      tools.add(id)
    }
  }

  // ─── Compile primitives ──────────────────────────────────────────────
  const primitives = new Set<string>()
  for (const skill of skills) {
    for (const p of skill.primitives) {
      primitives.add(p)
    }
  }

  // ─── Evidence policy ─────────────────────────────────────────────────
  const evidencePolicy: EvidencePolicy = {
    autoCapture: true, // httpRequest always auto-captures
    manualEvidenceAllowed: policy.allowManualEvidence,
    requireClaimBeforeWrite: true, // findings must have evidence
  }

  // ─── Estimate tokens ─────────────────────────────────────────────────
  const estimatedTokens = tools.size * TOKENS_PER_TOOL

  // ─── Skill Contract validation (Strix Adaptation Phase B) ────────────
  const contract = primarySkill.contract
  let coverageValidation: CapabilityCoverageValidation | undefined

  if (contract && contract.capabilities.length > 0) {
    const toolSet = tools
    const covered: string[] = []
    const uncovered: string[] = []

    for (const cap of contract.capabilities) {
      const satisfyingTools = CAPABILITY_TOOL_MAP[cap] ?? []
      const hasCoverage = satisfyingTools.some(t => toolSet.has(t))
      if (hasCoverage) {
        covered.push(cap)
      } else {
        uncovered.push(cap)
      }
    }

    coverageValidation = {
      required: contract.capabilities,
      covered,
      uncovered,
      complete: uncovered.length === 0,
    }
  }

  return {
    tools: [...tools],
    primitives: [...primitives],
    evidencePolicy,
    skill: primarySkill,
    estimatedTokens,
    ...(contract ? { contract } : {}),
    ...(coverageValidation ? { coverageValidation } : {}),
  }
}
