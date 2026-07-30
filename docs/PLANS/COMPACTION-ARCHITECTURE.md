# Compaction Architecture — Context Overflow Prevention

**Date:** 2026-07-29
**Author:** opencode
**Status:** PLANNING → READY TO BUILD
**Depends on:** Mastra SDK `@mastra/core` ^1.42.0, `@mastra/memory` ^1.20.2

---

## Problem Statement

The solver loop generates unbounded context growth at **5 independent vectors**, eventually overflowing the model's context window (e.g. 262,144 tokens for NVIDIA stepfun-ai/step-3.7-flash). Current mitigations are reactive (catch HTTP 400 and compact) rather than proactive. The compression service (`CompressionService`) can expand text instead of reducing it due to a broken headroom-ai fallback path.

### The Five Vectors

| Vector | Source | Max Size | Current Mitigation | Status |
|--------|--------|----------|-------------------|--------|
| **V1:** Mastra intra-turn tool history | `agent.stream()` — up to 50 tool rounds | ~150K tokens | `maxSteps: 50` only | **UNMITIGATED** |
| **V2:** Enriched goal injection | Rebuilt every REPL turn with graph state, blackboard, skills, reflexion | 6K-15K tokens (unbounded) | Dead `maxBlackboardFactsInSummary` config | **UNMITIGATED** |
| **V3:** Worker results to brain | `spawnWorker`/`spawnSwarm` return full Mastra `FullOutput` | UNBOUNDED (hundreds of KB) | `executeDirect` 2K cap, sequential swarm 200-char truncation | **PARTIAL** |
| **V4:** Individual tool results | `httpRequest` 50K, `parseResponse` 100K (body+dom dup), `extractBrowserAuth` unbounded | 50-200K chars | `CompressionService` (broken) | **BROKEN** |
| **V5:** Overflow recovery | Reactive HTTP 400 catch | N/A | `conversationHistory: ""` blind spot | **BROKEN** |

---

## Architecture Overview

**Four-layer approach: use Mastra natives for generic pruning, add domain-specific layers on top.**

```
┌──────────────────────────────────────────────────────────────┐
│                Mastra Native Layer                            │
│                                                              │
│  TokenLimiterProcessor          Observational Memory          │
│  (intra-turn pruning)           (cross-turn compression)     │
│  processInputStep at every      Observer + Reflector          │
│  tool round. limit =            compress old messages         │
│  contextWindow × 0.7            into dense observations       │
│  trimMode = best-fit            at proportional threshold     │
│                                   (contextWindow × 0.25)      │
│                                                              │
│  Fixes V1                        Fixes V2 (partial)           │
└──────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│              Ultimatrix Domain Layer                          │
│                                                              │
│  Tool Result Ref-Store    Enriched Goal Budget   Done Index   │
│  Store full result in     Priority-weighted      Compact      │
│  graph, return compact    sections, hard cap     "what's      │
│  reference. LLM fetches   (5% of context        tested/      │
│  full data on demand.     window) per turn.     untested"    │
│  via getToolResult.       Replaces unbounded     ~200 tokens  │
│                           section injection.                │
│                                                              │
│  Fixes V3 + V4            Fixes V2 (remainder)   Re-testing   │
└──────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────┐
│              Safety Net Layer                                 │
│                                                              │
│  CompressionService fix         Overflow 5% margin           │
│  Singleton, model-aware,        classifyOverflow uses        │
│  never-expand invariant.        contextWindow × 0.95         │
│  extractToolResponse only.      instead of raw >.            │
│  headroom disabled default.                                │
│                                                              │
│  Fixes V4 (compression)        Fixes V5 (reactive)           │
└──────────────────────────────────────────────────────────────┘
```

---

## Hard Rules (from architectural-no-bandaids)

