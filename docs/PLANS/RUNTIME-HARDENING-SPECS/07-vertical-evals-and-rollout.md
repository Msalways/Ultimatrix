# 07. Vertical Evals and Rollout

## Goal

Prevent another "implemented in isolation but bypassed in production" outcome by validating invariants through real public entrypoints and removing old paths in controlled phases.

## Test Strategy

Unit tests remain for pure functions, but completion requires vertical fixtures that use real composition roots and only fake external boundaries: model, browser provider, network, process/container runner, and clock.

## Required Eval Matrix

| Invariant | CLI | Web | SDK | Council | Worker |
|---|---:|---:|---:|---:|---:|
| Runtime isolation/persistence | yes | yes + concurrent | yes | shared runtime | shared runtime |
| Skill activation/tool view | yes | yes | yes | yes | yes |
| Experiment/proof/finding | yes | yes | yes | proposal only | yes |
| Structured planning | yes | yes | yes | yes | consumes plan |
| Terminal lifecycle/resume | yes | yes | yes | n/a | playbook |
| Case file/replay | yes | API route | yes | n/a | evidence source |

## Mandatory Negative Fixtures

- Unknown skill and tool IDs.
- Browser/extension tool outside final allow-list.
- Missing proof and transport-only evidence.
- Generic 200 denial, localized copy, baseline marker collision, and ordinary structured fields.
- Two concurrent targets with opposite policies.
- Interrupted checkpoint and process restart.
- Provider mismatch on resume.
- Worker-required plan without a delegate.
- Docker selected but unavailable.
- Legacy workflow migration containing secret-bearing URLs.

## Rollout Phases

### Phase 1: Composition Root

Add `EngagementRuntime`, migrate CLI and Web behind compatibility adapters, and land concurrency/persistence evals. Do not add new global adapters.

### Phase 2: Skills and Tools

Land canonical catalog, activation state, and final tool views. Remove automatic preloading and duplicate search implementations in the same phase.

### Phase 3: Findings

Land experiment and promotion services. Migrate all finding callers, remove public `addFinding`, and change reports to require passing proof.

### Phase 4: Planning and Orchestration

Land structured planning, hint provenance, terminal finalizer, and worker delegate wiring. Remove duplicate text routers after call-site migration.

### Phase 5: SDK and Delivery

Move SDK to the canonical runtime, implement replay/case validation/CI schema, then add optional isolation and remediation plugins.

### Phase 6: Benchmark Release

Freeze benchmark schema and fixtures, run clean baselines, publish methodology and results.

## Compatibility Policy

- Deprecations last one release unless retaining them would preserve a proof, isolation, or authorization bypass; unsafe APIs are removed immediately with a migration error.
- Persisted format migrations are pure, versioned, and covered by golden fixtures.
- CLI/config names remain compatible where semantics remain honest.
- Do not silently translate an unsupported old behavior into success.

## Completion Gate Per Phase

1. Spec acceptance tests pass.
2. Existing focused and architecture evals pass.
3. Full test suite and CLI build pass.
4. No deprecated bypass remains reachable on a production call path.
5. Documentation and audit gap IDs are updated with evidence links.

## Final Acceptance Criteria

- Every gap G1-G10, H1-H8, A1-A8, and P1-P7 maps to a passing vertical eval or an explicitly deferred product milestone.
- Architectural completion statements cite the public-entrypoint eval that proves them.
- No phase is marked complete solely from mocked manual pipelines or isolated set-composition tests.
