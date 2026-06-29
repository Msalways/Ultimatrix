/**
 * Organic Solver Engine — Agent-driven security exploration
 *
 * Single agent.stream() call per REPL turn. The LLM drives everything:
 * what tools to call, in what order, when to stop. Mastra handles the
 * tool-call → tool-result → reasoning cycle internally via maxSteps.
 *
 * Intelligence layers (EvidenceGate, Reflexion, LoopDetector) observe
 * passively — they record state but do NOT gate or interrupt the agent.
 *
 * The agent arrives fully wired (via createSolverBrain → createAgent).
 * No instruction or tool overrides here. Goal is the user message.
 */

import type { Agent } from '@mastra/core/agent'
import { Blackboard } from './blackboard'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { ReflexionEngine } from '../intelligence/reflexion'
import { LoopDetector, extractAttackPath } from '../intelligence/anti-loop'
import { log } from '../utils/logger'
import { setForensicLog } from '../tools/report-tools'
import { getGlobalGraphStore } from '../graph/store'
import { NodeType } from '../graph/schema'

const CONTEXT_WINDOW_MAP: Record<string, number> = {
  'groq/llama3-8b-8192': 8192,
  'openai/gpt-4o': 128000,
  'openai/gpt-4o-mini': 128000,
  'anthropic/claude-3-5-sonnet': 200000,
  'anthropic/claude-3-haiku': 200000,
  'google/gemini-2.0-flash': 1048576,
  'nvidia/nemotron-ultra-253b': 131072,
}

function getEnrichedGoalCap(model?: string): number {
  if (!model) return 8000
  const ctx = CONTEXT_WINDOW_MAP[model]
  if (!ctx) return 8000
  if (ctx <= 8192) return 2000
  if (ctx <= 32000) return 4000
  if (ctx <= 131072) return 8000
  return 16000
}

/**
 * Truncate enriched goal to fit within model context budget.
 * Preserves user's original goal. Trims injected context from least to most important.
 */
