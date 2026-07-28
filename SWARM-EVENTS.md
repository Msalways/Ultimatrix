# Ultimatrix Swarm Event System — Complete Event Taxonomy & Implementation Plan

> **Goal:** Make every piece of work the agent and its swarm workers perform visible, attributed, and streamable to the web UI in real-time.

---

## 1. Current Event Infrastructure (Audit)

### 1.1 Existing Emitters

| # | Emitter | File | Events | Status |
|---|---------|------|--------|--------|
| 1 | `ToolEventEmitter` (singleton) | `src/lib/tool-events.ts` | `tool-call`, `tool-result`, `error`, `info`, `reasoning`, `agent-start`, `agent-end` | **Active** — web UI reads via `/api/activity` |
| 2 | `TypedEventEmitter` (global) | `src/events/emitter.ts` | `activity:start`, `activity:complete`, `activity:error`, `finding`, `graph:update`, `spider:progress`, `recorder:interaction` | **Dead code** — `emit*()` functions defined but never called from solver engine |
| 3 | `userInputEmitter` | `src/tools/interaction-tools.ts` | `askUser-question`, `askUser-response` | **Active** — REPL only |
| 4 | `uiGoalEmitter` | `src/tools/interaction-tools.ts` | `goal` | **Active** — Ink TUI only |
| 5 | `uiInputEmitter` | `src/tools/interaction-tools.ts` | (none) | **Unused** — declared, zero emit calls |

### 1.2 Existing Callback Chains

| # | System | File | Signature | Status |
|---|--------|------|-----------|--------|
| 6 | Solver stream | `src/solver/solver.ts` | `params.onMessage(SolverStreamMessage)` | **Active** — no worker metadata |
| 7 | Solver phase | `src/solver/solver.ts` | `params.onPhase(PhaseEvent)` | **Active** — no worker metadata |
| 8 | Mastra fullStream | `src/manager/agent.ts` | `AsyncIterable<StreamChunk>` | **Active** — legacy supervisor path |
| 9 | AI SDK stream | `src/app/api/chat/route.ts` | `toAISdkV5Stream()` → SSE | **Active** — web UI chat |

### 1.3 Existing API Endpoints

| Endpoint | File | Transport | Purpose |
|----------|------|-----------|---------|
| `POST /api/chat` | `src/app/api/chat/route.ts` | SSE (AI SDK) | LLM chat stream |
| `GET /api/activity` | `src/app/api/activity/route.ts` | SSE | `ToolEventEmitter` → browser |
| `GET /api/workers` | `src/app/api/workers/route.ts` | REST | Worker list (legacy 4 agents) |
| `GET /api/findings` | `src/app/api/findings/route.ts` | REST | Findings list |
| `GET /api/graph` | `src/app/api/graph/route.ts` | REST | Knowledge graph |
| `GET /api/skills` | `src/app/api/skills/route.ts` | REST | Skills list |
| `GET /api/status` | `src/app/api/status/route.ts` | REST | Agent status |
| `GET /api/config` | `src/app/api/config/route.ts` | REST | LLM config |

---

## 2. The Gap: What's Missing

### 2.1 No Worker Identity in Any Event

When `spawnWorker({ skillId: 'sql-injection', task: 'Test /api/login' })` is called:
- The brain sees the `spawnWorker` tool-call event → **no information about what the worker does internally**
- The worker runs `httpRequest`, `evaluateRendered`, etc. → those tool events show up as flat events with **no worker attribution**
- The worker completes → only the `spawnWorker` result tells the brain what happened; **no lifecycle events reach the UI**

### 2.2 No Worker Lifecycle Events

| Lifecycle Event | Exists? | Where? |
|----------------|---------|--------|
| Worker spawned | ❌ | Nothing emitted from `WorkerPool.spawn()` |
| Worker started task | ❌ | Nothing emitted before `worker.generate()` |
| Worker tool-call | ❌ | Worker's internal tool calls have no worker context |
| Worker tool-result | ❌ | Same |
| Worker completed | ❌ | Nothing emitted after `worker.generate()` resolves |
| Worker killed | ❌ | Nothing emitted from `WorkerPool.kill()` |
| Worker error | ❌ | Nothing emitted on catch |
| Worker timeout | ❌ | `withTimeout()` catches but doesn't emit |
| Swarm started | ❌ | Nothing from `spawnSwarm()` |
| Swarm worker finished | ❌ | Nothing from parallel/sequential completion |
| Swarm all-done | ❌ | Nothing from `spawnSwarm()` final resolution |

### 2.3 No Task/Title Visibility

When the brain calls `spawnWorker({ task: "Test SQL injection on /api/login" })`:
- The `task` string is visible in the tool-call args → **but the web UI doesn't parse it or display it**
- No way to see "SQL Injection Specialist is testing /api/login" in the UI
- No way to see task completion status, duration, or result summary

### 2.4 No Parallel Execution Visualization