1. **No hardcoded substring detection** — structured typed fields only
2. **No hardcoded enumerations in tool descriptions** — live schema discovery
3. **No bandaids** — fix design, not symptom
4. **No regex/keyword detection** — relation-native reasoning only
5. **All imports verified** — every function exists at stated path
6. **Platform-native first** — use Mastra's TokenLimiterProcessor and Observational Memory instead of reimplementing pruning logic
7. **Graph as source of truth** — tool results live in the graph, LLM context carries compact references
8. **Never-expand invariant** — compression must never produce output larger than input

---

## BANDAID REVIEW CHECKLIST

Before implementation, verify each task against these criteria:

| # | Check | If fails → |
|---|-------|-----------|
| B1 | Does this fix the root cause or a symptom? | Rewrite to fix root cause |
| B2 | Does this use a platform-native mechanism? | Investigate native option first |
| B3 | Does this introduce hardcoded values that go stale? | Use config-driven resolution |
| B4 | Does this compose with future changes (new models, new tools)? | Redesign for composability |
| B5 | Does this break existing tests? | Fix tests to match new architecture |
| B6 | Does this add a new abstraction without clear ownership? | Merge into existing module |
| B7 | Is the "fix" just hiding the problem (e.g. increasing a limit instead of reducing usage)? | Find the actual reduction path |

---

## Phase 1: TokenLimiterProcessor — Intra-Turn Pruning (V1)

**Rationale:** Mastra natively solves V1 via `TokenLimiterProcessor.processInputStep`. This runs at every tool round and prunes old messages. We just wire it. Zero custom pruning logic.

### Task 1.1: Extend `createAgent()` to accept processors

**File:** `src/mastra/index.ts`
**Change:** Add `inputProcessors?` and `outputProcessors?` to `AgentOptions` interface. Pass them through to `agentConfig`.

```typescript
// AgentOptions — add:
inputProcessors?: InputProcessorOrWorkflow[]
outputProcessors?: OutputProcessorOrWorkflow[]

// createAgent() — add before `new Agent(agentConfig)`:
if (options?.inputProcessors) agentConfig.inputProcessors = options.inputProcessors
if (options?.outputProcessors) agentConfig.outputProcessors = options.outputProcessors
```

**Verify:** `InputProcessorOrWorkflow` type exists in `@mastra/core/dist/agent/types.d.ts` (confirmed: line 754).

### Task 1.2: Create token limiter factory

**File:** `src/solver/brain-tools.ts`
**Change:** In `createSolverBrainAgent()`, create a `TokenLimiterProcessor` with model-proportional limit.

```typescript
import { TokenLimiterProcessor } from '@mastra/core/processors'
import { ContextWindowRegistry } from '../models/context-window-registry'

// Before creating agent:
const registry = new ContextWindowRegistry(config)
const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
const tokenLimit = Math.floor(contextWindow * 0.7)

const limiter = new TokenLimiterProcessor({
  limit: tokenLimit,
  trimMode: 'best-fit', // Keep diverse tool results, not just linear suffix
})

// Pass to createAgent via options:
inputProcessors: [limiter],
```

**Why 70%:** 30% reserved for system prompt (~3.5K tokens) + tool schemas (~11K tokens) + enriched goal (~8K tokens) + output reserve. The 70% is for accumulated tool history within a single `agent.stream()` call.

**Why `best-fit`:** Security research needs diverse tool results across the session (HTTP responses, browser extracts, graph queries). `contiguous` would drop older but still relevant results to keep a continuous suffix. `best-fit` keeps as many messages as possible within budget, even if they're not contiguous.

### Task 1.3: Cap worker `FullOutput` in `spawnWorker`

**File:** `src/manager/tools/spawn-worker.ts`
**Change:** After `worker.generate()`, do NOT return the full `FullOutput`. Extract only the compact fields.

**Before (returns full FullOutput):**
```typescript
return { ok: true, value: { workerId, status: 'spawned', result, graphDiff } }
```

