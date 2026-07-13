/**
 * Solver Blackboard — re-exported from core.
 *
 * The canonical Blackboard now lives in src/core/blackboard.ts.
 * This file re-exports everything for backward compatibility so
 * existing solver imports and tests continue to work unchanged.
 */
export {
  Blackboard,
  IntentStatus,
  TaskStatus,
  type BoardFact,
  type BoardIntent,
  type PlanTask,
  type ToolCallRecord,
} from '../core/blackboard'
