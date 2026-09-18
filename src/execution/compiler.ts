/**
 * Execution Compiler (Phase 8).
 *
 * Compiles a logical investigation plan into a physical execution plan.
 * Separates WHAT to do (skill procedure) from HOW to run it (physical steps).
 *
 * The same logical plan can produce different physical plans based on:
 * - Model profile (strong model: single worker; small model: parallel workers)
 * - Budget constraints (limited tokens: more deterministic steps)
 * - Available capabilities (no browser: HTTP-only steps)
 *
 * Core principle: deterministic steps replace LLM work whenever semantics are preserved.
 */

import type { CompiledCapabilitySet } from '../capabilities/types'
import type { ResearchContextView } from '../context/types'
import type { SkillMeta } from '../solver/skills/loader'

// --- Input/Output Types ---

export interface LogicalStep {
  stepId: string
  goal: string
  category: 'observe' | 'act' | 'compare' | 'verify' | 'conclude'
}

export interface LogicalPlan {
  skillId: string
  steps: LogicalStep[]
  objective: string
}

export interface ModelProfile {
  modelId: string
  reasoningClass: 'small' | 'medium' | 'strong'
  toolCalling: boolean
  contextWindow: number
}

export interface TaskBudget {
  maxModelCalls: number
  maxToolCalls: number
  maxDurationMs: number
  maxTokens: number
}

export interface ExecutionCompilerInput {
  logicalPlan: LogicalPlan
  skill: SkillMeta
  contextView: ResearchContextView
  capabilitySurface: CompiledCapabilitySet
  modelProfiles: ModelProfile[]
  budget: TaskBudget
}

// --- Physical Step Types ---

export interface BaseStep {
  stepId: string
  logicalStepId: string
  description: string
  estimatedDurationMs: number
}

export interface DeterministicStep extends BaseStep {
  type: 'deterministic'
  operation: 'http_request' | 'compare_responses' | 'timing_measure' | 'response_diff' | 'retest'
  config: Record<string, unknown>
}

export interface ModelStep extends BaseStep {
  type: 'model'
  instruction: string
  outputSchema?: string
  parallelizable: boolean
}

export interface ParallelStep extends BaseStep {
  type: 'parallel'
  branches: PhysicalStep[]
  aggregation: 'all' | 'first' | 'majority'
}

export interface WorkerStep extends BaseStep {
  type: 'worker'
  skillId: string
  objective: string
  tier: 'fast' | 'balanced' | 'powerful'
}

export interface VerificationStep extends BaseStep {
  type: 'verification'
  requirement: string
  fatal: boolean
}

export type PhysicalStep = DeterministicStep | ModelStep | ParallelStep | WorkerStep | VerificationStep

export interface PhysicalPlan {
  steps: PhysicalStep[]
  estimatedDurationMs: number
  estimatedModelCalls: number
  deterministicRatio: number
  rationale: string[]
}

// --- Step Classification ---

const DETERMINISTIC_CANDIDATES: Record<string, Array<{ operation: DeterministicStep['operation']; description: string }>> = {
  observe: [
    { operation: 'http_request', description: 'Fetch baseline observation via HTTP' },
  ],
  act: [],
  compare: [
    { operation: 'compare_responses', description: 'Deterministic response comparison' },
    { operation: 'timing_measure', description: 'Timing-based differential measurement' },
    { operation: 'response_diff', description: 'Structural diff of response bodies' },
  ],
  verify: [
    { operation: 'retest', description: 'Independent re-verification of finding' },
  ],
  conclude: [],
}

function canBeDeterministic(
  step: LogicalStep,
  caps: CompiledCapabilitySet,
): { deterministic: boolean; operation?: DeterministicStep['operation']; reason: string } {
  const candidates = DETERMINISTIC_CANDIDATES[step.category]
  if (!candidates || candidates.length === 0) {
    return { deterministic: false, reason: `category '${step.category}' has no deterministic candidate` }
  }

  const hasNetwork = caps.effects?.network === true
  const hasBrowser = caps.effects?.browser === true

  if (step.category === 'compare') {
    return {
      deterministic: true,
      operation: 'compare_responses',
      reason: 'comparison is structural and deterministic',
    }
  }

  if (step.category === 'observe' && hasNetwork && !hasBrowser) {
    return {
      deterministic: true,
      operation: 'http_request',
      reason: 'observation via HTTP-only capability (no browser needed)',
    }
  }

  if (step.category === 'verify') {
    return {
      deterministic: true,
      operation: 'retest',
      reason: 'verification re-fetch is deterministic',
    }
  }

  return { deterministic: false, reason: 'requires LLM reasoning' }
}