When `spawnSwarm({ tasks: [...], parallel: true })` runs 4 workers:
- The UI shows nothing about parallel execution
- No way to see 4 concurrent investigation tracks
- No way to see which worker finished first, which is still running

---

## 3. Complete Event Taxonomy

### 3.1 Design Principles

1. **No regex/substring detection** — all events use structured typed fields
2. **No hardcoded enumerations in descriptions** — event names are self-describing
3. **Single event bus** — all new events flow through `TypedEventEmitter` (upgrade dead code to active)
4. **Worker identity is a structured field** — `workerId`, `workerName`, `workerSkill` are typed fields, never parsed from strings
5. **Task/title is a structured field** — `task` is an opaque string the agent assigned, displayed as-is

### 3.2 Event Categories

```
┌─────────────────────────────────────────────────────────────┐
│                    EVENT CATEGORIES                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  A. SOLVER EVENTS        — brain/reasoning lifecycle         │
│  B. TOOL EVENTS          — individual tool invocations       │
│  C. WORKER EVENTS        — swarm worker lifecycle            │
│  D. SWARM EVENTS         — multi-worker orchestration        │
│  E. INTELLIGENCE EVENTS  — evidence gate, reflexion, anti-loop│
│  F. GRAPH EVENTS         — knowledge graph mutations         │
│  G. BROWSER EVENTS       — page navigation, reactions        │
│  H. FINDING EVENTS       — discovery, verification, status  │
│  I. SESSION EVENTS       — lifecycle, config, errors         │
│  J. SPIDER EVENTS        — crawler lifecycle                 │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Event Definitions (All Scenarios)

### A. SOLVER EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `solver:start` | `{ target, engine, model, timestamp }` | `solver.ts` | Solver loop begins |
| `solver:phase` | `{ phase, step, text?, timestamp }` | `solver.ts` | Phase transition (observe/learn/attack/record/reason/complete) |
| `solver:reasoning` | `{ text, index, timestamp }` | `solver.ts` | Reasoning delta streamed |
| `solver:answer` | `{ text, index, timestamp }` | `solver.ts` | Answer delta streamed |
| `solver:complete` | `{ completed, reason, steps, toolCalls, tokensUsed, durationMs, timestamp }` | `solver.ts` | Solver loop exits |
| `solver:stale` | `{ reason, stepCount, lastUsefulStep, timestamp }` | `solver.ts` | Anti-loop detected stale state |
| `solver:interrupt` | `{ reason, prompt?, timestamp }` | `solver.ts` | HITL interrupt requested |

### B. TOOL EVENTS (Enhanced)

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `tool:call` | `{ toolName, args, workerId?, workerName?, workerSkill?, timestamp }` | `tool-events.ts` | Tool invoked (enriched with worker context) |
| `tool:result` | `{ toolName, ok, result?, durationMs, workerId?, workerName?, timestamp }` | `tool-events.ts` | Tool returns (enriched with worker context) |
| `tool:error` | `{ toolName, error, workerId?, workerName?, timestamp }` | `tool-events.ts` | Tool throws (enriched with worker context) |
| `tool:progress` | `{ toolName, phase, detail?, workerId?, timestamp }` | NEW | Long-running tool progress (e.g., crawler discovering pages) |

**Key change:** Existing `tool-call`/`tool-result` events gain optional `workerId`/`workerName`/`workerSkill` fields. When a tool runs inside a spawned worker, these fields are populated. When a tool runs in the main agent, they are absent.

### C. WORKER EVENTS (NEW)

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `worker:spawned` | `{ workerId, workerName, skillId, task, endpointId?, tier?, modelId?, tokenBudget?, timestamp }` | `spawn-worker.ts` | Worker created in pool |
| `worker:started` | `{ workerId, workerName, skillId, task, timestamp }` | `spawn-worker.ts` | Worker begins executing task |
| `worker:tool-call` | `{ workerId, workerName, skillId, toolName, args, timestamp }` | Worker context wrapper | Tool called inside worker |
| `worker:tool-result` | `{ workerId, workerName, skillId, toolName, ok, durationMs, timestamp }` | Worker context wrapper | Tool result inside worker |
| `worker:progress` | `{ workerId, workerName, skillId, phase, detail?, step?, timestamp }` | Worker context wrapper | Worker progress update |
| `worker:completed` | `{ workerId, workerName, skillId, task, status, result?, durationMs, graphDiff?, timestamp }` | `spawn-worker.ts` | Worker finishes successfully |
| `worker:error` | `{ workerId, workerName, skillId, task, error, durationMs, timestamp }` | `spawn-worker.ts` | Worker throws |
| `worker:timeout` | `{ workerId, workerName, skillId, task, timeoutMs, durationMs, timestamp }` | `pool.ts` | Worker exceeds timeout |
| `worker:killed` | `{ workerId, workerName, skillId, reason, timestamp }` | `pool.ts` | Worker removed from pool |
| `worker:context-budget` | `{ workerId, workerName, skillId, tokenBudget, tokensUsed, exceeded, timestamp }` | `pool.ts` | Context window budget check |

### D. SWARM EVENTS (NEW)

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `swarm:started` | `{ swarmId, mode, totalWorkers, tasks: [{skillId, task}], timestamp }` | `spawn-swarm.ts` | Swarm orchestration begins |
| `swarm:worker-dispatched` | `{ swarmId, workerId, workerName, skillId, task, index, total, timestamp }` | `spawn-swarm.ts` | Individual worker dispatched |
| `swarm:worker-completed` | `{ swarmId, workerId, workerName, skillId, status, result?, durationMs, timestamp }` | `spawn-swarm.ts` | Individual worker finishes |
| `swarm:completed` | `{ swarmId, mode, totalWorkers, completedWorkers, failedWorkers, durationMs, summary, timestamp }` | `spawn-swarm.ts` | All workers done |
| `swarm:sequential-next` | `{ swarmId, workerId, workerName, skillId, task, priorResultsCount, timestamp }` | `spawn-swarm.ts` | Sequential mode: next worker starts with prior context |
| `swarm:parallel-progress` | `{ swarmId, running, completed, failed, total, timestamp }` | `spawn-swarm.ts` | Parallel mode: progress update |

### E. INTELLIGENCE EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `evidence:recorded` | `{ evidenceId, kind, workerId?, toolName?, timestamp }` | `evidence-gate.ts` | New evidence item recorded |
| `evidence:verified` | `{ claimId, verified, confidence, evidenceIds, timestamp }` | `evidence-gate.ts` | Claim verified against ledger |
| `evidence:rejected` | `{ claimId, reason, workerId?, timestamp }` | `evidence-gate.ts` | Claim rejected (hallucination) |
| `reflexion:escalation` | `{ fromLevel, toLevel, reason, workerId?, timestamp }` | `reflexion.ts` | Escalation level change |
| `reflexion:experience` | `{ technique, outcome, lesson, timestamp }` | `reflexion.ts` | Experience extracted from failure |
| `anti-loop:stale` | `{ pathId, staleCount, threshold, timestamp }` | `anti-loop.ts` | Stale path detected |
| `anti-loop:dead-end` | `{ pathId, reason, timestamp }` | `anti-loop.ts` | Dead-end detected |
| `hypothesis:generated` | `{ hypothesisId, type, endpointId?, timestamp }` | `hypotheses.ts` | New attack hypothesis |
| `hypothesis:tested` | `{ hypothesisId, outcome, evidenceId?, timestamp }` | `hypotheses.ts` | Hypothesis tested |

### F. GRAPH EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `graph:node-added` | `{ nodeType, nodeId, workerId?, timestamp }` | `store.ts` | Node added to graph |
| `graph:node-updated` | `{ nodeType, nodeId, fields, workerId?, timestamp }` | `store.ts` | Node fields updated |
| `graph:edge-added` | `{ edgeType, fromId, toId, workerId?, timestamp }` | `store.ts` | Edge added |
| `graph:finding-added` | `{ findingId, severity, technique, endpoint?, workerId?, timestamp }` | `store.ts` | Finding node added |
| `graph:attack-added` | `{ attackId, technique, endpointId, workerId?, timestamp }` | `store.ts` | Attack node added |
| `graph:mutated` | `{ action, nodeType, count, workerId?, timestamp }` | `store.ts` | Batch graph mutation |

### G. BROWSER EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `browser:navigate` | `{ url, status, workerId?, timestamp }` | `dialog-inject.ts` | Page navigation |
| `browser:reaction` | `{ type, description, elements, workerId?, timestamp }` | `reaction-observer.ts` | DOM reaction detected |
| `browser:dialog` | `{ dialogType, message, autoAccepted, workerId?, timestamp }` | `dialog-watcher.ts` | JS dialog intercepted |
| `browser:console` | `{ level, text, workerId?, timestamp }` | `human-observer.ts` | Console message |
| `browser:auth-detected` | `{ flowType, details, workerId?, timestamp }` | `human-observer.ts` | Auth flow detected |
| `browser:bot-detected` | `{ provider, details, timestamp }` | `anti-bot.ts` | Bot challenge detected |
| `browser:bot-resolved` | `{ provider, waitMs, timestamp }` | `anti-bot.ts` | Bot challenge resolved |

### H. FINDING EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `finding:discovered` | `{ findingId, severity, technique, endpoint?, workerId?, source, timestamp }` | `control-tools.ts` | New finding written |
| `finding:verified` | `{ findingId, verifiedBy, confidence, timestamp }` | `evidence-gate.ts` | Finding confirmed by evidence |
| `finding:exploit-proof` | `{ findingId, exploitProofId, scenario, impact, timestamp }` | `control-tools.ts` | Exploit proof attached |
| `finding:status-changed` | `{ findingId, from, to, workerId?, timestamp }` | `control-tools.ts` | Finding lifecycle change |
| `finding:chain-detected` | `{ chainId, findingIds, steps, timestamp }` | `chaining.ts` | Multi-step attack chain detected |

### I. SESSION EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `session:init` | `{ target, engine, model, skills, timestamp }` | `lifecycle.ts` | Session initialized |
| `session:config` | `{ provider, model, engine, timestamp }` | `lifecycle.ts` | Config loaded |
| `session:error` | `{ phase, error, recoverable, timestamp }` | `lifecycle.ts` | Session error |
| `session:complete` | `{ durationMs, findings, nodes, toolCalls, timestamp }` | `lifecycle.ts` | Session ends |
| `session:spider-progress` | `{ url, pages, endpoints, status, timestamp }` | `lifecycle.ts` | Spider crawl progress |

### J. SPIDER EVENTS

| Event | Payload | Source | When |
|-------|---------|--------|------|
| `spider:start` | `{ target, maxPages, maxDurationMs, timestamp }` | `spider/agent.ts` | Spider begins |
| `spider:page` | `{ url, status, links, forms, timestamp }` | `spider/agent.ts` | Page discovered |
| `spider:endpoint` | `{ method, url, params, timestamp }` | `spider/agent.ts` | Endpoint discovered |
| `spider:complete` | `{ pages, endpoints, durationMs, timestamp }` | `spider/agent.ts` | Spider finishes |
| `spider:error` | `{ url, error, timestamp }` | `spider/agent.ts` | Spider error |

---

## 5. Event Flow Architecture

### 5.1 Enhanced TypedEventEmitter

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    ENHANCED EVENT FLOW                                   │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  SOURCES                    EVENT BUS                   SINKS          │
│  ───────                    ────────                   ─────           │
│                                                                         │
│  solver.ts ──────────┐                                                  │
│  spawn-worker.ts ────┤                                                  │
│  spawn-swarm.ts ─────┤                                                  │
│  WorkerPool ─────────┤    ┌──────────────────┐                         │
│  Worker context ─────┼───►│  TypedEventEmitter │──► /api/swarm-events  │
│  evidence-gate.ts ───┤    │  (global singleton)│    (SSE) → Web UI     │
│  reflexion.ts ───────┤    │                    │                         │
│  anti-loop.ts ───────┤    │  36 event types   │──► /api/activity       │
│  graph/store.ts ─────┤    │  (see §4 above)   │    (SSE, legacy)       │
│  browser modules ────┤    │                    │                         │
│  control-tools.ts ───┤    │  Producers: ~40    │──► Zustand store      │
│  spider/agent.ts ────┤    │  call sites        │    (client-side)       │
│  session/lifecycle ──┘    │                    │                         │
│                            │  No regex.         │──► ForensicLog        │
│                            │  No substring.     │    (persistent)       │
│                            │  Structured types. │                         │
│                            └──────────────────┘                         │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Worker Context Propagation

When a worker is spawned, it receives a **context wrapper** that intercepts all tool calls and enriches them with worker identity:

```
Brain calls spawnWorker({skillId: "sqli", task: "Test /api/login"})
  │
  ├─► emit('worker:spawned', {workerId: "sqli-1721", workerName: "SQL Injection Specialist", ...})
  │
  ├─► worker = workerPool.spawn(config)
  │
  ├─► emit('worker:started', {workerId: "sqli-1721", ...})
  │
  ├─► worker.generate(informedTask)
  │     │
  │     ├─► worker calls httpRequest({url: "/api/login", ...})
  │     │     │
  │     │     └─► emit('worker:tool-call', {workerId: "sqli-1721", toolName: "httpRequest", ...})
  │     │         emit('tool:call', {toolName: "httpRequest", workerId: "sqli-1721", ...})
  │     │
  │     ├─► worker calls evaluateRendered({pattern: "error"})
  │     │     │
  │     │     └─► emit('worker:tool-call', {workerId: "sqli-1721", toolName: "evaluateRendered", ...})
  │     │         emit('tool:call', {toolName: "evaluateRendered", workerId: "sqli-1721", ...})
  │     │
  │     └─► worker returns result
  │
  ├─► emit('worker:completed', {workerId: "sqli-1721", status: "ok", result: "...", ...})
  │
  └─► return {workerId, status, result, graphDiff}
