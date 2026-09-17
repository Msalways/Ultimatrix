# Ultimatrix × Strix Adaptation Implementation Plan

**Goal:** Adapt the strongest execution/runtime ideas from Strix into Ultimatrix without copying Strix's broad-tool, prompt-heavy agent architecture.

**Pinned source snapshots**
- Ultimatrix: `Msalways/Ultimatrix` @ `71d4dec443b5facaf0b324aca9c2c5daec2e2c7f`
- Strix: `usestrix/strix` @ `2dadbb748a09053463a66abb773e710fa49d2a35`
- Audit date: 2026-09-16

The target is not “make Ultimatrix like Strix.” The target is:

> Keep Ultimatrix's stronger task/evidence foundations, preserve skill-first progressive disclosure, and borrow Strix's strongest execution mechanisms underneath a stricter Capability Compiler architecture.

---

## 1. Executive summary

### What Strix is stronger at today

1. Generic MCP discovery / dispatch.
2. Tool-output bounding and spill-to-artifact.
3. Negative-space coverage accounting.
4. Execution sandbox abstraction.
5. Persistent / resumable agent lifecycle.
6. HTTP exchange identity and provenance.
7. Shared run-scoped state such as threat models.
8. Context compaction and crash recovery.

### What should not be copied

- A large common tool surface for every agent.
- Full skill bodies injected into every selected worker's system prompt.
- Prompt-only role separation.
- Generic `call(toolName, arguments)` as the normal execution interface.
- Model-owned bookkeeping when provenance can be inferred by runtime.
- Pentest-specific state types as core SDK abstractions.

### Target architecture

```text
Task
  ↓
Skill Retrieval
  ↓
Skill Contract
  ↓
Logical Plan
  ↓
Execution Compiler
  ├─ Capability Compiler
  ├─ Context Compiler
  └─ Backend Selector
  ↓
Worker Capsule
  ↓
Physical Execution
  ├─ HTTP
  ├─ Browser
  ├─ Sandbox
  └─ Capability Gateway / MCP
  ↓
Observation Pipeline
  ├─ Artifact Store
  ├─ Evidence Ledger
  ├─ Graph Projection
  └─ Telemetry
  ↓
Coverage Ledger
  ↓
Acceptance Engine
```

Core rule:

> **Skills reduce the semantic search space first. Capability compilation reduces the executable search space second.**

---

## 2. Adaptation matrix

| Priority | Strix idea | Adapt? | Ultimatrix target | Why |
|---|---:|---:|---|---|
| P0 | MCP `list → describe → call` | Yes, modified | Capability Gateway | JIT long-tail capability disclosure |
| P0 | Tool-output bounding + spill | Yes | Observation / Artifact pipeline | Prevent context pollution |
| P0 | Negative-space coverage | Yes | Coverage Ledger | Distinguish “tested clean” from “not tested” |
| P0 | Skill/tool separation | Improve beyond Strix | Capability Compiler | Compile narrow semantic facades |
| P1 | Sandbox backend registry | Yes | ExecutionBackend | Physical execution abstraction |
| P1 | Persistent agent sessions | Yes | WorkerSession | Crash recovery / resume |
| P1 | HTTP exchange IDs | Yes, more automatic | ExchangeArtifact | Strong provenance |
| P1 | Shared threat model | Generalize | SharedRunArtifact<T> | Avoid rediscovery |
| P2 | Context compaction | Yes | Context Manager | Safety net |
| P2 | Agent graph UX | Partially | Task / Worker runtime | Inspectability |
| P3 | Broad common base tools | No | — | Opposes capability isolation |
| P3 | Full skill injection | No | — | Opposes progressive disclosure |
| P3 | Prompt-only authority | No | — | Must be structural |

---

## 3. Keep Skills before tools

Current Ultimatrix still has the correct high-level order:

```text
Task
  ↓
Skill selection
  ↓
Tool resolution
  ↓
Worker
```

The problem is that tool resolution expands into:

```text
CORE_TOOLS
+ skill.toolRefs
+ globally scoped generic tools
```

Target:

```text
Task
  ↓
Skill selection
  ↓
Skill Contract
  ↓
Semantic Capability Requirements
  ↓
Capability Compiler
  ↓
Task-specific model facade
  ↓
Worker
```

