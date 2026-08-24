# Runtime Wiring and Hardcoded Heuristic Gaps

**Status:** SUPERSEDED BY RUNTIME-HARDENING SPECS; RELEASE BLOCKERS IMPLEMENTED, DEFERRED ITEMS REMAIN  
**Audit date:** 2026-08-13  
**Scope:** Skill/runtime wiring and hardcoded decision heuristics. This audit does not propose changes to skill methodology content or payload libraries.

**Fix specifications:** [`RUNTIME-HARDENING-SPECS/README.md`](RUNTIME-HARDENING-SPECS/README.md)

---

## 1. Goal

Make progressive skill loading a coherent runtime lifecycle across CLI, Web, solver, council, workers, and legacy entrypoints.

The intended behavior is:

1. Initialize one metadata catalog.
2. Let the LLM discover skills on demand.
3. Activate a skill by exact ID.
4. Load its full body only after activation.
5. Apply its tool allow-list to the execution context.
6. Reject unknown skill and tool IDs.
7. Preserve activation state for the intended turn or session lifetime.

The current implementation completes some of these steps independently, but they are not connected into one end-to-end contract. The wider runtime also contains keyword and pattern heuristics that are useful for discovery but are allowed to influence stronger decisions than their evidence supports.

---

## 2. Current Runtime Flow

```text
CLI/Web goal
   -> substring search over the complete goal
   -> eagerly load up to three skill bodies
   -> append bodies to the solver prompt
   -> solver keeps its original complete tool pack

LLM calls loadSkillBody(skillId)
   -> full body returned as a tool result
   -> no active-skill state is recorded
   -> current tool set is not recalculated

LLM calls spawnWorker(skillId)
   -> skill ID is not validated at the spawn boundary
   -> body is loaded if found
   -> worker receives CORE_TOOLS plus declared toolRefs
   -> extra and browser tools are added after filtering
```

---

## 3. Confirmed Skill Wiring Gaps

### G1. CLI solve uses an uninitialized injected registry

**Severity:** Critical

`src/cli/solve.ts` constructs `SkillRegistry` and passes it to `WorkerPool` and `createSolverBrain`, but never calls `loadFromDirectory()`. Session setup initializes its registry correctly.

The failure is partially hidden because `listSkills`, `searchSkills`, and `loadSkillBody` use the global loader rather than the injected registry. Discovery can therefore appear functional while injected-registry consumers see zero skills.

**Affected paths:**

- `src/cli/solve.ts`
- `src/session/engine-setup.ts`
- `src/tools/skill-tools.ts`

### G2. CLI and Web bypass true on-demand selection

**Severity:** High

`src/session.ts` and `src/web/engine.ts` search the complete free-form goal, select up to three matches, and eagerly load their bodies before calling `solve()`.

This conflicts with the documented design that the brain should use discovery tools and decide which skill to load. It also causes entrypoint-dependent behavior because direct CLI solve does not use the same preload pipeline.

### G3. Skill loading is not skill activation

**Severity:** High

`loadSkillBody` returns instructions and metadata, but it does not create an `ActiveSkill` runtime record, define its lifetime, update the current execution context, or emit an activation event.

The loaded body is only conversation data. A later independent solve has no authoritative state indicating that the skill remains active.

### G4. Matched skills only modify the prompt

**Severity:** High

`matchedSkills` is converted into a methodology block and appended to `enrichedGoal`. The solver brain is created once with `buildToolPack()` and is not rebuilt or filtered when matched skills change.

Consequently, `toolRefs` do not control the solver brain's available tools.

### G5. Worker spawning accepts unknown skill IDs

**Severity:** High

`createSpawnWorkerTool()` receives a `SkillRegistry`, but does not validate `skillId`. `WorkerFactory` accepts a missing body and creates a generic worker. The unknown ID then resolves to the core tool set instead of failing closed.

The same boundary is used by swarm execution.

### G6. The invariant core tool set is too broad

**Severity:** High

