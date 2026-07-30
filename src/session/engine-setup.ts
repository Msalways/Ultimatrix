/**
 * Engine setup — extracted from SessionLifecycle.setupEngine().
 *
 * Pure function: config → engine services. No `this`, no lifecycle state.
 * Callable from both CLI (via lifecycle) and Web (via WebEngine).
 */

import type { UltimatrixConfig } from '../config'
import { DEFAULTS } from '../config'
import { Blackboard } from '../solver/blackboard'
import { EvidenceGate } from '../intelligence/evidence-gate'
import { LoopDetector } from '../intelligence/anti-loop'
import { ReflexionEngine } from '../intelligence/reflexion'
import { SkillRegistry } from '../solver/skills/registry'
import { WorkerPool } from '../workers/pool'
import { createSolverBrain } from '../solver/brain-tools'
import { createAllWorkers } from '../workers/registry'
import { createSupervisor } from '../manager/agent'
import { ModelSelector } from '../models/selector'
import { checkModelCapability } from '../models/capability'
import { coreEvidenceLedger } from '../core/evidence'
import type { CoreServices } from '../core/types'
import { log } from '../utils/logger'

/**
 * Result of engine setup — all engine-specific resources.
 * The caller is responsible for storing these in whatever resource bag it uses.
 */
export interface EngineServices {
  solverBrain?: any
  supervisor?: any
  workers?: any
  skillRegistry?: SkillRegistry
  workerPool?: WorkerPool
  sessionBlackboard: Blackboard
  sessionEvidence: EvidenceGate
  sessionLoopDetector: LoopDetector
  sessionReflexion?: ReflexionEngine
  coreServices: CoreServices
  modelSelector?: ModelSelector
  council?: import('../council/factory').CouncilResources
}

export interface EngineSetupContext {
  config: UltimatrixConfig
  browser: any
  memory: any
  target: string
  harContextForLLM?: string
}

/**
 * Create all engine services in one call.
 *
 * Handles:
 * - Model capability contract (check)
 * - Core services (blackboard, evidence, loop detector, reflexion)
 * - Legacy path (workers + supervisor)
 * - Solver path (skill registry, worker pool, brain, council)
 * - Model selector (non-legacy)
 *
 * Does NOT mutate any external state — returns a plain object.
 */
export async function createEngineServices(ctx: EngineSetupContext): Promise<EngineServices> {
  const { config, browser, memory, target, harContextForLLM } = ctx
  const useSolver = config.engine !== 'legacy'

  // Model Capability Contract — refuse/warn on sub-16K models for complex goals.
  if (useSolver) {
    const cap = checkModelCapability(config, config.model, {
      complex: true,
      require: config.requireCapableModel === true,
    })
    if (!cap.ok) {
      throw new Error(`Model capability contract failed: ${cap.reason}`)
    }
    if (cap.warned && cap.reason) {
      log.warn(`Model capability warning: ${cap.reason}`)
    }
  }

  // Build shared intelligence (blackboard + evidence + loop + reflexion) ONCE.
  const sessionBlackboard = new Blackboard({ origin: target || 'unknown', goal: 'Session started' })
  const sessionEvidence = new EvidenceGate()
  const sessionLoopDetector = new LoopDetector(config.antiLoop?.maxFailedTarget ?? DEFAULTS.antiLoop.maxFailedTarget)
  const sessionReflexion = config.reflexion?.enabled === false
    ? undefined
    : new ReflexionEngine({
        maxSameVulnFails: config.reflexion?.maxSameVulnFails,
        maxTotalNoProgress: config.reflexion?.maxTotalNoProgress,
        escalationMaxLevel: config.reflexion?.escalationMaxLevel,
      })

  // Build unified CoreServices — single instance shared by runner + both engines
  const coreServices: CoreServices = {
    evidence: coreEvidenceLedger,
    blackboard: sessionBlackboard,
    loopDetector: sessionLoopDetector,
    reflexion: sessionReflexion,
  }

  const result: EngineServices = {
    sessionBlackboard,
    sessionEvidence,
    sessionLoopDetector,
    sessionReflexion,
    coreServices,
  }

  if (!useSolver) {
    // @deprecated Legacy supervisor path — kept for backward compatibility
    log.warn('[deprecated] engine: legacy is deprecated. Switch to engine: multi-model or engine: council in ultimatrix.yaml')
    const workers = await createAllWorkers(config, browser, memory)
    const supervisor = createSupervisor(config, { workers, browser, memory })
    result.workers = workers
    result.supervisor = supervisor
  } else {
    // ModelSelector — created BEFORE brain so it can be shared (budget/cooldown state)
    const modelSelector = new ModelSelector(
      config.modelCapabilities ?? {},
      config.budgetPolicy ?? { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false },
      config,
    )
    result.modelSelector = modelSelector

    const skillRegistry = new SkillRegistry()
    skillRegistry.loadFromDirectory('skills')
    const workerPool = new WorkerPool(config, skillRegistry, browser)

    const solverBrain = createSolverBrain(config, {
      skillRegistry,
      workerPool,
      browser,
      memory,
      extraContext: harContextForLLM,
      modelSelector,
    })
    result.solverBrain = solverBrain
    result.skillRegistry = skillRegistry
    result.workerPool = workerPool

    // Create council — available on-demand via /council command
    const { createCouncil } = await import('../council/factory')
    const council = createCouncil(config, { skillRegistry, workerPool, browser }, sessionBlackboard)
    result.council = council
    log.info('Council available (type /council <goal> to deliberate)')
  }

  return result
}