```

### 5.3 How Each Event Reaches the Web UI

```
┌──────────────────────────────────────────────────────────────────────┐
│                     EVENT → UI PIPELINE                              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. TypedEventEmitter.emit('worker:spawned', {...})                  │
│         │                                                            │
│  2. /api/swarm-events SSE endpoint listens                           │
│         │                                                            │
│  3. SSE: data: {"type":"worker:spawned","workerId":"sqli-1721",...}  │
│         │                                                            │
│  4. Browser EventSource receives JSON                                │
│         │                                                            │
│  5. Zustand store updates:                                           │
│         │  workers = [...prev, {id: "sqli-1721", name: "...", ...}] │
│         │                                                            │
│  6. Components re-render:                                            │
│         │  ├─ SwarmPanel shows new worker lane                       │
│         │  ├─ StatusBar shows "1 worker active"                      │
│         │  └─ AttackAnimationLayer shows spawn animation             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 6. Implementation Plan

### Phase 1: TypedEventEmitter Upgrade (Backend)

**Goal:** Replace the dead `TypedEventEmitter` with the active event bus. Wire all producers.

| # | Task | File | Change |
|---|------|------|--------|
| 1.1 | Extend `EventMap` with all 36 event types from §4 | `src/events/emitter.ts` | Add typed events to `EventMap` interface |
| 1.2 | Export `emit()` convenience functions for each event | `src/events/emitter.ts` | ~20 new `emit*()` functions |
| 1.3 | Wire `TypedEventEmitter` as subscriber to `ToolEventEmitter` | `src/lib/tool-events.ts` | `emitter.on('event', e => getGlobalEmitter().emit('tool:' + e.type, e))` |
| 1.4 | Add `workerId?`, `workerName?`, `workerSkill?` to `ToolEvent` | `src/lib/tool-events.ts` | Typed optional fields |
| 1.5 | Add `workerId?`, `workerName?` to `SolverStreamMessage` tool/tool-result variants | `src/solver/solver.ts` | Structured fields |
| 1.6 | Add `workerId?`, `workerName?` to `PhaseEvent` | `src/solver/solver.ts` | Structured fields |

