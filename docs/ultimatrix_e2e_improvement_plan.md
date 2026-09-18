# Ultimatrix E2E Improvement Plan

**Project:** Ultimatrix  
**Goal:** Evolve the current runtime from skill selection + capability compilation into a full **agent execution compiler** that compiles the smallest useful knowledge, capability, and execution surface for each research objective.

---

## 1. Executive Summary

Ultimatrix already has many of the hard runtime foundations that other agent systems usually lack:

- skill discovery and progressive loading,
- capability compilation,
- capability grants and risk classification,
- worker/task coordination,
- actor/session references,
- bounded tool results,
- exchange artifacts,
- evidence and finding gates,
- coverage tracking,
- capability gateway enforcement,
- graph-backed runtime state,
- model routing and budget controls.

The next improvement should **not** be a rewrite.

The next phase should make the runtime better at managing the full investigation lifecycle:

```text
Observation
   ↓
Research Opportunity
   ↓
Skill Selection
   ↓
Context Compilation
   ↓
Capability Compilation
   ↓
Execution Compilation
   ↓
Experiment
   ↓
Evidence
   ↓
Candidate Finding
   ↓
Verification
   ↓
Finding / Rejection
   ↓
Research Learning
   ↓
Next Opportunity
```

The central architectural idea is:

> **The model should reason over a compiled view of the investigation, not the entire investigation.**

Ultimatrix should compile three independent surfaces for each task:

```text
1. WHAT THE MODEL SHOULD KNOW
   → Context Compiler

2. WHAT THE MODEL MAY DO
   → Capability Compiler

3. HOW THE WORK SHOULD PHYSICALLY RUN
   → Execution Compiler
```

This improves context efficiency, small-model reliability, security, parallelism, reproducibility, evidence quality, debuggability, learning from failed investigations, and portability across domains and providers.

---

# 2. Target Architecture

## 2.1 End-to-End Architecture

```text
                                  WORLD
                                    │
              ┌─────────────────────┼─────────────────────┐
              │                     │                     │
           Browser                HTTP              External Research
              │                     │                     │
              │                     │                DISCOVER
              │                     │                     │
              │                     │                  SELECT
              │                     │                     │
              │                     │                MATERIALIZE
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    ▼
                               Observations
                                    │
                                    ▼
                              Signal Extraction
                                    │
                                    ▼
                         ResearchOpportunity
                                    │
                                    ▼
                              Skill Retrieval
                                    │
                                    ▼
                               Logical Plan
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
         Context Compiler    Capability Compiler   Execution Compiler
                │                   │                   │
          relevant facts       allowed actions      physical topology
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    ▼
                              Worker Capsule
                                    │
                                    ▼
                                Execution
                                    │
                    ┌───────────────┼───────────────┐
                    │               │               │
                  HTTP           Browser         Sandbox/MCP
                    │               │               │
                    └───────────────┼───────────────┘
                                    ▼
                          Observation Pipeline
                                    │
                  ┌─────────────────┼─────────────────┐
                  │                 │                 │
               Artifact          Evidence          Coverage
                  │                 │                 │
                  └─────────────────┼─────────────────┘
                                    ▼
                                Experiment
                                    │
                                    ▼
                            CandidateFinding
                                    │
                               Evidence Gate
                               /           \
                              /             \
                         rejected          accepted
                            │                 │
                            ▼                 ▼
                     ResearchEvent         Finding
                            │                 │
                            └────────┬────────┘
                                     ▼
                                ResearchCase
                                     │
                              Generalization
                                     │
                                     ▼
                            Curriculum / Memory
                                     │
                                     ▼
                              Pivot Generation
                                     │
                                     ▼
                         ResearchOpportunity
```

---

# 3. Core Runtime Principles

## 3.1 Authority Is Not Visibility

A capability may exist in the registry without being visible to a worker.

```text
Capability exists
      ↓
Registry knows it
      ↓
Resolver considers it
      ↓
Policy authorizes it
      ↓
Compiler exposes it
      ↓
Worker sees it
```

Never collapse this into:

```text
exists ≈ visible ≈ authorized
```

## 3.2 Skills Narrow the Semantic Search Space First

A skill answers:

> What kind of problem is being solved, and what procedure should apply?

The capability compiler answers:

> What exact executable surface should this worker receive?

```text
Task
 ↓
Skill narrows HOW
 ↓
Capability Compiler narrows WHAT
 ↓
Model chooses NEXT
```

## 3.3 Context and Capability Must Be Compiled Separately

The runtime must independently determine what the model knows and what the model can do.

A worker may know about a browser observation without receiving browser control. A worker may receive a comparison capability without receiving raw HTTP authorization headers.

## 3.4 Runtime Owns Bookkeeping

Runtime should automatically own artifact persistence, evidence creation, provenance, graph projection, coverage projection, telemetry, tool attribution, session hydration, and capability enforcement.

The model should mainly own hypothesis formation, semantic interpretation, deciding the next experiment, and proposing conclusions.

## 3.5 Worker Completion Is Not Task Acceptance

