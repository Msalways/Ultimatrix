# 05. Orchestration and Terminal Lifecycle

**Status:** IMPLEMENTED

## Goal

Make crawl and playbook orchestration return one authoritative terminal result, and ensure every planned execution type has a real production executor.

## Spider Terminal Ordering

The successful path must execute in this order:

```text
consume final graph diff
-> determine stop reason
-> runtime.stop(reason)
-> terminalState = runtime.snapshot()
-> persist reachability from terminalState
-> checkpoint workflow/ledger/graph
-> emit completion containing terminalState
-> return terminalState
```

Error and abort paths use the same `finalizeSpiderRun()` function. Finalization is idempotent; the first terminal outcome wins. No caller takes an independent final snapshot.

```typescript
interface SpiderRunResult {
  state: SpiderRuntimeState
  outcome: WorkflowOutcome
  checkpointId: string
}
```

CLI and Web attach `result.state`, not a separately queried runtime snapshot.

## Playbook Execution

`runAdvancedPlaybook` must be constructed with runtime dependencies rather than exported as a context-free singleton tool:

```typescript
function createAdvancedPlaybookTool(runtime: EngagementRuntime): MastraTool
```

The runner dispatches by typed execution mode:

- `primitive`: run through the primitive executor.
- `worker`: validate `skillId`, activate worker-scoped skill, and delegate through `runtime.workers`.
- Unknown execution modes fail before the run.

Worker results use the existing compact result contract plus evidence, decision, and graph references. A missing delegate is a construction error, not a runtime skip in production. Unit tests may inject an explicit no-delegate fake.

## Cancellation and Failure

- Abort signals propagate into primitive and worker execution.
- Candidate state is `planned | running | completed | failed | aborted`; skipped is reserved for explicit policy or user decisions.
- Worker failure is recorded and does not become a successful playbook result.
- Checkpoint after each completed candidate supports resume without rerunning completed work.

## Resume

Persist playbook ID, planning decision, candidate state, worker IDs, evidence refs, and outcomes. Resume validates target, workflow, provider, catalog version, and capability availability before continuing.

## Remove

- Context-free `runAdvancedPlaybookTool` production construction.
- Successful-path pre-stop snapshots.
- Production behavior that silently skips a worker candidate because wiring is absent.

### Implemented

- Production construction is only available through `createRunAdvancedPlaybookTool(coordinator)`.
- The context-free singleton and its legacy registry/metadata entries were removed.
- Worker candidates delegate through `TaskCoordinator.run()` and surface failed task status as an unsuccessful result.
- Spider success, abort, and failure converge on one memoized finalizer. It seals one terminal snapshot, persists it, checkpoints through the owning runtime, emits completion, and returns `{ state, outcome, checkpointId }`; the first terminal outcome wins.
- CLI, WebEngine, and target-backed SessionLifecycle consume that result and no longer perform independent post-run snapshots or duplicate saves.
- CLI resume loads the persisted workflow through `SessionLifecycle`; engine construction recovers interrupted durable tasks before exposing orchestration tools. `TaskGraphRunner.resume()` validates the stored graph and never repeats completed tasks.

## Tests

- All spider stop reasons return, emit, and persist byte-equivalent normalized state.
- Repeated finalization does not duplicate events or persistence.
- Worker candidate delegates exactly once with the expected skill and task.
- Invalid skill, missing runtime delegate, failure, cancellation, and resume are covered.
- A mixed primitive/worker plan preserves order and checkpoint state.

## Acceptance Criteria

- One finalizer owns all spider terminal behavior.
- Every production playbook execution mode has a required executor at construction.
- Resume never repeats a completed candidate unless explicitly requested as a retest.
