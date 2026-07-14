/**
 * Council factory (A10 + A11).
 *
 * Root-cause rewrite: builds agents that output STRUCTURED JSON with typed fields.
 * The factory parses the LLM's JSON output block into MemberOutput typed fields.
 * No substring scanning — the orchestrator reads typed fields.
 *
 * Each LLM member is a real agent wired with the full tool set, so the operator
 * can actually execute approved experiments and the strategist can gather evidence.
 */

import { createAgent } from '../mastra'
import type { UltimatrixConfig } from '../config'
import type { SkillRegistry } from '../solver/skills/registry'
import type { WorkerPool } from '../workers/pool'
import type { StagehandBrowser } from '@mastra/stagehand'
import { personaFor, personaMetadataFor, defaultCouncilConfig } from './personas'
import { ConversationBus } from './bus'
import { SharedBlackboard } from './blackboard-shared'
import type { CouncilConfig, CouncilMember, CouncilMemberRole, MemberOutput, CouncilIntent, ImpactLevel, TaskComplexity } from './types'
import type { Skill } from '../solver/skills/loader'
import { createSpawnWorkerTool } from '../manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../manager/tools/spawn-swarm'
import { createExecuteDirectTool } from '../manager/tools/execute-direct'
import { TOOL_IDS } from '../mastra/tools'
import { ModelSelector } from '../models/selector'
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { createSanitizedInputSchema } from '../models/schema-sanitizer'
import type { StandardSchemaWithJSON } from '@mastra/schema-compat/schema'
import { log } from '../utils/logger'

/** Local sanitizer mirroring brain-tools.sanitizeTool — avoids a circular import. */
function sanitizeTool(tool: any, provider?: string): any {
  if (tool.inputSchema && typeof tool.inputSchema === 'object' && '~standard' in (tool.inputSchema as object)) {
    return { ...tool, inputSchema: createSanitizedInputSchema(tool.inputSchema as StandardSchemaWithJSON, provider) }
  }
  return tool
}

export interface CouncilResources {
  members: CouncilMember[]
  bus: ConversationBus
  blackboard: SharedBlackboard
  councilConfig: CouncilConfig
}

export interface CouncilDeps {
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
  browser: StagehandBrowser
}

const LLM_ROLES: CouncilMemberRole[] = ['strategist', 'operator', 'skeptic', 'analyst']

// ─── Structured output parsing ─────────────────────────────────────────────

/**
 * Parse structured JSON output from an LLM response.
 * Extracts the JSON code block and maps it to typed MemberOutput fields.
 * No substring scanning — reads the JSON object's typed fields.
 */
export function parseStructuredOutput(rawText: string): MemberOutput {
  const text = typeof rawText === 'string' ? rawText : String(rawText ?? '')

  // Extract JSON code block (```json ... ```)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (!jsonMatch) {
    // Fallback: try to find a raw JSON object in the text
    const objectMatch = text.match(/\{[\s\S]*"intent"[\s\S]*\}/)
    if (!objectMatch) {
      return { text, intent: 'propose' } // Default to propose if no structured output
    }
    return parseJsonBlock(objectMatch[0], text)
  }

  return parseJsonBlock(jsonMatch[1], text)
}