```text
worker completed successfully
```

must not imply:

```text
research objective succeeded
```

A task should only succeed when its verification contract is satisfied.

---

# 4. E2E Improvement Roadmap

Recommended implementation order:

```text
Phase 0   Baseline instrumentation
Phase 1   Coverage identity + persistence
Phase 2   ResearchOpportunity lifecycle
Phase 3   Context Compiler
Phase 4   ResearchEvent + ResearchCase learning
Phase 5   Pivot generation
Phase 6   Discover → Select → Materialize abstraction
Phase 7   Capability effect metadata
Phase 8   Execution Compiler
Phase 9   Live Model Registry
Phase 10  Integrated E2E evaluation
```

The order matters. The system should become more observable before it becomes more adaptive.

---

# 5. Phase 0 — Baseline Instrumentation

## Objective

Create reliable before/after measurements before changing runtime behavior.

## Record Per Task

```ts
interface TaskTelemetry {
  runId: string
  taskId: string
  skillId?: string

  model: string
  provider: string

  visibleTools: string[]
  visiblePrimitiveIds: string[]

  initialContextTokens: number
  skillTokens: number
  toolSchemaTokens: number
  retrievedContextTokens: number

  modelCalls: number
  toolCalls: number
  invalidToolCalls: number
  irrelevantToolCalls: number
  retries: number

  evidenceCreated: number
  artifactsCreated: number
  candidateFindings: number
  acceptedFindings: number
  rejectedFindings: number

  durationMs: number
}
```

## Required Measurements

### Context

- visible tools per worker,
- visible primitive IDs,
- tool schema token count,
- skill procedure token count,
- retrieved context token count,
- total initial prompt size.

### Reasoning

- model calls,
- tool calls,
- irrelevant tool calls,
- invalid calls,
- retries,
- time to first useful action.

### Evidence

- duplicate evidence rate,
- missing evidence rate,
- unattributed result count,
- evidence-to-finding ratio.

### Verification

- candidate findings,
- accepted findings,
- rejected findings,
- rejection reasons,
- successful independent retests.

## Exit Criteria

Do not move to later optimization without being able to compare:

```text
OLD WORKER
vs
COMPILED WORKER
```

using deterministic metrics.

---

# 6. Phase 1 — Fix Coverage Identity and Persistence

## Problem

Coverage should not be keyed only by skill. Parallel tasks may use the same skill against different targets or hypotheses.

Incorrect conceptual identity:

```text
authorization → coverage
```

Correct identity:

```text
runId + taskId + skillId → coverage
```

## New Model

```ts
interface CoverageScope {
  runId: string
  taskId: string
  skillId: string
}

interface CoverageStage {
  stageId: string

  status:
    | 'pending'
    | 'executed'
    | 'satisfied'
    | 'skipped'
    | 'failed'

  evidenceRefs: string[]
  reason?: string
}

interface SkillCoverage {
  scope: CoverageScope
  stages: CoverageStage[]
  updatedAt: number
}
```

## Event-Sourced Coverage

Prefer:

```text
CoverageStageExecuted
CoverageStageSatisfied
CoverageStageSkipped
CoverageStageFailed
        ↓
Run Event Store
        ↓
Coverage Projection
```

The in-memory map becomes a cache/projection rather than the authoritative record.

## E2E Test

Two workers:

```text
Task A → authorization
Task B → authorization
```

must maintain completely separate coverage state.

## Exit Criteria

- no cross-task coverage leakage,
- replay reconstructs coverage,
- retries do not duplicate completed stages incorrectly,
- resumed tasks recover previous coverage.

---

# 7. Phase 2 — ResearchOpportunity Lifecycle

## Why This Is Needed

Current investigation systems tend to jump from observation directly to task, or experiment directly to candidate finding. This loses potentially valuable signals that were observed but never investigated.

Introduce a first-class pre-task concept:

```text
Observation
    ↓
ResearchOpportunity
    ↓
Task
```

## Data Model

```ts
interface ResearchOpportunity {
  id: string

  runId: string
  targetRef: string

  title: string
  summary: string

  signal: {
    type: string
    source:
      | 'traffic'
      | 'graph'
      | 'recon'
      | 'scanner'
      | 'research'
      | 'human'
      | 'pivot'
  }

  evidenceRefs: string[]
  artifactRefs: string[]

  suggestedSkills: Array<{
    skillId: string
    score: number
    reason: string
  }>

  priority: number

  status:
    | 'new'
    | 'investigating'
    | 'parked'
    | 'killed'
    | 'promoted'

  firstSeenAt: number
  lastSeenAt: number
  seenCount: number

  taskRefs: string[]
  candidateRefs: string[]
}
```

## Opportunity Deduplication

Potential dedupe key:

```text
targetRef
+
signal.type
+
normalized subject
+
semantic fingerprint
```

Do not create a new opportunity every time the same signal appears. Increment `seenCount` and `lastSeenAt` instead.

## Opportunity Scoring

Score using deterministic signals before model scoring.

Example:

