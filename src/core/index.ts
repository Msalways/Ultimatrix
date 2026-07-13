/**
 * Execution Core — shared foundation for multi-model and council engines.
 *
 * Re-exports every module in this directory for convenient single-path imports.
 */

export type {
  CoreServices,
  StrategyContext,
  StrategyPhaseEvent,
  EnginePreset,
  EngineType,
  ModelSelection,
  RunResult,
  ExecutionStrategy,
  StrategyId,
} from './types'

export { Blackboard, IntentStatus, TaskStatus } from './blackboard'
export type { BoardFact, BoardIntent, PlanTask, ToolCallRecord } from './blackboard'

export { coreEvidenceLedger, EvidenceLedger } from './evidence'

export { buildToolPack } from './toolpack'
export type { ToolPackOptions, ToolPackDeps } from './toolpack'

export { decideApproval } from './approval'
export type { ApprovalMode, ApprovalDecision } from './approval'