function parseJsonBlock(jsonStr: string, fullText: string): MemberOutput {
  try {
    const parsed = JSON.parse(jsonStr.trim())

    const intent: CouncilIntent = isValidIntent(parsed.intent) ? parsed.intent : 'propose'

    const output: MemberOutput = {
      text: fullText,
      intent,
    }

    if (parsed.proposal && intent === 'propose') {
      output.proposal = {
        action: typeof parsed.proposal.action === 'string' ? parsed.proposal.action : fullText.slice(0, 200),
        skillId: typeof parsed.proposal.skillId === 'string' ? parsed.proposal.skillId : 'general',
        endpointId: typeof parsed.proposal.endpointId === 'string' ? parsed.proposal.endpointId : undefined,
        complexity: isValidComplexity(parsed.proposal.complexity) ? parsed.proposal.complexity : 'medium',
        impact: isValidImpact(parsed.proposal.impact) ? parsed.proposal.impact : 'low',
        reasoning: typeof parsed.proposal.reasoning === 'string' ? parsed.proposal.reasoning : '',
        evidenceRequired: Array.isArray(parsed.proposal.evidenceRequired) ? parsed.proposal.evidenceRequired : [],
      }
    }

    if (parsed.critique && intent === 'critique') {
      output.critique = {
        targets: Array.isArray(parsed.critique.targets) ? parsed.critique.targets : [],
        agreements: Array.isArray(parsed.critique.agreements) ? parsed.critique.agreements : [],
        disagreements: Array.isArray(parsed.critique.disagreements) ? parsed.critique.disagreements : [],
        evidenceGaps: Array.isArray(parsed.critique.evidenceGaps) ? parsed.critique.evidenceGaps : [],
        alternative: typeof parsed.critique.alternative === 'string' ? parsed.critique.alternative : undefined,
      }
    }

    if (parsed.reflection && (intent === 'complete' || intent === 'escalate')) {
      output.reflection = {
        whatWorked: Array.isArray(parsed.reflection.whatWorked) ? parsed.reflection.whatWorked : [],
        whatFailed: Array.isArray(parsed.reflection.whatFailed) ? parsed.reflection.whatFailed : [],
        whatLearned: Array.isArray(parsed.reflection.whatLearned) ? parsed.reflection.whatLearned : [],
        nextSteps: Array.isArray(parsed.reflection.nextSteps) ? parsed.reflection.nextSteps : [],
      }
    }

    // Structured evidence claim (FindingClaim). The skeptic structurally verifies
    // claim.observed against the recorded evidence ledger — this is how
    // evidence-integrity is enforced without scanning free text.
    if (parsed.claim && typeof parsed.claim === 'object') {
      const c = parsed.claim
      const observed = c.observed && typeof c.observed === 'object' ? c.observed : undefined
      output.claim = {
        type: typeof c.type === 'string' ? c.type : 'finding',
        endpoint: typeof c.endpoint === 'string' ? c.endpoint : '',
        param: typeof c.param === 'string' ? c.param : undefined,
        method: typeof c.method === 'string' ? c.method : undefined,
        observed: observed
          ? {
              method: typeof observed.method === 'string' ? observed.method : undefined,
              url: typeof observed.url === 'string' ? observed.url : undefined,
              status: typeof observed.status === 'number' ? observed.status : undefined,
            }
          : undefined,
      }
    }

    return output
  } catch {
    return { text: fullText, intent: 'propose' } // JSON parse failure — fallback
  }
}

function isValidIntent(v: unknown): v is CouncilIntent {
  return v === 'propose' || v === 'critique' || v === 'complete' || v === 'escalate'
}

function isValidImpact(v: unknown): v is ImpactLevel {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical'
}

function isValidComplexity(v: unknown): v is TaskComplexity {
  return v === 'low' || v === 'medium' || v === 'high' || v === 'critical'
}

// ─── Member factory ────────────────────────────────────────────────────────