**After (returns compact summary):**
```typescript
return {
  ok: true,
  value: {
    workerId: worker.id,
    status: 'completed',
    text: typeof result?.text === 'string' ? result.text.slice(0, 2000) : '',
    findingsCount: graphDiff.findingsAdded,
    nodesAdded: graphDiff.nodesAdded,
    durationMs: result?.usage ? undefined : undefined, // extract from usage if available
  },
}
```

**Do NOT include:** `result.toolCalls`, `result.toolResults`, `result.steps`, `result.messages`. These stay inside the worker's Mastra agent — they do NOT enter the brain's context.

### Task 1.4: Cap swarm worker results

**File:** `src/manager/tools/spawn-swarm.ts`
**Change:** Same pattern as Task 1.3 — each worker's result is capped to text + graphDiff.

---

## Phase 2: Observational Memory — Cross-Turn Compression (V2 partial)

**Rationale:** Mastra natively compresses old messages into dense observations when message history exceeds a threshold. Requires a storage adapter (LibSQLStore) which we already have.

### Task 2.1: Add storage to `createMemoryFromConfig()`

**File:** `src/memory/config.ts`
**Change:** Pass `LibSQLStore` as `storage` to the `Memory` constructor (currently missing). Enable Observational Memory with model-proportional thresholds.

```typescript
import { LibSQLStore } from '@mastra/libsql'
import { ContextWindowRegistry } from '../models/context-window-registry'

// Add storage instance:
const storage = new LibSQLStore({ id: 'ultimatrix', url: 'file:./ultimatrix.db' })

// Resolve thresholds from model's context window (NOT hardcoded):
const registry = new ContextWindowRegistry(config)
const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
const observationThreshold = Math.floor(contextWindow * 0.25)  // Compress at 25% of window
const reflectionThreshold = Math.floor(contextWindow * 0.35)   // Summarize at 35% of window

return new Memory({
  storage,  // ADD — currently missing in this path
  ...(vector ? { vector } : {}),
  options: {
    lastMessages: config.memory.lastMessages,
    semanticRecall,
    workingMemory: {
      enabled: config.memory.workingMemory,
      template: `...`,
    },
    observationalMemory: {
      model: config.model ?? 'openai/gpt-4o-mini',
      observation: {
        messageTokens: observationThreshold,  // Proportional to context window
      },
      reflection: {
        observationTokens: reflectionThreshold,  // Proportional to context window
      },
    },
  },
})
```

**Verify:** `@mastra/memory` v1.20.2 supports `observationalMemory` config. `LibSQLStore` import path is `@mastra/libsql` (confirmed in `src/workers/registry.ts`).

### Task 2.2: Ensure brain agent receives memory

**File:** `src/solver/brain-tools.ts`
**Status:** Already wired at lines 417-419. Verify the caller passes `memory` to `createSolverBrainAgent()`.

**File:** `src/session.ts`
**Verify:** The `solve()` call at line 539 passes `memory: { thread: threadId, resource: resourceId }`. This is already correct.

---

## Phase 3: Tool Result Ref-Store — Graph-as-Database (V3 + V4)

**Rationale:** Instead of returning full tool results in the LLM context, store them in the graph and return compact references. The LLM can fetch full data on demand. This is architecturally superior because:
- Graph becomes the single source of truth
- Tools become stateless (execute → store → return ref)
- LLM context stays lean
- Future agents can query the graph without re-executing tools
- Composable with Observational Memory

### Task 3.1: Create `ToolResultStore` module

**New file:** `src/graph/tool-result-store.ts`

Core infrastructure: store full tool result as a graph node, return compact reference, retrieve on demand.

```typescript
export interface ToolResultRef {
  graphNodeId: string
  tool: string
  summary: string
  sizeBytes: number
}

export class ToolResultStore {
  constructor(private graph: GraphStore) {}
  
  store(toolName: string, data: unknown, metadata?: Record<string, unknown>): ToolResultRef
  get(graphNodeId: string): unknown
}
```