```text
severity prior
+ novelty
+ repeated observation count
+ confidence
+ target relevance
+ unexplored skill coverage
- duplicated evidence
- already disproven hypothesis
```

## Opportunity Lifecycle

```text
new
 ↓
investigating
 ├─→ promoted → task / experiment
 ├─→ parked
 └─→ killed
```

## Kill Reasons

```ts
type OpportunityKillReason =
  | 'duplicate'
  | 'out_of_scope'
  | 'already_tested'
  | 'insufficient_signal'
  | 'policy_denied'
  | 'proven_benign'
  | 'budget_exhausted'
```

## E2E Tests

1. repeated observation increments `seenCount`,
2. duplicate opportunity is not recreated,
3. promoted opportunity links to task,
4. rejected task does not delete originating opportunity,
5. opportunity survives restart,
6. parked opportunity can be resumed.

---

# 8. Phase 3 — Context Compiler

This is one of the most important improvements.

## Objective

Compile the **smallest useful investigation context** for a worker.

The model should not receive all graph nodes, all evidence, all HTTP exchanges, all past messages, all browser pages, or all previous findings. It should receive a task-specific view.

## Input

```ts
interface CompileContextInput {
  runId: string
  taskId: string

  objective: string
  skillId?: string

  opportunityRefs?: string[]
  experimentRefs?: string[]
  candidateRefs?: string[]

  tokenBudget: number

  modelProfile?: ModelProfile
}
```

## Output

```ts
interface ResearchContextView {
  objective: string

  summary: string

  graphRefs: string[]
  opportunityRefs: string[]
  experimentRefs: string[]
  evidenceRefs: string[]
  artifactRefs: string[]
  findingRefs: string[]

  sourceViews: Array<{
    ref: string
    type: string
    preview: string
    relevance: number
  }>

  omissions: Array<{
    type: string
    count: number
    reason: string
  }>

  tokenEstimate: number
}
```

## Context Selection Layers

### Level 0 — Identity

```text
task objective
selected skill
target scope
actors
```

### Level 1 — Direct Evidence

Only evidence directly linked to the opportunity/task.

### Level 2 — Relevant Graph Facts

Only high-relevance graph facts.

### Level 3 — Previous Experiments

Only experiments related to the same hypothesis family.

### Level 4 — Historical Lessons

Only sanitized reusable lessons matching current context.

### Level 5 — Raw Artifacts

Loaded just in time.

## Context Rule

Prefer references over raw payloads.

Example:

```text
Exchange ex_128:
GET /api/invoice/41
actor: user-A
status: 200
body fingerprint: 2fa1...
```

instead of immediately dumping a 25 KB body.

Raw material can be fetched if required.

## Grounded Follow-Up

User asks:

> Why do you think this is an authorization problem?

Do:

```text
question
   ↓
Context Compiler
   ↓
candidate finding
experiment
A/B actor exchanges
evidence
verification result
   ↓
grounded answer
```

Do not rerun the full investigation.

## E2E Tests

- IDOR task should not load unrelated JWT knowledge,
- follow-up context excludes unrelated findings,
- raw artifact is omitted until requested,
- context stays below token budget,
- context compiler records what it omitted.

---

# 9. Phase 4 — ResearchEvent + ResearchCase Learning

## ResearchEvent

Execution events describe what happened operationally. Research events describe what happened semantically.

```ts
interface ResearchEvent {
  eventId: string
  runId: string

  opportunityId?: string
  taskId?: string
  experimentId?: string
  candidateId?: string
  findingId?: string

  skillId?: string

  type:
    | 'opportunity.created'
    | 'investigation.started'
    | 'candidate.created'
    | 'finding.validated'
    | 'finding.rejected'
    | 'false_positive.identified'
    | 'technique.succeeded'
    | 'technique.failed'
    | 'human.corrected'

  reasonCode?: string

  evidenceRefs: string[]
  timestamp: number
}
```

## ResearchCase

A ResearchCase is a distilled investigation lesson.

```ts
interface ResearchCase {
  id: string

  domain: string
  skillId?: string

  initialHypothesis: string

  contextFeatures: string[]

  decisiveEvidence: string[]
  counterEvidence: string[]

  outcome:
    | 'validated'
    | 'rejected'
    | 'inconclusive'

  falsePositiveReason?: string
  killSignal?: string

  reusableLesson?: string

  sourceRefs: string[]
}
```

## Why False Positives Matter

A weak memory system stores:

```text
authorization test failed
```

A useful research memory stores:

```text
Hypothesis:
  object ID was accepted cross-user

Counter-evidence:
  both object IDs belonged to resources shared with both actors

Kill signal:
  ownership boundary was never crossed

Reusable lesson:
  verify ownership separation before classifying equal responses as IDOR
```

## Sanitization Boundary

Raw case containing specific URLs, actor IDs, cookies, headers, payloads, or customer data must remain engagement-local.

Generalized lessons containing framework patterns, security controls, reasoning mistakes, counter-evidence patterns, and kill signals may enter reusable memory.

## E2E Tests

