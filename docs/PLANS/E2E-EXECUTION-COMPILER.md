# E2E Execution Compiler — Task Breakdown

**Source:** `docs/ultimatrix_e2e_improvement_plan.md` (2300-line plan)
**Goal:** Evolve Ultimatrix into an agent execution compiler — compile the smallest useful knowledge, capability, and execution surface for each research objective.
**Status:** IMPLEMENTATION STARTED
**Created:** 2026-09-17

---

## Architecture Principle

> The model should reason over a compiled view of the investigation, not the entire investigation.

Three independent compilation surfaces:
1. **Context Compiler** → WHAT THE MODEL SHOULD KNOW
2. **Capability Compiler** → WHAT THE MODEL MAY DO (partially built)
3. **Execution Compiler** → HOW THE WORK SHOULD PHYSICALLY RUN

---

## Build Order (Impact-Per-Effort Priority)

| Phase | What | Effort | Impact | Status |
|-------|------|--------|--------|--------|
| 0 | Telemetry Baseline | Small | High (enables measurement) | `DONE` |
| 1 | Coverage Identity Fix | Small | High (real bug fix) | `DONE` |
| S | Docker Sandbox | Medium | High (immediate tooling) | `DONE` |
| 7 | Capability Effects | Small | Medium (extends compiler) | `DONE` |
| 3 | Context Compiler | Large | Highest (40-50% token reduction) | `DONE` |
| 2 | ResearchOpportunity | Medium | High (new concept) | `DONE` |
| 4 | Research Cases | Medium | Medium (learning loop) | `DONE` |
| 5 | Pivot Generation | Small | Medium (extends hypotheses) | `DONE` |
| 8 | Execution Compiler | Medium | High (differentiator) | `DONE` |
| 9 | Live Model Registry | Medium | Medium (stale-map fix) | `DONE` |
| 10 | Benchmark Harness | Small | High (proves improvement) | `DONE` |

---

## Phase 0 — Telemetry Baseline

**Objective:** Create reliable before/after measurements. Without baseline metrics, we cannot prove improvements work.

### T0.1 — TaskTelemetry type
- **File:** `src/telemetry/types.ts` (NEW)
- **What:** Define `TaskTelemetry` interface with 20+ metrics:
  - Identity: `runId`, `taskId`, `skillId`, `model`, `provider`
  - Context: `visibleTools`, `visiblePrimitives`, `toolSchemaTokens`, `skillTokens`, `retrievedContextTokens`
  - Reasoning: `modelCalls`, `toolCalls`, `invalidToolCalls`, `irrelevantToolCalls`, `retries`
  - Evidence: `evidenceCreated`, `artifactsCreated`, `candidateFindings`, `acceptedFindings`, `rejectedFindings`
  - Timing: `durationMs`, `firstActionMs`
- **Verify:** TypeScript compiles, type exported

### T0.2 — TelemetryRecorder
- **File:** `src/telemetry/recorder.ts` (NEW)
- **What:** `TelemetryRecorder` class:
  - `start(runId, taskId, skillId, model, provider)` → returns `TaskTelemetryBuilder`
  - Builder has `.recordToolCall()`, `.recordModelCall()`, `.recordEvidence()`, `.recordFinding()`, `.end()`
  - `.end()` freezes the telemetry, persists to `ForensicLog` as a new event type `task-telemetry`
  - Module-level singleton: `getGlobalTelemetryRecorder()`
- **Verify:** Unit test — start, record events, end, check forensic log entry

### T0.3 — Wire into solver loop
- **File:** `src/solver/solver.ts` (MODIFY)
- **What:** At solver turn start, call `telemetryRecorder.start()`. At turn end, call `.end()`. Wire tool-call counting into existing tool-call tracking.
- **Verify:** Existing tests pass, telemetry events appear in forensic log

### T0.4 — Wire into worker execution
- **File:** `src/runtime/worker-pool-executor.ts` (MODIFY)
- **What:** Wrap worker execution with telemetry recording. Capture worker-level metrics separately from brain-level.
- **Verify:** Existing tests pass, worker telemetry recorded