Example skill contract:

```yaml
id: authorization

requires:
  capabilities:
    - network.request
    - response.compare
    - session.actor-context

policy:
  primitives:
    allow:
      - authBypass
      - idorSwapper
      - authzMatrix
      - tenantIsolation
```

Compiled worker surface:

```text
requestAsActor()
compareResponses()
runPrimitive(
  authBypass |
  idorSwapper |
  authzMatrix |
  tenantIsolation
)
```

The worker should not automatically receive all graph, session, evidence, primitive, and skill-management tools.

---

# 4. P0 — Capability Gateway inspired by Strix MCP

## Strix pattern

Strix avoids injecting every MCP schema into each request. The agent gets only:

```text
list_mcps()
describe_mcp()
call_mcp()
```

Tool schemas are disclosed on demand.

## Ultimatrix adaptation

Create a **Capability Gateway** for long-tail or initially unknown capabilities.

This is a fallback. The normal path remains:

```text
Skill
  ↓
Capability Compiler
  ↓
small typed facade
```

### Proposed flow

```text
Worker Capsule

Visible:
  requestAsActor()
  compareResponses()

Worker discovers:
  "I need deployment metadata"

        ↓

requestCapability("kubernetes.inspect")

        ↓

Runtime policy + registry

        ↓

grant typed facade on next turn
or use generic gateway for one-off access
```

### Interfaces

```ts
export interface CapabilitySummary {
  id: string
  description: string
  provider?: string
  risk: 'read' | 'network' | 'mutate' | 'delegate'
}

export interface CapabilityDescriptor extends CapabilitySummary {
  inputSchema: unknown
  outputSchema?: unknown
}

export interface CapabilityGateway {
  list(query?: string): Promise<CapabilitySummary[]>
  describe(id: string): Promise<CapabilityDescriptor>
  invoke(
    grant: CapabilityGrant,
    id: string,
    input: unknown,
  ): Promise<ObservationRef>
}
```

### Stronger rule than Strix

```text
discoverable
≠ describable
≠ invokable
```

Description does not grant execution.

### New files

```text
src/capabilities/
  gateway.ts
  registry.ts
  grants.ts
  types.ts
```

### Tests

- ungranted capability can be visible but cannot execute
- hidden capability cannot be discovered
- describe does not imply invoke
- runtime rechecks grant on every invocation
- initial worker context does not contain all schemas

---

# 5. P0 — Universal tool-output bounding + ArtifactRef

## Strix pattern

Oversized tool output is stored externally. The model receives a bounded preview plus a path/reference.

## Ultimatrix target

Generalize `resultRef` / ToolResultStore into an **Observation Pipeline**.

```text
Tool / Backend
      ↓
Raw Result
      ↓
Observation Pipeline
      ├─ store raw artifact
      ├─ normalize observation
      ├─ record provenance
      ├─ create bounded preview
      └─ return refs
```

### Result contract

```ts
export interface CompiledToolResult<TPreview = unknown> {
  preview: TPreview
  resultRef: string
  artifactRefs: string[]
  evidenceRefs: string[]
  observationRef: string
  truncated: boolean

  metadata: {
    bytes?: number
    lines?: number
    contentType?: string
  }
}
```

### Example

Instead of returning a 1 MB body:

```json
{
  "status": 200,
  "contentType": "application/json",
  "bodyPreview": "{ ... }",
  "resultRef": "artifact://run-21/tool-88",
  "truncated": true
}
```

JIT inspection:

```ts
inspectArtifact({
  ref: "artifact://run-21/tool-88",
  query: "find all organizationId fields"
})
```

### Files

```text
src/runtime/
  observation-pipeline.ts
  result-bounding.ts

src/tools/
  inspect-artifact.ts
```

### Migration order

1. `httpRequest`
2. browser outputs
3. shell/sandbox
4. worker result payloads
5. MCP / Capability Gateway

### Metrics

```text
raw_output_bytes
preview_bytes
preview_tokens
artifact_retrieval_count
artifact_retrieval_tokens
context_saved_tokens
```

---

# 6. P0 — Coverage Ledger / negative space

A findings ledger answers:

> What went wrong?

It does not answer:

> What was actually tested?

`0 findings` can mean either “tested clean” or “never tested.”

## Ultimatrix adaptation

