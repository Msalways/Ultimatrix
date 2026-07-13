/**
 * Unified runner — resolves engine preset + creates CoreServices once.
 *
 * @deprecated This runner is dead code. The REPL calls debateOnce() and solve()
 * directly from session.ts, bypassing the runner entirely. Retained for backward
 * compatibility with any external callers of runSession().
 */

import type { UltimatrixConfig } from '../config'
import type { EnginePreset, CoreServices, StrategyContext, RunResult, ApprovalMode } from './types'
import { Blackboard } from './blackboard'
import { coreEvidenceLedger } from './evidence'

// Lazy imports to avoid circular deps at module load
async function getStrategy(strategyId: 'single' | 'council') {
  if (strategyId === 'council') {
    const { CouncilStrategy } = await import('./strategies/council')
    return new CouncilStrategy()
  } else {
    const { SingleAgentStrategy } = await import('./strategies/single')
    return new SingleAgentStrategy()
  }
}

// Lazy import for intelligence modules (fallback when services not pre-built)
async function createIntelligence() {
  const [{ LoopDetector }, { ReflexionEngine }] = await Promise.all([
    import('../intelligence/anti-loop'),
    import('../intelligence/reflexion'),
  ])
  return { loopDetector: new LoopDetector(), reflexion: new ReflexionEngine() }
}

export function resolveEnginePreset(config: UltimatrixConfig): EnginePreset {
  const engine = config.engine ?? 'multi-model'

  // Map engine config to strategy + policy
  if (engine === 'council') {
    return {
      strategy: 'council',
      approvalMode: config.council?.approvalMode ?? 'autonomous',
      modelSelection: false,
    }
  }

  // 'multi-model' or deprecated 'solver' alias
  return {
    strategy: 'single',
    approvalMode: 'autonomous',
    modelSelection: true,
  }
}

export interface RunSessionParams {
  config: UltimatrixConfig
  goal: string
  toolPack: Record<string, any>
  /** Pre-built CoreServices from lifecycle (T3.3). When provided, runner skips building its own. */
  services?: CoreServices
  modelSelector?: any
  memory?: any
  humanApprove?: (proposal: any) => Promise<boolean>
  onPhase?: (event: { phase: string; round: number; text?: string }) => void
}

export async function runSession(params: RunSessionParams): Promise<RunResult> {
  const { config, goal, toolPack, services: presetServices, modelSelector, memory, humanApprove, onPhase } = params
  const preset = resolveEnginePreset(config)

  // Use pre-built CoreServices if supplied (T3.3), otherwise build fresh (T3.1 backward compat)
  let services: CoreServices
  if (presetServices) {
    services = presetServices
  } else {
    // Fallback — should only be hit in tests or direct runner usage
    const { loopDetector, reflexion } = await createIntelligence()
    services = {
      evidence: coreEvidenceLedger,
      blackboard: new Blackboard({ origin: config.target ?? '', goal }),
      loopDetector,
      reflexion,
    }
  }

  // Get strategy
  const strategy = await getStrategy(preset.strategy)

  // Build strategy context
  const ctx: StrategyContext = {
    goal,
    config,
    services,
    toolPack,
    modelSelector,
    memory,
    humanApprove: humanApprove ?? (preset.approvalMode === 'hitl'
      ? async () => false  // no human harness → reject
      : undefined),
    onPhase,
    maxRounds: config.council?.maxRounds ?? 10,
    approvalMode: preset.approvalMode,
  }

  // Run
  const result = await strategy.run(ctx)
  return result
}