### T0.5 — Aggregation query
- **File:** `src/telemetry/aggregator.ts` (NEW)
- **What:** `aggregateTelemetry(runId)` → `RunTelemetry` (per-run summary), `compareTelemetry(baseline, improved)` → diff report
- **Verify:** Unit test — aggregate multiple task telemetries, produce summary

### T0.6 — Tests
- **File:** `test/telemetry/recorder.test.ts` (NEW)
- **File:** `test/telemetry/aggregator.test.ts` (NEW)
- **What:** 10+ tests covering: start/end lifecycle, event recording, forensic log integration, aggregation, comparison
- **Verify:** `npx vitest run test/telemetry`

---

## Phase 1 — Coverage Identity Fix

**Objective:** Coverage should not be keyed only by skillId. Parallel tasks using the same skill must maintain separate coverage.

### T1.1 — CoverageScope type
- **File:** `src/intelligence/coverage-ledger.ts` (MODIFY)
- **What:** Add `CoverageScope` type:
  ```ts
  interface CoverageScope { runId: string; taskId: string; skillId: string }
  ```
  Change internal `coverageMap` key from `string` (skillId) to `string` (composite key: `runId:taskId:skillId`).
  Add helper `scopeKey(scope: CoverageScope): string`.
- **Verify:** TypeScript compiles

### T1.2 — Update API signatures
- **File:** `src/intelligence/coverage-ledger.ts` (MODIFY)
- **What:** All public functions (`initCoverage`, `markStageExecuted`, `markStageCovered`, `markStageSkipped`, `getCoverageStatus`, `getUncoveredStages`, `coverageSummary`) accept `CoverageScope` as first parameter instead of `skillId`.
  Add backward-compat wrapper: `initCoverage(skillId, contract)` delegates to `initCoverage({ runId: 'default', taskId: 'default', skillId }, contract)`.
- **Verify:** Existing callers still work (backward compat), new callers can use scope

### T1.3 — Update callers
- **Files:** `src/solver/brain-tools.ts`, `src/runtime/worker-pool-executor.ts`, `src/solver/solver.ts` (MODIFY)
- **What:** Pass `runId + taskId` from `StrategyContext` or `WorkerConfig` into coverage functions.
- **Verify:** Existing tests pass

### T1.4 — Event-sourced coverage projection
- **File:** `src/intelligence/coverage-ledger.ts` (MODIFY)
- **What:** Add `CoverageEvent` type:
  ```ts
  type CoverageEvent = { type: 'stage.executed' | 'stage.covered' | 'stage.skipped'; scope: CoverageScope; stageId: string; timestamp: number; ref?: string }
  ```
  Store events in module-level array. Coverage state becomes a projection of events.
  Add `getCoverageEvents(scope)` for replay.
- **Verify:** Coverage state is deterministic from events, replay works

### T1.5 — Tests
- **File:** `test/integration/coverage-scope.test.ts` (NEW)
- **What:** 6+ tests:
  - Two tasks using same skill maintain separate coverage
  - Coverage survives scope-keyed lookups
  - Event replay reconstructs coverage state
  - Backward-compat wrapper works
  - Cross-task coverage leakage is impossible
- **Verify:** `npx vitest run test/integration/coverage-scope`

---

## Phase S — Docker Sandbox

**Objective:** Run security tools in isolated Docker containers with auto-fallback from local to sandbox.

### TS.1 — Sandbox types
- **File:** `src/execution/types.ts` (NEW)
- **What:**
  ```ts
  type ExecutionPlatform = 'linux-native' | 'docker-desktop' | 'no-docker'
  type NetworkMode = 'host' | 'bridge' | 'none'
  interface SandboxConfig { enabled: boolean; image: string; networkMode: NetworkMode; timeoutMs: number; memoryLimit: string; cpuQuota: number }
  interface SandboxStatus { platform: ExecutionPlatform; dockerAvailable: boolean; containerRunning: boolean; containerId?: string }
  interface SandboxResult { stdout: string; stderr: string; exitCode: number; durationMs: number; timedOut: boolean }
  ```
