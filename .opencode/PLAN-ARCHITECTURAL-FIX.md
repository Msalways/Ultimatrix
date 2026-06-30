# Ultimatrix — Architectural Fix: Observe → Learn → Attack

## Problem

The supervisor agent fires 122+ blind LLM calls per session without ever reading the graph data produced by the spider. Workers are spawned with generic tasks ("test for SQL injection") instead of informed, specific tasks based on discovered endpoints. `writeFinding` and `recordEvidence` are stubs — findings are never persisted. The entire Observe → Learn → Attack loop is broken.

## Root Causes

| # | Gap | Location | Impact |
|---|-----|----------|--------|
| 1 | `writeFinding` is a stub | `control-tools.ts:38-46` | Findings never persist to graph or disk |
| 2 | `recordEvidence` is a stub | `control-tools.ts:4-23` | Evidence doesn't accumulate |
| 3 | `execute-direct` is a stub | `execute-direct.ts:17-23` | Placeholder, never runs |
| 4 | `skill-search` references `s.category`, `s.tier` | `skill-search.ts:27,37` | Type mismatch, undefined access |
| 5 | No `getTargetSummary()` query | `graph/store.ts` | Supervisor can't understand target in one call |
| 6 | No `getEndpointsWithParams()` query | `graph/store.ts` | No structured endpoint list for workers |
| 7 | Spider doesn't store structured params | `spider/instructions.ts` | Graph has URLs but not API schemas |
| 8 | No bridge: Graph → AppModel → Workers | `context/writer.ts` vs `graph/` | Workers receive blind tasks |
| 9 | Swarm fires all workers with same task | `spawn-swarm.ts:37` | `Promise.all()` with identical generic task |
| 10 | Supervisor instructions are suggestions, not enforced | `manager/instructions.ts` | LLM skips Observe, goes straight to Attack |

## Phase A: Fix the Data Flow (prerequisites for everything)

### A1: Fix `writeFinding` — persist to graph store
- **File:** `src/tools/control-tools.ts`
- **Change:** `writeFinding.execute()` must call `getGlobalGraphStore().addFinding()` to persist the finding as a `FindingNode` in the graph
- **Also:** Save to disk via `getGlobalGraphStore().save()`
- **Return:** The persisted finding node (with ID)

### A2: Fix `recordEvidence` — accumulate evidence
- **File:** `src/tools/control-tools.ts`
- **Change:** Maintain a module-level `evidenceBuffer: Map<string, Evidence[]>` keyed by finding ID or endpoint
- **Change:** `recordEvidence` pushes to the buffer
- **Change:** `writeFinding` reads from the buffer and includes accumulated evidence
- **Also:** Persist evidence to graph via `updateGraph` with an `Evidence` property on Finding nodes

### A3: Fix `execute-direct` — actually run skills
- **File:** `src/manager/tools/execute-direct.ts`
- **Change:** Resolve the skill's tools via `resolveTools(skill.toolRefs)`, construct a mini-agent or run the tool chain inline
- **Return:** Actual tool execution results

### A4: Fix `skill-search` type mismatches
- **File:** `src/manager/tools/skill-search.ts`
- **Change:** `s.category` → `s.tags?.[0] || 'general'`
- **Change:** Remove `s.tier` reference or derive from skill metadata

### A5: Add `getTargetSummary()` to graph store
- **File:** `src/graph/store.ts`
- **Change:** New method that returns a structured summary:
  ```typescript
  getTargetSummary(): {
    pages: PageNode[],
    actions: ActionNode[],
    inputs: InputNode[],
    authFlows: AuthFlowNode[],
    findings: FindingNode[],
    untestedActions: ActionNode[],
  }
  ```

### A6: Add `getEndpointsWithParams()` to graph store
- **File:** `src/graph/store.ts`
- **Change:** New method that joins Page → Action → Input nodes into a structured endpoint list:
  ```typescript
  getEndpointsWithParams(): Array<{
    url: string,
    method: string,
    params: Array<{ name: string, type: string, required: boolean }>,
    auth: boolean,
    contentType: string,
    tested: boolean,
  }>
  ```