`CORE_TOOLS` includes discovery, graph mutation, finding operations, primitives, campaign execution, recon operations, and other capabilities. A worker therefore receives a large execution surface even when its skill declares only a small set of `toolRefs`.

This makes tool filtering technically active but functionally weak.

### G7. Tools are added after allow-list filtering

**Severity:** Medium

`createAgent()` computes its filtered registry first, then appends `extraTools` and wrapped browser tools. These additions bypass the effective skill and council allow-list.

A restriction can therefore narrow registry tools without narrowing the complete tool surface exposed to the agent.

### G8. Skill discovery has multiple sources of truth

**Severity:** Medium

Search behavior is implemented separately in:

- `SkillRegistry.search()`
- loader `searchSkills()`
- manager `createSkillSearchTool()`
- `TechniqueRegistry.searchSkills()`

They inspect different metadata and use different scoring. The same catalog and query can produce different results depending on the entrypoint.

### G9. Registry initialization is inconsistent across entrypoints

**Severity:** Medium

Session setup, Web setup through session services, legacy `AgentManager`, the API route, Mastra workspace, and direct CLI solve do not share one construction function. Some explicitly initialize the registry and some rely on the global loader.

This makes initialization correctness dependent on which command created the runtime.

### G10. Existing tests do not prove the vertical lifecycle

**Severity:** Medium

The matched-skills test manually performs `search -> loadSkill`. It does not invoke a real CLI/Web entrypoint, activate a skill, inspect the resulting agent tool set, spawn a worker, or verify rejection of an unknown ID.

Tool-filter tests prove set composition in isolation, not the final tools exposed after browser and extra-tool injection.

---

## 4. Hardcoded Heuristic Findings

Not every regex, marker, or substring check is a defect. Structural parsing remains appropriate for protocol syntax, content types, identifiers, exact generated-marker reflection, status codes, and vendor fingerprints.

The problematic boundary is:

```text
keyword or pattern
   -> treated as target semantics or successful behavior
   -> stored or routed as if it were observed truth
   -> used to confirm a finding without an independent semantic proof
```

### H1. Keyword-based oracles can produce confirmed false positives

**Severity:** High

The GraphQL BOLA oracle treats generic email, role-like, secret-like, or `node` fields as cross-user disclosure signals. The resulting claim is then checked by an evidence gate that commonly validates endpoint, method, and status co-occurrence rather than ownership of the returned object.

**Affected paths:**

- `src/primitives/graphqlBola.ts`
- `src/intelligence/evidence-ledger.ts`
- `src/primitives/framework.ts`

### H2. Static response markers are used as exploit confirmation

**Severity:** High

NoSQL and RCE-class primitives use generic response strings such as denial vocabulary, `49`, `uid=`, `root:`, or `polluted`. These values are not consistently proven to be absent from a baseline or causally produced by the current mutation.

**Affected paths:**

- `src/primitives/nosqlInjection.ts`
- `src/primitives/rceClass.ts`
- `src/primitives/internalStateDisclosure.ts`

### H3. Generic HTTP success can become security-impact success

**Severity:** High

`assessAccess()` defaults to treating 2xx responses as granted and uses English success/denial markers as secondary signals. Several callers use that outcome to decide whether an operation succeeded. A localized denial page or a `200` error envelope can therefore be misclassified.

**Affected paths:**

- `src/primitives/framework.ts`
- `src/primitives/bolaFuzzer.ts`
- `src/primitives/authBypass.ts`
- `src/primitives/workflowBypass.ts`

### H4. Campaign routing is driven by fixed endpoint vocabulary

**Severity:** Medium

Campaign signals recognize endpoint purpose through fixed path segments, parameter-name lists, and primitive tags. The `hasParams` fallback also makes a broad set of primitives relevant to nearly every parameterized endpoint, weakening target-specific planning.

**Affected path:** `src/campaign/planner.ts`

### H5. Graph semantics are inferred from English names and URL fragments