- **Verify:** TypeScript compiles

### TS.2 — Platform detection
- **File:** `src/execution/platform.ts` (NEW)
- **What:** `detectPlatform(): ExecutionPlatform` — runs `docker info` via `execFile`, classifies result.
  `getDefaultConfig(platform): SandboxConfig` — returns appropriate defaults per platform.
  `checkDockerAvailable(): Promise<boolean>` — lightweight docker ping.
- **Verify:** Unit test with mocked execFile

### TS.3 — Docker client
- **File:** `src/execution/docker-client.ts` (NEW)
- **What:** Thin wrapper around `dockerode`:
  - `pullImage(image)` — pull with progress
  - `createContainer(config)` — create with resource limits, network mode, read-only root FS
  - `startContainer(id)`, `stopContainer(id)`, `removeContainer(id)`
  - `execInContainer(id, command, opts)` → `SandboxResult` — exec with timeout
  - `listContainers(filter)` — list running ultimatrix containers
  - All operations use `execFile` arg-arrays (NO shell interpolation)
- **Verify:** Unit test with mocked dockerode

### TS.4 — Sandbox manager
- **File:** `src/execution/sandbox-manager.ts` (NEW)
- **What:** Per-engagement container lifecycle:
  - `SandboxManager` class:
    - `constructor(config: SandboxConfig)`
    - `ensureReady()` — pull image if needed, create container
    - `execute(command, opts)` → `SandboxResult` — auto-retry on timeout
    - `isAvailable()` — platform check + docker check
    - `shutdown()` — stop + remove container
  - Module-level singleton per engagement via `EngagementServices`
- **Verify:** Unit test with mocked docker client

### TS.5 — Sandbox adapter
- **File:** `src/execution/sandbox-adapter.ts` (NEW)
- **What:** `createSandboxAdapter(toolId, localFn, sandboxCommand)` — wraps any `ToolAdapter`:
  1. Try local execution first (`localFn`)
  2. If tool not available locally AND docker available → run in sandbox
  3. If neither available → return `{ ok: false, skip: true, reason: 'tool not available' }`
  - Maps tool IDs to sandbox commands: `nuclei → nuclei -target $TARGET`, `sqlmap → sqlmap -u $URL`, etc.
- **Verify:** Unit test — local available, local unavailable+sandbox available, neither available

### TS.6 — Config integration
- **File:** `src/config.ts` (MODIFY)
- **What:** Add `SandboxConfig` to `UltimatrixConfig`:
  ```ts
  sandbox?: { enabled?: boolean; image?: string; networkMode?: 'host' | 'bridge' | 'none'; timeoutMs?: number }
  ```
  Add defaults in `DEFAULT_CONFIG`.
- **Verify:** Config parsing still works

### TS.7 — Wire into scanner tools
- **File:** `src/tools/scanner-tools.ts` (MODIFY)
- **What:** Wrap `buildAdapterTool` to auto-apply sandbox fallback. When sandbox config is enabled, each adapter tool gets the sandbox wrapper.
- **Verify:** Existing adapter tests pass, new sandbox fallback tests pass

### TS.8 — Custom Dockerfile
- **File:** `containers/Dockerfile` (NEW)
- **What:** FROM `kalilinux/kali-rolling`, install: nmap, nuclei, sqlmap, ffuf, gobuster, nikto, hydra, john, amass, subfinder, httpx, masscan, wpscan, wafw00f, whatweb, netcat, tshark, tcpdump, python3, SecLists. Cleanup apt cache. Non-root user for execution.
- **Verify:** `docker build -t ultimatrix-sandbox containers/`

### TS.9 — Tests
- **File:** `test/execution/platform.test.ts` (NEW) — 6 tests
- **File:** `test/execution/docker-client.test.ts` (NEW) — 8 tests
- **File:** `test/execution/sandbox-manager.test.ts` (NEW) — 8 tests
- **File:** `test/execution/sandbox-adapter.test.ts` (NEW) — 6 tests
- **Verify:** `npx vitest run test/execution`

---

## Phase 7 — Capability Effects