### A7: Wire `getTargetSummary` into `graph/tools.ts`
- **File:** `src/graph/tools.ts`
- **Change:** New tool `getTargetSummary` that calls `getGlobalGraphStore().getTargetSummary()`
- **Change:** New tool `getEndpoints` that calls `getGlobalGraphStore().getEndpointsWithParams()`

## Phase B: Bridge Graph → Workers (informed swarm)

### B1: Spider stores structured endpoint data
- **File:** `src/spider/instructions.ts`
- **Change:** Add instructions for spider to call new `addEndpoint` action with structured param data from `stagehand_extract`

### B2: New `addEndpoint` action on `updateGraph`
- **File:** `src/graph/tools.ts`
- **Change:** New action type: `addEndpoint` with properties `{ url, method, params: Array<{name,type,in}>, headers, bodySchema }`
- **Change:** Creates/updates an `EndpointNode` type in the graph

### B3: New `EndpointNode` type in graph schema
- **File:** `src/graph/schema.ts`
- **Change:** Add `Endpoint` node type with properties: `url`, `method`, `params`, `headers`, `contentType`, `requiresAuth`, `tested`

### B4: Worker receives endpoint context in task
- **File:** `src/manager/tools/spawn-worker.ts`
- **Change:** Before creating worker, query graph for the target endpoint's data
- **Change:** Inject structured context into the task description:
  ```
  "Test SQL injection on: GET /api/users?id={integer,query,required}
   Headers: Authorization: Bearer <JWT>
   Response type: JSON
   Body preview: {\"users\": [{\"id\": 1, \"name\": \"...\"}]}"
  ```

### B5: Swarm constructs informed tasks per worker
- **File:** `src/manager/tools/spawn-swarm.ts`
- **Change:** Instead of passing the same `task` to all workers, query graph for endpoints
- **Change:** Match skills to endpoints (SQL injection → endpoints with string params, XSS → endpoints with user input, etc.)
- **Change:** Each worker gets a **specific endpoint + technique** combo
- **Change:** Run workers **sequentially** (not `Promise.all`) so findings from worker 1 can inform worker 2

## Phase C: Enforce the flow (phase-locked supervisor)

### C1: Rewrite supervisor instructions as mandatory phases
- **File:** `src/manager/instructions.ts`
- **Change:** Hard phase gates:
  - Phase 1 (OBSERVE): "You MUST call getTargetSummary and getEndpoints before doing anything else. Do NOT spawn workers until you have read the graph."
  - Phase 2 (PLAN): "Based on the target summary, decide which endpoints to test with which techniques. Output a numbered plan."
  - Phase 3 (ATTACK): "Execute your plan one step at a time. Spawn workers with specific endpoint context."
  - Phase 4 (REPORT): "Read findings from graph, summarize results."

### C2: Phase-aware tool sets
- **File:** `src/manager/agent.ts`
- **Change:** If possible, restrict tool access per phase (observe tools first, attack tools later)
- **Alternative:** If Mastra doesn't support dynamic tool sets, use instructions to enforce phase ordering

### C3: Clean up session.ts
- **File:** `src/session.ts`
- **Change:** Graph is already populated by spider at startup; supervisor should not need to re-crawl
- **Change:** Remove redundant graph operations between spider and supervisor

## Implementation Order

```
Phase A (data flow):     A1 → A2 → A3 → A4 → A5 → A6 → A7
Phase B (graph bridge):  B3 → B2 → B1 → B4 → B5
Phase C (supervisor):    C1 → C2 → C3
```

## Verification

After all phases:
1. `npm test` — all existing tests pass + new tests for fixed stubs
2. `npx tsup` — clean build
3. `npx eslint src/` — lint clean
4. Manual test: `npx ultimatrix interact -t https://httpbin.org` — should observe first, then plan, then attack
5. Verify findings persist in `output/graph.json` after session
6. Verify LLM call count stays under 32/min for NVIDIA NIM
