# Ultimatrix Skill Runtime Audit & Restructuring Plan

**Repository:** `Msalways/Ultimatrix`  
**Branch audited:** `master`  
**Pinned commit:** `71d4dec443b5facaf0b324aca9c2c5daec2e2c7f`  
**Audit date:** 2026-09-16  
**Purpose:** Use Ultimatrix as an execution laboratory for a stronger, domain-agnostic agent runtime/SDK.

> This document is not primarily a request to "clean up Ultimatrix." The goal is to restructure enough of its skill mechanism to run controlled experiments and learn which abstractions belong in the new SDK.

---

## 1. Executive summary

The current Ultimatrix skill subsystem is substantially better than the older snapshot that contained 59 skills. At the pinned commit, the repository documents **74 skills across 18 domains**, uses a shared metadata-first skill index, loads full skill bodies on demand, has a TaskCoordinator with typed task state, and has a much stronger finding-promotion/evidence gate.

However, the central capability-boundary problem discovered in the earlier skill audit still exists:

1. A skill declares `primitives[]`, but `resolveToolsForSkills()` does not use that field.
2. If a skill declares `runPrimitive`, the worker receives the global `runPrimitive` tool.
3. `runPrimitive` exposes `primitiveId: z.enum(PRIMITIVE_IDS)` where `PRIMITIVE_IDS` is built from **all registered primitives**.
4. `resolveToolsForSkills()` begins with `CORE_TOOLS`, so every skill-derived worker receives roughly 30 capabilities before its own `toolRefs` are considered.
5. Many of those core capabilities are not domain actions. They are runtime bookkeeping, state access, evidence, session handling, and skill-discovery mechanisms.
6. Skills therefore remain much more strongly specialized by **prompt text** than by their executable surface.
7. Workers additionally inherit the parent's active extension tools, which is useful for continuity but weakens the principle that a worker's visible surface should be compiled specifically for its assigned task.

The most valuable experiment is therefore **not** "give every skill unique tools." It is:

> Keep generic implementations reusable, but compile a narrow model-visible capability facade from the selected skill, task, runtime state, and policy.

The proposed restructuring separates five concepts that Ultimatrix currently partially conflates:

- **Primitive** — reusable implementation-level operation.
- **Capability** — semantic ability the runtime can provide.
- **Skill** — compact procedural knowledge + capability policy + verification/output contract.
- **Facade** — worker/task-specific permissioned actions exposed to the model.
- **Runtime** — authority over evidence, state projection, provenance, telemetry, context hydration, and lifecycle.

This document gives a staged migration that lets you A/B test the current model against the restructured model inside Ultimatrix.

---

## 2. Source-of-truth note

I attempted to clone the public repository into the execution sandbox, but the sandbox environment could not resolve `github.com`. Rather than use the older ZIP, this audit inspected the **live public repository through the GitHub integration** and pinned every code conclusion to commit:

`71d4dec443b5facaf0b324aca9c2c5daec2e2c7f`

Relevant source files inspected:

