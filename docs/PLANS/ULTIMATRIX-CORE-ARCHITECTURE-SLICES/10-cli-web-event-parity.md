# 10. CLI/Web Event Parity

## Goal

Make CLI and web consume equivalent typed runtime events so progress reflects real runtime state instead of model text.

## Current State

Typed spider stream work is partially complete. Web progress reporting still needs to consume full runtime/tool events, not only text deltas.

## Gaps Addressed

- CLI and web can display different runtime states.
- Progress UI may depend on model text.
- Spider events do not yet cover all user-visible crawl transitions.

## In Scope

- Stream typed spider events:
  - `crawl_started`
  - `page_seen`
  - `endpoint_seen`
  - `form_seen`
  - `auth_detected`
  - `scope_proposed`
  - `crawl_progress`
  - `crawl_stalled`
  - `crawl_completed`
- Fix web progress reporting to consume full runtime/tool events.
- Ensure CLI and web display the same state from the same event stream.

## Out of Scope

- Final visual design of web components.
- WebSocket infrastructure replacement unless required.
- New event analytics.

## Implementation Tasks

1. Define shared runtime event union.
2. Emit all spider lifecycle events from `SpiderRuntime`.
3. Ensure scope proposals use typed events.
4. Update CLI rendering to consume the shared event stream.
5. Update web engine/API/store to consume the same event stream.
6. Remove text-delta-only progress assumptions.
7. Add parity tests or fixtures for CLI/web event handling.

## Public Types / Interfaces

```typescript
export type SpiderRuntimeEvent =
  | { type: 'crawl_started'; workflowId: string; target: string }
  | { type: 'page_seen'; workflowId: string; page: SpiderPage }
  | { type: 'endpoint_seen'; workflowId: string; endpoint: SpiderEndpoint }
  | { type: 'form_seen'; workflowId: string; form: SpiderForm }
  | { type: 'auth_detected'; workflowId: string; authState: SpiderAuthState }
  | { type: 'scope_proposed'; workflowId: string; url: string; reason: string }
  | { type: 'crawl_progress'; workflowId: string; state: SpiderProgress }
  | { type: 'crawl_stalled'; workflowId: string; reason: string }
  | { type: 'crawl_completed'; workflowId: string; stopReason: SpiderStopReason }
```

## Data Flow

Runtime emits typed events to a shared event emitter. CLI and web subscribe to the same event contract and render local presentation from event payloads.

## Failure Modes

- Web shows progress from text delta while runtime has stalled.
- CLI receives events web does not.
- Event payloads omit workflow ID and merge sessions.
- Scope proposals are emitted as plain text only.

## Tests

- Runtime emits expected event sequence.
- CLI renderer handles all event kinds.
- Web event store handles all event kinds.
- Same fixture produces equivalent CLI/web state.

## Acceptance Criteria

- CLI and web receive equivalent typed events.
- Progress UI reflects runtime state, not model text.
- Scope proposal and stalled crawl states are visible in both surfaces.

## Dependencies

- Slice 01 for runtime event emission.
- Slice 03 for `scope_proposed`.
- Slice 06 for `auth_detected`.

## Completion Status

Partially complete.

