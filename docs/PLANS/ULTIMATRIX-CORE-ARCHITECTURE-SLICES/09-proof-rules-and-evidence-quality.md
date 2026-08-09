# 09. Proof Rules and Evidence Quality

## Goal

Make finding creation and reporting fail closed unless deterministic proof rules are satisfied.

## Current State

Evidence gate and evidence ledger modules exist, but minimum evidence floors are not centralized as reusable proof rules tied to finding creation and reporting.

## Gaps Addressed

- Findings may be promoted from weak or incomplete evidence.
- Evidence requirements vary by path.
- Conflicting evidence is not consistently handled.

## In Scope

- Add `ProofRules`.
- Define deterministic minimum evidence floors.
- Connect proof rules to finding creation and reporting.
- Prevent findings from being reported without required evidence.

## Out of Scope

- Redesigning report templates.
- Manual triage workflow UI.
- ML-based evidence scoring.

## Implementation Tasks

1. Define `ProofRule`, `ProofCheckResult`, and finding evidence requirements.
2. Add default proof floors by finding class or impact.
3. Integrate proof checks before `writeFinding` and report generation.
4. Mark missing and conflicting evidence as blocking.
5. Store proof-check results in evidence/provenance state.
6. Add tests for enough evidence, missing evidence, and conflicting evidence.

## Public Types / Interfaces

```typescript
export interface ProofRule {
  id: string
  findingType: string
  requiredEvidenceKinds: string[]
  minIndependentSources: number
  allowConflicts: boolean
}

export interface ProofCheckResult {
  ruleId: string
  findingId?: string
  passed: boolean
  missingEvidence: string[]
  conflicts: string[]
  evidenceRefs: string[]
}
```

## Data Flow

Candidate findings enter the proof-rule checker. The checker reads evidence refs and provenance, returns a typed result, and only passing findings are eligible for durable report output.

## Failure Modes

- Report path bypasses proof rules.
- Conflicting evidence is treated as enough evidence.
- Evidence refs point to redacted artifacts without useful metadata.
- Rules are too generic to be enforceable.

## Tests

- Enough evidence passes.
- Missing evidence fails closed.
- Conflicting evidence fails unless explicitly allowed.
- Report generator excludes failed findings.

## Acceptance Criteria

- Findings fail closed when evidence is missing.
- Tests cover enough evidence, missing evidence, and conflicting evidence.
- Reported findings include proof-check metadata.

## Dependencies

- Existing evidence gate and ledger.
- Slice 04 for artifact refs.
- Slice 07 for provenance.

## Completion Status

Mostly pending.

