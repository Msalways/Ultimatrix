# 07. Decision Ledger and Provenance

## Goal

Record why Ultimatrix chose tools, models, workers, browser actions, and scope decisions, and attach provenance to evidence and discoveries.

## Current State

Some worker/model routing reasons exist, but event typing errors around `routingReason` show the contract is not yet stable. There is no central decision ledger.

## Gaps Addressed

- Decisions are hard to inspect after a run.
- Evidence and discoveries lack consistent provenance.
- Routing reasons are not preserved through typed events.
- Source metadata is fragmented across subsystems.

## In Scope

- Add `DecisionLedger`.
- Add provenance records for user input, browser, connector, web, tool, generated code, and model inference.
- Include source page, triggering action, request/response metadata, provider, timestamp, and workflow id.
- Preserve routing reasons for worker/model decisions.

## Out of Scope

- Full explainability UI.
- Long-term analytics storage.
- Replacing forensic log immediately.

## Implementation Tasks

1. Define `DecisionLedger`, `DecisionRecord`, and `ProvenanceRecord`.
2. Fix worker spawn event typing for `routingReason`.
3. Add ledger writes for model selection, worker spawn, tool execution, browser action, scope classification, and finding creation.
4. Attach provenance refs to spider discoveries and evidence items.
5. Persist ledger IDs in workflow state.
6. Add query helpers for post-run inspection.
7. Add tests for routing reason preservation.

## Public Types / Interfaces

```typescript
export type ProvenanceSource =
  | 'user'
  | 'browser'
  | 'connector'
  | 'web'
  | 'tool'
  | 'generated_code'
  | 'model'

export interface DecisionRecord {
  id: string
  workflowId: string
  kind: string
  reason: string
  routingReason?: string
  provider?: string
  model?: string
  sourceRefs: string[]
  createdAt: string
}

export interface ProvenanceRecord {
  id: string
  workflowId: string
  source: ProvenanceSource
  pageUrl?: string
  actionId?: string
  requestId?: string
  responseId?: string
  provider?: string
  createdAt: string
}
```

## Data Flow

Every decision-producing subsystem writes a decision record. Every durable discovery or evidence item links to provenance records. Workflow state links to the ledger for post-run audit.

## Failure Modes

- Worker spawn reason exists in memory but is absent from events.
- Evidence is stored without source information.
- Browser action provenance contains secrets.
- Ledger writes are best-effort and silently fail.

## Tests

- Worker spawn event includes typed `routingReason`.
- Model selection decision persists.
- Spider discovery has provenance.
- Evidence item has provenance.

## Acceptance Criteria

- Decisions are inspectable after a run.
- Evidence and spider discoveries have provenance.
- Routing reasons survive worker/model event boundaries.

## Dependencies

- Slice 02 for workflow references.
- Slice 03 for policy decision provenance.
- Slice 04 for artifact provenance and redaction.

## Completion Status

Mostly pending.