### Phase 2: Worker Lifecycle Events (Backend)

**Goal:** Emit events from `spawn-worker.ts`, `spawn-swarm.ts`, and `WorkerPool`.

| # | Task | File | Change |
|---|------|------|--------|
| 2.1 | Emit `worker:spawned` after `workerPool.spawn()` | `src/manager/tools/spawn-worker.ts` | Add `emitWorkerSpawned(...)` call |
| 2.2 | Emit `worker:started` before `worker.generate()` | `src/manager/tools/spawn-worker.ts` | Add `emitWorkerStarted(...)` call |
| 2.3 | Emit `worker:completed` / `worker:error` after result | `src/manager/tools/spawn-worker.ts` | Try/catch with emit on both paths |
| 2.4 | Emit `worker:timeout` in `withTimeout()` catch | `src/workers/pool.ts` | Add event emission on timeout |
| 2.5 | Emit `worker:killed` in `WorkerPool.kill()` | `src/workers/pool.ts` | Add event emission |
| 2.6 | Emit `swarm:*` events in `spawn-swarm.ts` | `src/manager/tools/spawn-swarm.ts` | Emit on dispatch, completion, sequential-next |
| 2.7 | Emit `swarm:parallel-progress` during `Promise.allSettled` | `src/manager/tools/spawn-swarm.ts` | Emit after each worker settles |

