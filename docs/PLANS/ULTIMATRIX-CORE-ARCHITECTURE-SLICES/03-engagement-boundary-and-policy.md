# 03. Engagement Boundary and Policy

## Goal

Replace same-host-only behavior with a central claim-based engagement boundary that classifies discovered URLs and actions before execution.

## Current State

Scope guard logic exists, but policy is not yet represented as a full engagement boundary. External tools are expected to remain disabled by default.

## Gaps Addressed

- URL-only scope decisions.
- Global mutable scope state affecting runtime classification.
- No explicit proposed-scope workflow.
- No shared authorization categories for tools and browser actions.

## In Scope

- Add `EngagementBoundary`.
- Classify discovered URLs as `allowed`, `proposed`, or `denied`.
- Add authorization categories: `read`, `search`, `create`, `modify`, `send`, `delete`, `share`, `execute`, `browser_action`, `external_tool`.
- Make scope proposals visible to CLI and web before expansion.
- Keep external tools disabled by default.

## Out of Scope

- UI polish for approval modals.
- Vendor-specific external scanner integrations.
- Legal authorization management outside config/runtime policy.

## Implementation Tasks

1. Define `EngagementBoundary` and `ScopeClassification`.
2. Move URL classification behind a pure function that receives boundary input.
3. Add action/tool policy checks using shared authorization categories.
4. Emit `scope_proposed` events when discovered URLs are outside allowed claims but eligible for user approval.
5. Block automatic execution of proposed scope.
6. Add config for explicit external tool opt-in.
7. Wire CLI and web to display proposed scope.

## Public Types / Interfaces

```typescript
export type ScopeClassification = 'allowed' | 'proposed' | 'denied'

export type AuthorizationCategory =
  | 'read'
  | 'search'
  | 'create'
  | 'modify'
  | 'send'
  | 'delete'
  | 'share'
  | 'execute'
  | 'browser_action'
  | 'external_tool'

export interface EngagementBoundary {
  workflowId: string
  allowedOrigins: string[]
  allowedUrlPatterns: string[]
  deniedUrlPatterns: string[]
  proposedOrigins: string[]
  allowedCategories: AuthorizationCategory[]
  externalToolsEnabled: boolean
}
```

## Data Flow

Discovered URLs and requested actions go through the engagement boundary. Allowed items proceed, proposed items are surfaced to CLI/web and stored, and denied items are recorded but not executed.

## Failure Modes

- Proposed scope executes automatically.
- External tools run without explicit opt-in.
- Denied URLs are discarded without audit records.
- Boundary is read from stale global state.

## Tests

- Allowed/proposed/denied URL classification.
- Proposed scope does not enqueue crawl work.
- External tool category denied by default.
- CLI/web receive `scope_proposed`.

## Acceptance Criteria

- Every discovered URL has a scope classification.
- Proposed scope never executes automatically.
- External tools require explicit config opt-in.

## Dependencies

- Slice 01 for spider classification integration.
- Slice 07 for provenance of policy decisions.
- Slice 10 for event display parity.

## Completion Status

Mostly pending.

