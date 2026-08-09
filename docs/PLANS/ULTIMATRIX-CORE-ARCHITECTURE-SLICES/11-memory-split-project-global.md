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

1. Define memory classes and allowed destinations.
2. Add target-sensitive data detector using `SecretVault` and scope metadata.
3. Route workflow discoveries to project memory.
4. Route user preferences to global memory only when explicitly safe.
5. Block global writes containing secrets, target URLs, auth state, storage values, or request/response bodies.
6. Add tests for blocked and allowed memory writes.

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

Mostly pending.

