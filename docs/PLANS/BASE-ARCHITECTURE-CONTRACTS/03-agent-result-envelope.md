# 03. Agent Result Envelope (F3)

## Goal

A typed envelope is the ONLY thing crossing agent boundaries — worker results stop being a string, and every artifact a worker produced becomes mechanically visible to the evidence ledger and the brain.

## Current State

- Pool returns full `GenerateResult` (`pool.ts:179-180`) but executor reads only `.text` (`worker-pool-executor.ts:26-32`) → `bridgeWorkerToolCall/Evidence` (src/council/evidence-bridge.ts) have zero worker-path callers.
- `ToolResultStore.store()` has zero callers; brain's `getToolResult` always "not found" (brain-tools.ts:73-81).
- Swarm chaining slices prior results to 200 chars (spawn-swarm.ts:109); parallel swarms share nothing. spawn-worker/swarm informed-task builders are near-duplicates with diverging fields.
- Workers receive no brain-side intelligence (no reflexion failedPaths / evolution summary / recent discoveries).

## Gaps Addressed

D3 stringly-typed seams.

## In Scope

1. `WorkerExecutionEnvelope` type: {workerId, text, toolCalls[], findingsCount, nodesAdded, evidenceRefs[], graphRefs[], resultRef?}.
2. Executor builds it; bridges toolCalls into coreEvidenceLedger via existing bridge functions (invariant I3).
3. Full result persisted through ToolResultStore.store(); envelope carries compact resultRef; brain `getToolResult` works.
4. Swarm: sequential chains pass prior envelope (resultRef + typed findings), parallel passes envelopes too.
5. Single `buildInformedTask` helper (dedupe spawn-worker/swarm; swarm gains tags).
6. Worker informed-task appends compact brain-state block: evolution summary (top promoted/demoted), reflexion failed-paths (do-NOT-retry list), recent discoveries counts.

## Out of Scope

Council execution path changes. Legacy pool paths.

## Failure Modes

- Envelope bloat → toolCalls bridged then dropped from the returned object; only refs travel upward
- Bridge double-counts with explicit worker recordEvidence calls → bridge dedupes on (toolName+args hash)

## Acceptance Criteria

- [ ] I3 contract test green
- [ ] getToolResult returns stored worker output (test)
- [ ] Swarm second worker receives full prior findings via ref read-back (test)
- [ ] tsc/tests/build green