**Severity:** Medium

Workflow type, state changes, entity ownership, role fields, sensitive fields, and endpoint use cases are derived from configured English vocabulary and URL fragments. These values can later feed structured hypothesis generation even though their source was heuristic.

**Affected paths:**

- `skills/registry.json`
- `src/skills/technique-registry.ts`
- `src/research/entity-extractor.ts`
- `src/research/workflow-extractor.ts`
- `src/analysis/analyser.ts`

### H6. Free-text matching controls tool and strategy routing

**Severity:** Medium

Attack-path matching, tool inference, primitive resolution, failure classification, and follow-up selection use substring checks over task or response text. These functions are spread across multiple layers, so behavior depends on vocabulary rather than one typed routing decision.

**Affected paths:**

- `src/skills/technique-registry.ts`
- `src/tools/tool-selector.ts`
- `src/solver/exploitation-loop.ts`
- `src/intelligence/reflexion.ts`

### H7. Heuristic provenance is not preserved strongly enough

**Severity:** Medium

The graph and downstream planners do not consistently distinguish a keyword-derived hint from a captured observation or a controlled proof. Once converted into a typed property, a heuristic may appear more authoritative than its source warrants.

### H8. Tests encode positive keyword examples but miss adversarial shapes

**Severity:** Medium

Current focused tests generally assert that expected vocabulary is recognized. Missing cases include:

- Generic `200` denial/error bodies.
- Localized or custom success and denial responses.
- A baseline that already contains the expected static marker.
- Ordinary GraphQL objects containing email or role fields.
- Valid targets with nonstandard or non-English endpoint and parameter names.
- Unknown endpoint semantics that must remain inconclusive.

---

## 5. Heuristic Decision Boundary

All derived knowledge should carry an authority level:

```typescript
type KnowledgeAuthority = 'hint' | 'observed' | 'proven'

interface DerivedKnowledge<T> {
  value: T
  authority: KnowledgeAuthority
  source: 'keyword' | 'llm' | 'capture' | 'experiment'
  evidenceRefs: string[]
  confidence?: number
}
```

Rules:

- Keyword, regex, URL-name, parameter-name, and LLM classifications create `hint` values only.
- Captured requests, responses, browser events, and graph relationships create `observed` values.
- A controlled baseline/mutation experiment with a satisfied oracle creates `proven` values.
- Hints may rank discovery candidates but cannot independently create findings, state transitions, ownership claims, or access verdicts.
- Unknown behavior must remain `inconclusive`; it must not default to success.
- Finding verification must validate the semantic oracle, not only the request URL, method, and status.

---

## 6. Core Architecture Integrity Gaps

These are correctness and production-wiring defects discovered during the broader architecture audit. They are separate from skill selection and heuristic classification.

### A1. A direct finding path can bypass proof enforcement

**Severity:** Critical

`addFinding` remains exposed through the shared tool pack and spider tooling. The report generator excludes findings only when `proofCheck.passed === false`; a finding with no `proofCheck` remains eligible.

This means the existence of the proof-gated `writeFinding` path does not make proof enforcement universal.

**Affected paths:**

- `src/core/toolpack.ts`
- `src/spider/agent.ts`
- `src/report/generator.ts`

### A2. Spider completion returns a pre-terminal snapshot

**Severity:** High

The successful spider path snapshots state, persists reachability, and saves the graph before assigning the fallback stop reason and calling `runtime.stop()`. It then returns the earlier snapshot.

The returned and attached workflow state can therefore omit the terminal `stopReason` even though the completion event contains it.

**Affected path:** `src/spider/runtime.ts`

### A3. Concurrent engines share mutable process-global state

**Severity:** Critical

Web engines share mutable scope configuration, workspace target/store selection, graph and OAST stores, browser state, decision ledger context, artifact listener, forensic logger, and other singleton services.

Starting or operating one engagement can overwrite the active context used by another engagement in the same process.

**Affected subsystems:**