### Phase 3: Worker Context Wrapper (Backend)

**Goal:** Intercept all tool calls inside a worker and emit both `worker:*` and enriched `tool:*` events.

| # | Task | File | Change |
|---|------|------|--------|
| 3.1 | Create `WorkerContext` class | `src/workers/worker-context.ts` | **NEW FILE** — wraps worker identity, intercepts tool calls |
| 3.2 | Wrap `worker.generate()` call with `WorkerContext` | `src/manager/tools/spawn-worker.ts` | Pass context to worker |
| 3.3 | `WorkerContext` emits `worker:tool-call` before each tool | `src/workers/worker-context.ts` | Event emission |
| 3.4 | `WorkerContext` emits `worker:tool-result` after each tool | `src/workers/worker-context.ts` | Event emission |
| 3.5 | `WorkerContext` enriches `ToolEvent` with `workerId`/`workerName` | `src/workers/worker-context.ts` | Push enriched event to `ToolEventEmitter` |

### Phase 4: SSE Endpoint (Backend)

**Goal:** Create SSE endpoint that streams all events to the web UI.

| # | Task | File | Change |
|---|------|------|--------|
| 4.1 | Create `GET /api/swarm-events` SSE endpoint | `src/app/api/swarm-events/route.ts` | **NEW FILE** — subscribes to `TypedEventEmitter`, streams all events |
| 4.2 | Update `GET /api/workers` to return dynamic swarm workers | `src/app/api/workers/route.ts` | Query `WorkerPool.list()` for live workers |
| 4.3 | Add `GET /api/workers/history` for completed workers | `src/app/api/workers/history/route.ts` | **NEW FILE** — return recently completed workers |

### Phase 5: Graph Mutation Events (Backend)

**Goal:** Emit graph events so the UI can show live graph updates.

| # | Task | File | Change |
|---|------|------|--------|
| 5.1 | Emit `graph:node-added` in `addNode()` methods | `src/graph/store.ts` | Add event emission per node type |
| 5.2 | Emit `graph:edge-added` in `addEdge()` methods | `src/graph/store.ts` | Add event emission |
| 5.3 | Emit `graph:finding-added` in `addFinding()` | `src/graph/store.ts` | Emit finding-specific event |
| 5.4 | Emit `graph:attack-added` in `addAttack()` | `src/graph/store.ts` | Emit attack-specific event |