- [`src/solver/skills/loader.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/solver/skills/loader.ts)
- [`src/solver/skills/registry.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/solver/skills/registry.ts)
- [`src/solver/skills/tool-filter.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/solver/skills/tool-filter.ts)
- [`src/solver/brain-tools.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/solver/brain-tools.ts)
- [`src/core/toolpack.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/core/toolpack.ts)
- [`src/mastra/index.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/mastra/index.ts)
- [`src/workers/factory.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/workers/factory.ts)
- [`src/workers/pool.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/workers/pool.ts)
- [`src/manager/tools/spawn-worker.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/manager/tools/spawn-worker.ts)
- [`src/runtime/task-coordinator.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/runtime/task-coordinator.ts)
- [`src/primitives/index.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/primitives/index.ts)
- [`src/tools/http-tools.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/tools/http-tools.ts)
- [`src/tools/control-tools.ts`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/src/tools/control-tools.ts)
- [`skills/auth-security/authorization.md`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/skills/auth-security/authorization.md)
- [`AGENTS.md`](https://github.com/Msalways/Ultimatrix/blob/71d4dec443b5facaf0b324aca9c2c5daec2e2c7f/AGENTS.md)

---

# 3. Current end-to-end skill execution path

At the pinned commit, the important flow is approximately:

```text
skills/<domain>/<skill>.md
        │
        │ YAML frontmatter
        │ + large methodology body
        ▼
src/solver/skills/loader.ts
        │
        ├── Phase 1: metadata only
        │      SkillMeta {
        │        toolRefs[]
        │        primitives[]
        │        triggers[]
        │        contextBoosts[]
        │        toolChains[]
        │        compositionRules
        │        ...
        │      }
        │
        └── Phase 2: loadSkillBody(skillId)
                    │
                    ▼
             SkillRegistry
                    │
                    │ selected skillId
                    ▼
            spawnWorker / TaskCoordinator
                    │
                    ▼
              WorkerFactory
                    │
                    ├── loads full skill body
                    ├── skillIds: [skillId]
                    ├── skills: [full Skill]
                    └── inherits active parent extension tools
                    │
                    ▼
              createAgent()
                    │
                    ├── create full ToolRegistry
                    ├── merge extraTools
                    ├── resolveToolsForSkills(skillIds)
                    │         │
                    │         ├── CORE_TOOLS
                    │         └── meta.toolRefs
                    │
                    ├── filter candidate registry by allow-set
                    ├── concatenate full skill instructions
                    └── create Mastra Agent
                              │
                              ▼
                       model-visible tools
                              │
                        ┌─────┴─────┐
                        ▼           ▼
                  generic tools   runPrimitive
                                      │
                                      ▼
                          GLOBAL PRIMITIVE_IDS ENUM
                                      │
                                      ▼
                              primitive executor
                                      │
                           HTTP / evidence / finding
```

The progressive-loading work is good. The issue is that **progressive knowledge loading and capability isolation are separate problems**. Ultimatrix has made meaningful progress on the first one while the second remains weak.

---

# 4. What changed since the earlier 59-skill audit

The earlier audit described 59 skills and found heavy overlap:

| Tool | Earlier skills referencing it |
|---|---:|
| `writeFinding` | 59 / 59 |
| `httpRequest` | 58 / 59 |
| `parseResponse` | 56 / 59 |
| `updateGraph` | 50 / 59 |
| `recordEvidence` | 46 / 59 |
| `getCapturedHeaders` | 42 / 59 |
| `runPrimitive` | 30 / 59 |
| `followRedirects` | 27 / 59 |
| `evaluateRendered` | 26 / 59 |

Earlier measured characteristics:

- median skill: ~8 tools;
- median pairwise overlap among populated skill toolsets: ~46%;
- 37 / 59 skills had no tool appearing in three or fewer skills.

The current repository now documents **74 skills / 18 domains**. The code has also changed in meaningful ways:

### Improvements already present

- `loader.ts` now clearly separates lightweight metadata loading from full-body loading.
- `SkillRegistry` is a read-through view over the shared loader index rather than a separate authority.
- `brain-tools.ts` explicitly removed eager methodology injection and serves methodology on demand.
- worker execution returns compact result summaries rather than returning unbounded full output to the brain.
- `TaskCoordinator` tracks typed task state, context references, required capabilities, budgets, retries, evidence refs, graph refs, and acceptance criteria.
- `control-tools.ts` has a centralized finding promotion path with structured claim verification and deterministic proof requirements.
- HTTP requests automatically capture structured evidence.
- worker events have explicit attribution.

These are all useful SDK lessons.

### But the critical skill-capability invariant is still missing

`SkillMeta` contains:

```ts
toolRefs: string[]
primitives: string[]
```

Yet `resolveToolsForSkills()` does:

```ts
const tools = new Set<string>(CORE_TOOLS)

for (const id of skillIds) {
  const meta = index.get(id)
  for (const t of meta.toolRefs) {
    tools.add(t)
  }
}
```

There is no enforcement of `meta.primitives`.

The current authorization skill, for example, declares:

```yaml
toolRefs:
  - httpRequest
  - parseResponse
  - evaluateRendered
  - findEndpointsInResponse
  - followRedirects
  - updateGraph
  - writeFinding
  - recordEvidence
  - getCapturedHeaders
  - runPrimitive

primitives:
  - authBypass
  - idorSwapper
  - authzMatrix
  - tenantIsolation
```

Architecturally that says:

> Authorization testing may use four primitives.

Mechanically it says:

> Authorization testing may use `runPrimitive`.

And the global `runPrimitive` schema says:

```ts
primitiveId: z.enum(PRIMITIVE_IDS)
```

where `PRIMITIVE_IDS` is generated from the entire primitive registry.

This means the primitive declaration is currently **descriptive metadata, not an executable permission boundary**.

---

# 5. Major findings

## F1 — `primitives[]` is parsed but not enforced

**Severity for SDK architecture:** Critical

**Files**

- `src/solver/skills/loader.ts`
- `src/solver/skills/tool-filter.ts`
- `src/primitives/index.ts`

`loader.ts` recognizes `primitives[]`, but the tool resolver ignores it.

`runPrimitive` is one global tool whose schema contains every primitive ID.

### Consequence

The apparent skill-level capability boundary is false.

This is a classic distinction between:

```text
declarative intention
```

and:

```text
mechanically enforced authority
```

For the SDK, **only mechanically enforced authority should count as a capability policy**.

### Required experiment

Compile a skill-bound `runPrimitive` facade whose enum is generated from that skill's `primitives[]`.

```text
authorization
   ↓
compilePrimitiveFacade(["authBypass", "idorSwapper", "authzMatrix", "tenantIsolation"])
   ↓
runPrimitive {
  primitiveId:
    "authBypass" |
    "idorSwapper" |
    "authzMatrix" |
    "tenantIsolation"
}
```

The worker must never receive the names or schema options for unrelated primitives.

---

## F2 — `CORE_TOOLS` weakens every specialization boundary

**Severity:** Critical

`src/solver/skills/tool-filter.ts` currently starts with a 30-item `CORE_TOOLS` set:

```text
listSkills
loadSkillBody
askUser
manageSkills
loadSkillReference
searchSkills
encodeDecode
queryGraph
getGraphSchema
getCaptureOverview
queryRelations
getGraphNeighborhood
getWorkflowAround
traceValue
explainReachability
getUntestedWorkarounds
verifyChains
recordEvidence
getDialogEvidence
getRecentChanges
getTargetSummary
getEndpointsWithParams
saveSession
restoreSession
getCapturedHeaders
storeSession
useSession
extractSessionCookie
getResearchStatus
getOastUrlTool
```

A worker declaring only a handful of skill tools therefore does **not** receive only those tools.

### Consequence

The skill author cannot reason locally about the actual capability surface.

A worker's model-selection problem is larger than the skill YAML suggests.

This is especially important for smaller/open-source models, where irrelevant tool schemas can increase:

- invalid tool selection;
- wrong sequencing;
- extra calls;
- token consumption;
- failure to use the intended primitive;
- accidental state mutation.

### Recommended change

Replace:

```ts
new Set(CORE_TOOLS)
```

with an explicit compiler policy:

```ts
compileWorkerCapabilities({
  skill,
  task,
  context,
  runtimePolicy,
})
```

A minimum bootstrap set may still exist, but it should be tiny and intentionally defined.

For example:

```text
Bootstrap:
- inspectContext
- requestMoreContext
- finishTask
```

Skill discovery belongs primarily to a planning/router layer, not automatically to every already-specialized worker.

---

## F3 — The skill's executable identity is still `toolRefs`, not semantic capability requirements

**Severity:** High

Skills refer directly to concrete global tool names such as:

```yaml
toolRefs:
  - httpRequest
  - parseResponse
  - recordEvidence
  - getCapturedHeaders
```

That binds skill knowledge to one implementation surface.

### Better abstraction

A skill should request semantic capabilities:

```yaml
requires:
  capabilities:
    - network.request
    - response.compare
    - session.actor-context
    - attack.authorization
```

The runtime then resolves those requirements into implementations.

```text
network.request
   ├── fetch adapter
   ├── captured-request replay adapter
   └── browser network adapter
```

This allows the same skill to work in a different host application without rewriting its methodology.

---

## F4 — Skill specialization is still dominated by prompt text

**Severity:** High

Current skill bodies can be very large. The authorization skill alone is ~23 KB at the pinned commit.

The worker factory loads the full skill and `createAgent()` concatenates the full `skill.instructions` into system instructions.

This is better than eager-loading all skills, but it remains coarse-grained.

### Current disclosure

```text
metadata
   ↓
entire selected skill body
```

### Target disclosure

```text
L0 index
   ↓
L1 skill contract
   ↓
L2 compact procedure
   ↓
L3 knowledge fragment only when a specific branch needs it
```

For example, an authorization worker doing an IDOR comparison should not need the JWT algorithm-confusion section unless the execution path actually reaches JWT analysis.

---

## F5 — Worker inheritance is useful but not capability-safe

**Severity:** High

`WorkerFactory` intentionally takes the parent brain's active extension registry and passes its active tools into `createAgent()` as `extraTools`.

That fixes a prior capability-discontinuity problem: a worker can use capabilities discovered/activated by the parent.

But it creates another design question:

> Should inherited availability imply inherited visibility and authority?

For the SDK, the answer should be no.

### Better rule

```text
parent capability universe
         +
skill policy
         +
task policy
         +
authorization policy
         +
runtime context
         ↓
Capability Compiler
         ↓
worker-specific facade
```

Workers can inherit the parent's **registry**, but not automatically the parent's **exposed surface**.

---

## F6 — Evidence has both automatic and LLM-managed paths

**Severity:** High

`httpRequest` automatically calls:

```ts
recordStructuredEvidence(...)
```

That is correct runtime behavior.

At the same time, many skills explicitly expose/instruct:

```text
recordEvidence
```

`runPrimitiveById()` also iterates primitive evidence and explicitly calls `recordEvidence` before calling `writeFinding`.

### Consequence

There are multiple evidence semantics:

1. deterministic runtime observation;
2. LLM-selected evidence buffering;
3. primitive-selected evidence;
4. workflow/task evidence references;
5. finding attached evidence.

Some separation is legitimate, but the agent should not have to perform bookkeeping that the runtime can derive.

### Recommended ownership

| Concern | Owner |
|---|---|
| raw request/response capture | runtime |
| status/latency/header observation | runtime |
| provenance / toolCallId | runtime |
| evidence persistence | runtime |
| relation to active task | runtime |
| relation to active hypothesis | runtime/event projection |
| "this observation supports hypothesis X" | agent may propose |
| verified claim support | evidence gate |
| finding promotion | deterministic evaluator/gate |

Rename or redesign model-facing `recordEvidence` into something semantic if it is still required, e.g.:

```text
linkEvidenceToClaim(evidenceRef, claimRef)
```

rather than letting the model re-enter raw observations that the runtime already owns.

---

## F7 — Authentication/session hydration remains model-visible plumbing

**Severity:** Medium/High

The authorization skill explicitly tells the model:

> Before making HTTP requests, call `getCapturedHeaders`, then pass those headers to `httpRequest`.

The `httpRequest` schema likewise tells the model to pass previously captured session headers.

This is a runtime-context problem being delegated to model reasoning.

### Target interface

```ts
httpRequest({
  sessionRef: "actor-A",
  method: "GET",
  url: ...
})
```

or even:

```ts
requestAs({
  actor: "user-A",
  requestRef: "captured-request-17",
  mutation: ...
})
```

The runtime should hydrate cookies/tokens/headers and attach provenance.

This:

- reduces token use;
- avoids accidental auth drift;
- reduces secret exposure to model context;
- produces deterministic actor attribution;
- makes request replay reproducible.

---

## F8 — Routine response normalization should be runtime middleware

**Severity:** Medium

The older skill set heavily referenced `parseResponse`. The current authorization skill still includes it.

For common HTTP calls, the runtime already knows:

- status;
- final/target URL;
- response headers;
- body;
- duration;
- request metadata.

A routine normalized observation should be generated automatically.

```text
httpRequest
   ↓
transport
   ↓
raw artifact
   ↓
normalizer
   ├── structured observation
   ├── evidence entry
   ├── compressed model view
   └── artifact ref
```

Retain an explicit deep-inspection capability for unusual responses. Do not require the LLM to copy body/headers/status from one tool into another for ordinary parsing.

---

## F9 — The base worker prompt still contains runtime bookkeeping instructions

**Severity:** Medium

`src/mastra/index.ts` instructs agents to:

```text
Record every observation in the graph with updateGraph
Write findings with evidence using writeFinding
```

This is philosophically inconsistent with the stronger runtime/evidence architecture now present elsewhere in the repository.

It encourages the model to behave as both:

```text
researcher
+
state database clerk
```

### Target

The worker should reason about:

```text
What do I need to know?
What action should I take?
What changed?
What does it imply?
What must be verified next?
Am I done?
```

The runtime should handle:

```text
tool result persistence
event ordering
evidence capture
provenance
graph projection
telemetry
task attribution
artifact references
```

---

## F10 — `TaskCoordinator.requiredCapabilities` is promising but not yet the authority for worker exposure

**Severity:** High / opportunity

`TaskRequest` already includes:

```ts
requiredCapabilities?: string[]
```

That is exactly the seam the new SDK needs.

Today it is primarily task/model-routing metadata.

It can evolve into a real compilation input:

```text
Task.requiredCapabilities
+
Skill.requires.capabilities
+
Skill.policy
+
Runtime authorization
=
WorkerCapabilitySurface
```

This is a very valuable bridge because you do not need to invent an entirely separate task abstraction.

---

## F11 — Acceptance criteria currently test generic worker completion/graph mutation

**Severity:** Medium

`spawn-worker.ts` currently provides criteria like:

```text
worker completed without error
at least one graph mutation was recorded
```

Those are execution-health criteria, not necessarily task-semantic success.

A good skill should declare an output/verification contract.

For example:

```yaml
verification:
  requires:
    - controlled_comparison
    - reproducible_difference

output:
  schema: AuthorizationTestConclusion
```

Then the task compiler can materialize real criteria for that skill/task.

---

## F12 — Finding promotion is stronger than the skill layer and should stay runtime-owned

**Severity:** Positive finding

`control-tools.ts` now has meaningful deterministic gates:

- evidence-backed structured verification;
- experiment requirements;
- proven/retested experiment checks;
- proof floors by severity;
- candidate lifecycle state.

This is the right architectural direction.

Do **not** move this logic back into skill prompts.

For the new SDK, this is a pattern:

> Agent proposes semantic conclusions; runtime/evaluator controls acceptance.

---

# 6. Proposed target Skill model

The most useful redefinition is:

> **A Skill is a declarative procedural policy describing when it applies, the semantic capabilities it needs, the procedure it recommends, the constraints it imposes, and how its result can be verified.**

It is not:

- a tool registry;
- an implementation module;
- a worker;
- a persistence service;
- a global prompt;
- a graph writer;
- an evidence ledger.

Suggested schema:

```yaml
id: authorization
version: 2

summary:
  description: >
    Test authorization boundaries using controlled actor/object comparisons.
  domain: auth-security
  tier: powerful

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

  sideEffects:
    network: allowed
    browser: optional
    stateMutation: runtime-only

procedure:
  stages:
    - id: establish-baseline
      goal: Capture authorized behavior for the owning actor.

    - id: controlled-variation
      goal: Change one authorization dimension at a time.

    - id: compare
      goal: Compare normalized observations.

    - id: reproduce
      goal: Reproduce any material access-control difference.

    - id: conclude
      goal: Propose a conclusion backed by evidence references.

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

Notice what is absent:

```text
recordEvidence
updateGraph
writeFinding
getCapturedHeaders
```

Those should not be the skill's core procedural identity.

---

# 7. Introduce a Capability Registry

Instead of treating global tool IDs as the ontology, create a registry whose entries describe semantic capabilities.

Example TypeScript:

```ts
type CapabilityId = string

interface CapabilityDefinition {
  id: CapabilityId

  // Human/model discoverability
  summary: string

  // Runtime implementation
  implementation: string

  // Security / scheduling
  activity:
    | 'inspect'
    | 'network'
    | 'browser'
    | 'mutate'
    | 'delegate'

  readOnly: boolean

  requirements?: string[]

  // Optional implementation variants
  variants?: string[]
}
```

Example registrations:

```ts
registry.register({
  id: 'network.request',
  implementation: 'httpRequest',
  activity: 'network',
  readOnly: false,
})

registry.register({
  id: 'response.compare',
  implementation: 'compareResearchResponses',
  activity: 'inspect',
  readOnly: true,
})

registry.register({
  id: 'primitive.execute',
  implementation: 'runPrimitive',
  activity: 'network',
  readOnly: false,
})
```

Ultimatrix already has an extension registry and lazy built-ins. Reuse that concept instead of creating another disconnected registry. The important change is to distinguish:

```text
registry membership
```

from:

```text
worker-visible exposure
```

---

# 8. Add a Capability Compiler

This is the key experiment.

```ts
interface CompileWorkerSurfaceInput {
  skill: SkillContract
  task: TaskState
  availableCapabilities: CapabilityRegistry
  runtimePolicy: RuntimePolicy
  parentCapabilities?: CapabilityRegistry
  modelProfile?: ModelProfile
}

interface CompiledWorkerSurface {
  tools: Record<string, Tool>
  instructions: string
  contextRefs: string[]
  grants: CapabilityGrant[]
  outputSchema: unknown
  verification: VerificationContract
}
```

Pseudo-flow:

```ts
function compileWorkerSurface(input): CompiledWorkerSurface {
  const requirements = union(
    input.skill.requires.capabilities,
    input.task.requiredCapabilities,
  )

  const resolved = input.availableCapabilities.resolve(requirements)

  const authorized = input.runtimePolicy.authorize({
    task: input.task,
    skill: input.skill,
    candidates: resolved,
  })

  const facades = authorized.map(cap =>
    compileFacade(cap, {
      primitiveAllowList: input.skill.policy.primitives?.allow,
      task: input.task,
    })
  )

  return {
    tools: Object.fromEntries(facades),
    instructions: compileProcedure(input.skill, input.task),
    contextRefs: input.task.contextRefs,
    grants: authorized,
    outputSchema: input.skill.output.schema,
    verification: input.skill.verification,
  }
}
```

---

# 9. First concrete code change: scoped `runPrimitive`

This is the highest-signal, lowest-risk experiment.

## Current

```ts
export const runPrimitiveTool = createTool({
  inputSchema: z.object({
    primitiveId: z.enum(PRIMITIVE_IDS),
    ...
  })
})
```

## Add

```ts
export function createRunPrimitiveTool(
  allowedPrimitiveIds: string[],
) {
  const valid = allowedPrimitiveIds.filter(id => getPrimitive(id))

  if (valid.length === 0) {
    throw new Error('No authorized primitives')
  }

  const ids = valid as [string, ...string[]]

  return createTool({
    id: 'runPrimitive',
    description: `Run an authorized technique primitive.`,
    inputSchema: z.object({
      primitiveId: z.enum(ids),
      context: primitiveContextSchema,
      commit: z.boolean().optional().default(true),
    }),
    execute: async ({ primitiveId, context, commit }) => {
      if (!valid.includes(primitiveId)) {
        return {
          ok: false,
          error: 'Primitive is not authorized for this worker',
        }
      }

      return runPrimitiveById(
        primitiveId,
        context ?? {},
        { commit: commit !== false },
      )
    },
  })
}
```

Important: enforce the allowlist twice:

1. schema-level discoverability;
2. runtime authorization.

The schema reduces model confusion; the runtime check provides actual security.

---

# 10. Replace `resolveToolsForSkills()` with compilation

## Phase-1 compatibility version

Do not rewrite everything initially.

Add:

```ts
interface ResolvedSkillPolicy {
  toolIds: string[]
  primitiveIds: string[]
}

export function resolveSkillPolicy(skillIds: string[]): ResolvedSkillPolicy {
  const index = initSkillIndex()

  const toolIds = new Set<string>()
  const primitiveIds = new Set<string>()

  for (const id of skillIds) {
    const meta = index.get(id)
    if (!meta) throw new Error(`Skill not found: ${id}`)

    for (const tool of meta.toolRefs) toolIds.add(tool)
    for (const primitive of meta.primitives) primitiveIds.add(primitive)
  }

  return {
    toolIds: [...toolIds],
    primitiveIds: [...primitiveIds],
  }
}
```

Initially keep selected bootstrap capabilities explicitly:

```ts
const WORKER_BOOTSTRAP = [
  'queryGraph',
  'getTargetSummary',
]
```

Then:

```ts
const policy = resolveSkillPolicy(skillIds)

const allowSet = new Set([
  ...WORKER_BOOTSTRAP,
  ...policy.toolIds,
])
```

When `runPrimitive` is requested, replace the global tool instance with:

```ts
createRunPrimitiveTool(policy.primitiveIds)
```

This single change lets you validate the biggest architectural hypothesis without a full rewrite.

---

# 11. Second code change: eliminate automatic `CORE_TOOLS`

Do this after primitive scoping has tests.

Instead of one global `CORE_TOOLS`, classify runtime capabilities.

```ts
const CAPABILITY_CLASSES = {
  workerBootstrap: [
    'queryGraph',
    'getTargetSummary',
  ],

  plannerDiscovery: [
    'listSkills',
    'searchSkills',
    'loadSkillBody',
    'loadSkillReference',
  ],

  runtimeInternal: [
    // not model-visible
    'recordEvidenceInternal',
    'persistToolResult',
    'projectGraphEvent',
  ],
}
```

A specialized worker should generally not need:

```text
manageSkills
searchSkills
loadSkillBody
listSkills
saveSession
restoreSession
getResearchStatus
...
```

unless its task specifically requires them.

The planning layer can discover/compose skills before worker compilation.

---

# 12. Third code change: context/session references

Current:

```text
getCapturedHeaders(target, role)
       ↓
model receives secrets
       ↓
httpRequest(headers=...)
```

Target:

```text
Task context:
  actorRefs:
    - user-A
    - user-B

Agent:
  requestAs({
    actorRef: "user-A",
    requestRef: "req-123",
    mutation: ...
  })

Runtime:
  actorRef
    ↓
SessionResolver
    ↓
actual cookie/token/header hydration
    ↓
transport
```

Minimum compatibility version:

```ts
httpRequest({
  sessionRef?: string
  ...
})
```

Runtime merges headers from the referenced session.

The model can still provide explicit headers when the skill genuinely requires header mutation, but normal session continuation should not depend on copying secrets around.

---

# 13. Fourth code change: runtime-owned observation pipeline

Build a uniform execution envelope:

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
}
```

For a network action:

```text
ToolCallRequested
      ↓
ToolCallStarted
      ↓
NetworkRequestSent
      ↓
NetworkResponseReceived
      ├── RawArtifactStored
      ├── ObservationNormalized
      ├── EvidenceRecorded
      ├── GraphProjectionUpdated
      └── TelemetryRecorded
      ↓
ToolCallCompleted
```

The worker gets a compressed result:

```json
{
  "status": 200,
  "shape": "json-object",
  "semanticDiffFromBaseline": null,
  "artifactRef": "artifact://response/123",
  "evidenceRef": "evidence://123"
}
```

The raw body remains retrievable JIT.

---

# 14. Fifth code change: split large skill bodies into procedural and knowledge layers

Current:

```text
one selected skill
   ↓
entire 10–25 KB methodology body
```

Target:

```text
SkillIndex
  id
  summary
  applicability

SkillContract
  required capabilities
  primitive policy
  context contract
  output contract
  verification

Procedure
  5–10 compact stages

KnowledgeFragments
  loaded only when relevant
```

Suggested filesystem:

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

`SKILL.md` stays compact.

Example:

```yaml
---
id: authorization
description: Authorization boundary testing
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

procedure: ./procedure.md

knowledge:
  - id: idor
    ref: ./knowledge/idor.md
  - id: jwt
    ref: ./knowledge/jwt.md

verification:
  contract: authorization-v1

output:
  schema: AuthorizationConclusion
---
```

The model initially receives only the contract + compact procedure.

Knowledge is JIT.

---

# 15. Skill discovery should stay outside specialized execution where possible

The current solver brain appropriately exposes discovery capabilities.

But once a worker is assigned:

```text
skillId = authorization
objective = test endpoint X against actors A/B
```

that worker usually does not need a global skill marketplace.

Prefer:

```text
Brain / Planner
   ├── search skill metadata
   ├── inspect contracts
   ├── compose logical procedure
   └── emit Task
          ↓
Execution Compiler
          ↓
Worker Capsule
```

If the worker genuinely reaches an unknown subproblem, it can emit:

```text
NeedCapability / NeedSkillFragment
```

and the runtime/planner can decide whether to expand its surface.

This is more controlled than automatically giving every worker `searchSkills` + `loadSkillBody`.

---

# 16. Logical plan vs physical execution plan

Skills should contribute **logical procedure**, not dictate orchestration topology.

Example logical plan:

```text
Authorization test
  1. establish actor A baseline
  2. establish actor B baseline
  3. perform object swap
  4. compare
  5. reproduce
  6. conclude
```

The execution compiler can choose:

```text
one worker
```

or:

```text
parallel A/B observation workers
   ↓
comparison worker
```

or:

```text
deterministic HTTP executor
   ↓
small reasoning model for comparison
```

based on:

- model capability;
- budget;
- latency;
- isolation;
- token size;
- independence of steps.

This is one of the most important generalizable SDK principles:

> **Skills describe what/how conceptually. The execution compiler decides how the procedure is physically realized.**

---

# 17. Proposed worker capsule

A worker should receive something closer to:

```ts
interface WorkerCapsule {
  objective: string

  procedure: {
    currentStage: string
    compactSteps: string[]
  }

  contextRefs: string[]

  actions: Tool[]

  constraints: {
    targetScope: string[]
    sideEffects: string[]
    primitiveAllowList?: string[]
  }

  outputContract: unknown

  verificationContract: unknown
}
```

Example:

```text
Objective:
Determine whether actor B can access actor A's object.

Procedure:
1. Establish A-owned baseline.
2. Replay as B with only object ownership changed.
3. Compare normalized authorization result.
4. Reproduce material unauthorized access.
5. Return evidence refs and conclusion.

Context:
endpoint://42
actor://A
actor://B
object://A-731

Actions:
requestAs
compareResponses
runPrimitive(authzMatrix | idorSwapper)

Output:
AuthorizationConclusion
```

Not:

```text
74 skills
30 core tools
global primitive enum
graph bookkeeping tools
evidence persistence tools
session header plumbing
full global registry
```

---

# 18. Migration plan for Ultimatrix

## Phase 0 — Baseline instrumentation

Do not alter behavior.

Record per worker:

- selected skill;
- visible tool IDs;
- visible primitive IDs;
- tool schema token estimate;
- skill instruction token estimate;
- tools actually called;
- invalid/failed tool calls;
- evidence records produced;
- duplicate evidence fingerprints;
- graph mutations;
- model calls;
- total tokens;
- task completion;
- finding accepted/rejected;
- runtime.

Store as a repeatable baseline.

### Exit criterion

You can reproduce metrics for a fixed E2E corpus.

---

## Phase 1 — Enforce `primitives[]`

Implement `createRunPrimitiveTool(allowedIds)`.

No other architecture change.

### Tests

- authorization worker schema lists exactly four primitive IDs;
- attempts to invoke unrelated primitive fail at runtime;
- permitted primitives still execute;
- skills without `runPrimitive` cannot invoke it;
- skills with `runPrimitive` but empty primitive policy fail closed.

### Why first

This directly tests the "underlying reusable primitive vs visible capability" thesis with minimal disruption.

---

## Phase 2 — Remove `CORE_TOOLS` from worker specialization

Keep a tiny explicit bootstrap set.

Compare:

```text
Current:
CORE_TOOLS + toolRefs
```

with:

```text
Experimental:
bootstrap + compiled requirements
```

Do not change the brain/planner surface initially.

### Metrics

- model tool-selection accuracy;
- calls per task;
- tool schema tokens;
- completion rate;
- latency;
- smaller-model performance.

---

## Phase 3 — Move evidence/state bookkeeping behind the runtime

Start with `httpRequest`.

Automatically generate:

```text
raw artifact
structured observation
evidence ref
task attribution
graph projection event
```

Remove `recordEvidence` from migrated skills unless the skill truly needs to semantically link an observation to a claim.

Do not remove the strong finding gate.

### Exit criterion

A migrated skill can produce a valid evidence-backed finding without ever manually calling `recordEvidence` for ordinary HTTP observations.

---

## Phase 4 — Session/context hydration

Add `sessionRef` / `actorRef`.

Migrate authorization first.

Measure:

- auth header copying errors;
- token usage;
- replay reproducibility;
- leaked/missing auth state;
- worker prompt size.

---

## Phase 5 — Split skill contract/procedure/knowledge

Migrate only 3 representative skills first:

1. `authorization` — actor/session + scoped primitives.
2. one injection skill — payload/response analysis.
3. one business-logic skill — multi-step stateful procedure.

This gives three different execution shapes.

Do not migrate all 74 until the experiments show a benefit.

---

## Phase 6 — Compile task-specific facades

Introduce `CapabilityCompiler`.

Inputs:

```text
TaskState
SkillContract
CapabilityRegistry
RuntimePolicy
Parent capability registry
Model profile
```

Output:

```text
CompiledWorkerSurface
```

Make the compiler emit diagnostics:

```json
{
  "required": ["network.request", "response.compare"],
  "resolved": ["httpRequest", "compareResearchResponses"],
  "denied": [],
  "primitiveAllowList": ["idorSwapper", "authzMatrix"],
  "visibleTools": 3,
  "schemaTokens": 740
}
```

This diagnostic will be extremely useful when designing the SDK.

---

## Phase 7 — Logical plan / execution compiler split

Only after worker capability compilation is stable.

Skill composition should produce a logical plan.

A physical execution planner then chooses:

- direct deterministic call;
- single worker;
- multiple workers;
- parallel execution;
- model tier;
- context allocation;
- retry policy.

This is the bridge from "agent framework" to "adaptive agent runtime."

---

# 19. E2E test matrix

Build a fixed E2E suite around the migrated skills.

## Capability isolation

### E2E-CAP-01 — permitted primitive

```text
skill: authorization
primitive: idorSwapper
expected: visible + executable
```

### E2E-CAP-02 — undeclared primitive hidden

```text
skill: authorization
primitive: classicInjection
expected:
- absent from schema
- runtime rejection if manually injected
```

### E2E-CAP-03 — undeclared tool hidden

```text
skill: authorization
tool: manageSkills
expected: absent unless task policy explicitly grants it
```

### E2E-CAP-04 — parent capability availability != worker exposure

Activate an extension in the parent.

Expected:

```text
parent registry contains extension
worker does not see extension unless compiler grants it
```

---

## Progressive disclosure

### E2E-SKILL-01 — metadata only before selection

Expected:

```text
no full skill body loaded
```

### E2E-SKILL-02 — compact procedure after selection

Expected:

```text
contract + procedure loaded
JWT fragment absent during simple IDOR task
```

### E2E-SKILL-03 — JIT knowledge fragment

Trigger JWT subproblem.

Expected:

```text
jwt fragment becomes available only then
```

---

## Runtime evidence

### E2E-EVID-01 — automatic HTTP evidence exactly once

One HTTP request.

Expected:

```text
1 raw response artifact
1 structured observation
1 evidence record
```

No model bookkeeping required.

### E2E-EVID-02 — finding gate still rejects unsupported claim

Worker proposes finding without enough evidence.

Expected:

```text
candidate retained
finding not promoted
```

### E2E-EVID-03 — valid replay + retest promotes

Expected:

```text
proof passes
finding promoted
```

---

## Session hydration

### E2E-SESSION-01

```text
actorRef=A
request
```

Expected auth context applied internally.

### E2E-SESSION-02

```text
actorRef=B
same request
```

Expected only actor identity changes.

### E2E-SESSION-03

Verify secrets are not unnecessarily rendered into the LLM-visible context.

---

## Task semantics

### E2E-TASK-01

Worker terminates with successful model response but without satisfying verification contract.

Expected:

```text
task != semantically accepted
```

### E2E-TASK-02

Worker satisfies skill output + verification contract.

Expected:

```text
task accepted
```

---

# 20. Metrics to collect

The experiment is much stronger if the result is quantitative.

## Context / capability metrics

```text
visible_tools_per_worker
visible_primitive_ids_per_worker
tool_schema_tokens
skill_instruction_tokens
total_initial_context_tokens
```

## Reasoning/execution metrics

```text
tool_calls_per_task
invalid_tool_calls
irrelevant_tool_calls
retries
model_calls
time_to_first_useful_action
total_latency
```

## Runtime correctness

```text
duplicate_evidence_rate
missing_evidence_rate
unattributed_tool_results
graph_mutations_per_task
finding_gate_rejection_rate
replay_success_rate
```

## Model sensitivity

Run the same corpus with:

```text
strong model
medium model
small/open-source model
```

The hypothesis to test:

> Narrow compiled capability surfaces should provide a disproportionately larger benefit to smaller models.

That is potentially a compelling hackathon result.

---

# 21. Suggested A/B experiment

## A — Current Ultimatrix

```text
full selected skill body
+
CORE_TOOLS
+
skill toolRefs
+
global runPrimitive enum
+
manual session/header plumbing
+
mixed evidence responsibilities
```

## B — Restructured worker

```text
compact skill contract
+
compact procedure
+
task context refs
+
compiled 3–6 action facade
+
skill-scoped primitive enum
+
runtime session hydration
+
automatic evidence
```

Hold constant:

- target;
- task;
- model;
- temperature;
- budget;
- starting graph/context.

Measure:

- task success;
- tool-call count;
- incorrect capability choices;
- token use;
- execution time;
- evidence quality;
- finding acceptance;
- reproducibility.

This turns an architectural opinion into an empirical SDK argument.

---

# 22. Recommended first migrated skill: `authorization`

Authorization is an excellent pilot because it simultaneously exercises:

- primitive scoping;
- two-actor/session context;
- controlled comparison;
- evidence provenance;
- graph context;
- finding verification;
- large methodology-body reduction.

### Current visible intent

```yaml
toolRefs:
  - httpRequest
  - parseResponse
  - evaluateRendered
  - findEndpointsInResponse
  - followRedirects
  - updateGraph
  - writeFinding
  - recordEvidence
  - getCapturedHeaders
  - runPrimitive

primitives:
  - authBypass
  - idorSwapper
  - authzMatrix
  - tenantIsolation
```

### Experimental visible facade

```text
requestAs(actorRef, requestRef, mutation?)
compareObservations(leftRef, rightRef)
runPrimitive(
  authBypass |
  idorSwapper |
  authzMatrix |
  tenantIsolation
)
proposeConclusion(...)
```

Potentially even `proposeConclusion` is just structured output rather than a tool.

Runtime owns:

```text
headers
cookies
transport
raw artifact storage
evidence ledger
graph projection
finding gate
telemetry
```

That is a much cleaner test of the architecture.

---

# 23. What not to do

## Do not create 100 highly specific tools

Bad direction:

```text
testIdor
testHorizontalIdor
testVerticalIdor
testAdminIdor
testJwtIdor
...
```

This moves complexity into an enormous tool catalog.

Keep reusable implementations generic.

Compile small semantic facades.

---

## Do not rely on prompt wording as permission enforcement

Bad:

```text
"You may only use these four primitives."
```

while the schema still exposes all primitive IDs.

The runtime must enforce the same boundary the prompt describes.

---

## Do not make the Skill the physical workflow engine

Avoid embedding:

```text
spawn worker
parallelize
choose model X
retry 3 times
```

into domain methodology unless it is a true semantic requirement.

The physical execution compiler should own those decisions.

---

## Do not remove the finding/evidence gate

That part of current Ultimatrix is moving in the right direction.

The experiment should reduce model bookkeeping **while strengthening deterministic verification**.

---

# 24. Proposed implementation file map

A minimal experimental branch could introduce:

```text
src/
  capabilities/
    types.ts
    registry.ts
    compiler.ts
    facade.ts

  primitives/
    scoped-tool.ts

  runtime/
    observation-pipeline.ts
    session-resolver.ts

  solver/
    skills/
      contract.ts
      compiler.ts
```

Modify:

```text
src/solver/skills/loader.ts
  parse new requires/policy/verification/output fields

src/solver/skills/tool-filter.ts
  deprecate CORE_TOOLS behavior for workers
  resolve policy rather than only tool IDs

src/mastra/index.ts
  consume CompiledWorkerSurface
  stop constructing worker exposure directly from CORE_TOOLS + toolRefs

src/workers/factory.ts
  compile worker surface from Skill + Task
  inherit parent capability registry, not parent's visible surface

src/primitives/index.ts
  export createScopedRunPrimitiveTool()

src/tools/http-tools.ts
  add sessionRef/actorRef hydration
  return normalized observation/evidence refs

src/tools/control-tools.ts
  keep centralized promotion gate
  reduce need for model-facing raw evidence bookkeeping
```

---

# 25. Suggested TypeScript contracts

```ts
export interface SkillContract {
  id: string
  version: number
  description: string

  applicability: {
    signals: string[]
    excludes?: string[]
  }

  requires: {
    capabilities: string[]
    context?: string[]
  }

  policy: {
    primitiveAllowList?: string[]
    sideEffects?: {
      network?: boolean
      browser?: boolean
      stateMutation?: 'runtime-only' | 'allowed'
    }
  }

  procedureRef: string

  knowledgeFragments?: Array<{
    id: string
    ref: string
    triggers?: string[]
  }>

  verification: VerificationContract

  output: {
    schemaId: string
  }
}
```

```ts
export interface CapabilityGrant {
  capabilityId: string
  implementationId: string
  constraints?: Record<string, unknown>
}
```

```ts
export interface WorkerCapabilitySurface {
  grants: CapabilityGrant[]
  tools: Record<string, unknown>
  primitiveAllowList: string[]
  contextRefs: string[]
  procedure: string
  outputSchemaId: string
  verification: VerificationContract
}
```

---

# 26. Runtime invariant tests

These should become non-negotiable SDK-level invariants.

### INV-01

A model cannot invoke an implementation merely because the implementation exists in the registry.

### INV-02

A model cannot invoke a primitive that is outside its compiled primitive grant.

### INV-03

Worker-visible capability surface is reproducible from:

```text
task + skill + policy + registry version
```

### INV-04

Every externally observable action produces a runtime event and provenance.

### INV-05

Raw tool output persistence does not depend on an LLM remembering to call a bookkeeping tool.

### INV-06

Finding acceptance does not depend solely on model prose.

### INV-07

Parent capability availability does not automatically imply child exposure.

### INV-08

Skill knowledge can be progressively disclosed without changing capability authority.

### INV-09

Capability authority can be narrowed without rewriting primitive implementations.

### INV-10

A worker completion response is not identical to semantic task acceptance.

---

# 27. What Ultimatrix already provides that is useful for the new SDK

Do not throw away the useful architecture while testing the skill redesign.

Strong reusable ideas in current master include:

- shared/live skill index;
- progressive skill-body loading;
- dynamic/lazy built-in capability registration;
- engagement-scoped services;
- typed task coordinator;
- task budgets and retries;
- worker attribution/events;
- compact parent/child result handoff;
- structured evidence ledger;
- centralized finding promotion;
- deterministic proof floor;
- graph/artifact references rather than stuffing everything into the parent prompt;
- model routing based on task metadata.

These are good ingredients.

The skill/capability compiler should be built **on top of them**, not as a separate competing framework inside Ultimatrix.

---

# 28. What this experiment should prove for the hackathon SDK

If the migration behaves as expected, you will have evidence for the following SDK thesis:

## 1. A registry is not a context window

The runtime may know 10,000 capabilities while a worker sees only 3–6.

## 2. Reusable primitives are not model-visible permissions

Many skills can share one HTTP implementation without sharing the same exposed capability surface.

## 3. Skills are procedural knowledge, not giant tool bundles

A skill describes how to approach a problem and what semantic abilities it requires.

## 4. Capability exposure is compiled

The worker surface is derived from task + skill + policy + runtime state.

## 5. Deterministic bookkeeping belongs to the harness

Evidence, provenance, telemetry, state projection, and session hydration should not consume reasoning bandwidth unnecessarily.

## 6. Planning and execution topology are separate

Skills produce logical procedure. The runtime chooses the physical execution strategy.

## 7. Progressive disclosure applies to both knowledge and capabilities

Do not push all knowledge or all executable affordances upfront.

## 8. Verification is a first-class contract

"Agent stopped" is not the same as "task succeeded."

---

# 29. Recommended immediate implementation sequence

If the goal is to get maximum learning with minimum code churn, use this order:

1. **Pin an E2E corpus and capture current metrics.**
2. **Implement scoped `runPrimitive`.**
3. **Remove automatic `CORE_TOOLS` only for experimental workers.**
4. **Migrate `authorization` to a compact contract/procedure.**
5. **Add actor/session references to HTTP execution.**
6. **Remove routine manual evidence recording from that migrated skill.**
7. **Run A/B on strong + small models.**
8. **Only if results are positive, introduce the general Capability Compiler.**
9. **Migrate two more skills with very different execution shapes.**
10. **Use the results to freeze the SDK abstractions.**

This sequence prevents designing the SDK purely from intuition.

---

# 30. Success criteria for the Ultimatrix experiment

I would consider the restructuring validated if the experimental worker shows most of these:

- >50% reduction in visible tool/schema tokens for specialized workers;
- unrelated primitive IDs completely absent from model-visible schema;
- zero successful execution of an undeclared primitive;
- lower irrelevant-tool-call rate;
- fewer model calls for routine request/parse/evidence flows;
- equal or higher task completion;
- equal or higher finding acceptance quality;
- no increase in unsupported finding promotion;
- lower prompt size;
- materially improved small-model reliability;
- no capability loss when the parent discovers a useful implementation, because the compiler can selectively grant it.

The exact percentages should be learned from the experiment rather than hard-coded into the SDK design.

---

# 31. Bottom line

The current Ultimatrix repository has already moved in several directions that support the new runtime thesis: progressive skill loading, shared registries, typed task state, compact worker handoff, runtime events, structured evidence, and deterministic finding gates.

The remaining skill mechanism still contains the most useful architectural failure to study:

```text
Skill declares policy
        ↓
tool filter exposes generic tool
        ↓
generic tool exposes global capability universe
```

The restructuring should make it:

```text
Skill contract
        +
Task requirements
        +
Capability registry
        +
Runtime policy
        ↓
Capability Compiler
        ↓
Worker-specific facade
        ↓
Reusable generic implementation
```

The key invariant for the new SDK is therefore:

> **Skills may share the same underlying implementations, but they must not automatically share the same model-visible authority.**

That is the experiment worth running inside Ultimatrix before freezing the hackathon SDK architecture.