**Objective:** The compiler should understand not only capability names, but their effects (network, browser, reversibility, etc.).

### T7.1 — CapabilityEffects type
- **File:** `src/capabilities/types.ts` (MODIFY)
- **What:** Add to `CompiledCapabilitySet`:
  ```ts
  interface CapabilityEffects {
    network?: boolean; browser?: boolean; filesystem?: boolean;
    readsSecrets?: boolean; writesState?: boolean; createsArtifact?: boolean;
    mutatesTarget?: boolean; spawnsWorker?: boolean; externallyVisible?: boolean;
    estimatedLatencyMs?: number; estimatedTokenCost?: number;
    reversibility?: 'read-only' | 'reversible' | 'irreversible';
  }
  ```
  Add `effects?: CapabilityEffects` to `CompiledCapabilitySet`.
- **Verify:** TypeScript compiles

### T7.2 — Tool effects registry
- **File:** `src/capabilities/effects.ts` (NEW)
- **What:** Static `TOOL_EFFECTS: Record<string, CapabilityEffects>` map for all 60+ tools.
  Example: `httpRequest → { network: true, externallyVisible: true, reversibility: 'read-only' }`
  `writeFinding → { writesState: true, createsArtifact: true, reversibility: 'reversible' }`
  `runPrimitive → { mutatesTarget: true, network: true, reversibility: 'irreversible' }`
  Function: `aggregateEffects(toolIds: string[]): CapabilityEffects` — merges effects from all tools.
- **Verify:** Unit test — aggregate effects for authorization skill tool set

### T7.3 — Wire into compiler
- **File:** `src/capabilities/compiler.ts` (MODIFY)
- **What:** After compiling tools, call `aggregateEffects(tools)` and attach to result.
- **Verify:** Existing tests pass, new `effects` field populated

### T7.4 — Tests
- **File:** `test/capabilities/effects.test.ts` (NEW)
- **What:** 8+ tests: individual tool effects, aggregation, reversibility merging, empty set
- **Verify:** `npx vitest run test/capabilities/effects`

---

## Phase 3 — Context Compiler

**Objective:** Compile the smallest useful investigation context for a worker. This is the highest-impact improvement.

### T3.1 — Context types
- **File:** `src/context/types.ts` (NEW)
- **What:**
  ```ts
  interface CompileContextInput {
    runId: string; taskId: string; objective: string; skillId?: string;
    opportunityRefs?: string[]; experimentRefs?: string[]; candidateRefs?: string[];
    tokenBudget: number; modelProfile?: ModelProfile;
  }
  interface ResearchContextView {
    objective: string; summary: string;
    graphRefs: string[]; opportunityRefs: string[]; experimentRefs: string[];
    evidenceRefs: string[]; artifactRefs: string[]; findingRefs: string[];
    sourceViews: Array<{ ref: string; type: string; preview: string; relevance: number }>;
    omissions: Array<{ type: string; count: number; reason: string }>;
    tokenEstimate: number;
  }
  ```
- **Verify:** TypeScript compiles

### T3.2 — Context selectors
- **File:** `src/context/selectors.ts` (NEW)
- **What:** Deterministic selection functions (NO LLM):
  - `selectDirectRefs(exchangeIds, graphStore)` — evidence directly linked to task
  - `selectRelevantFacts(graphStore, endpointUrl, skillId)` — high-relevance graph facts
  - `selectRelatedExperiments(experimentIds, graphStore)` — same hypothesis family
  - `selectHistoricalLessons(skillId, crossEngagementMemory)` — sanitized reusable lessons
  - `estimateTokenCount(sources)` — token estimation per source
- **Verify:** Unit test each selector

### T3.3 — Context compiler
- **File:** `src/context/compiler.ts` (NEW)
- **What:** `compileContext(input: CompileContextInput): ResearchContextView`:
  1. Level 0: Identity (objective, skill, target, actors) — always included
  2. Level 1: Direct evidence — from exchange artifact refs
  3. Level 2: Relevant graph facts — scored by endpoint/skill relevance
  4. Level 3: Previous experiments — same hypothesis family
  5. Level 4: Historical lessons — from cross-engagement memory
  6. Level 5: Raw artifacts — loaded JIT (omitted by default)
  - Budget enforcement: iterate levels, add sources until token budget exhausted
  - Record omissions when budget exceeded