function truncateEnrichedGoal(full: string, originalGoal: string, maxChars: number): string {
  if (full.length <= maxChars) return full

  // Strategy: keep original goal + truncate injected sections
  const sections = full.split(/(?=^## )/m)
  const goalSection = sections[0] // user's original goal (first section before any ## header)
  const injectedSections = sections.slice(1)

  if (goalSection.length >= maxChars) {
    return goalSection.slice(0, maxChars) + '\n... [truncated]'
  }

  let budget = maxChars - goalSection.length
  const kept: string[] = []

  // Priority order (keep most important first): stale/hallucination warnings > graph state > blackboard > reflexion hints
  const priorityOrder = ['WARNING', 'Current Graph State', 'Accumulated Knowledge', 'Lessons from Past', 'Captured Traffic']
  const sorted: string[] = []

  for (const keyword of priorityOrder) {
    const idx = injectedSections.findIndex(s => s.includes(keyword))
    if (idx >= 0) {
      sorted.push(injectedSections[idx])
      injectedSections.splice(idx, 1)
    }
  }
  // Add remaining sections in original order
  sorted.push(...injectedSections)

  for (const section of sorted) {
    if (budget <= 0) break
    if (section.length <= budget) {
      kept.push(section)
      budget -= section.length
    } else {
      kept.push(section.slice(0, budget) + '\n... [truncated]')
      budget = 0
    }
  }

  return goalSection + kept.join('')
}

export interface SolverConfig {
  maxToolCalls?: number
  maxDurationMs?: number
  staleThreshold?: number
  maxParallel?: number
}

export type SolverPhase = 'observe' | 'learn' | 'attack' | 'record' | 'reason' | 'complete' | 'stale' | 'interrupt'

export interface PhaseEvent {
  phase: SolverPhase
  step: number
  text?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  toolResult?: unknown
  progress?: { endpoints: number; findings: number; tested: number; pending: number }
  interruptPrompt?: string
}

export interface SolveResult {
  completed: boolean
  reason: 'goal_achieved' | 'frontier_exhausted' | 'budget_reached' | 'stale' | 'interrupted'
  steps: number
  toolCalls: number
  tokensUsed: number
  durationMs: number
  facts: number
  intents: number
  planSummary?: string
}

export interface SolveParams {
  origin: string
  goal: string
  hints?: string[]
  model?: string
  config?: SolverConfig
  blackboard?: Blackboard
  evidence?: EvidenceGate
  loopDetector?: LoopDetector
  reflexion?: ReflexionEngine
  memory?: { thread: string; resource: string }
  onPhase?: (event: PhaseEvent) => void
  onToolComplete?: (toolName: string, result?: unknown) => void
}

const DEFAULTS: Required<SolverConfig> = {
  maxToolCalls: 50,
  maxDurationMs: 300000,
  staleThreshold: 3,
  maxParallel: 1,
}

function detectPhase(toolName?: string): SolverPhase {
  if (!toolName) return 'reason'

  const upper = toolName.toUpperCase()

  if (['GETTARGETSUMMARY', 'QUERYGRAPH', 'GETENDPOINTSWITHPARAMS', 'GETFULLCONTEXT'].includes(upper)) {
    return 'observe'
  }
  if (['SKILLSEARCH', 'SKILLLOAD', 'SEARCHSKILLS', 'LOADSKILLREFERENCE'].includes(upper)) {
    return 'learn'
  }
  if (['SPAWNWORKER', 'SPAWNSWARM', 'EXECUTEDIRECT', 'HTTPREQUEST', 'STAGEHAND_NAVIGATE', 'STAGEHAND_ACT'].includes(upper)) {
    return 'attack'
  }
  if (['WRITEFINDING', 'RECORDEVIDENCE', 'UPDATEGRAPH'].includes(upper)) {
    return 'record'
  }

  return 'reason'
}

interface CompletionResult {
  completed: boolean
  reason: SolveResult['reason']
}

/**
 * Determine completion based on graph findings and conversation state.
 *
 * - Graph findings exist → goal_achieved
 * - Conversational turn (hi, hello) → frontier_exhausted (normal)
 * - Nothing happened → stale
 */
function checkCompletion(
  goal: string,
  toolCallCount: number,
  fullText: string,
): CompletionResult {
  const goalLower = (goal || '').toLowerCase()
  const isConversational = toolCallCount === 0 && fullText.length < 500
    && ['hi', 'hello', 'hey', 'help', 'ping', 'test', 'who', 'what', 'how'].some(g => goalLower.startsWith(g))

  // Nothing happened at all
  if (toolCallCount === 0 && fullText.length === 0) {
    return { completed: false, reason: 'stale' }
  }

  // Conversational turn — just show response, no completion forced
  if (isConversational) {
    return { completed: false, reason: 'frontier_exhausted' }
  }

  // Check if the agent wrote findings to the graph
  try {
    const store = getGlobalGraphStore()
    const findings = store.queryNodes?.(NodeType.FINDING) || []
    if (findings.length > 0) {
      return { completed: true, reason: 'goal_achieved' }
    }
  } catch {
    // Graph store not available
  }

  // Agent responded but no findings — normal turn
  return { completed: false, reason: 'frontier_exhausted' }
}

/**
 * Solve — single agent.stream() call per REPL turn.
 *
 * The agent arrives fully wired (all tools, browser, instructions).
 * Goal is the user message. Intelligence layers observe passively.
 */
export async function solve(
  agent: Agent,
  params: SolveParams,
): Promise<SolveResult> {
  const cfg = { ...DEFAULTS, ...params.config }
  const board = params.blackboard || new Blackboard({ origin: params.origin, goal: params.goal })
  const evidence = params.evidence || new EvidenceGate()
  const loopDetector = params.loopDetector || new LoopDetector()
  const reflexion = params.reflexion || new ReflexionEngine()
  const forensicLog = setForensicLog()
  const emit = (event: PhaseEvent) => params.onPhase?.(event)
  const startTime = Date.now()

  // Seed blackboard (only if fresh)
  if (board.facts.length === 0) {
    board.addFact(`Target origin=${params.origin}; goal=${params.goal}`, 'origin')
    if (params.hints) {
      for (const h of params.hints) {
        board.addFact(`Hint: ${h}`, 'hint')
      }
    }
  }

  // Auto-inject graph context + blackboard state into the goal message
  let enrichedGoal = params.goal
  try {
    const store = getGlobalGraphStore()
    const summary = store.getTargetSummary()
    if (summary.totalEndpoints > 0 || summary.totalFindings > 0) {
      const graphContext = [
        `\n\n## Current Graph State`,
        `- ${summary.totalEndpoints} endpoints discovered (${summary.totalCapturedHeaders} with captured headers)`,
        `- ${summary.totalFindings} findings: ${Object.entries(summary.findingsBySeverity).map(([s, c]) => `${s}=${c}`).join(', ') || 'none'}`,
        `- ${summary.totalTests} tests run`,
        `- ${summary.authFlows} auth flows, ${summary.rbacRoles} RBAC roles`,
        `- ${summary.untestedActions} untested actions`,
      ]
      if (summary.endpoints.length > 0) {
        graphContext.push('Top endpoints:')
        for (const ep of summary.endpoints.slice(0, 10)) {
          graphContext.push(`  - ${ep.method} ${ep.url} (params: ${ep.params}, auth: ${ep.authRequired ? 'yes' : 'no'}, headers: ${ep.headerCount})`)
        }
      }
      enrichedGoal += '\n' + graphContext.join('\n')
    }
  } catch {
    // Graph store not available
  }

  // Inject blackboard state (accumulated across REPL turns)
  const boardState = board.toPromptGraph()
  if (boardState && board.facts.length > 1) {
    enrichedGoal += `\n\n## Accumulated Knowledge (Blackboard)\n\`\`\`\n${boardState}\n\`\`\``
  }

  // Inject reflexion hints from past sessions (target-scoped)
  try {
    const { loadRelevantHints } = await import('../intelligence/reflexion-store')
    const hints = loadRelevantHints('', params.origin)
    if (hints.length > 0) {
      enrichedGoal += `\n\n## Lessons from Past Sessions\n${hints.map(h => `- ${h}`).join('\n')}`
    }
  } catch {
    // Reflexion store not available
  }

  // Inject stale detection context
  if (loopDetector.isStale(cfg.staleThreshold)) {
    enrichedGoal += `\n\n## WARNING: Stale detection triggered`
    enrichedGoal += `\nThe agent has repeated the same attack path ${cfg.staleThreshold} times.`
    enrichedGoal += `\nSwitch strategy immediately. Try a completely different approach or ask the user for guidance.`
    emit({ phase: 'stale', step: 0, text: 'Stale detection triggered — switching strategy' })
  }

  // Inject hallucination warnings from evidence gate
  const unsupported = evidence.getUnsupportedClaims?.()
  if (unsupported && unsupported.length > 0) {
    enrichedGoal += `\n\n## WARNING: Hallucinated claims detected`
    enrichedGoal += `\nThe agent previously claimed things without tool evidence. VERIFY all claims with tools before reporting.`
    for (const claim of unsupported.slice(0, 5)) {
      enrichedGoal += `\n- Unsupported: "${claim}"`
    }
  }

  // Truncate enriched goal to fit model context budget
  const goalCap = getEnrichedGoalCap(params.model)
  enrichedGoal = truncateEnrichedGoal(enrichedGoal, params.goal, goalCap)

  emit({ phase: 'observe', step: 0, text: 'Starting exploration...' })

  let fullText = ''
  let toolCallCount = 0

  try {
    // Single stream call — Mastra handles tool loops internally (like v7)
    // Wrap with timeout enforcement via maxDurationMs
    const streamPromise = agent.stream(enrichedGoal, {
      maxSteps: cfg.maxToolCalls,
      ...(params.memory ? { memory: params.memory } : {}),
    })

    const timeoutMs = cfg.maxDurationMs
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Solver timeout: ${timeoutMs}ms exceeded`)), timeoutMs)
    })

    const stream = await Promise.race([streamPromise, timeoutPromise])

    for await (const chunk of stream.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          fullText += chunk.payload.text
          emit({ phase: 'reason', step: toolCallCount, text: chunk.payload.text })
          break

        case 'reasoning-delta':
          if (chunk.payload.text) {
            fullText += chunk.payload.text
          }
          break

        case 'tool-call':
          if (chunk.payload.toolName && chunk.payload.toolName !== 'askUser') {
            toolCallCount++

            emit({
              phase: detectPhase(chunk.payload.toolName),
              step: toolCallCount,
              toolName: chunk.payload.toolName,
              toolArgs: chunk.payload.args,
            })
          }
          break

        case 'tool-result':
          if (chunk.payload.toolName) {
            const output = typeof chunk.payload.result === 'string'
              ? chunk.payload.result
              : JSON.stringify(chunk.payload.result)

            // Passive observation — record but don't gate
            evidence.recordToolOutput(output)

            const detectedPath = extractAttackPath(output)
            if (detectedPath) {
              loopDetector.recordAttackPath(detectedPath)
            }

            // Notify caller (graph save, etc.)
            params.onToolComplete?.(chunk.payload.toolName, chunk.payload.result)
          }
          break

        case 'tool-error':
          if (chunk.payload.toolName) {
            log.error(`${chunk.payload.toolName} failed: ${chunk.payload.error}`)
            forensicLog?.log({
              type: 'tool-error',
              agent: 'solver-brain',
              tool: chunk.payload.toolName,
              error: chunk.payload.error,
            })
          }
          break
      }
    }
  } catch (err) {
    log.error(`Solver error: ${err instanceof Error ? err.message : String(err)}`)
    forensicLog?.log({
      type: 'error',
      agent: 'solver-brain',
      error: String(err),
    })
  }

  // Check goal completion based on graph findings
  const { completed, reason } = checkCompletion(params.goal, toolCallCount, fullText)

  emit({ phase: 'complete', step: toolCallCount, reason })

  return {
    completed,
    reason,
    steps: toolCallCount,
    toolCalls: toolCallCount,
    tokensUsed: fullText.length,
    durationMs: Date.now() - startTime,
    facts: board.facts?.length || 0,
    intents: board.intents?.length || 0,
    planSummary: board.planSummary?.() || '',
  }
}

export {}