- false-positive reason is retained,
- sensitive values are removed from generalized memory,
- historical lesson can be retrieved for a semantically similar task,
- lesson does not grant capability authority.

---

# 10. Phase 5 — Pivot Generation

## Objective

Convert investigation conclusions into new research opportunities.

## Flow

```text
Experiment / Finding / Rejection
           ↓
      Pivot Generator
           ↓
      Proposed Pivots
           ↓
        Deduplicate
           ↓
       Score / Policy
           ↓
  ResearchOpportunity[]
```

## Example

Current experiment:

```text
/api/v2/invoice/41
```

could generate:

```text
1. Test legacy /api/v1 invoice endpoint
2. Test tenant boundary, not just user boundary
3. Test export endpoint for same object
4. Test mobile API equivalent
```

The pivot generator does not execute them directly. It only creates candidate opportunities.

## Pivot Object

```ts
interface ProposedPivot {
  title: string
  hypothesis: string

  sourceRefs: string[]

  suggestedSkills: string[]

  expectedInformationGain?: number
  estimatedCost?: number
}
```

## Safety Rule

```text
IDEA GENERATION
≠
AUTHORIZATION
```

A pivot does not automatically receive new tools. Normal policy and capability compilation still apply.

---

# 11. Phase 6 — Discover → Select → Materialize

This should become a reusable SDK abstraction.

## Problem

Agent runtimes often eagerly materialize too much: all search results, all documents, all skill bodies, all repo files, or all API descriptions.

Use a generic three-stage pattern:

```text
DISCOVER
  ↓
SELECT
  ↓
MATERIALIZE
```

## Interface

```ts
interface DiscoveryProvider<TMeta, TFull> {
  discover(
    query: string,
    options?: Record<string, unknown>
  ): Promise<TMeta[]>

  materialize(
    item: TMeta
  ): Promise<TFull>
}
```

## Applications

### Skills

```text
skill metadata
 ↓
select
 ↓
load contract/procedure
 ↓
load knowledge fragment JIT
```

### Web Research

```text
title/url/snippet
 ↓
select
 ↓
fetch page
```

### GitHub

```text
repo/file metadata
 ↓
select
 ↓
fetch selected files
```

### API Catalog

```text
endpoint metadata
 ↓
select
 ↓
load schema/example
```

## Benefit

The architecture becomes consistently progressive-disclosure across knowledge, tools, external research, repository data, and artifacts.

---

# 12. Phase 7 — Capability Effect Metadata

The compiler should understand not only capability names, but their effects.

## Add

```ts
interface CapabilityEffects {
  network?: boolean
  browser?: boolean
  filesystem?: boolean

  readsSecrets?: boolean
  writesState?: boolean
  createsArtifact?: boolean
  mutatesTarget?: boolean
  spawnsWorker?: boolean

  externallyVisible?: boolean

  estimatedLatencyMs?: number
  estimatedTokenCost?: number

  reversibility?:
    | 'read-only'
    | 'reversible'
    | 'irreversible'
}
```

## Capability Definition

```ts
interface CapabilityDefinition {
  id: string
  summary: string

  implementation: string

  readOnly: boolean

  effects: CapabilityEffects

  requirements?: string[]
  variants?: string[]
}
```

## Why This Helps

The Execution Compiler can now make better decisions from explicit metadata rather than guessing from tool names.

---

# 13. Phase 8 — Execution Compiler

This is the main long-term runtime differentiator.

## Separation

Skill:

```text
semantic procedure
```

Execution Compiler:

```text
physical execution plan
```

The skill should not hardcode `spawn 3 agents` unless the problem semantically requires independent reasoning.

## Input

```ts
interface ExecutionCompilerInput {
  logicalPlan: LogicalPlan

  task: TaskState

  skill: SkillContract

  contextView: ResearchContextView

  capabilitySurface: CompiledWorkerSurface

  modelProfiles: ModelProfile[]

  budget: TaskBudget
}
```

## Output

```ts
interface PhysicalPlan {
  steps: PhysicalStep[]
}

type PhysicalStep =
  | DeterministicStep
  | ModelStep
  | ParallelStep
  | WorkerStep
  | VerificationStep
```

## Example

Logical authorization plan:

```text
1. establish owner baseline
2. execute alternate actor request
3. compare observations
4. reproduce difference
5. conclude
```

Possible physical plan:

```text
Step 1 → deterministic runtime HTTP
Step 2 → deterministic runtime HTTP
Step 3 → deterministic response comparator
Step 4 → model chooses controlled variant
Step 5 → model proposes conclusion
Step 6 → deterministic evidence gate
```

No reason to spend six LLM turns if four steps are deterministic.

## Model-Adaptive Topology

For a small model:

```text
3 isolated workers
+
deterministic aggregator
```

For a stronger model:

```text
one worker
+
deterministic tools
```

Same logical plan, different physical topology.

---

# 14. Phase 9 — Live Model Registry

## Objective

Avoid hardcoded model capability maps becoming stale.

## Layering

```text
bundled seed
    ↓
disk cache
    ↓
live provider metadata
    ↓
normalized ModelProfile
```

