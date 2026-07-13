/**
 * Core types for the Unified Execution Core.
 *
 * T0.1 (Wave Core): shared interfaces consumed by the runner, both strategies,
 * and downstream Waves B–D. Every type here is concrete — no `any` bags.
 */

import type { UltimatrixConfig } from '../config'
import type { EvidenceLedger, FindingClaim, VerificationResult } from '../intelligence/evidence-ledger'
import type { LoopDetector } from '../intelligence/anti-loop'
import type { ReflexionEngine } from '../intelligence/reflexion'
import type { Blackboard } from './blackboard'
import type { ApprovalMode } from './approval'

// ─── Execution strategy ────────────────────────────────────────────────

export type EngineType = 'multi-model' | 'council' | 'solver'

export interface ModelSelection {
  selector: any // ModelSelector — avoid circular import
}

export interface CoreServices {
  evidence: EvidenceLedger
  blackboard: Blackboard
  loopDetector?: LoopDetector
  reflexion?: ReflexionEngine
}

export interface StrategyContext {
  goal: string
  config: UltimatrixConfig
  services: CoreServices
  toolPack: Record<string, any>
  modelSelector?: ModelSelection['selector'] | null
  memory?: any
  onPhase?: (event: StrategyPhaseEvent) => void
  humanApprove?: (proposal: any) => Promise<boolean>
  maxRounds?: number
  approvalMode?: ApprovalMode
}

export interface StrategyPhaseEvent {
  phase: string
  round: number
  text?: string
}

export type StrategyId = 'single' | 'council'

export interface EnginePreset {
  strategy: StrategyId
  approvalMode: ApprovalMode
  modelSelection: boolean
}

export interface RunResult {
  completed: boolean
  reason: string
  rounds?: number
  approved?: number
  rejected?: number
  steps?: number
  toolCalls?: number
  facts?: number
  intents?: number
  planSummary?: string
  text?: string
  error?: string
  tokensUsed?: number
  messages?: any[]
  transcript?: string
}

export interface ExecutionStrategy {
  run(ctx: StrategyContext): Promise<RunResult>
}