// --- Topology Deciders ---

function selectTopology(
  profiles: ModelProfile[],
  budget: TaskBudget,
  logicalSteps: LogicalStep[],
): 'single-strong' | 'parallel-fanout' | 'hybrid' {
  const strong = profiles.find(p => p.reasoningClass === 'strong')
  const small = profiles.filter(p => p.reasoningClass === 'small')

  if (strong && budget.maxModelCalls >= logicalSteps.length) {
    return 'single-strong'
  }
  if (small.length >= 2 && logicalSteps.length >= 4) {
    return 'parallel-fanout'
  }
  return 'hybrid'
}

function tierForModel(profile: ModelProfile): 'fast' | 'balanced' | 'powerful' {
  if (profile.reasoningClass === 'strong') return 'powerful'
  if (profile.reasoningClass === 'medium') return 'balanced'
  return 'fast'
}

// --- Main Compiler ---

export function compileExecution(input: ExecutionCompilerInput): PhysicalPlan {
  const { logicalPlan, skill, contextView, capabilitySurface, modelProfiles, budget } = input
  const rationale: string[] = []
  const physicalSteps: PhysicalStep[] = []

  const topology = selectTopology(modelProfiles, budget, logicalPlan.steps)
  rationale.push(`Topology: ${topology} (models: ${modelProfiles.map(p => p.reasoningClass).join(', ')})`)

  let modelCallCount = 0
  let stepCounter = 0

  for (const logicalStep of logicalPlan.steps) {
    stepCounter++
    const classification = canBeDeterministic(logicalStep, capabilitySurface)

    if (classification.deterministic && classification.operation) {
      physicalSteps.push({
        stepId: `step-${stepCounter}`,
        logicalStepId: logicalStep.stepId,
        type: 'deterministic',
        operation: classification.operation,
        description: `[D] ${logicalStep.goal}`,
        estimatedDurationMs: 2000,
        config: {
          target: contextView.objective,
          skillId: logicalPlan.skillId,
        },
      })
      rationale.push(`Step '${logicalStep.stepId}': deterministic (${classification.reason})`)
    } else if (topology === 'parallel-fanout' && logicalStep.category === 'act') {
      const workers = modelProfiles.filter(p => p.reasoningClass !== 'strong').slice(0, 3)
      const branches: PhysicalStep[] = workers.map((profile, i) => ({
        stepId: `step-${stepCounter}-w${i}`,
        logicalStepId: logicalStep.stepId,
        type: 'worker' as const,
        skillId: logicalPlan.skillId,
        objective: logicalStep.goal,
        description: `Worker ${i + 1}: ${logicalStep.goal}`,
        estimatedDurationMs: 15000,
        tier: tierForModel(profile),
      }))
      physicalSteps.push({
        stepId: `step-${stepCounter}`,
        logicalStepId: logicalStep.stepId,
        type: 'parallel',
        branches,
        aggregation: 'all',
        description: `[P] ${logicalStep.goal} (${branches.length} workers)`,
        estimatedDurationMs: 15000,
      })
      modelCallCount += branches.length
      rationale.push(`Step '${logicalStep.stepId}': parallel fanout (${branches.length} workers)`)
    } else {
      const bestProfile = modelProfiles[0] ?? { modelId: 'default', reasoningClass: 'medium' as const, toolCalling: true, contextWindow: 32000 }
      modelCallCount++
      physicalSteps.push({
        stepId: `step-${stepCounter}`,
        logicalStepId: logicalStep.stepId,
        type: 'model',
        instruction: logicalStep.goal,
        parallelizable: false,
        description: `[M] ${logicalStep.goal}`,
        estimatedDurationMs: bestProfile.reasoningClass === 'strong' ? 5000 : 10000,
      })
      rationale.push(`Step '${logicalStep.stepId}': model reasoning (${bestProfile.reasoningClass})`)
    }
  }

  physicalSteps.push({
    stepId: `step-${stepCounter + 1}`,
    logicalStepId: 'verification-gate',
    type: 'verification',
    requirement: 'evidence_gate_check',
    fatal: true,
    description: '[V] Evidence gate verification',
    estimatedDurationMs: 1000,
  })

  const deterministicCount = physicalSteps.filter(s => s.type === 'deterministic').length
  const totalSteps = physicalSteps.length

  return {
    steps: physicalSteps,
    estimatedDurationMs: physicalSteps.reduce((sum, s) => sum + s.estimatedDurationMs, 0),
    estimatedModelCalls: modelCallCount,
    deterministicRatio: totalSteps > 0 ? deterministicCount / totalSteps : 0,
    rationale,
  }
}
