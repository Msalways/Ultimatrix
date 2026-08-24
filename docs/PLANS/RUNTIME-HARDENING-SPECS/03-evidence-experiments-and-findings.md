# 03. Evidence, Experiments, and Findings

**Status:** TYPED ORACLES, CANDIDATE PROMOTION, MANDATORY EXPERIMENT LINK, AND INDEPENDENT RETEST IMPLEMENTED

## Goal

Preserve LLM adaptability while making every reportable finding the result of a typed, replayable experiment with a semantically verified oracle.

## Root Cause

Several oracles decide success from status codes or static response words, while the evidence gate often verifies only endpoint, method, and status. Direct graph/tool paths can also create findings without a proof result. Hypotheses, observations, and proofs are not consistently distinguished.

## Knowledge Authority

```typescript
type KnowledgeAuthority = 'hint' | 'observed' | 'proven'

interface KnowledgeRecord<T> {
  value: T
  authority: KnowledgeAuthority
  source: 'heuristic' | 'llm' | 'capture' | 'experiment'
  evidenceRefs: string[]
  confidence?: number
}
```

Heuristics and LLM interpretations produce hints. Captures produce observations. Only a satisfied experiment oracle produces proof.

## Experiment Contract

The LLM creates target-specific experiments through a typed tool; deterministic execution validates them:

```typescript
interface SecurityExperiment {
  id: string
  hypothesisId: string
  invariant: string
  actorRefs: string[]
  baseline: ExperimentAction[]
  mutation: ExperimentAction[]
  changedVariables: string[]
  oracle: EvidenceOracle
  retest?: RetestPolicy
}

type EvidenceOracle =
  | UniqueMarkerOracle
  | CrossIdentityOracle
  | StateTransitionOracle
  | OastCallbackOracle
  | TimingDifferentialOracle
  | BrowserEffectOracle
```

Every oracle validates referenced typed evidence. Arbitrary model prose is never executable oracle logic.

## Outcome Contract

```typescript
type ExperimentOutcome =
  | { status: 'proven'; proof: ProofAssertion }
  | { status: 'disproven'; evidenceRefs: string[] }
  | { status: 'inconclusive'; reason: string; evidenceRefs: string[] }
  | { status: 'failed'; error: SerializedError }
```

Access assessment becomes `granted | denied | inconclusive`. A generic 2xx response is inconclusive unless the experiment declares and satisfies an observable success condition.

## Finding Lifecycle

```text
Hypothesis -> Experiment -> CandidateFinding -> ProofCheck -> Finding
```

- `CandidateFinding` is the only input to promotion.
- Promotion requires a passing `ProofAssertion` and proof rule.
- `Finding` construction is private to `FindingService.promote()`.
- `addFinding` is removed from agent, spider, and public graph tool surfaces.
- `writeFinding` becomes candidate submission or calls the same promotion service.
- Reports include only `status = verified` findings with a passing proof check.
- Absence of `proofCheck` fails closed.

### Implemented

- `promoteFindingCandidate()` is the single production path that writes reportable findings.
- Every submission persists a `CandidateFinding`; failed checks remain `needs-more-evidence` and successful checks mark it `verified`.
- Findings retain `candidateId`, optional `experimentIds`, and the passing `proofCheck`.
- `addFinding` was removed from agent registries, spider tools, skill core tools, and `updateGraph` actions.
- `evaluateResearchExperiment` evaluates six typed oracle variants against evidence IDs and persists `proven | disproven | inconclusive` outcomes.
- Response comparison uses researcher-declared markers/JSON paths; the fixed sensitive-field vocabulary and status-only authorization result were removed.
- Supplied experiment IDs must resolve to persisted `proven` outcomes before promotion.
- Every non-informational promotion now requires at least one persisted `proven` experiment whose proof assertion names that experiment and contains evidence references. Missing or invalid provenance remains a `needs-more-evidence` candidate.
- Retests persist a separate oracle and outcome, require disjoint evidence references, and require fresh markers/correlation tokens for challenge-based oracle types. Promotion requires both the original and retest outcomes to be proven.

## Oracle Corrections

- Static response words may create hints but cannot prove a result.
- Generated markers are random per experiment and must be absent from baseline.
- Cross-identity proof references both actors and a victim-specific known value or confirmed state change.
- Authentication proof requires a new session artifact plus a successful protected follow-up observation.
- Timing proof uses repeated baseline and mutation samples with configured separation, not one absolute duration.
- OAST proof correlates a unique experiment token.
- Retest uses a newly generated marker where applicable.

## SDK Migration

SDK `generate()` returns hypotheses/candidates, not findings. `scan()` returns separate arrays for hypotheses, candidates, verified findings, and incomplete experiments. Existing `findings` remains only as a deprecated alias for verified findings during one compatibility release.

## Persistence

Persist experiment definition, evidence references, outcome, proof assertion, retest, and decision provenance. Raw operational secrets remain referenced, not embedded.

## Tests

- Existing marker in baseline never proves mutation.
- Generic 200, localized denial, and error envelopes remain inconclusive.
- Ordinary GraphQL fields do not prove cross-identity access.
- Randomized second retest must independently pass.
- Missing actor, baseline, mutation, or oracle evidence blocks promotion.
- Direct finding creation is unavailable from every agent/tool entrypoint.
- Report generation excludes missing, failed, and legacy-null proof checks.
- SDK hypotheses cannot appear in verified findings.

## Acceptance Criteria

- One promotion service is the only constructor of durable reportable findings.
- Every finding references a replayable experiment and passing semantic proof.
- LLMs remain free to design experiments within typed action and oracle contracts.
