# 01. Service Ownership (F1)

## Goal

One ownership contract for engagement-scoped services: anything an agent/tool needs at runtime resolves from the `EngagementServices` container (AsyncLocalStorage), with module-level globals demoted to legacy-fallback only.

## Current State

- The right pattern exists and is partially adopted: `EngagementServices` (src/runtime/engagement-context.ts:40-66) carries ~28 services; `runWithEngagementServices` scopes them per operation.
- **Evidence gate is already scoped**: `getFindingState()` resolves `EngagementServices.findingState` with a legacy fallback (`control-tools.ts:29-45`); `setEvidenceGateForFindings`/`getGlobalEvidenceGate` are context-aware. Constructed at engagement-runtime.ts:215 (`findingState.evidenceGate: null`).
- NOT scoped: model selector availability inside spawn tools (ctor-arg only — council path omits it), captured-request store, evolution counters. Captured-store/evolution scoping deferred to F2/F3 where their seams are touched.
- Unverified: whether every solver/web/CLI entrypoint actually wraps execution in the ALS context (tools resolving services during brain streams depend on it).

## Gaps Addressed

D1 wiring-by-global-state: gate swaps become per-engagement by construction; missing service slots formalized.

## In Scope

1. Contract test proving gate isolation between two concurrent-ish engagement contexts + legacy fallback behavior (invariant I1).
2. ALS-context audit: lifecycle/web-engine/solve entrypoints wrap tool-executing operations in `runWithEngagementServices`; unwrap any that don't.
3. `EngagementServices.modelSelector?: ModelSelector`; spawn-worker/spawn-swarm/run-task-graph resolve selector as ctor-arg → engagement → undefined.
4. Ownership rule documented in AGENTS.md: new capabilities register in EngagementServices, never module state.

## Out of Scope

Legacy engine files (frozen). Captured-request/evolution scoping (deferred to F3 seams). Council factory changes (F2 covers selector sharing).

## Failure Modes

- Services object constructed without new optional fields → fields optional, no breakage
- ALS context lost across async boundaries (e.g., un-awaited callbacks) → contract test spawns via the same paths production uses

## Acceptance Criteria

- [ ] I1 test green
- [ ] Spawn tools resolve selector from engagement when ctor arg absent (test)
- [ ] tsc/tests/build green