```ts
export type CoverageOutcome =
  | 'finding'
  | 'no_issue'
  | 'ruled_out'
  | 'not_applicable'
  | 'needs_follow_up'
  | 'unverified'

export interface CoverageRecord {
  coverageId: string

  taskId: string
  workerId?: string
  skillId?: string

  surface: string
  hypothesis?: string

  outcome: CoverageOutcome

  evidenceRefs: string[]
  experimentRefs: string[]
  artifactRefs: string[]

  source: 'runtime' | 'agent' | 'evaluator'

  timestamp: number
}
```

## Skill coverage contract

```yaml
verification:
  coverage:
    - id: owner-baseline
      required: true
    - id: alternate-actor
      required: true
    - id: object-identity-boundary
      required: true
    - id: independent-retest
      required: true
```

A worker can be:

```text
completed
```

while the task is:

```text
incomplete
```

because required semantic coverage is missing.

### Runtime inference

Where possible, infer coverage automatically from actions.

```text
requestAsActor(A)
requestAsActor(B)
compareResponses()
```

can satisfy:

```text
owner-baseline
alternate-actor
controlled-comparison
```

without forcing the model to record bookkeeping.

### Files

```text
src/runtime/
  coverage-ledger.ts
  coverage-evaluator.ts

src/solver/skills/
  verification-contract.ts
```

### Tests

- worker completes without required coverage → task not accepted
- agent claims coverage without observed execution → agent-reported only
- runtime contradicts model claim → runtime record wins
- budget exhaustion → completeness false
- selected risk skill with no accounted execution → coverage gap

---

# 7. P1 — ExecutionBackend abstraction

Strix already treats Docker as one sandbox backend. Ultimatrix should generalize this further.

```ts
export interface ExecutionRequirement {
  capabilityId: string
  activity:
    | 'network'
    | 'browser'
    | 'filesystem'
    | 'shell'
    | 'external'
    | 'deterministic'
}

export interface ExecutionBackend {
  id: string

  supports(
    requirement: ExecutionRequirement,
    context: ExecutionContext,
  ): boolean

  execute(
    action: CompiledAction,
    context: ExecutionContext,
  ): Promise<RawExecutionResult>
}
```

Backend map:

```text
network.request
    ↓
HTTPBackend

browser.interact
    ↓
BrowserBackend

shell.execute
    ↓
SandboxBackend

external.github
    ↓
MCPBackend

response.compare
    ↓
DeterministicBackend
```

### Files

```text
src/execution/
  action.ts
  backend.ts
  registry.ts
  selector.ts
  backends/
    deterministic.ts
    http.ts
    browser.ts
    sandbox.ts
    mcp.ts
```

This unlocks the larger SDK pattern:

```text
Logical Plan
  ↓
Execution Compiler
  ↓
Physical Plan
```

---

# 8. P1 — Docker / shell sandbox

Do not give shell/filesystem to every worker.

Target:

```text
skill + task
   ↓
Capability Compiler
   ↓
shell.execute required?
   ↓
yes
   ↓
SandboxBackend grant
```

Prefer semantic facades where possible:

```text
runStaticAnalyzer()
readWorkspaceFile()
writeWorkspaceFile()
```

Grant arbitrary `exec` only when needed.

```ts
export interface SandboxSessionRef {
  sandboxId: string
  backendId: string
  workspaceRef: string
  createdAt: number
}
```

Isolation requirements:

- explicit writable paths
- network policy
- secret injection outside normal prompt
- execution timeout
- output cap
- artifact capture
- deterministic teardown
- resumability only where supported

---

# 9. P1 — WorkerSession / lifecycle

Strix has mature lifecycle handling. Borrow the lifecycle ideas, but keep **Task** and **WorkerSession** separate.

```text
Task = semantic work item
WorkerSession = physical reasoning/execution process
```

```ts
export type WorkerSessionStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'crashed'
  | 'stopped'

export interface WorkerSession {
  sessionId: string
  taskId: string
  workerId: string

  status: WorkerSessionStatus

  modelId: string
  provider?: string

  skillIds: string[]
  capabilityGrantIds: string[]

  sessionRef: string
  lastCheckpointRef?: string

  createdAt: number
  updatedAt: number
}
```

A task may have multiple physical attempts:

