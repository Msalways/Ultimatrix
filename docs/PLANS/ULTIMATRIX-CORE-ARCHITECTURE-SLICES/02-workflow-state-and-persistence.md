# 02. Workflow State and Persistence

## Goal

Create canonical workflow state across browser, spider, evidence, artifacts, model usage, and workers so a run can be resumed without losing operational context.

## Current State

State is split across session lifecycle, browser manager, spider runtime, evidence systems, web stores, and worker runtime. Some state is keyed by target URL or process-global variables.

## Gaps Addressed

- Target-global state such as `spiderRanTargets`.
- Resume that loses crawl/evidence/browser metadata.
- No single workflow-owned state object.
- Hard-to-replay worker and artifact state.

## In Scope

- Add `WorkflowState`.
- Attach spider state to workflow state.
- Track browser session id, model usage, active workers, artifacts, and evidence references.
- Add persistence/load support for workflow resume.
- Replace target-global crawl state.

## Out of Scope

- Global preference memory.
- Browser provider implementation details.
- Full report generation redesign.

## Implementation Tasks

1. Add `src/workflow/types.ts` or equivalent existing-module-aligned location.
2. Define `WorkflowState` with stable IDs and versioning.
3. Embed `SpiderRuntimeState`.
4. Add browser session, model usage, worker, artifact, evidence, and decision ledger references.
5. Add persistence functions for save/load.
6. Replace target-keyed crawl globals with workflow IDs.
7. Add migration or fallback handling for missing state fields.
8. Wire CLI and web resume paths to load `WorkflowState`.

## Public Types / Interfaces

```typescript
export interface WorkflowState {
  version: 1
  workflowId: string
  target: string
  createdAt: string
  updatedAt: string
  status: WorkflowStatus
  browserSessionId?: string
  spider?: SpiderRuntimeState
  modelUsage: ModelUsageSummary[]
  activeWorkers: WorkerState[]
  artifacts: ArtifactRef[]
  evidenceRefs: EvidenceRef[]
  decisionLedgerId?: string
}
```

## Data Flow

Session startup creates or loads `WorkflowState`. Runtime subsystems update typed parts of the state through explicit APIs. Persistence stores state snapshots, not subsystem internals.

## Failure Modes

- Resume loads stale browser state that no longer exists.
- State version mismatch is silently ignored.
- Multiple workflows share target-keyed crawl state.
- Evidence references point to redacted or missing artifacts.

## Tests

- Workflow save/load round trip.
- Resume with spider state and evidence refs.
- No target-global crawl state use.
- Missing optional fields load safely.

## Acceptance Criteria

- A workflow can be resumed without losing crawl, evidence, browser, artifact, model, or worker metadata.
- No crawl state is keyed only by target URL.
- State has a version and typed persistence boundary.

## Dependencies

- Slice 01 for `SpiderRuntimeState`.
- Slice 04 for artifact refs and redaction guarantees.
- Slice 07 for decision ledger references.

## Completion Status

Mostly pending.

