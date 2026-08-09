# 08. Orchestrator and Worker Routing

## Goal

Make `multi-model` the main orchestration path with typed workflow steps, bounded worker context, retries, fallback, and evidence-led final state.

## Current State

Worker pools, model selection, skills, and council exist. Council/debate should remain explicit and on-demand. The missing layer is a lightweight orchestrator that coordinates workflow steps and worker routing without handing full conversation state to every worker.

## Gaps Addressed

- Multi-model is not yet the primary structured orchestration path.
- Worker context can be too broad.
- Routing decisions are not consistently typed or ledgered.
- Worker results do not consistently update evidence and decision ledgers.

## In Scope

- Add lightweight orchestrator for workflow steps, retries, fallback, workers, and final state.
- Keep council/debate explicit and on-demand.
- Restore/improve dynamic workers under `multi-model`.
- Spawn workers by hypothesis, skill match, complexity, scope, budget, and evidence gaps.
- Give workers bounded typed context.

## Out of Scope

- Making council automatic by default.
- Adding new model providers.
- Replacing the solver engine wholesale.

## Implementation Tasks

1. Define orchestrator step and result types.
2. Add worker routing input with hypothesis, skill refs, complexity, scope class, budget, and evidence gaps.
3. Call model selector by role and complexity.
4. Spawn workers with bounded typed context.
5. Persist routing decisions in `DecisionLedger`.
6. Require workers to emit typed results and evidence refs.
7. Add retry/fallback policy for failed workers.
8. Add tests for routing, context bounds, fallback, and evidence writes.

## Public Types / Interfaces

```typescript
export interface OrchestratorStep {
  id: string
  workflowId: string
  kind: 'crawl' | 'analyze' | 'worker' | 'verify' | 'report'
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped'
}

export interface WorkerRoutingInput {
  workflowId: string
  hypothesisId?: string
  skillRefs: string[]
  complexity: 'low' | 'medium' | 'high'
  scopeClassification: ScopeClassification
  budgetRemaining: number
  evidenceGaps: string[]
}
```

## Data Flow

The orchestrator reads workflow state, diagnosis, evidence gaps, scope policy, and budget. It selects workers/models, records decisions, executes bounded steps, and writes typed results into evidence and workflow state.

## Failure Modes

- Worker receives full conversation instead of bounded context.
- Routing reason is lost.
- Worker writes unverified findings directly to report output.
- Retry loop burns budget without progress.

## Tests

- Complexity-based model role routing.
- Skill-matched worker spawning.
- Bounded worker context snapshot.
- Failed worker fallback.
- Worker result enters evidence ledger.

## Acceptance Criteria

- Workers emit typed results into evidence and decision ledgers.
- Complexity-based routing chooses appropriate model roles.
- Council remains explicit and on-demand.

## Dependencies

- Slice 02 for workflow state.
- Slice 03 for scope policy.
- Slice 07 for decision ledger.
- Slice 09 for evidence/finding gating.

## Completion Status

Mostly pending.