```text
Task
 ├─ WorkerSession #1 → crashed
 ├─ WorkerSession #2 → retry
 └─ WorkerSession #3 → completed
```

Task acceptance still depends on verification, coverage, and evidence.

### Files

```text
src/runtime/
  worker-session.ts
  worker-session-store.ts
  worker-recovery.ts
```

---

# 10. P1 — ExchangeArtifact for HTTP provenance

Strix uses durable HTTP exchange IDs. Ultimatrix should adopt the concept but automate linkage.

```ts
export interface ExchangeArtifact {
  exchangeId: string

  taskId?: string
  workerId?: string
  toolCallId: string
  actionId?: string

  actorRef?: string
  sessionRef?: string

  request: {
    method: string
    url: string
    headersRef?: string
    bodyRef?: string
  }

  response: {
    status: number
    headersRef?: string
    bodyRef?: string
    durationMs?: number
  }

  timestamp: number
}
```

Automatic causal chain:

```text
ToolCall
   ↓
ExchangeArtifact
   ↓
Observation
   ↓
Experiment
   ↓
FindingCandidate
   ↓
Finding
```

No LLM should need to manually copy request IDs, raw responses, headers, or evidence labels when runtime already knows the chain.

### Modify

```text
src/tools/http-tools.ts
src/tools/control-tools.ts
src/intelligence/evidence-ledger.ts
src/security/artifacts.ts
```

### Invariant

> Every network action that may support a claim produces an immutable exchange reference.

---

# 11. P1/P2 — SharedRunArtifact<T>

Generalize Strix's run-scoped threat-model idea.

```ts
export interface SharedRunArtifact<T> {
  ref: string
  kind: string
  version: number

  value: T

  createdBy: string
  createdAt: number

  parentRef?: string
}
```

Potential kinds:

```text
ThreatModel
TargetMap
EndpointMap
ActorMap
SessionMap
AuthModel
ResearchMap
WorkflowModel
HypothesisSet
```

Version updates rather than silently overwriting:

```text
ThreatModel v1
   ↓
ThreatModel v2
   ↓
ThreatModel v3
```

Workers should receive a ref or compact relevant slice.

Avoid one CRUD tool per artifact type.

---

# 12. P2 — Context compaction as safety net

Compaction is worth borrowing, but only after progressive disclosure.

Correct order:

```text
1. narrow skill knowledge
2. narrow capabilities
3. bound tool output
4. externalize raw data
5. JIT retrieve
6. deterministic runtime processing
7. compact conversation only when necessary
```

Checkpoint:

```ts
export interface ContextCheckpoint {
  checkpointId: string
  taskId: string
  workerSessionId: string

  summary: string

  retainedMessageRefs: string[]
  artifactRefs: string[]
  evidenceRefs: string[]

  sourceTokenEstimate: number
  compactedTokenEstimate: number
}
```

Preserve:

- unresolved hypotheses
- current procedure stage
- failed attempts
- user constraints
- artifact/evidence refs
- tool-call/result pairing
- acceptance blockers

---

# 13. Capability Compiler — core implementation

```ts
export interface CompileWorkerSurfaceInput {
  task: Readonly<TaskState>
  skill: SkillContract

  registry: CapabilityRegistry
  runtimePolicy: RuntimePolicy

  parentAvailability?: CapabilityRegistry
  modelProfile?: ModelProfile

  contextRefs: string[]
}

export interface CompiledWorkerSurface {
  instructions: string
  tools: Record<string, Tool>
  grants: CapabilityGrant[]
  contextRefs: string[]
  procedure: CompiledProcedure
  verification: VerificationContract
  outputSchema: unknown
}
```

Hard rules:

1. Skill is selected before worker tools.
2. Skill declares semantic capabilities.
3. Runtime resolves implementations.
4. Policy authorizes.
5. Compiler generates a facade.
6. Worker sees only the facade.
7. Runtime rechecks grants.
8. Missing long-tail capability goes through Capability Gateway.

---

# 14. First code change — scoped `runPrimitive`

Current skill metadata can allow four primitives while global `runPrimitive` exposes all primitive IDs.

Fix first:

```ts
export function createScopedRunPrimitiveTool(
  allowedPrimitiveIds: string[],
  grant: CapabilityGrant,
): Tool
```