## Model

```ts
interface ModelProfile {
  provider: string
  modelId: string

  contextWindow?: number
  maxOutputTokens?: number

  toolCalling?: boolean
  structuredOutput?: boolean
  vision?: boolean

  reasoningClass?: 'small' | 'medium' | 'strong'

  costClass?: 'low' | 'medium' | 'high'
  latencyClass?: 'low' | 'medium' | 'high'

  source:
    | 'seed'
    | 'cache'
    | 'live'
}
```

## Fallback Policy

```text
live unavailable
 ↓
use last-known cache
 ↓
fallback to bundled seed
```

Do not erase previously valid provider data because one refresh failed.

---

# 15. Worker Capsule v2

The final worker input should look approximately like this:

```ts
interface WorkerCapsule {
  identity: {
    runId: string
    taskId: string
    workerId: string
    skillId?: string
  }

  objective: string

  procedure: {
    currentStage: string
    compactSteps: string[]
  }

  context: ResearchContextView

  capabilities: {
    tools: Tool[]
    grants: CapabilityGrant[]
  }

  constraints: {
    targetScope: string[]
    sideEffects: string[]
    primitiveAllowList?: string[]
  }

  verificationContract: VerificationContract

  outputContract: unknown

  budgets: {
    modelCalls: number
    toolCalls: number
    durationMs: number
  }
}
```

---

# 16. Runtime Event Model

Unify operational observability.

```ts
interface RunEvent<T = unknown> {
  eventId: string

  runId: string
  taskId?: string
  workerId?: string
  toolCallId?: string

  sequence: number
  timestamp: number

  type: string

  payload: T

  artifactRefs?: string[]
  evidenceRefs?: string[]
}
```

## Example Flow

```text
ToolCallRequested
      ↓
ToolCallAuthorized
      ↓
ToolCallStarted
      ↓
ToolCallCompleted
      ↓
ObservationDerived
      ↓
ArtifactPersisted
      ↓
EvidenceRecorded
      ↓
CoverageProjected
      ↓
GraphProjected
      ↓
TelemetryRecorded
```

The worker receives only a compact observation. The runtime keeps the full provenance chain.

---

# 17. Verification Contracts

Each skill should declare semantic completion conditions.

Example authorization skill:

```yaml
verification:
  requires:
    - owner_baseline
    - alternate_actor_observation
    - controlled_difference
    - independent_retest
```

Runtime maps these onto structured verification state.

```ts
interface VerificationResult {
  requirement: string
  satisfied: boolean

  evidenceRefs: string[]

  reason?: string
}
```

Task accepted only when required conditions are satisfied.

---

# 18. Skill Contract Improvement

Recommended skill structure:

```yaml
id: authorization
version: 2

summary:
  description: >
    Test authorization boundaries using controlled actor/object comparisons.

applicability:
  signals:
    - authenticated-session
    - object-identifier
    - role-boundary

  excludes:
    - public-static-resource

requires:
  capabilities:
    - network.request
    - response.compare
    - session.actor-context
    - primitive.execute

  context:
    - target
    - endpoint
    - actors

policy:
  primitives:
    allow:
      - authBypass
      - idorSwapper
      - authzMatrix
      - tenantIsolation

procedure:
  stages:
    - id: establish-baseline
      goal: Capture authorized owner behavior.

    - id: controlled-variation
      goal: Change one authorization dimension at a time.

    - id: compare
      goal: Compare normalized observations.

    - id: reproduce
      goal: Reproduce any material access-control difference.

    - id: conclude
      goal: Propose a conclusion backed by evidence.

verification:
  requires:
    - baseline_observation
    - variant_observation
    - controlled_difference
    - independent_retest

output:
  schema: AuthorizationConclusion

knowledge:
  fragments:
    - idor
    - horizontal-access
    - vertical-access
    - jwt
    - session-boundaries
```

---

# 19. Progressive Disclosure Standard

Use the same pattern everywhere.

## Skills

```text
L0 metadata
 ↓
L1 contract
 ↓
L2 procedure
 ↓
L3 knowledge fragment
```

## Capabilities

```text
registry metadata
 ↓
required capabilities
 ↓
compiled tools
 ↓
JIT capability expansion
```

## Research

```text
search metadata
 ↓
selected sources
 ↓
materialized content
```

## Artifacts

```text
artifact metadata
 ↓
preview
 ↓
full payload
```

---

# 20. E2E Test Matrix

## 20.1 Capability Isolation

Skill permits:

```text
idorSwapper
authzMatrix
```

Registry contains 33 primitives.

Assert the worker schema exposes only:

```text
idorSwapper | authzMatrix
```

and runtime independently rejects any other primitive.

## 20.2 Parent/Worker Isolation

Parent has browser, network, filesystem, and research capabilities. Child task requires only `network.request` and `response.compare`.

Assert the child sees only compiled child capabilities.

## 20.3 Progressive Skill Loading

Before skill selection: metadata only. After selection: compact procedure. JWT fragment remains absent during a pure object-access IDOR test.

