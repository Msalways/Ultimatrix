# 02. Canonical Registries (F2)

## Goal

Every shared concept has exactly ONE live authority. Snapshots become read-through caches; nothing authorizes against stale state.

## Current State

- `SkillRegistry.loadFromDirectory(_dir)` ignores its argument and copies `initSkillIndex()` once (src/solver/skills/registry.ts:33-38). Gates that authorize spawning (`spawn-worker.ts:92`, `spawn-swarm.ts:126`, `task-graph.ts:53,121`) and loading (`factory.ts:39`, `pool.ts:119`) read the frozen copy — so a mid-session `manageSkills` import is invisible to workers while the brain sees it (shared-index tools are live).
- Three ModelSelector instances per possible session: engine-setup shared instance, council factory per-member news (factory.ts:214-235), toolpack fallback builder. Cooldown/quota/success-history diverge.

## Gaps Addressed

D2 dual registries.

## In Scope

1. SkillRegistry methods delegate live to loader (`has/load/list/search` call loader functions each time); constructor snapshot retained only for backward-compatible direct property reads, marked deprecated.
2. Contract test I2: manageSkills add → spawnWorker with user/<id> succeeds in-session.
3. Engagement-scoped selector: council factory + toolpack resolve `EngagementServices.modelSelector` when no ctor arg (builds on F1.3).
4. AGENTS.md rule: one canonical authority per concept.

## Out of Scope

Legacy specialist agents (frozen). Removing the registry class (delegation keeps API).

## Acceptance Criteria

- [ ] I2 test green
- [ ] Council + solver share one selector instance in an engagement (test)
- [ ] tsc/tests/build green
