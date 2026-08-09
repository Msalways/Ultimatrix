# 04. Secret Vault and Artifacts

## Goal

Ensure secret-like values are redacted before durable persistence and give every durable output a typed artifact lifecycle with provenance.

## Current State

Secret vault work and tests are partially present. The remaining risk is uneven adoption across HAR, browser storage, screenshots metadata, graph persistence, reports, traces, downloads, generated tests, and findings.

## Gaps Addressed

- Secret redaction not guaranteed on every persistence path.
- Artifacts lack a shared lifecycle and provenance model.
- Evidence may point to untracked or unredacted files.

## In Scope

- Finalize `SecretVault` redaction API.
- Apply redaction to HAR bridge, saved HAR files, browser storage exports, screenshots metadata, and graph persistence.
- Add artifact lifecycle states for screenshots, HAR, reports, downloads, traces, generated tests, and findings.
- Add provenance metadata to artifacts.

## Out of Scope

- Encrypting local artifact storage.
- Remote artifact storage.
- Full report layout redesign.

## Implementation Tasks

1. Audit `src/security`, `src/analysis/har-bridge.ts`, browser storage export, screenshot metadata, and graph persistence paths.
2. Normalize the `SecretVault` API around `redactValue`, `redactObject`, and `redactArtifactMetadata`.
3. Ensure HAR entries are redacted before saving and before graph ingestion.
4. Ensure browser storage exports redact cookies, tokens, bearer values, API keys, and session IDs.
5. Ensure screenshot metadata is redacted before persistence.
6. Add `ArtifactRecord` and lifecycle state.
7. Add artifact provenance fields.
8. Add tests for each persistence path.

## Public Types / Interfaces

```typescript
export type ArtifactKind =
  | 'screenshot'
  | 'har'
  | 'report'
  | 'download'
  | 'trace'
  | 'generated_test'
  | 'finding'

export type ArtifactStatus =
  | 'created'
  | 'redacted'
  | 'linked'
  | 'reported'
  | 'deleted'

export interface ArtifactRecord {
  id: string
  workflowId: string
  kind: ArtifactKind
  status: ArtifactStatus
  path?: string
  createdAt: string
  redactedAt?: string
  provenance: ProvenanceRef[]
}
```

## Data Flow

Subsystems create artifact records through a shared artifact API. Secret vault redaction runs before the artifact is persisted or linked into graph/evidence state. Evidence stores artifact references, not raw secret-bearing values.

## Failure Modes

- Raw HAR contains Authorization or Cookie values.
- Screenshot metadata stores sensitive URLs or tokens.
- Graph nodes contain unredacted storage values.
- Generated reports rehydrate redacted data from raw artifacts.

## Tests

- `test/security/secret-vault.test.ts`
- `test/analysis/har-bridge.test.ts`
- Add storage export, screenshot metadata, and graph persistence tests.

## Acceptance Criteria

- Secret-like values are redacted before durable persistence.
- Tests cover HAR, storage, screenshots metadata, and graph persistence paths.
- Artifacts have typed lifecycle state and provenance.

## Dependencies

- Slice 02 for workflow artifact refs.
- Slice 07 for provenance records.

## Completion Status

Partially complete.