## 20.4 Context Compilation

Case contains:

```text
100 HTTP exchanges
40 graph facts
12 experiments
8 findings
```

Task relates to one authorization candidate.

Assert the worker receives only the relevant subset under token budget.

## 20.5 Runtime Evidence

One HTTP request should produce exactly:

```text
1 raw exchange artifact
1 normalized observation
1 evidence record
1 provenance chain
```

No duplicate evidence caused by the model manually calling a second evidence tool.

## 20.6 Session Hydration

Worker invokes:

```ts
requestAs({
  actorRef: 'actor-B',
  requestRef: 'req-41'
})
```

Assert runtime hydrates cookies, headers, and auth tokens without exposing raw secrets in normal worker context.

## 20.7 ResearchOpportunity Dedup

Same suspicious endpoint observed three times.

Assert:

```text
1 opportunity
seenCount = 3
```

not three separate opportunities.

## 20.8 Coverage Isolation

Two authorization tasks run concurrently.

Assert no stage completion from Task A appears in Task B.

## 20.9 False Positive Learning

Candidate rejected due to shared-resource semantics.

Assert ResearchCase stores initial hypothesis, counter-evidence, false-positive reason, and generalized kill signal.

## 20.10 Pivot Generation

Rejected authorization hypothesis reveals a legacy endpoint.

Assert pivot becomes a `ResearchOpportunity` but receives no automatic capability expansion.

## 20.11 Worker Completion vs Acceptance

Worker returns `likely IDOR` without required independent retest.

Assert:

```text
worker = completed
task = not accepted
```

## 20.12 Replay

Persist event log, restart runtime, and assert the system reconstructs task state, coverage, artifacts, evidence, and research opportunity lifecycle.

---

# 21. Evaluation Strategy

Run controlled A/B tests.

## A — Current Runtime

```text
selected skill
+
current context behavior
+
compiled/current tools
+
existing evidence behavior
```

## B — Improved Runtime

```text
ResearchOpportunity
+
compact skill procedure
+
Context Compiler
+
Capability Compiler
+
runtime-owned evidence
+
verification contract
+
ResearchCase learning
```

## Keep Constant

- same target,
- same task,
- same model,
- same temperature,
- same budget,
- same initial state.

## Measure

### Success

- task completion,
- validated finding rate,
- false-positive rate,
- reproducibility.

### Context

- initial prompt tokens,
- total input tokens,
- tool schema tokens,
- retrieved context tokens.

### Reasoning

- model calls,
- tool calls,
- irrelevant calls,
- retries,
- failed actions.

### Runtime

- evidence duplication,
- missing evidence,
- coverage completeness,
- graph attribution,
- task duration.

### Model Sensitivity

Run with strong, medium, and small/open models.

Primary hypothesis:

> Narrow compiled contexts and capability surfaces should disproportionately improve smaller models.

---

# 22. Recommended Repository Structure

```text
src/
  research/
    opportunities/
      types.ts
      store.ts
      scorer.ts
      dedupe.ts

    events/
      types.ts
      projector.ts

    cases/
      types.ts
      builder.ts
      sanitizer.ts

    pivots/
      generator.ts

  context/
    compiler.ts
    selectors.ts
    views.ts
    token-budget.ts

  discovery/
    provider.ts
    selector.ts
    materializer.ts

  capabilities/
    types.ts
    registry.ts
    compiler.ts
    effects.ts
    facade.ts

  execution/
    logical-plan.ts
    compiler.ts
    physical-plan.ts

  models/
    registry.ts
    provider-discovery.ts
    cache.ts
    profile.ts

  runtime/
    events.ts
    observation-pipeline.ts
    session-resolver.ts
    coverage-projector.ts
```

Existing components should be migrated into these concepts rather than rewritten unnecessarily.

---

# 23. Migration Strategy

## Rule 1 — Do Not Migrate All Skills Simultaneously

Start with:

```text
authorization
injection
business-logic
```

These exercise very different runtime needs.

## Rule 2 — Keep Compatibility Adapters

Old skill:

```yaml
toolRefs:
  - httpRequest
  - runPrimitive
```

Compatibility resolver:

```text
toolRefs
 ↓
legacy semantic mapping
 ↓
Capability Compiler
```

Then progressively convert to:

```yaml
requires:
  capabilities:
    - network.request
    - primitive.execute
```

## Rule 3 — Do Not Remove Deterministic Finding Gates

The new architecture should reinforce them.

## Rule 4 — Do Not Move Policy Into Prompts

Runtime policy must remain authoritative.

## Rule 5 — Do Not Globally Push Tools

Skill selection must still happen before worker tool exposure.

---

# 24. Anti-Patterns to Avoid

## 24.1 Huge Dynamic Tool Universe

Bad:

```text
worker sees 70 tools
and decides what matters
```

Good:

```text
skill selected
 ↓
compiler
 ↓
3–6 task-specific tools
```

## 24.2 One Tool per Tiny Operation

Do not create hundreds of hyper-specialized implementation tools. Prefer semantic facades over reusable implementations.

