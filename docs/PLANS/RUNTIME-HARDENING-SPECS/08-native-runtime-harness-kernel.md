# 08. Native Runtime Harness Kernel

**Status:** SLICES A-F IMPLEMENTED

## Goal

Build Ultimatrix's own runtime discipline using architectural lessons from mature agent CLIs without replacing Ultimatrix with them. The orchestrator remains free to propose goals, task graphs, models, skills, and replans. A deterministic kernel owns task identity, lifecycle, persistence, budgets, cancellation, and result attribution.

## Boundary

```text
LLM Orchestrator
  -> typed task proposals and graph revisions
TaskCoordinator
  -> validates dependencies, policy, budgets, and lifecycle
HarnessAdapter
  -> executes one assignment through Mastra or another configured runtime
CapabilityCatalog
  -> metadata search, activation, tool view, connector session
WorkflowStore + EvidenceLedger + GraphStore
  -> canonical durable state
```

Harnesses are replaceable executors, not owners of engagement truth. Domain state never depends on a harness conversation transcript.

## Runtime Invariants

1. A task exists before a worker is created and has an ID stable across retries.
2. A worker ID identifies one execution attempt, not the durable task.
3. Every transition is checkpointed: `queued -> running -> terminal`.
4. Terminal states are `completed | partial | blocked | failed | timed_out | cancelled | budget_exceeded | budget_unverifiable`.
5. Cancellation and deadlines reach the underlying executor through `AbortSignal`.
6. Results are typed and compact; evidence and graph changes are referenced by IDs.
7. Context is passed as references plus a bounded task-local view, not ambient global state.
8. The LLM may revise the task DAG, but deterministic validation rejects cycles, unresolved dependencies, invalid capabilities, scope violations, and exhausted budgets.
9. Resume never assumes a pre-restart execution is still running. Reconciliation explicitly fails or requeues it according to retry policy.
10. Skill selection, connector selection, and model selection are recorded decisions, not substring-derived facts.

## Canonical Contracts

`WorkflowState.tasks` is the durable task collection. `activeWorkers` remains a compatibility execution snapshot until all spawn paths migrate, after which it becomes derived state or is removed.

```typescript
interface HarnessAdapter {
  readonly id: string
  execute(task: TaskState, context: TaskContext, signal: AbortSignal): Promise<TaskExecutionResult>
}

interface TaskExecutionResult {
  workerId?: string
  status: 'completed' | 'partial' | 'blocked'
  summary: string
  evidenceRefs: string[]
  graphMutationRefs: string[]
  proposedTasks: TaskProposal[]
  usage: TaskUsage
}
```

The proof slice uses an injected executor function instead of an adapter interface. Add the interface only when a second real harness exists.

## Capability Loading

The capability catalog stores compact metadata for skills, tools, and connectors. Retrieval combines typed task requirements, graph state, prior outcomes, and semantic ranking. The LLM receives a shortlist and chooses capabilities through typed output. Full skill bodies and tool schemas load only after activation.

Keyword and regex matching may contribute low-confidence hints. They cannot activate a capability, authorize execution, or establish an observation.

## Context and Compaction

Keep these independently addressable:

- immutable policy and system instructions;
- task objective, criteria, and dependency results;
- graph/evidence references;
- task-local conversation history;
- disposable tool chatter.

Compaction may rewrite only conversation history and disposable chatter. It must preserve task state, unresolved questions, decisions, evidence references, budgets, and approvals structurally.

## Delivery Slices

### Slice A: Lifecycle Proof

- Add versioned durable tasks to `WorkflowState` with v1 migration.
- Add `TaskCoordinator.run()`, cancellation, timeout propagation, terminal checkpoints, evidence references, and interrupted-run reconciliation.
- Verify using a real `WorkflowStore` and a fake external executor only.

Implemented on 2026-08-13. Verification: 30 focused runtime/workflow tests, 9 architecture evals, 2,073 full-suite tests, and the CLI/DTS build pass. The timeout test exposed and fixed a race where the deadline could fire during checkpoint persistence before the executor subscribed to cancellation.

