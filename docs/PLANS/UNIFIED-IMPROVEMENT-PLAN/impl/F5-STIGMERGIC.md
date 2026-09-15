# F5: Stigmergic Coordination Layer - Implementation Plan

**Phase**: F5 - Stigmergic Coordination Layer
**Status**: IN PROGRESS
**Priority**: HIGH
**Effort**: Medium (2-3 weeks)

---

## Overview

The Stigmergic Coordination Layer adds a pheromone-based coordination layer that enables emergent swarm behavior without central planning. Workers emit pheromones on discoveries; other workers follow trails, creating emergent attack chains.

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    PheromoneCoordination Layer                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  PheromoneCoordinator (singleton)                                           │
│  ├─ emit(signal)           → emit pheromone on target                      │
│  ├─ subscribe(worker, types, handler)  → subscribe to signal types         │
│  ├─ getSignals(targetId)  → get active signals on target                   │
│  ├─ getStrongestSignal()  → strongest signal of type on target             │
│  ├─ decay()                → exponential decay + TTL sweep                 │
│  └─ getPheromoneStrength(targetId)  → aggregate strength                   │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PheromoneScheduler (replaces maxParallel)             │
├─────────────────────────────────────────────────────────────────────────────┤
│  PheromoneScheduler                                                        │
│  ├─ enqueue(task, basePheromone) → score = base + pheromoneBoost         │
│  ├─ dequeue() → highest pheromone task (respects maxConcurrency)          │
│  ├─ complete(taskId, success) → releases slot                            │
│  └─ contextSuffix injection → enriched goal with pheromone summary       │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Worker Pool Integration                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  WorkerPoolExecutor                                                         │
│  ├─ emitWorkerPheromones()  → emits on completion                         │
│  ├─ getActiveBrowserContext() → unified context access                    │
│  └─ getActiveBrowserContext() → provider-agnostic context access          │
└─────────────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      Swarm Chaining via ResultRefs                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Sequential: pass resultRef → next worker fetches via getToolResult       │
│  Parallel:   pass resultRef array                                         │
│  Prior findings injected as: `[full output: <ref> via get-tool-result]`  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Checklist

### F5.1 PheromoneCoordinator ✅ DONE (`src/runtime/pheromone-coordinator.ts`)
- [x] Emit/Subscribe API with typed signals
- [ ] Exponential decay with configurable half-lives per signal type
- [ ] TTL-based expiry with sweep-on-read
- [ ] `getSignals(targetId)`, `getStrongestSignal()`, `getPheromoneStrength()`
- [ ] Subscription API with typed handlers
- [ ] `getPheromoneStrength(targetId)` - aggregate strength

### F5.1 Remaining
- [ ] Add `getPheromoneStrength(targetId)` - aggregate strength
- [ ] Add `getAllTrails()` for dashboard
- [ ] Persist pheromones to graph for resume capability
- [ ] Unit tests for decay logic

### F5.2 PheromoneScheduler (Week 1-2)
- [ ] **PheromoneScheduler** class replacing `maxParallel` logic
  - [ ] Pheromone-weighted priority queue
  - [ ] `enqueue(task, basePheromone)` → adds pheromone boost from relevant signals
  - [ ] `dequeue()` returns highest pheromone task (respects `maxConcurrency`)
  - [ ] `complete(taskId, success)` releases slot
  - [ ] `contextSuffix` injection into enriched goal
- [ ] Integration with `TaskCoordinator` / `runSpiderRuntime`

### F5.2 Worker Pheromone Emission
- [ ] Worker emission in `worker-pool-executor.ts` after completion
  - `ENDPOINT_DISCOVERED` on HTTP 200
  - `VULN_FOUND` on confirmed finding
  - `CREDENTIAL_FOUND` on validated credential
  - `SESSION_ESTABLISHED` on valid session
  - `TECHNIQUE_SUCCESSFUL` / `TECHNIQUE_FAILED`
  - `ENDPOINT_ERROR`
  - `AUTH_BYPASS`, `PRIVILEGE_ESCALATION`, `DATA_EXFILTRATION`
- [ ] `worker-pool-executor.ts` → emit pheromones on completion
- [ ] `spawn-swarm.ts` → `executeSingle` emits on completion

### F5.2 Pheromone Scheduler (replaces maxParallel)
- [ ] `PheromoneScheduler` class with pheromone-weighted priority queue
- [ ] `enqueue(task, basePheromone)` → adds pheromone boost from relevant signals
- [ ] `dequeue()` returns highest pheromone task (respects `maxConcurrency`)
- [ ] `complete(taskId, success)` releases slot
- [ ] Integration with `TaskCoordinator` / `runSpiderRuntime`
- [ ] `contextSuffix` injection into enriched goal (includes pheromone summary)

### F5.2 Worker Pheromone Emission
- [ ] `worker-pool-executor.ts` → emit pheromones on completion
  - `ENDPOINT_DISCOVERED` on HTTP 200
  - `VULN_FOUND` on confirmed finding
  - `CREDENTIAL_FOUND` on validated credential
  - `SESSION_ESTABLISHED` on valid session
  - `TECHNIQUE_SUCCESSFUL` / `TECHNIQUE_FAILED`
  - `ENDPOINT_ERROR`
  - `AUTH_BYPASS`, `PRIVILEGE_ESCALATION`, `DATA_EXFILTRATION`