Schema:

```ts
primitiveId: z.enum(allowedPrimitiveIds)
```

Runtime:

```ts
if (!grant.allowsPrimitive(input.primitiveId)) {
  throw new CapabilityDeniedError(...)
}
```

Enforce twice:

```text
schema visibility
+
runtime authorization
```

Tests:

- allowed IDs appear
- undeclared IDs absent
- forged undeclared call rejected
- empty list → no tool
- multi-skill union contains only union of declared IDs

---

# 15. Remove automatic `CORE_TOOLS` from specialist workers

Replace broad defaults with classes:

```ts
export const PLANNER_BOOTSTRAP = [
  'listSkills',
  'searchSkills',
]

export const WORKER_BOOTSTRAP = [
  'queryGraph',
  'getTargetSummary',
]

export const RUNTIME_INTERNAL = [
  'persistToolResultInternal',
  'recordStructuredEvidenceInternal',
  'projectGraphEventInternal',
]
```

A specialist worker should receive:

```text
tiny bootstrap
+
compiled capabilities
```

Planner, worker, and runtime must have different authority.

---

# 16. Authorization pilot

Use `authorization` first.

It stresses:

```text
actors
sessions
primitive scoping
controlled comparison
evidence
retest
finding verification
```

Target contract:

```yaml
id: authorization
version: 2

summary:
  description: Test authorization boundaries using controlled actor/object comparisons.

requires:
  capabilities:
    - network.request
    - response.compare
    - session.actor-context
    - primitive.execute

policy:
  primitives:
    allow:
      - authBypass
      - idorSwapper
      - authzMatrix
      - tenantIsolation

procedure:
  stages:
    - id: baseline
      goal: Capture authorized owner behavior.
    - id: alternate-actor
      goal: Replay equivalent request under another actor.
    - id: mutate-identity
      goal: Change one ownership dimension.
    - id: compare
      goal: Compare normalized observations.
    - id: reproduce
      goal: Reproduce a material difference.

verification:
  coverage:
    - owner-baseline
    - alternate-actor
    - controlled-difference
    - independent-retest

output:
  schema: AuthorizationConclusion
```

Worker surface:

```text
requestAsActor()
compareResponses()
runPrimitive(
  authBypass |
  idorSwapper |
  authzMatrix |
  tenantIsolation
)
```

Prefer a structured `AuthorizationConclusion` output over exposing `writeFinding()` directly.

---

# 17. Actor / Session refs

Current manual pattern:

```text
getCapturedHeaders()
→ copy headers
→ httpRequest(headers)
```

Target:

```ts
requestAsActor({
  actorRef: 'actor:user-a',
  requestRef: 'request:invoice-123',
  mutation: {
    objectId: 'invoice-456'
  }
})
```

Runtime:

```text
actorRef
  ↓
sessionRef
  ↓
secret vault
  ↓
headers/cookies/token
```

Keep secrets out of model context when possible.

---

# 18. Observation / evidence event flow

```text
ToolCallRequested
    ↓
ToolCallStarted
    ↓
BackendActionStarted
    ↓
BackendActionCompleted
    ├─ RawArtifactStored
    ├─ ObservationNormalized
    ├─ EvidenceRecorded
    ├─ GraphProjectionUpdated
    ├─ CoverageUpdated
    └─ TelemetryRecorded
    ↓
ToolCallCompleted
```

```ts
export interface RunEvent<T = unknown> {
  eventId: string
  runId: string

  taskId?: string
  workerId?: string
  workerSessionId?: string
  toolCallId?: string

  sequence: number
  timestamp: number

  type: string
  payload: T

  artifactRefs?: string[]
  evidenceRefs?: string[]
}
```

One event stream can power replay, provenance, evidence, graph projection, coverage, debugging, and analytics.

---

# 19. Suggested implementation file map

### New

```text
src/
  capabilities/
    types.ts
    registry.ts
    grants.ts
    compiler.ts
    facade.ts
    gateway.ts

  execution/
    action.ts
    backend.ts
    registry.ts
    selector.ts
    backends/
      deterministic.ts
      http.ts
      browser.ts
      sandbox.ts
      mcp.ts

  runtime/
    observation-pipeline.ts
    result-bounding.ts
    coverage-ledger.ts
    coverage-evaluator.ts
    worker-session.ts
    worker-session-store.ts
    worker-recovery.ts
    session-resolver.ts
    shared-artifacts.ts

  artifacts/
    exchange-artifact.ts

  solver/
    skills/
      contract.ts
      compiler.ts
      verification-contract.ts

  tools/
    inspect-artifact.ts
```