**Node type:** Add `NodeType.TOOL_RESULT` to graph schema (`src/graph/schema.ts`) with `ToolResultNode` interface. Properties: `tool`, `data`, `summary`, `sizeBytes`. This enables graph-aware querying of tool results (e.g., prune old results, forensic analysis).

### Task 3.2: Create `getToolResult` brain tool

**File:** `src/solver/brain-tools.ts`
**Change:** Add `getToolResult` tool to the brain's tool set.

```typescript
getToolResult: createTool({
  id: 'getToolResult',
  description: 'Retrieve full data from a previous tool result by its graph node reference',
  input: z.object({ graphNodeId: z.string() }),
  execute: async ({ graphNodeId }) => {
    const data = toolResultStore.get(graphNodeId)
    if (!data) return { ok: false, error: 'Result not found' }
    return { ok: true, value: data }
  },
})
```

### Task 3.3: Wire `ToolResultStore` into `CoreServices`

**File:** `src/session/engine-setup.ts`
**Change:** Create `ToolResultStore` instance in `createEngineServices()`, attach to the services object.

**File:** `src/core/types.ts`
**Change:** Add `toolResultStore: ToolResultStore` to `CoreServices` interface.

### Task 3.4: Update `httpRequest` tool

**File:** `src/tools/http-tools.ts`
**Change:** Store body in graph, return compact reference.

**Before:**
```typescript
return { ok: true, value: { status, url, headers, body: responseBody, durationMs } }
```

**After:**
```typescript
const bodyRef = toolResultStore.store('httpRequest', responseBody, { url, status })
return {
  ok: true,
  value: {
    status,
    url,
    headers,
    bodyRef: bodyRef.graphNodeId,
    bodyPreview: responseBody.slice(0, 500),
    bodySize: responseBody.length,
    durationMs,
  },
}
```

### Task 3.5: Update `parseResponse` tool

**File:** `src/tools/observation-tools.ts`
**Change:** Remove body/dom duplication. Store body in graph, return reference.

**Before:**
```typescript
return { ok: true, value: { status, body: compressionResult.compressed, json, dom: compressionResult.compressed, textSnippets } }
```

**After:**
```typescript
const bodyRef = toolResultStore.store('parseResponse', compressionResult.compressed, { status })
return {
  ok: true,
  value: {
    status,
    bodyRef: bodyRef.graphNodeId,
    bodyPreview: compressionResult.compressed.slice(0, 500),
    json,
    textSnippets,
  },
}
```

### Task 3.6: Update `extractBrowserAuth` tool

**File:** `src/tools/extract-browser-auth.ts`
**Change:** Store full auth data in graph, return keys found + reference.

### Task 3.7: Update `spawnWorker` result format

**File:** `src/manager/tools/spawn-worker.ts`
**Change:** Already covered in Task 1.3. Store worker's full output in graph via ref-store.

### Task 3.8: Update `spawnSwarm` result format

**File:** `src/manager/tools/spawn-swarm.ts`
**Change:** Same pattern as Task 3.7 — each worker stores result in graph.

---

## Phase 4: Enriched Goal Budget + Done Index (V2 remainder)

**Rationale:** The enriched goal is rebuilt every REPL turn. Without a budget, sections grow unboundedly. The done index prevents re-testing by summarizing what's been covered.

### Task 4.1: Create `buildBudgetedGoal()` function

**New file:** `src/solver/budgeted-goal.ts`

Priority-weighted section builder with hard token cap (proportional to context window).

```typescript
import { ContextWindowRegistry } from '../models/context-window-registry'

interface GoalSection {
  name: string
  priority: number  // 100=highest
  content: string
}

function buildBudgetedGoal(sections: GoalSection[], config: { model?: string }): string {
  const registry = new ContextWindowRegistry(config)
  const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
  const tokenBudget = Math.floor(contextWindow * 0.05)  // 5% of context window
  // ... sort by priority, add until budget exhausted, truncate last section
}
```