- Web engine initialization and cleanup.
- Workspace and graph/OAST globals.
- Scope and external-tool policy globals.
- Decision ledger and artifact globals.
- Browser and observer globals.
- Forensic logging globals.

### A4. Decision ledger records are not durable

**Severity:** High

The decision ledger stores decisions and provenance in in-memory maps. `WorkflowState.decisionLedgerId` exists, but there is no durable ledger save/load contract connected to that reference.

Decision history therefore disappears across process restarts and cannot satisfy post-run inspectability by itself.

**Affected paths:**

- `src/security/decision-ledger.ts`
- `src/workflow/types.ts`
- `src/workflow/store.ts`

### A5. Production entrypoints bypass the browser-provider abstraction

**Severity:** High

CLI and Web record `config.browser.provider` in workflow state but instantiate the browser through `getOrCreateBrowser()`. The provider abstraction is therefore not the authoritative production creation path.

The persisted provider name can describe a provider that did not actually create the runtime browser.

**Affected paths:**

- `src/cli/solve.ts`
- `src/web/engine.ts`
- `src/browser/provider.ts`

### A6. Reachability persistence rewrites historical identity metadata

**Severity:** High

`persistReachability()` iterates historical records but assigns `state.currentIdentity` metadata to every record. If identity changed during the crawl, earlier observations can be persisted with the final identity, role, or tenant.

**Affected path:** `src/spider/runtime.ts`

### A7. Advanced playbook worker candidates have no production delegate

**Severity:** High

The public `runAdvancedPlaybook` tool invokes the runner without `delegateWorker`. Candidates classified for worker execution are reported as skipped rather than routed through the existing worker pool.

**Affected paths:**

- `src/orchestration/tools.ts`
- `src/orchestration/playbook-runner.ts`

### A8. Workflow persistence can retain secret-bearing raw URLs

**Severity:** High

Spider state includes target, frontier, endpoints, pages, forms, scope proposals, and other URL-bearing records. Decision and report paths use URL redaction, but workflow snapshot persistence does not consistently redact the complete state before durable storage.

Query parameters, fragments, embedded credentials, and signed URLs may therefore survive in `workflow.json`.

**Affected paths:**

- `src/spider/runtime.ts`
- `src/workflow/store.ts`
- `src/security/secret-vault.ts`

---

## 7. SDK and Competitive Product Gaps

These are capability and maturity gaps. They should not be treated as confirmed runtime bugs unless their current API contract claims otherwise.

### P1. SDK hypotheses are converted directly into findings

**Severity:** High product risk

The SDK `generate()` path converts analysis hypotheses into open findings with empty evidence. It does not use the runtime proof-gated finding lifecycle.

**Affected path:** `src/sdk.ts`

### P2. SDK replay does not execute tests

**Severity:** High product gap

`replay()` loads generated tests but returns every test as skipped with `executed: false`. The SDK therefore exposes a replay API without execution infrastructure.

**Affected path:** `src/sdk.ts`

### P3. Worker sandboxing is logical only

**Severity:** High product gap

Tenant and sandbox identifiers scope bookkeeping and workspace state, but workers are not isolated by an OS process, container, filesystem jail, or network policy boundary.

**Affected path:** `src/workers/pool.ts`

### P4. Case-file output is not a complete replayable submission artifact

**Severity:** Medium product gap

The current case file aggregates findings and engagement metadata, but the audited flow does not guarantee a complete baseline, mutation, actor/state context, proof oracle, replay command or script, retest outcome, and decision trace for every finding.

### P5. No remediation worktree and PR pipeline is implemented

**Severity:** Medium product gap

No complete flow was found for generating a patch in an isolated worktree, point-retesting the change, preparing a PR, and requiring explicit user approval before publication. This remains an intended capability rather than current wiring.

### P6. Scan-oriented CI integration is missing

**Severity:** Medium product gap

The repository contains release automation, but no audited CI workflow that runs an Ultimatrix assessment, resumes or stores engagement artifacts, and emits machine-readable verified results for merge gating.