### Phase 6: Intelligence Events (Backend)

**Goal:** Emit events from evidence gate, reflexion, and anti-loop.

| # | Task | File | Change |
|---|------|------|--------|
| 6.1 | Emit `evidence:recorded` in `EvidenceLedger.record()` | `src/intelligence/evidence-ledger.ts` | Add event emission |
| 6.2 | Emit `evidence:verified` / `evidence:rejected` in `EvidenceGate.verifyClaim()` | `src/intelligence/evidence-gate.ts` | Emit on both paths |
| 6.3 | Emit `reflexion:escalation` in `ReflexionEngine` | `src/intelligence/reflexion.ts` | Emit on level change |
| 6.4 | Emit `anti-loop:stale` / `anti-loop:dead-end` | `src/intelligence/anti-loop.ts` | Emit on detection |

### Phase 7: Browser Events (Backend)

**Goal:** Emit events from browser modules.

| # | Task | File | Change |
|---|------|------|--------|
| 7.1 | Emit `browser:navigate` in `dialog-inject.ts` | `src/browser/dialog-inject.ts` | Emit after navigation |
| 7.2 | Emit `browser:reaction` in `reaction-observer.ts` | `src/browser/reaction-observer.ts` | Emit on new elements |
| 7.3 | Emit `browser:dialog` in `dialog-watcher.ts` | `src/browser/dialog-watcher.ts` | Emit on intercepted dialog |
| 7.4 | Emit `browser:auth-detected` in `human-observer.ts` | `src/capture/human-observer.ts` | Emit on auth flow detection |
| 7.5 | Emit `browser:bot-detected` / `browser:bot-resolved` in `anti-bot.ts` | `src/browser/anti-bot.ts` | Emit on challenge detect/resolve |

### Phase 8: UI Components (Frontend)

**Goal:** Build the web UI components that consume the new events.

| # | Task | File | Change |
|---|------|------|--------|
| 8.1 | Create `SwarmPanel` component | `src/components/swarm-panel.tsx` | **NEW FILE** — swimlane view of parallel workers |
| 8.2 | Create `WorkerLane` component | `src/components/worker-lane.tsx` | **NEW FILE** — single worker track with live tool stream |
| 8.3 | Create `WorkerTaskCard` component | `src/components/worker-task-card.tsx` | **NEW FILE** — shows task title, status, duration |
| 8.4 | Extend Zustand store with worker/swarm state | `src/stores/app-store.ts` | Add `workers`, `swarms`, `workerEvents` slices |
| 8.5 | Create `useSwarmEvents` hook | `src/hooks/use-swarm-events.ts` | **NEW FILE** — SSE consumer for `/api/swarm-events` |
| 8.6 | Wire `SwarmPanel` into `page.tsx` tab system | `src/app/page.tsx` | Add "Swarm" tab |
| 8.7 | Update `StatusBar` with worker count | `src/components/status-bar.tsx` | Show "N workers active" |
| 8.8 | Update `WorkersPanel` with live data | `src/components/workers-panel.tsx` | Replace legacy list with live swarm data |
| 8.9 | Update `AttackAnimationLayer` for worker attribution | `src/components/attack-animation-layer.tsx` | Show which worker is running which tool |
| 8.10 | Update `ActivityPanel` with worker badges | `src/components/activity-panel.tsx` | Show worker name on tool events |

### Phase 9: Session & Spider Events (Backend + Frontend)

**Goal:** Emit and display session lifecycle and spider events.

| # | Task | File | Change |
|---|------|------|--------|
| 9.1 | Emit `session:*` events from `lifecycle.ts` | `src/session/lifecycle.ts` | Emit init, config, error, complete |
| 9.2 | Emit `spider:*` events from `spider/agent.ts` | `src/spider/agent.ts` | Emit start, page, endpoint, complete, error |
| 9.3 | Add spider progress to `SwarmPanel` | `src/components/swarm-panel.tsx` | Spider as a special worker lane |

### Phase 10: Finding Events (Backend + Frontend)

**Goal:** Emit and display finding lifecycle events.

| # | Task | File | Change |
|---|------|------|--------|
| 10.1 | Emit `finding:discovered` in `writeFinding` | `src/tools/control-tools.ts` | Emit on new finding |
| 10.2 | Emit `finding:verified` in `EvidenceGate` | `src/intelligence/evidence-gate.ts` | Emit on confirmation |
| 10.3 | Emit `finding:status-changed` on lifecycle change | `src/tools/control-tools.ts` | Emit on status update |
| 10.4 | Wire finding events to `FindingsPanel` | `src/components/findings-panel.tsx` | Live finding discovery animation |

---

## 7. Event Volume Estimates