**Behavior:** Budget is `contextWindow * 0.05` (5% of window). For 262K model = ~13K tokens. For 128K model = ~6.4K. Sort by priority descending. Add sections until budget exhausted. Truncate last section to fit.

### Task 4.2: Create `buildDoneIndex()` function

**New file:** `src/solver/done-index.ts`

Compact "what's been tested/untested" summary.

```typescript
function buildDoneIndex(graph: GraphStore, blackboard: Blackboard, tokenBudget: number): string
```

**Output format (~200-500 tokens):**
```
Tested Endpoints:
- GET /api/users → sqli, xss, idor
- POST /api/login → brute-force, credential-stuffing

Untested (3): PUT /api/users/:id; DELETE /api/users/:id; GET /api/admin

Failed: timing-attack inconclusive; ssti blocked by WAF

Attack Paths: / → /api/admin (2 hops, high severity)
```

**Replaces:**
- `board.toPromptGraph()` (6K-10K tokens) → folded into done index (~500 tokens)
- `reflexion.toReflectionPrompt()` → folded into done index
- `crossEngagement.toPromptBlock()` → folded into done index

### Task 4.3: Rewrite enriched goal builder in `solver.ts`

**File:** `src/solver/solver.ts`
**Change:** Replace lines 486-686 (ad-hoc section builders) with `buildBudgetedGoal()` call.

**Before:** ~10 independent section builders, each with their own caps, total unbounded.
**After:** Single `buildBudgetedGoal()` call with priority-ordered sections, 8K token hard cap.

### Task 4.4: Cap blackboard growth

**File:** `src/core/blackboard.ts`
**Change:** Add max bounds to `facts[]`, `intents[]`, `plan[]` arrays. When exceeded, drop oldest or summarize.

```typescript
private maxFacts = 50
private maxIntents = 20
private maxPlanItems = 15

addFact(text: string, type: string) {
  this.facts.push({ text, type, timestamp: Date.now() })
  if (this.facts.length > this.maxFacts) {
    this.facts = this.facts.slice(-this.maxFacts)
  }
}
```

### Task 4.5: Fix `conversationHistory: ""` lie

**File:** `src/solver/solver.ts`
**Change:** At lines 715-721 and 739-746, pass actual conversation history instead of empty string.

```typescript
// BEFORE:
conversationHistory: "",

// AFTER:
conversationHistory: historyString, // from agent's message history
```

---

## Phase 5: CompressionService + Overflow Safety (V4 compression + V5)

### Task 5.1: Singleton pattern for `CompressionService`

**File:** `src/compression/headroom-service.ts`
**Change:** Add module-level singleton. Replace `new CompressionService()` per-call with `getCompressionService()`.

### Task 5.2: Model-aware token budget

**File:** `src/compression/headroom-service.ts`
**Change:** `compressResponse()` accepts optional `modelId`. Resolves token budget from `ContextWindowRegistry` (10% of context window per response).

### Task 5.3: Verification invariant — never expand

**File:** `src/compression/headroom-service.ts`
**Change:** After every compression path, verify `compressedSize < originalSize`. If not, return original unchanged.

### Task 5.4: Fix `extractText()` → `extractToolResponse()`

**File:** `src/compression/headroom-service.ts`
**Change:** Only extract from `role: 'tool'` messages, not system prompt wrapper.

### Task 5.5: Fix headroom fallback detection

**File:** `src/compression/headroom-service.ts`
**Change:** After `compress()`, check `result.compressed === false` → fall through to local compaction.

### Task 5.6: Disable headroom by default

**File:** `src/config.ts`
**Change:** `compression.headroom.enabled: false` (was `true`). `maxResponseSize: 50000` (was `200000`).

### Task 5.7: Add 5% safety margin to overflow handler

