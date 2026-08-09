# 01. Spider Runtime Foundation

## Goal

Make `SpiderRuntime` the deterministic shared crawl engine for CLI and web, with typed state, reliable scope classification, stale handling, and resume support.

## Current State

`SpiderRuntime` exists and is already partially wired. The current implementation appears to cover crawl progression, page discovery, endpoint/form detection, dedupe, and typed runtime events, but it still has correctness gaps.

Known issue: an external CDN URL is currently classified as `allowed` instead of `proposed` in a spider runtime test.

## Gaps Addressed

- Runtime state scattered outside the workflow.
- URL classification that can be affected by global scope guard state.
- Stale crawl handling that does not reliably pause or stop the loop.
- Missing or incomplete crawl resume input/output.
- CLI/web risk of using different crawl behavior.

## In Scope

- Keep `SpiderRuntime` as the single shared crawl engine.
- Finalize typed state for frontier, visited URLs, forms, endpoints, auth states, workflows, assets, and stop reason.
- Fix stale crawl handling.
- Fix URL classification so external URLs are never accidentally allowed by stale global state.
- Add resume input/output for prior crawl state.
- Verify max pages, max depth, dedupe, stale stop, and resume.

## Out of Scope

- Claim-based engagement policy beyond the minimal URL classification needed by the runtime.
- Browser provider abstraction.
- Worker orchestration.
- Finding proof rules.

## Implementation Tasks

1. Audit `src/spider/runtime.ts` and `test/spider/runtime.test.ts`.
2. Make runtime state serializable and workflow-owned.
3. Add or complete `SpiderRuntimeState` import/export.
4. Ensure frontier entries include URL, depth, discovered-from, classification, and identity context placeholder.
5. Ensure visited URL dedupe is canonical and independent of browser event ordering.
6. Fix URL classification so runtime receives explicit boundary/scope input and does not rely on mutable global defaults.
7. Add stale detection behavior that emits `crawl_stalled` and sets a typed stop reason when thresholds are reached.
8. Add resume tests for partial frontier and visited state.
9. Update CLI/web callers to instantiate and consume the same runtime path.

## Public Types / Interfaces

```typescript
export interface SpiderRuntimeState {
  workflowId: string
  target: string
  frontier: SpiderFrontierItem[]
  visitedUrls: string[]
  pages: SpiderPage[]
  endpoints: SpiderEndpoint[]
  forms: SpiderForm[]
  authStates: SpiderAuthState[]
  workflows: SpiderWorkflow[]
  assets: SpiderAsset[]
  stopReason?: SpiderStopReason
}

export type SpiderStopReason =
  | 'completed'
  | 'max_pages'
  | 'max_depth'
  | 'stalled'
  | 'aborted'
  | 'error'
```

## Data Flow

Browser/page events feed `SpiderRuntime`. The runtime classifies discovered URLs, updates frontier and visited state, emits typed crawl events, and returns a serializable state snapshot. Workflow state owns that snapshot for persistence and resume.

## Failure Modes

- External URLs are classified as `allowed` because global scope state leaked.
- Stale crawls continue indefinitely.
- Resumed crawls revisit already crawled URLs.
- CLI and web use different crawl paths.
- Runtime state cannot be serialized due to browser object references.

## Tests

- `test/spider/runtime.test.ts`
- Add focused cases for external URL classification, stale stop, resume, max pages, max depth, and dedupe.

## Acceptance Criteria

- One spider runtime is used by CLI and web.
- Crawl state is workflow-owned and serializable.
- External URLs outside current authorization are `proposed` or `denied`, never accidentally `allowed`.
- Tests pass for frontier, visited dedupe, stale stopping, depth/page limits, and resume.

## Dependencies

- Existing scope guard behavior.
- Browser manager and spider agent integration.
- Slice 02 depends on this state shape.

## Completion Status

Partially complete.