### Modify

```text
src/solver/skills/loader.ts
src/solver/skills/tool-filter.ts
src/mastra/index.ts
src/workers/factory.ts
src/manager/tools/spawn-worker.ts
src/runtime/task-coordinator.ts
src/primitives/index.ts
src/tools/http-tools.ts
src/tools/control-tools.ts
src/core/toolpack.ts
```

---

# 20. Migration phases

## Phase 0 — baseline instrumentation

Record:

```text
selected_skill_ids
visible_tool_ids
visible_primitive_ids
initial_system_tokens
tool_schema_tokens
skill_instruction_tokens
tool_calls
irrelevant_tool_calls
invalid_tool_calls
model_calls
input_tokens
output_tokens
worker_runtime_ms
evidence_items
duplicate_evidence_rate
finding_candidates
finding_accepted
finding_rejected
coverage_required
coverage_satisfied
coverage_missing
```

## Phase 1 — scoped primitive execution

Implement `createScopedRunPrimitiveTool()`.

## Phase 2 — experimental worker bootstrap

Feature flag:

```text
CURRENT:
CORE_TOOLS + skillRefs

EXPERIMENTAL:
WORKER_BOOTSTRAP + compiled skill surface
```

## Phase 3 — authorization Skill Contract

Split:

```text
skills/
  auth-security/
    authorization/
      SKILL.md
      procedure.md
      knowledge/
        idor.md
        vertical-access.md
        horizontal-access.md
        jwt.md
        sessions.md
```

## Phase 4 — ToolResult → ArtifactRef pipeline

Start with `httpRequest`.

## Phase 5 — actor/session refs

Remove manual header plumbing from migrated authorization worker.

## Phase 6 — ExchangeArtifact

Make every network action produce an immutable exchange ref.

## Phase 7 — Coverage Ledger

Connect Skill verification contracts to Task acceptance.

## Phase 8 — Capability Gateway

Use initially for MCP, optional scanners, plugins, and external providers.

## Phase 9 — ExecutionBackend

Add HTTP + Deterministic + Browser, then Sandbox + MCP.

## Phase 10 — WorkerSession + recovery

Add crash salvage, resume, waiting, wakeup, checkpoint.

## Phase 11 — SharedRunArtifact

Begin with ThreatModel, TargetMap, ActorMap.

## Phase 12 — Context compaction

Only after earlier context-control mechanisms work.

---

# 21. A/B experiment

### Current

```text
full selected skill body
+
CORE_TOOLS
+
skill toolRefs
+
global runPrimitive enum
+
manual auth/header plumbing
+
mixed evidence responsibility
```

### Experimental

```text
compact skill contract
+
compact procedure
+
context refs
+
compiled 3–6 action facade
+
skill-scoped primitive enum
+
runtime session hydration
+
automatic evidence
+
bounded outputs
+
artifact refs
```

Keep constant:

- task
- target
- model
- temperature
- token budget
- starting state

Compare:

```text
task completion
accepted finding quality
tool calls
irrelevant calls
invalid calls
input tokens
tool-schema tokens
runtime
retries
coverage completeness
duplicate evidence
reproducibility
```

---

# 22. Model sensitivity experiment

Run the same corpus on:

```text
strong model
medium model
small/open-source model
```

Hypothesis:

> Narrow compiled capability surfaces and bounded observations should help smaller models disproportionately.

Measure:

```text
success_rate
irrelevant_tool_rate
tool_selection_error_rate
retries
context_tokens
time_to_first_useful_action
accepted_findings
```

---

# 23. What to keep from Ultimatrix

Keep:

- shared live skill index
- progressive skill metadata/body loading
- references / folder-per-skill support
- TaskCoordinator
- task budgets and retries
- context/evidence/graph refs
- task attribution
- structured evidence ledger
- central finding promotion
- deterministic proof floor
- experiment + independent retest requirement
- graph/artifact references
- adaptive context work
- model routing
- streaming/event improvements

---

