# 04. Resource Claim Registry (F4)

## Goal

A typed, graph-backed claim contract so no two escalation paths fire against the same resource unaware of each other.

## Current State

- Three independent selection engines: ExploitationTracker agenda (escalation-state.ts:122-154), diagnosis/technique-planner ranking, campaign coverage matrix. All write through the same seam but share no in-flight coordination.
- Parallelism exists inside paths (swarm, campaign slices, task-graph maxParallel≤20) and across engines/sessions sharing the global store.
- `TECHNIQUE_TO_PRIMITIVE` hardcoded map in the escalation spine (exploitation-loop.ts:31-41) — frozen vocabulary.

## Gaps Addressed

D4 concurrency/claim contract + frozen-vocab violation in the spine.

## In Scope

1. `ClaimRegistry` on WorkflowStore state (persisted, survives resume): `claims: Array<{resourceKey, owner, purpose, claimedAt}>`; check-and-set API with TTL expiry; resourceKey = `${method}:${normalizedUrl}` or endpoint id.
2. Claim-before-fire: exploitation loop agenda items, playbook primitive candidates, campaign slices, spawned worker tasks (endpoint-scoped ones).
3. Contract test I4: two registries/paths claiming the same key — second gets `claimed:false` with owner info.
4. Technique resolution via registry metadata (`appliesTo`/tags match) with the frozen map demoted to last-resort fallback.
5. Claims released on completion/failure (owner reports), expired claims stealable.

## Out of Scope

Cross-process distributed locking (single-process semantics only). Rate limiting (exists per-host).

## Failure Modes

- Stale claims block progress → TTL + steal-on-expiry
- Over-claiming starves parallelism → claims are per-endpoint+purpose, not global
- Graph bloat → bounded array, evict oldest beyond N=200

## Acceptance Criteria

- [ ] I4 contract test green
- [ ] Technique→primitive resolution has no required frozen map path (test)
- [ ] tsc/tests/build green