### Slice B: WorkerPool Adapter

- Give `WorkerPool` an abort-aware managed execution method returning the actual worker ID.
- Route `spawnWorker` and `spawnSwarm` through `TaskCoordinator`.
- Delete their direct `spawn() -> generate()` paths.
- Persist model routing, usage, worker attempt, and compact result on the task.

Implemented on 2026-08-13. `WorkerPool.executeManaged()` propagates `AbortSignal` into Mastra, reports the real attempt before generation, and cleans up deterministically. CLI solve, session lifecycle, WebEngine, supervisor, council, solver brain, and shared toolpack receive the workflow-owned coordinator. `spawnWorker` and `spawnSwarm` no longer contain direct spawn/generate paths. Provider-authoritative task usage and budget enforcement were completed in Slice F.

Vertical verification also found that both tools declared plain output schemas while returning `{ ok, value }`; Mastra therefore rejected successful results. Their return values now match their declared schemas. Verification: 22 focused runtime/wiring/eval tests, TypeScript no-emit, CLI/DTS build, and 2,077 full-suite tests across 202 files pass.

The final bypass audit completed on 2026-08-14. Interactive `/council` execution now uses the workflow-owned coordinator and preserves model routing and deadlines on the durable task. `WorkerPool.spawn()` is private, obsolete public `execute()`/`dispatchSlices()` entry points were removed, and `executeManaged()` is called only by the coordinator adapter. An architecture invariant test guards this boundary. Final verification: 2,095 full-suite tests across 205 files, TypeScript no-emit, CLI/DTS build, and diff hygiene pass.

### Slice C: Dynamic Task Graph

- Accept typed task proposals from solver and council.
- Validate IDs, dependencies, cycles, capability availability, policy, and budgets.
- Schedule only ready tasks with bounded concurrency.
- Feed typed results back to the orchestrator for replan or conclusion.

Implemented on 2026-08-13. The shared orchestration surface now exposes a typed task-graph executor to solver, supervisor, and council. It validates stable and existing IDs, skills, dependencies, self-dependencies, cycles, numeric task budgets, and parallelism before model routing or persistence. A valid graph is persisted in one workflow checkpoint before dispatch; ready tasks run with bounded parallelism, and downstream tasks unlock only after accepted dependencies complete.

Runtime-verifiable acceptance currently supports non-empty bounded summaries and minimum evidence-reference counts. Failed acceptance marks a task partial, blocks dependent work, and returns typed `needs_replan` reasons and unresolved IDs to the orchestrator. Dependency context is passed as bounded structured task summaries and evidence references rather than transcript concatenation. LLM-facing instructions describe capabilities rather than hardcoded tool IDs, and the prompt anti-hardcoding guard remains green.

Verification: 40 focused DAG/runtime/prompt/eval tests, TypeScript no-emit, CLI/DTS build, and 2,082 full-suite tests across 203 files pass.

Authorization remains at scope-aware tool and execution boundaries because free-form task objectives are not authorization inputs. Task-level graph/evidence attribution and retry history were completed in Slice E; provider-authoritative usage enforcement was completed in Slice F.

### Slice D: Lazy Capabilities and Connectors

- Establish one capability catalog and connector lifecycle manager.
- Load metadata first and definitions on activation.
- Build per-task tool views after policy, availability, budget, and connector health checks.
- Remove keyword-only activation and duplicate tool-discovery paths.

Implemented on 2026-08-13 for the native solver runtime. `SkillRegistry` is now the exact-ID catalog and worker activation boundary; unknown worker skills fail before agent construction. CLI, terminal, WebEngine, council, and workers share an engagement-owned `DynamicToolRegistry`. Connector listing is metadata-only, exact discovery/load/invocation is lazy, concurrent opens are deduplicated, health is typed, and lifecycle cleanup closes the engagement registry. Process-global acquired-tool mutation was removed because it could not update an already-constructed Mastra agent; extension calls now use the stable `invokeTool` gateway.