- [ ] Swarm `executeSingle` emits pheromones on completion
- [ ] Emitted pheromones tracked in `WorkerExecutionEnvelope.pheromonesEmitted`

### F5.3 Swarm Chaining via ResultRefs
- [ ] Sequential: pass `resultRef` instead of 200-char JSON slices
- [ ] Parallel: pass `resultRef` array
- [ ] `buildInformedTask` reads `resultRef` → `getToolResult` for full output
- [ ] Prior findings injected as `[full output: <ref> via get-tool-result]`

### F5.3 Stigmergic Skill Selection
- [ ] `SkillRegistry.selectSkills()` uses pheromone weights
- [ ] `getRelevantSkills(goal)` returns skills ordered by pheromone boost
- [ ] Skill metadata includes `pheromoneAffinity` tags

### F5.4 Pheromone Decay Background Job
- [ ] Exponential decay per signal type (configurable half-lives)
- [ ] Sweep-on-read + periodic sweep (1 min interval)
- [ ] Expired signals auto-removed
- [ ] Metrics: active signals, total strength, decay rate

### F5.4 Dashboard / Observability
- [ ] Pheromone heatmap on targets (dashboard widget)
- [ ] Signal history per target
- [ ] Decay visualization
- [ ] Export for external SIEM

---

## Implementation Order

### Week 1: Core Infrastructure
- [ ] `PheromoneCoordinator` - verify complete (DONE)
- [ ] `PheromoneScheduler` class + integration with `TaskCoordinator`
- [ ] Worker emission in `worker-pool-executor.ts`
- [ ] `contextSuffix` injection includes pheromone summary

### Week 2: Swarm Integration
- [ ] `spawn-swarm.ts` → emits pheromones on completion
- [ ] `PheromoneScheduler` replaces `maxParallel` in `TaskCoordinator`
- [ ] Swarm chaining via `resultRef` (not 200-char truncation)
- [ ] `contextSuffix` includes pheromone summary

### Week 2: Skill Selection & Decay
- [ ] Stigmergic skill selection (pheromone-weighted)
- [ ] Pheromone decay background job (exponential decay, sweep-on-read)
- [ ] Dashboard: pheromone heatmap on targets

### Week 3: Integration & Tests
- [ ] Integration tests: worker emits → scheduler picks up → result recorded
- [ ] Swarm chaining via `resultRef` (not 200-char truncation)
- [ ] Dashboard: pheromone heatmap on targets
- [ ] All existing tests pass + new stigmergic tests

---

## Testing Strategy

### Unit Tests
- `pheromone-coordinator.test.ts`: emit, decay, subscription, strength
- `pheromone-scheduler.test.ts`: enqueue/dequeue priority, concurrency limit
- `pheromone-decay.test.ts`: exponential decay, TTL sweep

### Integration Tests
- Worker emits → scheduler picks up → result recorded
- Swarm of 3 workers → pheromone heatmap on target
- Capability turn with pheromone-weighted selection

### E2E
- Spider crawl → pheromones emitted → scheduler picks highest → exploit runs
- Capability turn includes pheromone summary in contextSuffix

---

## Dependencies

| Task | Depends On |
|-----|------------|
| F5.2 Worker Emission | F5.1 PheromoneCoordinator ✅ |
| F5.2 Scheduler | F5.1 PheromoneCoordinator ✅ |
| F5.3 Swarm Chaining | F5.2 Worker Emission ✅ |
| F5.3 Stigmergic Skill Selection | F5.2 Scheduler |
| F5.4 Decay Job | F5.1 PheromoneCoordinator ✅ |
| F5.4 Dashboard | F5.1 + F5.2 |

---

## Acceptance Criteria

- [ ] `PheromoneCoordinator` emits/decays/subscribes correctly (unit tests)
- [ ] `PheromoneScheduler` replaces `maxParallel` (all tests pass)
- [ ] Workers emit pheromones on completion (verified by logs)
- [ ] Swarm chaining uses `resultRef` (not 200-char truncation)
- [ ] Capability turn includes pheromone summary in `contextSuffix`
- [ ] Dashboard shows pheromone heatmap on targets
- [ ] All existing tests pass + new stigmergic tests green
- [ ] `npm test` → 2226+ pass, `tsc` clean, `build:cli` clean

---

## Dependencies

| Task | Depends On |
|-----|------------|
| F5.2 Worker Emission | F5.1 PheromoneCoordinator ✅ |
| F5.2 Scheduler | F5.1 PheromoneCoordinator ✅ |
| F5.3 Swarm Chaining | F5.2 Worker Emission ✅ |
| F5.3 Stigmergic Skill Selection | F5.2 Scheduler |
| F5.4 Decay Job | F5.1 PheromoneCoordinator ✅ |
| F5.4 Dashboard | F5.1 + F5.2 |

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Pheromone storms (too many signals) | Cap signals per target; decay aggressively |
| Starvation (low pheromone tasks never run) | Minimum pheromone floor; aging boost |
| Cross-engagement leakage | Engagement-scoped registry (AsyncLocalStorage) |
| Pheromone storm on popular target | Per-target signal cap + decay |
| Dashboard performance | Aggregate in worker, push deltas |

---

## Acceptance Criteria

- [ ] `npm test` → all tests pass (2226+)
- [ ] `npx tsc --noEmit` → 0 errors
- [ ] `npm run build:cli` → clean build
- [ ] `npm run test:evals` → architecture evals pass
- [ ] Manual: run swarm on test target → pheromone heatmap visible, workers follow trails