function makeMember(config: UltimatrixConfig, role: CouncilMemberRole, deps: CouncilDeps): CouncilMember {
  const persona = personaFor(role)
  const meta = personaMetadataFor(role)

  // Inject the persona voice as a synthetic skill so createAgent's instruction
  // assembly picks it up (no hardcoded string scanning — it is the agent face).
  const skill = {
    id: `council-${role}`,
    name: `Council ${role}`,
    tier: meta.tier ?? 'balanced',
    description: (meta.description ?? persona).slice(0, 80),
    toolRefs: [],
    triggers: [],
    tags: [],
    instructions: persona,
  } as unknown as Skill

  // Per-role tool filtering from YAML frontmatter.
  // `toolRestrictions` is parsed from the persona .md frontmatter. A literal "*"
  // means "no restriction" (all tools). An array means an explicit allow-list.
  // Unknown tool IDs in the list are dropped so a typo in a persona file can
  // never widen the tool surface — it can only narrow it.
  const toolRestrictions = meta.toolRestrictions
  let toolIds: string[] | undefined
  if (toolRestrictions && toolRestrictions !== '*') {
    const allowed = new Set<string>(TOOL_IDS as readonly string[])
    const requested = Array.isArray(toolRestrictions) ? toolRestrictions : [toolRestrictions]
    toolIds = requested.filter(t => allowed.has(t))
    if (toolIds.length === 0) {
      // Every requested tool was unknown — fail safe to NO tools rather than ALL.
      log.warn(`[council] role ${role}: all requested toolRestrictions were unknown; exposing no tools`)
    }
  }

  // Role-specific orchestration tools (operator executes; others deliberate).
  const extraTools: Record<string, any> = role === 'operator' ? {
    spawnWorker: createSpawnWorkerTool(config, deps.skillRegistry, deps.workerPool),
    spawnSwarm: createSpawnSwarmTool(config, deps.skillRegistry, deps.workerPool),
    executeDirect: createExecuteDirectTool(config, deps.skillRegistry),
  } : {}

  // Dynamic model-selection reasoning for planning (strategist) and execution (operator).
  // Other roles deliberate on evidence/strategy, not model choice.
  if (role === 'strategist' || role === 'operator') {
    const selector = new ModelSelector(
      config.modelCapabilities ?? {},
      config.budgetPolicy ?? { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false },
      config,
    )
    extraTools.selectModel = sanitizeTool(createTool({
      id: 'selectModel',
      description: 'Select the optimal model for a proposed task based on capabilities, budget, and rate limits. Use before planning (strategist) or executing (operator) to justify the model choice.',
      inputSchema: z.object({
        skillId: z.string().describe('ID of the skill'),
        taskDescription: z.string().describe('Task description'),
        complexity: z.enum(['low', 'medium', 'high', 'critical']).describe('Task complexity'),
        requiredCapabilities: z.array(z.string()).optional().describe('Required model capabilities'),
      }),
      execute: async ({ skillId, taskDescription, complexity, requiredCapabilities }) => {
        const selection = selector.selectForTask({ skillId, taskDescription, complexity, requiredCapabilities }, 'worker')
        log.info(`[model] Recommended: ${selection.modelId} (${selection.tier}) for ${complexity} task "${skillId}" — ${selection.reasoning}`)
        return { ok: true, selection, explanation: selector.explainSelection(selection, { skillId, taskDescription, complexity }) }
      },
    }), config.provider)
  }

  const agent = createAgent(config, {
    skillRegistry: deps.skillRegistry,
    workerPool: deps.workerPool,
    browser: deps.browser,
    skills: [skill],
    extraTools,
    ...(toolIds ? { toolIds } : {}),
  })

  return {
    role,
    id: `council-${role}`,
    tier: 'balanced',
    respond: async (prompt: string) => {
      const res = await agent.generate(prompt)
      const rawText = typeof res.text === 'string' ? res.text : String(res.text ?? '')
      return parseStructuredOutput(rawText)
    },
  }
}

export function createCouncil(config: UltimatrixConfig, deps: CouncilDeps, sharedBlackboard?: import('../core/blackboard').Blackboard): CouncilResources {
  const members: CouncilMember[] = LLM_ROLES.map((role) => makeMember(config, role, deps))

  // Human is seated but does not "speak" through an LLM — approval is handled by
  // the host via decideApproval / the HITL gate.
  members.push({
    role: 'human',
    id: 'council-human',
    tier: 'balanced',
    respond: async () => ({ text: '', intent: 'propose' as const }),
  })

  // Use shared blackboard if provided, otherwise create isolated one
  const blackboard = sharedBlackboard
    ? new SharedBlackboard(sharedBlackboard)
    : new SharedBlackboard()

  return {
    members,
    bus: new ConversationBus(),
    blackboard,
    councilConfig: config.council ?? defaultCouncilConfig(),
  }
}