## 24.3 Prompt-Based Permission

Bad:

```text
"Do not call destructive tools."
```

Good:

```text
destructive tool absent from compiled surface
+
runtime authorization rejects it anyway
```

## 24.4 Agent-Owned Evidence Persistence

Bad:

```text
model must remember to call recordEvidence()
```

Good:

```text
tool execution
 ↓
runtime observation
 ↓
artifact
 ↓
evidence
```

## 24.5 Automatically Executing Pivots

Pivot generation creates research opportunities. It must not bypass policy, skill selection, capability compilation, or budget checks.

## 24.6 Learning Raw Target Data Globally

Never promote cookies, customer URLs, access tokens, payloads, or private identifiers into reusable global memory.

---

# 25. SDK-Level Invariants

These should eventually become tests.

```text
INV-01
A model cannot invoke an implementation merely because it exists.

INV-02
A primitive outside the compiled grant cannot execute.

INV-03
Worker-visible capabilities are reproducible from:
task + skill + policy + registry version.

INV-04
Every external action creates provenance.

INV-05
Raw tool result persistence never relies on model bookkeeping.

INV-06
Finding acceptance cannot be based only on model prose.

INV-07
Parent capability availability does not automatically imply child visibility.

INV-08
Knowledge disclosure and capability authority are independent.

INV-09
Capability narrowing does not require rewriting the underlying implementation.

INV-10
Worker completion does not imply task acceptance.

INV-11
Coverage is isolated by run/task/skill.

INV-12
Research opportunities survive worker failure.

INV-13
Generated pivots cannot automatically escalate authority.

INV-14
Reusable research memory cannot contain engagement secrets.

INV-15
Context compilation must stay within explicit token budget.

INV-16
A compiled worker capsule must be replayable/auditable.

INV-17
Execution Compiler may replace model work with deterministic runtime work when semantics are preserved.
```

---

# 26. Hackathon Demo Plan

A strong demo should visibly prove the compiler idea.

## Scenario

Authorization investigation.

### Current-Style Worker

```text
large methodology
many tools
large primitive namespace
manual context retrieval
manual evidence plumbing
```

### Compiled Worker

```text
Skill:
authorization

Context:
endpoint
owner actor
alternate actor
relevant previous exchange

Capabilities:
requestAsActor()
compareResponses()
runPrimitive(idorSwapper | authzMatrix)

Verification:
baseline
variant
controlled difference
retest
```

## Show On Screen

### Panel 1 — Original Universe

```text
74 skills
100+ capabilities
33 primitives
large case graph
multiple models
```

### Panel 2 — Compiled Worker

```text
1 selected skill
4 context references
3 tools
2 primitive variants
1 verification contract
```

### Panel 3 — Runtime Execution

```text
HTTP request
 ↓
artifact
 ↓
evidence
 ↓
coverage
 ↓
comparison
 ↓
retest
```

### Panel 4 — Result

```text
candidate accepted / rejected
why
evidence refs
coverage satisfied
```

### Panel 5 — Learning

Rejected hypothesis creates a `ResearchCase`, and a new `ResearchOpportunity` is generated from a pivot.

---

# 27. Hackathon Thesis

A concise positioning statement:

> **Ultimatrix is an agent execution compiler. Instead of giving an LLM the whole tool universe and the whole case context, it compiles the smallest knowledge surface, capability surface, and execution topology required for each hypothesis, then verifies the resulting evidence and learns from the outcome.**

Shorter:

> **Compile the agent before you run the agent.**

Technical framing:

```text
Problem
   ↓
Opportunity Selection
   ↓
Skill Selection
   ↓
Context Compilation
   ↓
Capability Compilation
   ↓
Execution Compilation
   ↓
Verified Runtime
   ↓
Research Learning
```

---

# 28. Definition of Done

The E2E improvement is successful when the same investigation can demonstrate all of the following:

1. A suspicious signal becomes a persistent `ResearchOpportunity`.
2. The runtime chooses a relevant skill without exposing unrelated skill bodies.
3. The Context Compiler produces a bounded task-specific view.
4. The Capability Compiler exposes only task-authorized actions.
5. Actor/session secrets remain runtime-managed.
6. Tool execution automatically creates artifacts and evidence.
7. Coverage is isolated per task.
8. Worker output alone cannot satisfy verification.
9. Candidate findings require structured evidence.
10. Rejected findings produce research learning.
11. Learning produces better future context or pivots.
12. Generated pivots become opportunities rather than direct actions.
13. The entire run can be replayed from events and references.
14. Small models show measurable improvement relative to the broad-context baseline.
15. The architecture remains usable outside security as a general agent-runtime abstraction.

---

# 29. Final Recommended Build Order

```text
1. Telemetry baseline
2. Coverage identity fix
3. ResearchOpportunity
4. Context Compiler
5. ResearchEvent
6. ResearchCase + sanitization
7. Pivot Generator
8. Discover → Select → Materialize
9. Capability Effects
10. Execution Compiler
11. Live Model Registry
12. Full A/B benchmark suite
```