### P7. Reproducible competitive benchmarks are not published

**Severity:** High competitive gap

The repository has tests and architecture evals, but no published benchmark suite that reports verified-finding recall, false positives, replay success, coverage, runtime, and cost in clean repeatable environments comparable to the referenced competitors.

---

## 8. Target Wiring

```text
Runtime bootstrap
   -> create one SkillCatalog from metadata
   -> inject the same catalog into every engine and tool

LLM discovery
   -> listSkills or searchSkills
   -> metadata results only

LLM activation
   -> activateSkill(exactSkillId, lifetime)
   -> validate ID against SkillCatalog
   -> load body on demand
   -> persist ActiveSkill in execution state
   -> derive allowed capability IDs

Execution context
   -> assemble all candidate tools
   -> include browser, extension, and role-specific tools
   -> apply one final allow-list intersection
   -> reject unknown references

Worker delegation
   -> require an active or explicitly selected valid skill
   -> construct worker from the same catalog and activation record
   -> expose minimal invariant tools plus declared capabilities

Completion
   -> deactivate turn-scoped skills automatically
   -> retain session-scoped skills only when explicitly requested
```

---

## 9. Required Runtime Contracts

The implementation needs one authoritative catalog and an explicit activation record. Names are illustrative; behavior is mandatory.

```typescript
interface SkillCatalog {
  list(): SkillMeta[]
  search(query: string): SkillMeta[]
  get(skillId: string): SkillMeta | undefined
  load(skillId: string): Skill | undefined
}

interface ActiveSkill {
  skillId: string
  activatedBy: 'llm' | 'user' | 'system'
  lifetime: 'turn' | 'session' | 'worker'
  toolRefs: string[]
  activatedAt: number
}

interface ToolViewRequest {
  role: 'brain' | 'council' | 'worker'
  activeSkills: ActiveSkill[]
  explicitToolIds?: string[]
}
```

Rules:

- Discovery never loads full bodies.
- Loading never silently activates a skill.
- Activation requires an exact catalog ID.
- Unknown skill IDs fail before agent construction.
- All tool sources are assembled before the final allow-list is applied.
- Unknown tool references fail closed during agent construction.
- The minimal invariant tool set contains only lifecycle, discovery, evidence, and required control tools.

---

## 10. Repair Order

- [ ] 1. Add one shared registry/catalog factory and use it in every entrypoint.
- [ ] 2. Initialize the direct CLI solve registry through that factory.
- [ ] 3. Remove automatic goal-to-skill preloading from CLI session and WebEngine.
- [ ] 4. Add explicit skill activation state with defined turn/session/worker lifetime.
- [ ] 5. Make worker and swarm spawn validate exact skill IDs before routing or model selection.
- [ ] 6. Reduce `CORE_TOOLS` to the actual invariant minimum.
- [ ] 7. Assemble browser, extension, role, and registry tools before applying the final allow-list.
- [ ] 8. Consolidate all search callers behind the shared catalog implementation.
- [ ] 9. Emit structured discovery, activation, deactivation, and rejection events.
- [ ] 10. Add vertical wiring tests across CLI, Web, solver, council, and workers.
- [ ] 11. Mark keyword and LLM-derived graph values as hints with explicit provenance.
- [ ] 12. Change access decisions to `granted | denied | inconclusive` and remove generic 2xx confirmation.
- [ ] 13. Require baseline/mutation oracle evidence for confirmed findings.
- [ ] 14. Replace static exploit markers with per-experiment values or correlated callbacks.
- [ ] 15. Restrict keyword routing to candidate ranking and use typed LLM selections for execution.
- [ ] 16. Add adversarial tests for localized, nonstandard, ambiguous, and baseline-collision cases.
- [ ] 17. Remove or gate every direct finding path so missing proof checks fail closed.
- [ ] 18. Stop the spider before taking, persisting, emitting, and returning its terminal snapshot.
- [ ] 19. Replace engagement-sensitive globals with workflow-owned service contexts.
- [ ] 20. Persist and restore decision/provenance records through the workflow ledger reference.
- [ ] 21. Route all production browser creation through the configured provider factory.
- [ ] 22. Persist the identity stored on each reachability record without final-state rewriting.
- [ ] 23. Wire advanced-playbook worker candidates to the existing validated worker delegate.
- [ ] 24. Redact the complete workflow snapshot at the durable persistence boundary.
- [ ] 25. Route SDK hypotheses through candidate and proof states instead of creating findings directly.
- [ ] 26. Either implement SDK replay execution or rename/remove the misleading replay contract.
- [ ] 27. Define optional real sandbox execution separately from logical tenant isolation.
- [ ] 28. Make case files self-contained and replayable for every included finding.
- [ ] 29. Add scan-oriented CI output with verified-result and artifact contracts.
- [ ] 30. Publish a repeatable benchmark harness and result schema before making comparative claims.

