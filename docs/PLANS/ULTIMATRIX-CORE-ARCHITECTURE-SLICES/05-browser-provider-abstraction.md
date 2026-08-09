# 05. Browser Provider Abstraction

## Goal

Introduce provider-neutral browser execution while preserving current Stagehand/Playwright behavior as the default.

## Current State

Browser behavior is currently coupled to Stagehand and Playwright through browser manager, capture, spider, and session paths. CamoFox is planned as opt-in only.

## Gaps Addressed

- Provider-specific browser code spread through runtime subsystems.
- No config-driven browser provider boundary.
- Risk of switching browser providers mid-workflow.

## In Scope

- Add `BrowserProvider` interface.
- Wrap current Stagehand/Playwright behavior in `StagehandProvider`.
- Keep CamoFox planned as opt-in only.
- Make provider selection config-driven.
- Prevent provider switching mid-workflow.

## Out of Scope

- Implementing CamoFox as default.
- Rewriting spider logic.
- Replacing Playwright tests.

## Implementation Tasks

1. Define `BrowserProvider`.
2. Add `StagehandProvider` around existing browser manager behavior.
3. Add config field for browser provider with default `stagehand`.
4. Store provider choice in `WorkflowState`.
5. Fail clearly for unsupported providers.
6. Prevent resume if requested provider differs from persisted workflow provider.
7. Update browser-dependent callers to depend on the provider interface where practical.

## Public Types / Interfaces

```typescript
export type BrowserProviderName = 'stagehand' | 'camofox'

export interface BrowserProvider {
  readonly name: BrowserProviderName
  start(input: BrowserStartInput): Promise<BrowserSession>
  getActivePage(sessionId: string): Promise<unknown>
  captureScreenshot(sessionId: string): Promise<ArtifactRecord>
  exportStorage(sessionId: string): Promise<ArtifactRecord>
  close(sessionId: string): Promise<void>
}
```

## Data Flow

Config selects a provider at workflow start. Workflow state records provider name and session id. Browser consumers request capabilities through the provider instead of constructing provider-specific sessions directly.

## Failure Modes

- Workflow resumes with a different provider.
- Unsupported provider falls back silently.
- Provider close leaves stale active page references.
- Storage export bypasses redaction.

## Tests

- Default config uses `StagehandProvider`.
- Unsupported provider fails clearly.
- Resume rejects provider mismatch.
- One workflow maps to one provider/session.

## Acceptance Criteria

- Existing behavior continues through `StagehandProvider`.
- Unsupported providers fail clearly.
- One workflow uses one browser provider and one browser session.

## Dependencies

- Slice 02 for workflow provider/session persistence.
- Slice 04 for storage and screenshot artifact redaction.

## Completion Status

Mostly pending.