- **Verify:** Unit test — authorization task gets relevant context, not JWT knowledge

### T3.4 — Wire into worker creation
- **File:** `src/workers/factory.ts` (MODIFY)
- **What:** Before creating agent, call `compileContext()` with task details. Attach `ResearchContextView` to worker instructions (compact summary, not full payloads).
- **Verify:** Existing tests pass, workers receive bounded context

### T3.5 — JIT expansion
- **File:** `src/context/compiler.ts` (MODIFY)
- **What:** `expandContext(view, ref, graphStore)` — fetch full payload for a specific ref on demand. Uses existing `boundResult()` + `ToolResultStore` pattern.
- **Verify:** Unit test — expand omitted artifact, get full content

### T3.6 — Tests
- **File:** `test/context/compiler.test.ts` (NEW) — 10 tests
- **File:** `test/context/selectors.test.ts` (NEW) — 8 tests
- **What:** IDOR task excludes JWT knowledge, budget enforced, omissions recorded, JIT expansion works
- **Verify:** `npx vitest run test/context`

---

## Phase 2 — ResearchOpportunity

**Objective:** First-class pre-task concept for "this looks interesting, investigate it."

### T2.1 — Opportunity types
- **File:** `src/research/opportunities/types.ts` (NEW)
- **What:**
  ```ts
  interface ResearchOpportunity {
    id: string; runId: string; targetRef: string;
    title: string; summary: string;
    signal: { type: string; source: 'traffic' | 'graph' | 'recon' | 'scanner' | 'research' | 'human' | 'pivot' };
    evidenceRefs: string[]; artifactRefs: string[];
    suggestedSkills: Array<{ skillId: string; score: number; reason: string }>;
    priority: number;
    status: 'new' | 'investigating' | 'parked' | 'killed' | 'promoted';
    firstSeenAt: number; lastSeenAt: number; seenCount: number;
    taskRefs: string[]; candidateRefs: string[];
  }
  type OpportunityKillReason = 'duplicate' | 'out_of_scope' | 'already_tested' | 'insufficient_signal' | 'policy_denied' | 'proven_benign' | 'budget_exhausted'
  ```
- **Verify:** TypeScript compiles

### T2.2 — Opportunity store
- **File:** `src/research/opportunities/store.ts` (NEW)
- **What:** `OpportunityStore` class:
  - `create(signal)` → deduplicates by `targetRef + signal.type + normalized subject`
  - `update(id, changes)` — update status, seenCount, lastSeenAt
  - `promote(id, taskId)` — link to task
  - `kill(id, reason)` — mark killed
  - `getById(id)`, `getByRun(runId)`, `getActive(runId)`
  - Persist to graph store as `ResearchOpportunityNode`
- **Verify:** Unit test — create, dedup, promote, kill

### T2.3 — Opportunity scorer
- **File:** `src/research/opportunities/scorer.ts` (NEW)
- **What:** `scoreOpportunity(opp, context)` → number:
  ```
  severity_prior + novelty + repeated_observation_count + confidence
  + target_relevance + unexplored_skill_coverage
  - duplicated_evidence - already_disproven_hypothesis
  ```
  Deterministic scoring, no LLM.
- **Verify:** Unit test — scoring increases with repeated observations, decreases with proven benign

### T2.4 — Graph node
- **File:** `src/graph/schema.ts` (MODIFY)
- **What:** Add `NodeType.RESEARCH_OPPORTUNITY` and `ResearchOpportunityNode` interface. Add edge types: `ORIGINATES_FROM`, `INVESTIGATED_BY`.
- **Verify:** Schema compiles, existing node count tests updated

### T2.5 — Wire into solver
- **File:** `src/solver/solver.ts` (MODIFY)
- **What:** After each solver turn, extract signals from observations → create/update opportunities.
- **Verify:** Existing tests pass