# 24. What to borrow from Strix

Borrow as patterns:

```text
MCP metadata-first disclosure
output bounding
spill-to-artifact
negative-space coverage
execution backend registry
sandbox isolation
worker-session recovery
shared run state
HTTP exchange identity
context compaction
```

Do not borrow:

```text
large global base tool set
full skill-body injection
prompt-only authority
manual provenance bookkeeping
generic call-by-name for normal capabilities
```

---

# 25. SDK invariants

```text
INV-01
A capability does not become model-visible merely because it exists.

INV-02
Skill selection happens before worker capability exposure.

INV-03
Skills declare semantic capability requirements, not concrete implementations.

INV-04
Worker surface is reproducible from task + skill + policy + registry version.

INV-05
Discovery/description does not imply execution authority.

INV-06
A primitive outside the compiled grant cannot execute.

INV-07
Parent availability does not automatically imply child visibility.

INV-08
Every external action yields durable provenance.

INV-09
Raw result persistence does not depend on LLM bookkeeping.

INV-10
Worker completion is not equivalent to task acceptance.

INV-11
Coverage distinguishes untested from tested-clean.

INV-12
Large raw outputs are externalized before model history.

INV-13
Secrets are hydrated from refs whenever possible.

INV-14
Knowledge disclosure and capability authority are independent.

INV-15
Compaction is a fallback, not the main context strategy.
```

---

# 26. Immediate implementation order

1. Add baseline metrics.
2. Implement scoped `runPrimitive`.
3. Add experimental `WORKER_BOOTSTRAP`.
4. Migrate `authorization` to compact Skill Contract.
5. Add actor/session refs.
6. Wrap `httpRequest` with result bounding + artifact refs.
7. Create `ExchangeArtifact`.
8. Add Coverage Ledger.
9. Connect coverage to Task acceptance.
10. Build Capability Gateway.
11. Introduce ExecutionBackend.
12. Add Docker SandboxBackend.
13. Add WorkerSession persistence/recovery.
14. Add SharedRunArtifact.
15. Add context compaction.
16. Migrate one injection skill.
17. Migrate one business-logic skill.
18. Freeze SDK abstractions only after A/B results.

Do **not** migrate all skills before validating the first three.

---

# 27. Recommended pilot skills

### Authorization

Exercises:

```text
actors
sessions
controlled comparison
primitive scoping
evidence
retest
```

### Injection skill

Exercises:

```text
payload iteration
response parsing
large outputs
sandbox scripting
artifact inspection
```

### Business logic

Exercises:

```text
stateful workflow
shared context
long plans
coverage
task dependencies
```

If one architecture works across all three, the SDK boundary is much more credible.

---

# 28. Success criteria

Aim for:

```text
>50% reduction in visible tool/schema tokens

100% undeclared primitive runtime rejection

0 unrelated primitive IDs visible

lower irrelevant tool-call rate

lower manual evidence bookkeeping

lower duplicate evidence rate

same or better task completion

same or better finding acceptance quality

higher coverage observability

better small/open-model reliability
```

---

# 29. Hackathon thesis

The story should not be:

> We built another multi-agent pentesting framework.

The stronger story is:

> **We built an adaptive agent runtime that compiles a large capability universe into the smallest task-specific execution surface a model needs, externalizes state/evidence from model context, and verifies semantic completion independently of worker prose.**

Ultimatrix is the real-world validation environment.

Strix provides production patterns showing that several mechanisms are practical:

- metadata-first external tool disclosure
- externalized large outputs
- durable worker state
- coverage accounting
- sandboxed execution

The new SDK goes beyond both through:

```text
Skill Contract
      ↓
Capability Compiler
      ↓
Context Compiler
      ↓
Execution Compiler
      ↓
Backend Selection
      ↓
Observation / Evidence / Coverage
      ↓
Acceptance Engine
```

---

# 30. Bottom line

The best Strix ideas to adapt are mostly **below the reasoning layer**:

```text
sandbox
output control
provenance
coverage
lifecycle
JIT external capability discovery
```

The part not to copy is Strix's broad per-agent model-visible tool surface.

Target Ultimatrix architecture:

> **Skill-first semantic narrowing → capability compilation → tiny worker surface → runtime-owned execution/evidence/state → coverage-aware acceptance.**