| Category | Events/minute (typical) | Events/minute (heavy swarm) |
|----------|------------------------|-----------------------------|
| Tool events | 10-30 | 50-100 |
| Worker lifecycle | 0-3 | 10-20 |
| Swarm orchestration | 0-1 | 5-10 |
| Intelligence | 5-15 | 20-40 |
| Graph mutations | 5-10 | 20-50 |
| Browser events | 5-20 | 30-80 |
| Finding events | 0-2 | 5-10 |
| Session events | 1-3 | 1-3 |
| Spider events | 5-15 | 10-20 |
| **Total** | **30-100/min** | **150-330/min** |

**Throttling strategy:** The SSE endpoint should batch events in 100ms windows and send as arrays. This reduces HTTP overhead from ~2-5/sec to ~10/sec while maintaining near-real-time feel.

```typescript
// In /api/swarm-events/route.ts
const buffer: SwarmEvent[] = []
const flush = setInterval(() => {
  if (buffer.length > 0) {
    sendEvent(buffer.splice(0))  // Send batch, clear buffer
  }
}, 100)
```

---

## 8. SSE Endpoint Specification

### `GET /api/swarm-events`

**Transport:** Server-Sent Events (SSE)

**Query params:**
- `types` (optional) — comma-separated event type prefixes to filter (e.g., `worker,swarm,tool`)
- `workerId` (optional) — filter events for a specific worker

**Connection lifecycle:**
1. Client connects → receives `{ type: 'connected', timestamp, eventCount: 0 }`
2. Server sends batched events every 100ms
3. Heartbeat every 30s: `{ type: 'heartbeat', timestamp }`
4. Client disconnects → cleanup listener

**Event batch format:**
```json
{
  "events": [
    { "type": "worker:spawned", "workerId": "sqli-1721", "workerName": "SQL Injection Specialist", "skillId": "sql-injection", "task": "Test /api/login for SQL injection", "timestamp": 1721000000000 },
    { "type": "worker:tool-call", "workerId": "sqli-1721", "toolName": "httpRequest", "args": { "method": "POST", "url": "/api/login" }, "timestamp": 1721000000100 }
  ]
}
```

---

## 9. Zustand Store Extensions

```typescript
// src/stores/app-store.ts — additions

interface SwarmWorker {
  id: string
  name: string
  skillId: string
  task: string
  status: 'queued' | 'running' | 'completed' | 'error' | 'timeout' | 'killed'
  startedAt: number
  completedAt?: number
  durationMs?: number
  toolCalls: ToolCallEvent[]
  result?: string
  error?: string
}

interface SwarmState {
  swarmId: string
  mode: 'parallel' | 'sequential'
  workers: SwarmWorker[]
  totalWorkers: number
  completedWorkers: number
  failedWorkers: number
  startedAt: number
  completedAt?: number
}

interface AppState {
  // ... existing fields ...

  // Swarm
  activeWorkers: SwarmWorker[]
  activeSwarms: SwarmState[]
  workerHistory: SwarmWorker[]  // recently completed

  addWorker: (worker: SwarmWorker) => void
  updateWorker: (id: string, patch: Partial<SwarmWorker>) => void
  removeWorker: (id: string) => void
  addSwarm: (swarm: SwarmState) => void
  updateSwarm: (id: string, patch: Partial<SwarmState>) => void
  removeSwarm: (id: string) => void

  // Swarm events
  onSwarmEvent: (event: SwarmEvent) => void
}
```

---

## 10. SwarmPanel Component Design

