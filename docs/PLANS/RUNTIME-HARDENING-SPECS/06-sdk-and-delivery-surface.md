# 06. SDK and Delivery Surface

**Status:** CORE DELIVERY BLOCKERS IMPLEMENTED; OPTIONAL ISOLATION, REMEDIATION, AND BENCHMARK RELEASE REMAIN

## Goal

Expose the same verified engagement runtime through a lightweight TypeScript SDK, while keeping heavy tools and language analyzers optional and delivering replayable artifacts, CI output, sandbox policy, and benchmarks.

## SDK Contract

The SDK is an orchestration client over `EngagementRuntime`; it does not implement a parallel legacy learn/generate finding pipeline.

```typescript
interface UltimatrixSdk {
  createEngagement(options: EngagementOptions): Promise<Engagement>
  resumeEngagement(workflowRef: string): Promise<Engagement>
}

interface Engagement {
  observe(): Promise<ObservationSummary>
  plan(goal?: string): Promise<PlanningDecision[]>
  run(options?: RunOptions): Promise<EngagementResult>
  replay(caseRef: string): Promise<ReplayResult>
  exportCaseFile(options?: ExportOptions): Promise<CaseFile>
  close(): Promise<void>
}
```

Deprecate the separate hypothesis-to-finding behavior in `src/sdk.ts`. Compatibility methods delegate to the engagement runtime and return honest candidate/verified separation.

### Implemented

- Each public `Ultimatrix` instance lazily creates and closes its own `EngagementRuntime`; learn, generate, and replay execute inside that engagement context.
- SDK capture persistence uses the runtime-owned graph and checkpoint path instead of mutating the global workspace.
- Concurrent SDK instances persist distinct workflow identities.
- The ESM entry is code-split so the runtime loads on first operation (`index.js` is about 56 KB; the runtime chunk is about 870 KB). CommonJS remains a self-contained compatibility bundle because split CJS chunks cannot safely execute the repository's `import.meta` paths.
- SDK replay executes verified graph proofs through the canonical proof replay path. It reports `passed`, `failed`, `inconclusive`, `unsupported`, and `execution_error`; generated Playwright tests remain a compatibility fallback when no verified graph finding exists.
- Case files use schema version 1. Export includes only findings with a passing proof floor, proven experiment, independent proven retest, and replayable exploit proof. Incomplete items are retained with explicit reasons, and `validateCaseFile(unknown)` fails closed on malformed input.
- `ultimatrix ci -t <url> --fail-on <severity>` emits schema-versioned JSON. Exit code 0 passes, 1 indicates a verified finding at or above the configured threshold, and 2 indicates incomplete or failed execution. Candidates never trigger the verified-finding gate.

## Replay

- Replay executes the recorded experiment through the same action executors and evidence oracle.
- Unsupported action/provider combinations fail with `unsupported`, not `skipped` success.
- Results distinguish `passed`, `failed`, `inconclusive`, `unsupported`, and `execution_error`.
- Point retest uses a fresh marker and stores a new proof assertion linked to the original.

## Sandbox Profiles

This remains an optional product milestone. External tools continue to be deny-by-default; adding Docker/local execution profiles must not weaken that gate.

```typescript
type ExecutionIsolation =
  | { mode: 'docker'; image: string; networkPolicy: NetworkPolicy }
  | { mode: 'local'; approvedByUser: true }
  | { mode: 'logical' }
```

- `docker` is required for configured active external operations.
- If Docker is selected but unavailable, fail closed. Do not automatically switch to local.
- Local execution requires an explicit approval record.
- Logical isolation is labeled as state namespacing and never described as a security sandbox.
- Heavy tools and source-language analyzers are optional process/Docker/MCP plugins; they are not bundled into the SDK.

## Case File

Each included finding contains target/scope refs, actor and workflow prerequisites, baseline, mutation, changed variables, oracle, evidence refs, redacted request/response material, replay definition, proof result, retest result, decisions, tool/plugin versions, and timestamps.

Export validates self-containment. Missing required data excludes the item from `findings` and lists it under `incompleteCandidates` with reasons.

## Remediation

Remediation is an optional plugin flow:

1. Create an isolated git worktree.
2. Generate a minimal patch from the verified case.
3. Run project checks and the point retest.
4. Produce a patch artifact and draft PR description.
5. Require explicit user approval before push or PR creation.
6. Never auto-merge.

This capability is not part of the first runtime-hardening gate and must not block verified scanning.

## CI Contract

Provide a noninteractive command that emits a versioned JSON result and stable exit policy:

```typescript
interface CiAssessmentResult {
  schemaVersion: number
  workflowRef: string
  status: 'complete' | 'incomplete' | 'failed'
  verifiedFindings: CaseFindingSummary[]
  candidates: CandidateSummary[]
  executionErrors: ExecutionErrorSummary[]
  artifactRefs: string[]
  metrics: RunMetrics
}
```

Merge gating is configurable by verified severity only. Candidates and incomplete runs are visible but do not masquerade as verified failures.

## Benchmarks

This remains a release-publication milestone, not a runtime correctness blocker.

- Version fixtures, target images, model/provider, configuration, tool versions, and seeds where available.
- Measure verified recall, false positives, replay success, incomplete rate, coverage, duration, and cost.
- Run in clean environments and publish failed cases.
- Separate deterministic fixture regressions from model-dependent benchmark runs.
- Do not claim superiority without comparable published methodology and results.

## Tests

- SDK and CLI create equivalent workflows for the same injected fixture.
- Replay actually executes and revalidates the oracle.
- Docker unavailable fails closed; local requires approval.
- SDK install does not pull heavy external binaries or language runtimes.
- Case-file self-containment validator detects missing components.
- CI schema and exit behavior are stable.
- Benchmark harness reproduces deterministic fixture results from a clean checkout.

## Acceptance Criteria

- SDK is a thin facade over the canonical runtime.
- Replay and case files are executable and honest about unsupported/incomplete states.
- Isolation modes are explicit and accurately named.
- Competitive claims are backed by reproducible published data.