Free-form goal-to-skill body preload was deleted from terminal, WebEngine, and `solve()`. Search remains metadata-only and both public search surfaces use one scorer. Agent candidates (builtins, browser, and extras) are assembled before one final skill/role intersection, so appended tools cannot bypass the tool view.

Verification: 147 focused extension/council/runtime tests, 2,082 full-suite tests across 204 files, TypeScript no-emit, and the CLI/DTS build pass.

### Slice E: Context and Resume

- Add structured context assembly and compaction checkpoints.
- Add retry policy, attempt history, waiting-for-input state, and restart reconciliation.
- Verify concurrent tasks cannot misattribute graph or evidence changes.

Implemented on 2026-08-13. Workflow state v3 persists bounded structured context checkpoints, typed retry policy, complete attempt history, waiting-for-input state, graph references, and evidence references. Dependency context uses section-aware compaction and bounded typed references; it never copies raw evidence or transcripts into task state.

`TaskCoordinator` now checkpoints queued, running, waiting, and terminal attempt states; retry decisions use typed statuses rather than error text. Waiting tasks resume explicitly with an optional context reference. Startup reconciliation runs in CLI, Web/session engine setup, and AgentManager: interrupted attempts become `interrupted`, retryable work returns to `planned`, and non-retryable work fails closed. The task-graph tool can resume exact persisted IDs or all unfinished work without repeating completed tasks.

Graph and evidence mutations are attributed through task-local async context at the real `GraphStore`, `LibSQLGraphStore`, and `EvidenceLedger` boundaries. Concurrent workers therefore cannot claim each other's references. Version 1 and 2 snapshots migrate to v3 with conservative single-attempt/no-retry defaults.

Verification: 178 focused runtime/workflow/graph/evidence/eval tests, 2,089 full-suite tests across 205 files, TypeScript no-emit, and the CLI/DTS build pass.

### Slice F: Provider Usage and Task Budgets

- Attribute each model request to its task through task-local async context.
- Persist provider-reported input/output totals per attempt and cumulatively per durable task.
- Apply one token allowance across retries and stop budget terminal states from retrying.
- Fail budgeted work closed when any provider call omits authoritative usage.
- Return compact usage counters from the public task-graph tool.

Implemented on 2026-08-14. Model middleware remains active when rate limiting is disabled, so accounting cannot be bypassed by configuration. Every request is counted; `doGenerate` responses and terminal `doStream` finish events contribute provider-reported tokens, including authoritative totals that may contain reasoning overhead. Calls without usage make a budgeted task `budget_unverifiable`. Reaching the remaining allowance aborts the attempt as `budget_exceeded`, and usage survives workflow reload.

Verification: 37 focused middleware/runtime tests, 2,094 full-suite tests across 205 files, TypeScript no-emit, and the CLI/DTS build pass.

## Non-Goals

- Copying Codex or Claude Code implementations.
- Hardcoding workflows for vulnerability classes or targets.
- Building a generic distributed queue before local restart/resume is proven.
- Supporting multiple harnesses before the native Mastra path obeys the contract.
- Treating successful model text as task acceptance or finding proof.

## Current Limitations

- Provider token usage is available only after a model call completes. The runtime stops immediately after the threshold is reached, but a single call can cross the limit; preventing that requires provider-specific preflight token estimation or reservation.
- Scope and approval policy remain enforced by callable tool/execution boundaries; task objective text never grants authorization.

## Acceptance Criteria

- A persisted task shows every externally visible state transition.
- Timeout and cancellation abort the executor rather than only abandoning its promise.
- Evidence references survive reload without raw evidence in task state.
- Interrupted queued/running tasks reconcile deterministically.
- Worker and task IDs remain distinct.
- Provider-reported task usage survives retries and reload, and missing usage fails a budgeted task closed.
- Production completion requires removal of every direct worker execution bypass.