---

## 11. Acceptance Tests

1. Direct `ultimatrix solve` and WebEngine expose the same skill metadata catalog.
2. Starting a solve does not load any full skill body automatically.
3. `searchSkills` reads metadata only.
4. Activating a known skill loads its body once and records `ActiveSkill` state.
5. Activating or spawning with an unknown skill ID fails before agent creation.
6. A loaded but inactive skill does not modify the prompt or tool set.
7. An active skill changes the final tool view according to its declared `toolRefs`.
8. Browser and extra tools cannot bypass the final allow-list.
9. Brain, council, and worker roles receive their expected role restrictions after skill filtering.
10. Turn-scoped activation is removed after the turn; session-scoped activation survives the next turn.
11. Resetting the catalog invalidates metadata and full-body caches together.
12. Every declared `toolRef` resolves to one canonical registered tool ID.
13. A keyword-derived classification is persisted as a hint, never as an observation or proof.
14. A generic 2xx response without a semantic oracle remains inconclusive.
15. A static marker already present in the baseline cannot confirm a finding.
16. A mutation is confirmed only when its experiment-specific result is absent from baseline and present after mutation.
17. Cross-identity claims reference both actor identities and a victim-specific observed value or state change.
18. Non-English and nonstandard endpoint names remain discoverable through observations and LLM reasoning without requiring a vocabulary match.
19. Failure classification can return unknown/inconclusive without forcing a strategy category.
20. Finding verification fails when transport metadata exists but the claimed semantic oracle is absent.
21. No tool or graph API can persist a reportable finding without a passing proof check.
22. Successful, stopped, aborted, stale, limited, and error spider runs return the same terminal state that they persist and emit.
23. Two concurrent WebEngine instances cannot observe or overwrite each other's scope, stores, ledger, artifacts, logs, or workflow identity.
24. Decision and provenance records survive process restart and remain addressable from the workflow snapshot.
25. The recorded browser provider equals the provider instance that created the browser session.
26. Reachability observations before and after an identity transition retain their original identities.
27. A worker-designated playbook candidate delegates once and returns its structured result instead of being skipped.
28. Persisted workflows contain no raw credentials, sensitive query values, fragments, or signed URL secrets.
29. SDK hypotheses remain candidates until an execution produces passing proof evidence.
30. SDK replay either executes stored tests with honest results or is not exposed as executable replay.
31. A configured container sandbox proves filesystem, process, and network isolation; logical mode is labeled separately.
32. Every exported case-file finding can be replayed from its recorded prerequisites and evidence references.
33. CI output distinguishes verified findings, candidates, execution failures, and incomplete runs.
34. Benchmark runs record fixture version, model/provider, configuration, cost, duration, verified results, false positives, and replay success.

---

## 12. Verification Note

This document is based on static call-path inspection. Focused runtime tests could not be executed in the audit shell because `node` was not resolvable and the PowerShell `npx` shim was blocked by execution policy.

No skill methodology or payload-library changes are part of this gap report.