If schedule becomes tight, the **hackathon-critical path** is:

```text
Coverage identity
      ↓
ResearchOpportunity
      ↓
Context Compiler
      ↓
Capability Compiler integration
      ↓
runtime-owned evidence
      ↓
verification contract
      ↓
ResearchCase
      ↓
Pivot → next opportunity
```

The Execution Compiler and Live Model Registry can be presented as the next evolution if they are not fully production-ready.

---

# 30. Final Architecture Summary

The strongest direction is not more agents, more tools, or larger prompts.

It is:

```text
                  LARGE RUNTIME UNIVERSE

      Skills     Knowledge     Capabilities     Models
        │            │              │              │
        └────────────┴──────┬───────┴──────────────┘
                            │
                            ▼
                      COMPILATION LAYER
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
          Context       Capability     Execution
          Compiler       Compiler       Compiler
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                       Worker Capsule
                            │
                            ▼
                         Runtime
                            │
                            ▼
                     Verified Evidence
                            │
                            ▼
                      Research Learning
                            │
                            ▼
                      Next Opportunity
```

The end-state principle is:

> **Keep complexity in the runtime. Give the model only the complexity required for the current decision.**

---

# 31. Practical PR Sequence

To make this plan easier to implement without destabilizing the repo, use a sequence of small PRs with measurable gates.

## PR-1: Coverage Scope Fix

**Files likely touched**

```text
src/runtime/
src/solver/
src/campaign/
```

**Deliverables**

- `CoverageScope { runId, taskId, skillId }`
- event-backed coverage updates
- migration adapter for current map
- concurrency tests

**Gate**

Existing tests pass and two parallel tasks using the same skill cannot influence each other's coverage.

## PR-2: ResearchOpportunity Core

**Deliverables**

- type model,
- event types,
- store/projection,
- dedupe,
- scoring,
- links to task creation.

**Gate**

Repeated signals produce one durable opportunity and correct `seenCount`.

## PR-3: Context Compiler v1

Start deterministic. Do not make context selection itself fully LLM-driven initially.

**Selectors**

```text
direct refs
same target
same endpoint
same actor pair
same skill
same experiment family
```

Only after this is measurable should semantic retrieval be layered on top.

**Gate**

Representative tasks use materially fewer context tokens without losing success rate.

## PR-4: Research Events + Cases

**Gate**

A rejected candidate can be reconstructed into a structured false-positive case and sanitized for reusable memory.

## PR-5: Pivot Generator

**Gate**

Pivots create opportunities only and never bypass capability policy.

## PR-6: Discovery Provider Abstraction

Implement one real adapter first, ideally external research or repository discovery.

**Gate**

Metadata-only discovery can select a subset before full materialization.

## PR-7: Capability Effects

**Gate**

Policy can reason about external visibility, mutation, secret access, and reversibility without parsing tool names.

## PR-8: Execution Compiler Prototype

Do not begin with a universal DAG optimizer. Start with one skill family where several stages can be deterministic.

Authorization is ideal.

**Gate**

Same logical plan can produce at least two physical plans based on model profile or budget.

## PR-9: Model Registry

**Gate**

Provider refresh failure falls back to last-known cache and never wipes working model metadata.

## PR-10: Benchmark Harness

**Gate**

One command can compare baseline vs compiled runtime and emit machine-readable metrics.

---

# 32. Risk Register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Too many new abstractions at once | Can make the runtime harder rather than simpler | Introduce one persistent lifecycle object at a time |
| Context compiler hides useful evidence | Could lower task quality | Record omissions, allow JIT expansion, benchmark against full-context baseline |
| Opportunity ledger becomes noisy | Too many weak signals create planning overhead | Deterministic dedupe, priority thresholds, parked state |
| Research memory reinforces mistakes | Bad lessons can bias later tasks | Store source refs, confidence, outcome, and allow correction events |
| Pivot loops explode | Agent may recursively generate endless opportunities | Budget, dedupe, depth, information-gain threshold |
| Execution compiler becomes premature optimizer | Hard to debug and over-engineered | Start with deterministic substitution only |
| Capability metadata becomes manually stale | Effect declarations can drift from implementation | Validation tests and registration-time assertions |
| Small-model optimization harms strong models | One topology may not fit all | Preserve model-adaptive physical planning |
| Event sourcing adds complexity | Projection bugs can appear | Keep event vocabulary compact and make projections replay-testable |

---

# 33. Recommended Success Targets

Use targets rather than vague improvement claims.

For representative tasks, aim for:

```text
≥ 50% reduction in visible tool schemas
≥ 40% reduction in initial context tokens
≥ 30% reduction in irrelevant tool calls
near-zero undeclared primitive execution
zero cross-task coverage leakage
zero secret exposure through actor/session hydration
zero candidate promotion without required verification
100% external action provenance
replayable task/coverage/opportunity state
```

For small/open models, the strongest success signal would be:

```text
same or better task success
with materially lower context + fewer tool choices
```

That validates the main runtime thesis rather than merely adding features.