### T2.6 — Tests
- **File:** `test/research/opportunities/store.test.ts` (NEW) — 8 tests
- **File:** `test/research/opportunities/scorer.test.ts` (NEW) — 6 tests
- **Verify:** `npx vitest run test/research/opportunities`

---

## Phase 4 — Research Cases

**Objective:** Structured false-positive retention with sanitized reusable memory.

### T4.1 — ResearchEvent type
- **File:** `src/research/events/types.ts` (NEW)
- **What:**
  ```ts
  interface ResearchEvent {
    eventId: string; runId: string;
    opportunityId?: string; taskId?: string; experimentId?: string;
    findingId?: string; skillId?: string;
    type: 'opportunity.created' | 'investigation.started' | 'candidate.created' | 'finding.validated' | 'finding.rejected' | 'false_positive.identified' | 'technique.succeeded' | 'technique.failed' | 'human.corrected';
    reasonCode?: string; evidenceRefs: string[]; timestamp: number;
  }
  ```
- **Verify:** TypeScript compiles

### T4.2 — ResearchCase type
- **File:** `src/research/cases/types.ts` (NEW)
- **What:**
  ```ts
  interface ResearchCase {
    id: string; domain: string; skillId?: string;
    initialHypothesis: string;
    contextFeatures: string[];
    decisiveEvidence: string[]; counterEvidence: string[];
    outcome: 'validated' | 'rejected' | 'inconclusive';
    falsePositiveReason?: string; killSignal?: string;
    reusableLesson?: string;
    sourceRefs: string[];
  }
  ```
- **Verify:** TypeScript compiles

### T4.3 — Case builder
- **File:** `src/research/cases/builder.ts` (NEW)
- **What:** `buildCase(events: ResearchEvent[], evidence: EvidenceItem[])` → `ResearchCase`. Extracts hypothesis, counter-evidence, outcome from structured events.
- **Verify:** Unit test — rejected candidate builds correct case

### T4.4 — Sanitizer
- **File:** `src/research/cases/sanitizer.ts` (NEW)
- **What:** `sanitizeForMemory(case)` → `ResearchCase` with sensitive values removed. Removes URLs, hostnames, cookies, headers, tokens, payloads. Keeps: framework patterns, reasoning mistakes, kill signals, counter-evidence patterns.
- **Verify:** Unit test — sanitized case has no raw URLs or secrets

### T4.5 — Wire into evidence gate
- **File:** `src/intelligence/evidence-gate.ts` (MODIFY)
- **What:** When a candidate finding is rejected, emit a `ResearchEvent` of type `false_positive.identified`. Store event.
- **Verify:** Existing tests pass

### T4.6 — Tests
- **File:** `test/research/cases/builder.test.ts` (NEW) — 6 tests
- **File:** `test/research/cases/sanitizer.test.ts` (NEW) — 6 tests
- **Verify:** `npx vitest run test/research/cases`

---

## Phase 5 — Pivot Generation

**Objective:** Convert investigation conclusions into new research opportunities.

### T5.1 — Pivot generator
- **File:** `src/research/pivots/generator.ts` (NEW)
- **What:**
  ```ts
  interface ProposedPivot { title: string; hypothesis: string; sourceRefs: string[]; suggestedSkills: string[]; expectedInformationGain?: number; estimatedCost?: number }
  function generatePivots(conclusion: ResearchCase, hypotheses: Hypothesis[]): ProposedPivot[]
  ```
  Safety rule: IDEA GENERATION ≠ AUTHORIZATION. Pivots become opportunities, never bypass policy.
- **Verify:** Unit test — rejected hypothesis generates pivot, pivot doesn't auto-grant capabilities

### T5.2 — Wire into opportunity store
- **File:** `src/research/pivots/generator.ts` (MODIFY)
- **What:** `generatePivots()` also creates `ResearchOpportunity` entries via `OpportunityStore` for each pivot.
- **Verify:** Pivots become opportunities with status 'new'

### T5.3 — Tests
- **File:** `test/research/pivots/generator.test.ts` (NEW) — 6 tests
- **Verify:** `npx vitest run test/research/pivots`

