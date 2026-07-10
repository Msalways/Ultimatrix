/**
 * Campaign module — Phase 2 (T2.3 planner + T2.4 executor).
 * Ties planCampaign + runCampaign + executeCampaign together for the solver.
 */

export { planCampaign } from './planner'
export { runCampaign, executeCampaign } from './executor'
export * from './continuity'
export type {
  PrimitiveRef,
  EvidenceItem,
  PrimitiveResult,
  CampaignSlice,
  CoverageStats,
  PlanOptions,
  CampaignPlan,
  SliceExecContext,
  PrimitiveRunner,
  Finding,
  SliceOutcome,
  CampaignExecutorOptions,
  CampaignResult,
  WriteFindingTool,
} from './types'
