# 12. Architecture Evals and Hardening

## Goal

Add architecture-level tests and evals that prove the vertical workflow works end to end.

## Current State

The repo has many targeted tests and build coverage. Architecture-level evals for the new runtime boundaries, orchestration, policy, proof rules, and recovery behavior are still mostly pending.

## Gaps Addressed

- Unit tests do not prove the full workflow is coherent.
- Browser lifecycle, provider selection, recovery, and worker routing need vertical coverage.
- Current verification has known TypeScript and spider runtime blockers.

## In Scope

- Add architecture evals for crawl completion, tool routing, worker spawning, policy decisions, evidence quality, and recovery behavior.
- Add browser lifecycle tests proving one workflow uses one shared browser session.
- Add config fallback tests for model roles and provider preferences.
- Add recovery tests for stalled crawls and failed workers.

## Out of Scope

- Exhaustive live internet scanning.
- Performance benchmarking beyond basic budget assertions.
- Replacing existing unit tests.

## Implementation Tasks

1. Create architecture eval fixtures.
2. Add vertical crawl-completion eval.
3. Add scope policy eval for allowed/proposed/denied.
4. Add worker routing eval.
5. Add proof-rule finding eval.
6. Add browser lifecycle eval.
7. Add config fallback eval for model roles and browser provider.
8. Add recovery evals for stalled crawls and failed workers.
9. Add CI-friendly targeted command documentation.

## Public Types / Interfaces

```typescript
export interface ArchitectureEvalCase {
  id: string
  name: string
  workflowInput: unknown
  expectedEvents: string[]
  expectedState: Record<string, unknown>
}

export interface ArchitectureEvalResult {
  caseId: string
  passed: boolean
  failures: string[]
  durationMs: number
}
```

## Data Flow

Eval fixtures drive workflow runs through the same runtime APIs used by CLI and web. Results assert final workflow state, event stream, evidence quality, browser lifecycle, and recovery behavior.

## Failure Modes

- Evals mock too much and miss integration bugs.
- Tests require unsandboxed Node without documentation.
- Slow evals block local iteration.
- Recovery tests hide failures instead of asserting final state.

## Tests

- Crawl completion eval.
- Tool/model routing eval.
- Worker spawning eval.
- Scope policy eval.
- Evidence quality/proof-rule eval.
- Browser lifecycle eval.
- Config fallback eval.
- Stalled crawl and failed worker recovery evals.

## Acceptance Criteria

- Architecture-level tests prove the vertical workflow works end to end.
- Build and targeted tests pass with the configured Node path.
- Known blockers from `INDEX.md` are resolved or explicitly tracked with failing tests.

## Dependencies

- Slices 01 through 11.

## Completion Status

Mostly pending.