---

## Verification Matrix

| Invariant | Test | Phase |
|-----------|------|-------|
| INV-01: Model cannot invoke merely because it exists | Capability isolation test | T7 |
| INV-02: Primitive outside grant cannot execute | Grant enforcement test | S |
| INV-03: Worker-visible capabilities reproducible | Deterministic compilation test | T7 |
| INV-04: Every external action creates provenance | Telemetry recording test | T0 |
| INV-05: Raw result persistence never relies on model | Auto-capture test | T3 |
| INV-06: Finding acceptance not based only on model prose | Evidence gate test | T4 |
| INV-07: Parent availability ≠ child visibility | Worker isolation test | T3 |
| INV-08: Knowledge ≠ capability authority | Context/capability separation test | T3+T7 |
| INV-09: Narrowing doesn't require rewriting implementation | Compiler composition test | T7 |
| INV-10: Worker completion ≠ task acceptance | Verification contract test | T4 |
| INV-11: Coverage isolated by run/task/skill | Coverage scope test | T1 |
| INV-12: Opportunities survive worker failure | Opportunity persistence test | T2 |
| INV-13: Pivots cannot escalate authority | Pivot safety test | T5 |
| INV-14: Reusable memory cannot contain secrets | Sanitizer test | T4 |
| INV-15: Context stays within token budget | Budget enforcement test | T3 |
| INV-16: Compiled capsule replayable/auditable | Telemetry + event log test | T0+T4 |
| INV-17: Execution Compiler replaces model work with deterministic | Deterministic step substitution test | Future |

---

## Estimated Test Count

| Phase | New Tests |
|-------|-----------|
| T0 Telemetry | ~12 |
| T1 Coverage | ~8 |
| S Sandbox | ~28 |
| T7 Effects | ~8 |
| T3 Context | ~18 |
| T2 Opportunity | ~14 |
| T4 Cases | ~12 |
| T5 Pivots | ~6 |
| **Total** | **~106** |

---

## File Manifest

### New Files (20)
```
src/telemetry/types.ts
src/telemetry/recorder.ts
src/telemetry/aggregator.ts
src/execution/types.ts
src/execution/platform.ts
src/execution/docker-client.ts
src/execution/sandbox-manager.ts
src/execution/sandbox-adapter.ts
src/context/types.ts
src/context/selectors.ts
src/context/compiler.ts
src/research/opportunities/types.ts
src/research/opportunities/store.ts
src/research/opportunities/scorer.ts
src/research/events/types.ts
src/research/cases/types.ts
src/research/cases/builder.ts
src/research/cases/sanitizer.ts
src/research/pivots/generator.ts
containers/Dockerfile
```

### Modified Files (10)
```
src/intelligence/coverage-ledger.ts    (Phase 1: scope key)
src/capabilities/types.ts             (Phase 7: effects)
src/capabilities/compiler.ts          (Phase 7: wire effects)
src/config.ts                         (Phase S: sandbox config)
src/tools/scanner-tools.ts            (Phase S: sandbox adapter)
src/graph/schema.ts                   (Phase 2: ResearchOpportunity node)
src/solver/solver.ts                  (Phase 0+2: telemetry + opportunities)
src/runtime/worker-pool-executor.ts   (Phase 0: worker telemetry)
src/workers/factory.ts                (Phase 3: context compilation)
src/intelligence/evidence-gate.ts     (Phase 4: false positive events)
```

### Test Files (12)
```
test/telemetry/recorder.test.ts
test/telemetry/aggregator.test.ts
test/integration/coverage-scope.test.ts
test/execution/platform.test.ts
test/execution/docker-client.test.ts
test/execution/sandbox-manager.test.ts
test/execution/sandbox-adapter.test.ts
test/capabilities/effects.test.ts
test/context/compiler.test.ts
test/context/selectors.test.ts
test/research/opportunities/store.test.ts
test/research/opportunities/scorer.test.ts
test/research/cases/builder.test.ts
test/research/cases/sanitizer.test.ts
test/research/pivots/generator.test.ts
```