**File:** `src/models/overflow-handler.ts`
**Change:** Line 53: `estimatedTokens > contextWindow * 0.95` (was `> contextWindow`).

### Task 5.8: Update tool call sites to use singleton

**Files:** `src/tools/http-tools.ts` (4 sites), `src/tools/observation-tools.ts` (2 sites)
**Change:** Replace `new CompressionService().compressResponse(body)` with `getCompressionService(config).compressResponse(body, config.model)`.

---

## Phase 6: Tests

### Task 6.1: `test/graph/tool-result-store.test.ts` (NEW)

Tests: store returns compact ref, get retrieves full data, non-existent ref returns null, summary generation.

### Task 6.2: `test/solver/budgeted-goal.test.ts` (NEW)

Tests: sections sorted by priority, budget respected, truncation works, empty input handled.

### Task 6.3: `test/solver/done-index.test.ts` (NEW)

Tests: tested endpoints listed, untested shown, failed approaches included, token budget respected.

### Task 6.4: `test/compression/headroom-service.test.ts` (NEW/UPDATE)

Tests: headroom fallback detection, never-expand invariant, extractToolResponse only extracts tool messages, singleton behavior, model-aware budget.

### Task 6.5: Update existing tests

- `test/tools/http-tools.test.ts` — httpRequest now returns `bodyRef` instead of full body
- `test/manager/spawn-worker.test.ts` — worker returns compact result, not FullOutput
- `test/models/overflow-handler.test.ts` — 5% margin in classifyOverflow
- `test/solver/solver.test.ts` — enriched goal uses buildBudgetedGoal

---

## Dependency Graph

```
Phase 1 (TokenLimiter) ─────────────────────── no dependencies
Phase 2 (Observational Memory) ─────────────── no dependencies  
Phase 3 (Ref-Store) ────────────────────────── depends on Phase 1 (brain tools file)
Phase 4 (Goal Budget) ──────────────────────── depends on Phase 3 (done index reads graph)
Phase 5 (CompressionService) ───────────────── no dependencies
Phase 6 (Tests) ────────────────────────────── depends on Phases 1-5
```

**Phases 1, 2, 5 can be built in parallel.**
**Phase 3 depends on Phase 1 (same file: brain-tools.ts).**
**Phase 4 depends on Phase 3 (done index reads graph via ref-store).**

---

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Intra-turn context growth | ~150K tokens (50 rounds × 3K) | Capped at `contextWindow × 0.7` |
| Cross-turn context growth | Unbounded | Compressed by OM at proportional threshold (25% of window) |
| Worker result in brain | UNBOUNDED (FullOutput) | ~500 tokens (text + graphDiff) |
| Tool result in brain | 5K-50K tokens per call | ~100 tokens (ref + preview) |
| Enriched goal | 6K-15K tokens | ~5-13K tokens (proportional: 5% of context window) |
| Blackboard state | UNBOUNDED | ~500 tokens (capped) |
| Re-testing prevention | Full facts list | ~200 tokens (done index) |
| Compression expansion | Can expand 1.5% | Never-expand invariant |

---

## Implementation Order (Recommended)

Build order based on dependency graph and impact:

1. **Phase 5** (CompressionService + Overflow) — Quick wins, fixes broken compression
2. **Phase 1** (TokenLimiterProcessor) — Highest impact, native Mastra feature
3. **Phase 2** (Observational Memory) — Config change, native Mastra feature
4. **Phase 3** (Ref-Store) — Most files changed, but clean pattern
5. **Phase 4** (Goal Budget + Done Index) — Depends on Phase 3
6. **Phase 6** (Tests) — After each phase, verify

**Estimated scope:** ~15 files modified, 4 new files, ~50 new tests.

---

## Verification Commands

After each phase:
```bash
npm test          # All 1761 tests pass
npm run build:cli # Clean build (ESM + CJS + DTS)
npm run lint      # 0 errors
```
