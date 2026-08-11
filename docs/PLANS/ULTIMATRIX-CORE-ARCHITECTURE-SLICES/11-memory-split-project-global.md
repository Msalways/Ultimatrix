# 11. Memory Split Project Global

## Goal

Separate workflow/project memory from global user preference memory and prevent target-sensitive data from entering global memory.

## Current State

Cross-engagement memory exists, but the boundary between project-specific discoveries and global preferences needs explicit enforcement and tests.

## Gaps Addressed

- Target data can leak into memory intended for reusable preferences.
- Project resume needs durable project memory.
- Secret, auth, and target-sensitive memory classification is not centralized.

## In Scope

- Add project memory for workflow-specific discoveries.
- Add global memory only for user preferences.
- Prevent secrets, target data, auth state, and target-sensitive data from entering global memory.
- Add tests for memory boundary enforcement.

## Out of Scope

- New vector database selection.
- Cross-target vulnerability intelligence beyond redacted patterns.
- User preference UI.

## Implementation Tasks

1. ✅ Define memory classes and allowed destinations — `MemoryScope`/`MemoryContentKind`/`MemorySensitivityTag`/`MemoryWriteRequest`/`MemoryPolicyResult` in `src/memory/policy.ts`.
2. ✅ Add target-sensitive data detector — `detectSensitivity(value, { targetOrigin, contextKey })` using secret shapes (JWT/Bearer/SECRET_NAME keys) + URL/hostname shape + structural HTTP request/response payload detection. Shape-based, no vocab/substring inference.
3. ✅ Route workflow discoveries to project memory — `evaluateMemoryWrite` reroutes `discovery`/`auth_state`/`target_data` from global → project (allowed, never global).
4. ✅ Route user preferences to global memory only when explicitly safe — `GlobalMemoryStore.writePreference` persists only `preference`/`technique_pattern` that pass the gate.
5. ✅ Block global writes containing secrets, target URLs, auth state, storage values, or request/response bodies — fail-closed `MemoryPolicyError`; `MemoryPolicyError` thrown; decisions recorded to the DecisionLedger (`memory.policy` kind).
6. ✅ Add tests for blocked and allowed memory writes — `test/memory/policy.test.ts` (19), `test/memory/global-store.test.ts` (5), `test/intelligence/cross-engagement-policy.test.ts` (5) = 29 tests.

## Public Types / Interfaces

```typescript
export type MemoryScope = 'project' | 'global'

export interface MemoryWriteRequest {
  workflowId?: string
  scope: MemoryScope
  kind: 'preference' | 'discovery' | 'auth_state' | 'target_data' | 'technique_pattern'
  value: unknown
}

export interface MemoryPolicyResult {
  allowed: boolean
  destination?: MemoryScope
  reason?: string
}
```

## Data Flow

Memory writes pass through a policy check. Project data is stored under workflow/project memory. Global memory accepts only safe user preferences and rejects target-sensitive content.

## Failure Modes

- Auth token or target URL enters global memory.
- Workflow resume depends on global memory.
- Redacted data is treated as safe without provenance.
- Preference extraction misclassifies observed target behavior.

## Tests

- Target URL blocked from global memory.
- Auth state blocked from global memory.
- Secret-like value blocked from global memory.
- User preference allowed in global memory.
- Project discovery available for resume.

## Acceptance Criteria

- Target-sensitive data never enters global memory.
- Project memory can support workflow resume.
- Memory policy decisions are inspectable.

## Dependencies

- Slice 02 for workflow/project memory references.
- Slice 04 for secret detection.
- Slice 07 for memory decision provenance.

## Completion Status

✅ COMPLETE. `src/memory/policy.ts` (types + shape gate + routing + ledger recording), `src/memory/global-store.ts` (gated global prefs store → `output/global/global-preferences.json`), cross-engagement `recordEngagementSummary` now routes through the shared gate (targetOrigin still a scoping token, never persisted). 29 boundary tests green; full suite 2045/2045; tsc clean; tsup build clean.

Notes:
- `isSecretKeyName` skips pluralized collection keys (e.g. `pathTokens`) so structural shape fields are not false-flagged; camelCase credential keys (`apiKey`, `accessToken`) via `contextKey` on the top-level persistence key.
- Decision-ledger recording is best-effort (`recordMemoryPolicyDecision`), never throws into the write site.
- `SECRET_NAME` is now exported from `src/security/secret-vault.ts` and reused by the policy gate (no duplicated regex).