```
┌─────────────────────────────────────────────────────────────────┐
│  ⬡ SWARM ACTIVITY                                    2 active  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─ SQL Injection Specialist ──────────────────────────────┐   │
│  │ ● sqli-1721  skill: sql-injection  duration: 12.3s    │   │
│  │ Task: "Test /api/login for SQL injection"              │   │
│  │                                                         │   │
│  │  → httpRequest POST /api/login           ✅ 234ms      │   │
│  │  → evaluateRendered error patterns       ✅ 89ms       │   │
│  │  → httpRequest POST /api/login' OR 1=1   ✅ 245ms      │   │
│  │  → writeFinding SQL Injection (high)     ✅ 12ms       │   │
│  │                                                         │   │
│  │  ◉ COMPLETED  3 findings  4 tool calls  15.2s         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Auth Control Specialist ───────────────────────────────┐   │
│  │ ● auth-1721  skill: auth-control  duration: 8.7s       │   │
│  │ Task: "Analyze OAuth flow on /api/auth"                │   │
│  │                                                         │   │
│  │  → httpRequest GET /api/auth/oauth      ✅ 156ms       │   │
│  │  → stagehand_extract session cookies   ⏳ running...   │   │
│  │                                                         │   │
│  │  ● RUNNING  2 tool calls so far                       │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌─ Recon Specialist ──────────────────────────────────────┐   │
│  │ ◉ recon-1719  skill: recon  completed 45.2s ago        │   │
│  │ Task: "Discover all API endpoints"                     │   │
│  │                                                         │   │
│  │  ◉ COMPLETED  12 endpoints found  8 tool calls  45.2s │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

Each worker lane shows:
- **Header:** Worker name + ID + skill + duration timer
- **Task:** The assigned task string (from `spawnWorker({task: ...})`)
- **Tool stream:** Live list of tool calls with status + duration
- **Footer:** Status badge + summary stats

---

## 11. Anti-Bandaid Checklist

- [ ] **No regex parsing of event messages** — all worker context is typed fields
- [ ] **No hardcoded tool name lists** — tool events flow through dynamically
- [ ] **No hardcoded worker name lists** — worker names come from `skill.name + " Specialist"` via `SkillRegistry`
- [ ] **Event bus is single source of truth** — no parallel event systems
- [ ] **No string concatenation for event type routing** — structured `EventMap` with typed keys
- [ ] **Worker identity is a structured field** — never parsed from event message text
- [ ] **Task/title is an opaque string** — displayed as-is, never parsed
- [ ] **SSE batching prevents HTTP overhead** — 100ms windows, not per-event
- [ ] **Events are ephemeral** — no persistence required for stream events
- [ ] **Each event has a `timestamp` field** — enables time-ordering and duration calculation

---

## 12. Files to Create

| File | Purpose |
|------|---------|
| `src/workers/worker-context.ts` | `WorkerContext` class — wraps worker identity, intercepts tool calls |
| `src/app/api/swarm-events/route.ts` | SSE endpoint streaming all events to browser |
| `src/app/api/workers/history/route.ts` | REST endpoint for recently completed workers |
| `src/components/swarm-panel.tsx` | Swarm activity swimlane panel |
| `src/components/worker-lane.tsx` | Single worker track with live tool stream |
| `src/components/worker-task-card.tsx` | Task title + status card |
| `src/hooks/use-swarm-events.ts` | SSE consumer hook for `/api/swarm-events` |

## 13. Files to Modify

| File | Change |
|------|--------|
| `src/events/emitter.ts` | Extend `EventMap` with 36 event types, add emit functions |
| `src/lib/tool-events.ts` | Add `workerId?`, `workerName?`, `workerSkill?` to `ToolEvent` |
| `src/solver/solver.ts` | Add `workerId?`, `workerName?` to `SolverStreamMessage` and `PhaseEvent` |
| `src/manager/tools/spawn-worker.ts` | Emit lifecycle events, wrap with `WorkerContext` |
| `src/manager/tools/spawn-swarm.ts` | Emit swarm orchestration events |
| `src/workers/pool.ts` | Emit `worker:timeout`, `worker:killed` |
| `src/graph/store.ts` | Emit graph mutation events |
| `src/intelligence/evidence-gate.ts` | Emit evidence verification events |
| `src/intelligence/evidence-ledger.ts` | Emit evidence recording events |
| `src/intelligence/reflexion.ts` | Emit escalation events |
| `src/intelligence/anti-loop.ts` | Emit stale/dead-end events |
| `src/browser/dialog-inject.ts` | Emit browser navigation events |
| `src/browser/reaction-observer.ts` | Emit reaction events |
| `src/browser/dialog-watcher.ts` | Emit dialog events |
| `src/capture/human-observer.ts` | Emit auth detection events |
| `src/browser/anti-bot.ts` | Emit bot detection events |
| `src/tools/control-tools.ts` | Emit finding events |
| `src/spider/agent.ts` | Emit spider lifecycle events |
| `src/session/lifecycle.ts` | Emit session lifecycle events |
| `src/app/api/workers/route.ts` | Return dynamic swarm workers |
| `src/stores/app-store.ts` | Add swarm state slices |
| `src/components/status-bar.tsx` | Show worker count |
| `src/components/workers-panel.tsx` | Replace legacy list with live data |
| `src/components/attack-animation-layer.tsx` | Show worker attribution |
| `src/components/activity-panel.tsx` | Show worker badges |
| `src/app/page.tsx` | Add Swarm tab, wire SwarmPanel |

---

## 14. Implementation Order

| Phase | Depends On | Estimated Effort |
|-------|-----------|-----------------|
| Phase 1: TypedEventEmitter upgrade | — | M (2-3h) |
| Phase 2: Worker lifecycle events | Phase 1 | M (2-3h) |
| Phase 3: Worker context wrapper | Phase 2 | L (3-4h) |
| Phase 4: SSE endpoint | Phase 1 | S (1h) |
| Phase 5: Graph mutation events | Phase 1 | S (1h) |
| Phase 6: Intelligence events | Phase 1 | S (1h) |
| Phase 7: Browser events | Phase 1 | S (1h) |
| Phase 8: UI components | Phase 4 | L (4-5h) |
| Phase 9: Session & spider events | Phase 1 | S (1h) |
| Phase 10: Finding events | Phase 1 | S (1h) |

**Total estimated effort: ~18-22 hours**

**Critical path:** Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 8

**Parallelizable:** Phases 5, 6, 7, 9, 10 can all run in parallel after Phase 1.
