# Ultimatrix v8.1 — Multi-Model Architecture & Budget-Aware Tool Delegation

> **Status**: DRAFT — Awaiting Review
> **Date**: 2026-07-04
> **Baseline**: 852 tests, 57 files, clean build (ESM 1.16MB + CJS 1.18MB + DTS)
> **Scope**: Generic tool delegation, provider-aware rate limiting, multi-model brain, budget-aware pruning, target-aware skills, context management

---

## Table of Contents

- [0. Critical Pre-Implementation Findings](#0-critical-pre-implementation-findings)
- [1. Problem Statement](#1-problem-statement)
- [2. Design Decisions (User-Confirmed)](#2-design-decisions-user-confirmed)
- [3. Architecture Overview](#3-architecture-overview)
- [4. Phase 0 — Config Schema & Data Models](#4-phase-0--config-schema--data-models)
- [5. Phase 0.5 — Token Usage Extraction Pipeline](#5-phase-05--token-usage-extraction-pipeline)
- [6. Phase 1 — Provider-Aware Rate Limiting](#6-phase-1--provider-aware-rate-limiting)
- [7. Phase 2 — Model Selection Service](#7-phase-2--model-selection-service)
- [8. Phase 3 — Dynamic Tool Discovery & Budget](#8-phase-3--dynamic-tool-discovery--budget)
- [9. Phase 4 — Brain & Worker Integration](#9-phase-4--brain--worker-integration)
- [10. Phase 5 — Skill Tier Defaults & Target-Aware Matching](#10-phase-5--skill-tier-defaults--target-aware-matching)
- [11. Phase 6 — Context Window Management](#11-phase-6--context-window-management)
- [12. Phase 7 — Observability & Forensic Logging](#12-phase-7--observability--forensic-logging)
- [13. Phase 8 — CLI Extensions](#13-phase-8--cli-extensions)
- [14. Phase 9 — Legacy Engine Compatibility](#14-phase-9--legacy-engine-compatibility)
- [15. Phase 10 — Testing & Calibration](#15-phase-10--testing--calibration)
- [16. Dependency Graph](#16-dependency-graph)
- [17. File Impact Matrix](#17-file-impact-matrix)
- [18. Migration Checklist](#18-migration-checklist)
- [19. Risk Register](#19-risk-register)
- [20. Gap Analysis](#20-gap-analysis--identified--addressed)
- [21. Edge Cases Catalog](#21-edge-cases-catalog)

---

## 0. Critical Pre-Implementation Findings

> These are real technical constraints discovered by auditing the actual codebase. **Every item below must be addressed before Phase 4** or the token tracking system will be built on sand.

### F1: Token Usage Is NEVER Extracted From Model Responses (CRITICAL)
- **Current state**: `SolveResult.tokensUsed = fullText.length` (`src/solver/solver.ts:483`) — this is **character count**, not token count
- **Root cause**: The solver's streaming loop handles `text-delta`, `tool-call`, `tool-result`, `tool-error` but **never reads the `finish` chunk** which contains `LanguageModelV2Usage`
- **Impact**: Without real token data, ALL budget tracking, token profiling, and dashboard features are meaningless
- **Fix required in Phase 1** (before anything else):
  - Add `'finish'` chunk handler to solver's `consumeStream()` that captures `chunk.usage`
  - Add `'finish'` chunk handler to `wrapModel()` middleware that captures usage from both `doStream` and `doGenerate`
  - `LanguageModelV2Usage` type (from `@ai-sdk/provider`): `{ inputTokens: number | undefined; outputTokens: number | undefined; totalTokens: number | undefined }`
  - Some providers return `undefined` for usage fields — must handle gracefully

### F2: `wrapModel()` Proxy Does Not Capture Response Data (CRITICAL)
- **Current state**: `src/models/middleware.ts:63` — `return originalMethod.call(target, args)` passes response through untouched
- **Impact**: Even if usage is in the response, the middleware discards it
- **Fix required**: Modify Proxy to intercept response, extract `usage`, and forward to `UsageTracker` + `TokenProfiler`

### F3: `UsageTracker` Is Completely Disconnected (CRITICAL)
- **Current state**: `src/usage/tracker.ts` — `record()` method exists but **nothing in the codebase calls it**
- **Impact**: Token tracking infrastructure exists but is dead code
- **Fix required**: Wire `wrapModel()` middleware → `UsageTracker.record()` on every model call

### F4: Streaming Finish Chunk Not Handled (CRITICAL)
- **Current state**: `src/solver/solver.ts` streaming loop has no `finish` case. Also `src/session.ts` `consumeStream()` (legacy) has no `finish` case
- **Impact**: Usage data from streaming responses is silently dropped
- **Fix required**: Add `case 'finish':` to both solver and legacy stream consumers

### F5: No Direct `ai` SDK — Types Come From `@ai-sdk/provider` (MEDIUM)
- **Current state**: `package.json` has no direct `ai` dependency. `LanguageModelV2` and `LanguageModelV2Usage` come from `@ai-sdk/provider` transitively through `@mastra/core`
- **Impact**: All type imports must use `@ai-sdk/provider` paths, not `ai` paths
- **Fix required**: Ensure all new code imports types from `@ai-sdk/provider` (or via Mastra re-exports)

### F6: Tool Schema Token Overhead Not Accounted (MEDIUM)
- **Current state**: 48 tools with full Zod schemas. Each tool schema ≈ 150-400 tokens when serialized
- **Impact**: 48 tools × ~250 tokens = ~12,000 tokens consumed by tool schemas alone on EVERY model call. This is 24% of an 8K context window (groq/llama3-8b)
- **Fix required**: 
  - `ContextBudgetManager` must include tool schema tokens in its calculation
  - Dynamic tool selection reduces this (prune tools → fewer schema tokens)
  - `selectModel` tool adds ~200 tokens to brain's schema — factor into brain budget

### F7: DynamicArgument Feasible But Not Used Anywhere (LOW RISK)
- **Current state**: Mastra `@mastra/core` ^1.42.0 supports `tools?: DynamicArgument<TTools, TRequestContext>` — confirmed in type definitions
- **Impact**: Switching is feasible, but every `new Agent({ tools: staticObject })` call must be migrated
- **Migration path**: 3 sites to change:
  1. `src/mastra/index.ts:createAgent()` — worker/legacy agents
  2. `src/solver/brain-tools.ts:createSolverBrain()` — brain agent
  3. `src/spider/agent.ts:createSpiderAgent()` — spider agent

### F8: Zod v4 Compatibility for Dynamic Tool Filters
- **Current state**: `zod@^4.0.0` — Major version with potential breaking changes from v3
- **Impact**: `sanitizeTool()` in `src/models/schema-sanitizer.ts` uses `createSanitizedInputSchema()` which converts Zod schemas to JSON Schema. Must verify v4 compatibility
- **Fix required**: Test that `createSanitizedInputSchema()` works with Zod v4 Standard Schema protocol

### F9: `selectModel` Tool Adds Brain Schema Overhead
- **Current state**: Brain already has ~30 tools (12K tokens of schemas)
- **Impact**: Adding `selectModel` adds ~200 tokens. Brain's context budget tightens further
- **Mitigation**: Make `selectModel` optional — only include when `engine: 'multi-model'`

---

## 1. Problem Statement

The v8 architecture introduced rigidity through several hardcoded patterns that prevent real-world deployment across diverse providers and budgets:

| Problem | Location | Impact |
|---------|----------|--------|
| **Hardcoded tool lists** | `CORE_TOOLS` (35 tools in `tool-filter.ts`), brain-tools (30 tools), legacy workers (4 fixed agents) | New tools require code changes in 3+ places |
| **Global single-config rate limiter** | `SlidingWindowLimiter` in `rate-limiter.ts`, `wrapModel` in `middleware.ts` | NVIDIA backoff (5s/15s/30s) baked in; no per-provider limits |
| **Static agent creation** | `WorkerFactory.create()` uses fixed `CORE_TOOLS` + skill `toolRefs` | No budget awareness; no dynamic pruning |
| **Blind skill matching** | `resolveSkillsForInput(userInput)` keyword-only in `tool-filter.ts` | Skills matched by user text, not graph state or target |
| **No multi-model routing** | Brain picks tier, supervisor picks tier — no capability/token/rate awareness | Wrong model for complex tasks; wasted tokens on simple tasks |
| **No budget enforcement** | `maxToolCalls` is the only limit | Unlimited API usage possible; no token tracking |
| **No context validation** | Enriched goal truncated to `getEnrichedGoalCap` but tool schemas + history unchecked | Silent context overflow, truncated responses |
| **Config schema split** | `config.ts` interfaces vs `config/schema.ts` Zod — two sources of truth | Drift risk, incomplete validation |

**Root cause**: Not bad architecture — incomplete wiring. The solver engine, worker pool, skill system, and rate limiter were built as independent modules without a unifying delegation/budget layer.

---

## 2. Design Decisions (User-Confirmed)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Budget enforcement mode | **Configurable**: `hard` (throw), `soft` (warn + prune), `warn` (log only) |
| Q2 | External tool API rate limits | **TBD** — needs further discussion |
| Q3 | Fallback behavior (no provider credits) | **Configurable**: `fail-fast`, `degrade`, `queue` |
| Q4 | Session model locking | **Flexible**: allow override per-agent, not rigid lock |
| Q5 | Legacy engine in multi-model | **Full support but secondary**: legacy kept for comparison, solver is primary |
| Q6 | Token tracking | **Optional**: configurable per-session |
| Q7 | Rate limit source | **Both headers + config**: sync from headers, warn on mismatch, context limiting too |
| Q8 | Tool weight estimation | **Empirical/calibration-based** (real-world scenario data), not heuristic pre-defined |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         CONFIG LAYER                                    │
│  ultimatrix.yaml + rate-limits.yaml + modelCapabilities + budgetPolicy  │
│  Single source: src/config.ts (validated by config/schema.ts)           │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                         MODEL LAYER                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ ProviderAware    │  │ HeaderSync       │  │ ModelSelector        │  │
│  │ Limiter          │  │ Limiter          │  │ (capability + budget │  │
│  │ (per-provider)   │  │ (reads headers)  │  │  + empirical data)   │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           └─────────────────────┼────────────────────────┘              │
│                                 │                                       │
│  ┌──────────────────┐  ┌───────▼──────────┐  ┌──────────────────────┐  │
│  │ resolveModel()   │◄─│ wrapModel()      │  │ QuotaTracker         │  │
│  │ (tier -> model)  │  │ (middleware)     │  │ (exhaustion detect)  │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                         TOOL LAYER                                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ DynamicTool      │  │ TokenProfiler      │  │ BudgetAwarePruner    │  │
│  │ Selector         │  │ (empirical data)   │  │ (prune tools to      │  │
│  │ (task+graph+bgt) │  │                    │  │  fit budget)         │  │
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────┘  │
│           └─────────────────────┼────────────────────────┘              │
│                                 │                                       │
│  Tool Registry (src/mastra/tools.ts) — 70 tools, Zod schemas           │
│  Skill toolRefs (21 skills/*.md) — tool name strings                    │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                         AGENT LAYER                                     │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────┐  │
│  │ Brain Agent      │  │ Worker Pool      │  │ Legacy Supervisor    │  │
│  │ (dynamic tools   │  │ (per-spawn model │  │ (single model,       │  │
│  │  + model select) │  │  + tool set)     │  │  for comparison)     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │
┌────────────────────────────────▼────────────────────────────────────────┐
│                    OBSERVABILITY LAYER                                   │
│  ForensicLog (extended) + BudgetDashboard + ConfigMismatchDetector      │
│  ContextBudgetManager + TokenProfiler                                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Phase 0 — Config Schema & Data Models

> **Goal**: Single source of truth for all config. Extend `UltimatrixConfig` with model capabilities, budget policy, and per-provider rate limits.

### Dependencies: None (foundational)

### Tasks

#### 0.1 — Merge Config Schemas
- [ ] **File**: `src/config/schema.ts`
  - Current Zod schema has fields (`target`, `credentials`, `browserOptions`, `outputDir`, `skillsDir`) that overlap with `config.ts` interfaces
  - Merge into single schema in `config.ts`, delete `config/schema.ts` OR make `schema.ts` re-export from `config.ts`
  - Validate: `UltimatrixConfigSchema` must cover all fields from `UltimatrixConfig` interface
- [ ] **File**: `src/config.ts`
  - Ensure `validateConfig()` uses the merged Zod schema

#### 0.2 — Add Model Capabilities Interface
- [ ] **File**: `src/config.ts`
  - Add `ModelCapability` interface:
    ```typescript
    interface ModelCapability {
      contextWindow: number
      maxOutputTokens: number
      maxTokensPerMinute?: number      // TPM limit (some providers enforce separately)
      strengths: string[]              // e.g., ["speed", "reasoning", "json-mode", "vision"]
      supportsStreaming: boolean
      supportsStructuredOutput: boolean
      supportsVision?: boolean
    }
    ```
  - Add `ModelCapabilities` type: `Record<string, ModelCapability>` (key = "provider/model")
  - Extend `UltimatrixConfig` with optional `modelCapabilities?: ModelCapabilities`

#### 0.3 — Add Budget Policy Interface
- [ ] **File**: `src/config.ts`
  - Add `BudgetPolicy` interface:
    ```typescript
    interface BudgetPolicy {
      enforcement: 'hard' | 'soft' | 'warn'
      scope: 'turn' | 'session'       // 'turn' = reset each REPL turn, 'session' = cumulative
      resetOn: 'turn' | 'never'        // when budget counters reset
      allocation: {
        brain: number       // fraction of maxModelCallsPerTask, default 0.3
        workers: number     // fraction, default 0.6
        spider: number      // fraction, default 0.1
      }
      maxModelCallsPerTask: number     // default 15
      maxTokensPerSession?: number     // total token cap, optional
      trackTokens: boolean             // default false
    }
    ```
  - Add `ToolTokenProfile` interface:
    ```typescript
    interface ToolTokenProfile {
      toolId: string
      avgModelCalls: number
      avgInputTokens: number
      avgOutputTokens: number
      externalApiCalls?: Array<{ service: string; avgCallsPerExecution: number }>
      lastUpdated: string
      sampleCount: number
    }
    ```
  - Extend `UltimatrixConfig` with optional `budgetPolicy?: BudgetPolicy`
  - Add `DEFAULTS.budgetPolicy` with sane defaults

#### 0.4 — Add Extended Rate Limit Config
- [ ] **File**: `src/config.ts`
  - Extend `RateLimitConfig` with provider-specific options:
    ```typescript
    interface RateLimitConfig {
      requestsPerMinute: number       // existing (global fallback)
      tokensPerMinute?: number        // NEW: TPM limit (some providers enforce separately)
      maxConcurrent: number           // existing
      retryOnLimit: boolean           // existing
      maxRetries: number              // existing
      // NEW
      backoffStrategy: 'exponential' | 'stepped' | 'fixed'
      backoffSteps?: number[]         // for stepped: [5000, 15000, 30000]
      baseBackoffMs: number           // default 2000
      maxBackoffMs: number            // default 30000
      useHeaders: boolean             // default true for known providers
      headerMapping?: {
        remaining?: string
        reset?: string
        retryAfter?: string
        tokensRemaining?: string      // NEW: x-ratelimit-tokens-remaining
        tokensReset?: string          // NEW: x-ratelimit-tokens-reset
      }
    }
    ```
  - Add `ProviderRateLimits` type: `Record<string, RateLimitConfig>` (per-provider overrides)
  - Extend `UltimatrixConfig` with optional `providerRateLimits?: ProviderRateLimits`

#### 0.5 — Add Engine Selection Type
- [ ] **File**: `src/config.ts`
  - Extend `EngineType` to include `'multi-model'` (solver with model selection):
    ```typescript
    type EngineType = 'legacy' | 'solver' | 'multi-model'
    ```
  - `multi-model` = solver engine + `ModelSelector` + `DynamicToolSelector` + budget enforcement

#### 0.6 — Update Zod Validation
- [ ] **File**: `src/config/schema.ts`
  - Add Zod schemas for: `ModelCapability`, `BudgetPolicy`, `ToolTokenProfile`, extended `RateLimitConfig`
  - Validate `modelCapabilities` entries: `contextWindow > 0`, `strengths` non-empty, `maxTokensPerMinute > 0` if provided
  - Validate `budgetPolicy`: `allocation` sums ≤ 1.0, `maxModelCallsPerTask > 0`, `maxTokensPerSession > 0`, `scope` and `resetOn` are valid enum values
  - Validate `providerRateLimits`: RPM > 0, TPM > 0 if provided, backoff steps ascending

#### 0.7 — Update `loadConfig()` and `saveProjectConfig()`
- [ ] **File**: `src/config.ts`
  - `loadConfig()`: merge `ultimatrix.yaml` + `~/.config/ultimatrix/rate-limits.yaml` + env vars
  - Validate: all `modelTiers` providers have matching `creds` entries
  - Validate: `budgetPolicy.allocation` sums ≤ 1.0
  - `saveProjectConfig()`: preserve new fields on write

#### 0.8 — Tests
- [ ] **File**: `test/config/config.test.ts` (NEW)
  - Test `ModelCapability` validation
  - Test `BudgetPolicy` validation (allocation sum, positive values)
  - Test `RateLimitConfig` validation (backoff strategy, header mapping)
  - Test `loadConfig()` merge behavior (YAML + rate-limits + env)
  - Test backward compatibility (existing configs without new fields load fine)
  - Test `saveProjectConfig()` roundtrip with new fields

### Deliverables
- `src/config.ts` with all new interfaces and defaults
- Updated `src/config/schema.ts` with Zod schemas
- `test/config/config.test.ts` with ≥15 tests

---

## 5. Phase 0.5 — Token Usage Extraction Pipeline (CRITICAL PREREQUISITE)

> **Goal**: Extract real `inputTokens`/`outputTokens` from every model call. Wire into `UsageTracker` and `TokenProfiler`. This MUST work before any budget tracking, profiling, or dashboard features.

### Dependencies: Phase 0

### Tasks

#### 0.5.1 — Add `finish` Chunk Handler to Solver Streaming Loop
- [ ] **File**: `src/solver/solver.ts`
  - In the `consumeStream` / chunk processing loop, add:
    ```typescript
    case 'finish':
      // Capture real token usage from model response
      if (chunk.usage) {
        currentUsage = {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
          totalTokens: chunk.usage.totalTokens ?? (chunk.usage.inputTokens ?? 0) + (chunk.usage.outputTokens ?? 0),
        }
      }
      break
    ```
  - Store `currentUsage` on the `SolveResult`:
    ```typescript
    interface SolveResult {
      // ... existing fields
      tokenUsage?: { inputTokens: number; outputTokens: number; totalTokens: number }
    }
    ```
  - **Replace** `tokensUsed: fullText.length` with `tokenUsage: currentUsage` in the return value
  - Add fallback: if `chunk.usage` is undefined (provider didn't return it), estimate from `fullText.length / 4` (chars ÷ 4 ≈ tokens)

#### 0.5.2 — Add `finish` Handler to Legacy Stream Consumer
- [ ] **File**: `src/session.ts`
  - In `consumeStream()`, add `case 'finish':` that captures `chunk.usage`
  - Wire to `UsageTracker.record()` (see 0.5.4)

#### 0.5.3 — Modify `wrapModel()` Proxy to Capture Usage
- [ ] **File**: `src/models/middleware.ts`
  - Currently: `return originalMethod.call(target, args)` — discards response
  - Change to:
    ```typescript
    const response = await originalMethod.call(target, args)

    // Extract usage from response (works for both doGenerate and doStream)
    if (response && typeof response === 'object') {
      const usage = response.usage
      if (usage) {
        const provider = extractProvider(modelId)
        const modelIdStr = extractModelId(modelId)
        // Forward to UsageTracker
        usageTracker.record(provider, modelIdStr, usage.totalTokens ?? 0)
        // Forward to TokenProfiler if available
        tokenProfiler?.recordExecution('model-call', {
          toolId: 'model-call',
          modelCalls: 1,
          inputTokens: usage.inputTokens ?? 0,
          outputTokens: usage.outputTokens ?? 0,
          externalApiCalls: 0,
          durationMs: Date.now() - startTime,
          success: true,
          modelId: modelIdStr,
        })
      }
    }

    return response
    ```
  - **Important**: `doStream` returns a stream, not a response object. Usage comes from the `finish` event inside the stream, not from the return value. So the Proxy captures usage for `doGenerate` directly, but for `doStream` the usage must be captured by the stream consumer (solver/legacy) via the `finish` chunk.
  - Add a helper: `captureUsageFromResponse(response, modelId, usageTracker, tokenProfiler)`

#### 0.5.4 — Wire `UsageTracker.record()` Into Model Pipeline
- [ ] **File**: `src/usage/tracker.ts`
  - Keep existing interface but add input/output distinction:
    ```typescript
    interface UsageEntry {
      provider: string
      model: string
      inputTokens: number
      outputTokens: number
      totalTokens: number
      timestamp: number
    }
    ```
  - Update `record()` signature: `record(provider, model, inputTokens, outputTokens)`
  - Update `getTotal()`: `{ inputTokens, outputTokens, totalTokens, calls }`
  - Update `getByProvider()`: group by provider with input/output breakdown
  - Update `printSummary()`: show input/output/total
  - **Deprecate** `cost` field (set to 0, keep for backward compat)

#### 0.5.5 — Integration Test: Verify Token Extraction
- [ ] **File**: `test/models/token-extraction.test.ts` (NEW)
  - Test: mock model returns `usage: { inputTokens: 100, outputTokens: 50 }` → solver captures it
  - Test: mock model returns no usage → fallback estimation kicks in
  - Test: `UsageTracker.record()` called after model call
  - Test: streaming `finish` chunk provides usage
  - Test: `doGenerate` response provides usage
  - Test: `wrapModel()` Proxy passes usage through

### Deliverables
- Updated `src/solver/solver.ts` — real token usage in SolveResult
- Updated `src/session.ts` — finish chunk in legacy stream
- Updated `src/models/middleware.ts` — usage capture for doGenerate
- Updated `src/usage/tracker.ts` — input/output token tracking
- `test/models/token-extraction.test.ts` — ≥8 tests

---

## 6. Phase 1 — Provider-Aware Rate Limiting

> **Goal**: Replace global `SlidingWindowLimiter` with per-provider rate limiters. Sync from response headers. Detect config/header mismatches.

### Dependencies: Phase 0

### Tasks

#### 1.1 — Create `ProviderAwareLimiter`
- [ ] **File**: `src/models/provider-limiter.ts` (NEW)
  - Class `ProviderAwareLimiter`:
    - Constructor takes `provider: string`, `config: RateLimitConfig`
    - Internally creates `SlidingWindowLimiter` + `Semaphore` per provider
    - `acquire()`: acquires both window slot and semaphore
    - `release()`: releases semaphore
    - `getAvailable()`: remaining window slots
    - `getConcurrent()`: remaining semaphore slots
    - `cooldown(ms)`: sets global pause (reuses existing `cooldown()` logic)
    - `syncFromHeaders(headers: Record<string, string>)`: reads `x-ratelimit-remaining`, `x-ratelimit-reset`, `retry-after`, `x-ratelimit-tokens-remaining`, `x-ratelimit-tokens-reset` per `headerMapping` config
    - `recordExhaustion()`: detects cumulative quota exhaustion (existing regex pattern)
    - `getStatus()`: returns `{ provider, used, available, concurrent, inCooldown, lastSync }`

#### 1.2 — Create `LimiterFactory`
- [ ] **File**: `src/models/limiter-factory.ts` (NEW)
  - `createProviderLimiter(provider: string, config: UltimatrixConfig): ProviderAwareLimiter`
  - Looks up `config.providerRateLimits[provider]` first, falls back to `config.rateLimit`
  - Maintains a `Map<string, ProviderAwareLimiter>` cache (one per provider per process)
  - `resetAllProviderLimiters()`: clears cache (for testing)

#### 1.3 — Create `QuotaTracker`
- [ ] **File**: `src/models/quota-tracker.ts` (NEW)
  - Class `QuotaTracker`:
    - Tracks per-provider: `{ used, limit, resetTime, exhaustionCount, lastExhaustion }`
    - `recordRequest(provider)`: increment used count
    - `recordExhaustion(provider)`: increment exhaustion count, set cooldown
    - `isExhausted(provider)`: returns true if in cooldown
    - `getStatus()`: returns all providers' quota status
    - Persist to forensic log on each exhaustion event

#### 1.4 — Update `wrapModel()` Middleware
- [ ] **File**: `src/models/middleware.ts`
  - Replace global `getSharedLimiter()` with `createProviderLimiter(provider)`
  - Extract provider from `modelId` string (split on `/`, take first part)
  - Before each `doStream`/`doGenerate`:
    - `limiter.acquire()` (per-provider window + semaphore)
  - After response:
    - `limiter.syncFromHeaders(response.headers)`
    - `quotaTracker.recordRequest(provider)`
  - On 429/quota error:
    - `limiter.recordExhaustion()`
    - Retry with provider's configured backoff strategy (not hardcoded 5s/15s/30s)
    - `quotaTracker.recordExhaustion(provider)`
  - After each call:
    - Compare `limiter.getAvailable()` with header `x-ratelimit-remaining`
    - If mismatch > 5: log warning, optionally `limiter.syncFromHeader(headerRemaining)`

#### 1.5 — Config Mismatch Detection
- [ ] **File**: `src/models/middleware.ts` (extend 1.4)
  - After each model call, if `useHeaders` is true:
    - Compare local remaining vs header remaining
    - If `|local - header| > threshold`: `log.warn('Rate limit mismatch for ${provider}: local=${local}, header=${header}')`
    - If `configMismatchAutoSync: true` in config: auto-adjust local limiter to header value
  - Log mismatch events to forensic log

#### 1.6 — Delete Old Singletons (or mark deprecated)
- [ ] **File**: `src/models/rate-limiter.ts`
  - Keep `SlidingWindowLimiter` and `Semaphore` classes (reused internally)
  - Mark `getSharedLimiter()`, `getSharedSemaphore()`, `resetSharedInstances()` as `@deprecated`
  - These are now only used as fallback when `providerRateLimits` is not configured

#### 1.7 — Tests
- [ ] **File**: `test/models/provider-limiter.test.ts` (NEW)
  - Test per-provider window tracking (separate providers don't interfere)
  - Test `syncFromHeaders()` parses standard header formats
  - Test config mismatch detection (local vs header divergence)
  - Test cooldown per provider (one provider exhausted doesn't affect others)
  - Test backoff strategies: exponential, stepped, fixed
- [ ] **File**: `test/models/middleware.test.ts` (UPDATE)
  - Test middleware uses per-provider limiter (not global)
  - Test retry uses provider's backoff strategy
  - Test header sync after successful call
  - Test mismatch warning on divergence
- [ ] **File**: `test/models/quota-tracker.test.ts` (NEW)
  - Test exhaustion tracking per provider
  - Test `isExhausted()` during cooldown period

### Deliverables
- `src/models/provider-limiter.ts` — `ProviderAwareLimiter` class
- `src/models/limiter-factory.ts` — factory with caching
- `src/models/quota-tracker.ts` — quota tracking per provider
- Updated `src/models/middleware.ts` — per-provider rate limiting
- ≥20 new tests

---

## 7. Phase 2 — Model Selection Service

> **Goal**: Brain/worker can select optimal model based on task complexity, capability match, budget, and rate limit headroom.

### Dependencies: Phase 0, Phase 1

### Tasks

#### 2.1 — Create `ModelSelector`
- [ ] **File**: `src/models/selector.ts` (NEW)
  - Class `ModelSelector`:
    - Constructor: `(capabilities: ModelCapabilities, limiterFactory: LimiterFactory, budgetPolicy: BudgetPolicy, toolProfiler: TokenProfiler)`
    - `selectForTask(task: WorkerTask, agentRole: 'brain' | 'worker' | 'spider'): ModelSelection`
      - Calculate task budget (agentRole × allocation × maxModelCallsPerTask)
      - Get all available models (have credentials + not exhausted)
      - Score each model: capability match + token efficiency + context headroom + rate limit headroom + empirical success rate
      - If no model fits budget: `fallbackSelection()` (cheapest model + reduced tool set)
    - `selectTierForSkill(skillId: string, taskComplexity: string): string`
      - Look up skill's default tier from frontmatter
      - Adjust based on task complexity
    - `explainSelection(selection: ModelSelection, task: WorkerTask): string`
      - Human-readable explanation of why this model was chosen

#### 2.2 — Define `ModelSelection` Type
- [ ] **File**: `src/models/selector.ts`
  - Types:
    ```typescript
    interface ModelSelection {
      tier: string
      provider: string
      modelId: string
      reasoning: string
      budget: TaskBudget
      estimatedTokens: number
      estimatedDuration: number
    }

    interface TaskBudget {
      estimatedModelCalls: number
      estimatedInputTokens: number
      estimatedOutputTokens: number
      maxAllowedModelCalls: number
      maxAllowedTokens: number
      toolSet: string[]
      prunedTools: string[]
    }

    interface WorkerTask {
      skillId: string
      taskDescription: string
      endpointId?: string
      complexity: 'low' | 'medium' | 'high' | 'critical'
      requiredCapabilities?: string[]
      graphState?: GraphSummary
    }
    ```

#### 2.3 — Implement Scoring Algorithm
- [ ] **File**: `src/models/selector.ts`
  - `scoreModel(model, task, budget)`:
    - **Capability match** (+20 per matching strength)
    - **Context headroom** (+10 if >20k headroom, +5 if >5k)
    - **Rate limit headroom** (+10 if RPM available > estimated × 2)
    - **TPM headroom** (+5 if tokens available > estimated × 2)
    - **Empirical success rate** (+0-20 based on historical success for this skill+model combo)
    - **Complexity alignment** (+15 if model complexity matches task complexity)
    - **Provider diversity** (+5 if this provider not already used by brain/workers — avoids shared quota)

#### 2.4 — Implement Budget Calculation
- [ ] **File**: `src/models/selector.ts`
  - `calculateBudget(task, agentRole)`:
    - `allocation = budgetPolicy.allocation[agentRole]`
    - `maxModelCalls = floor(budgetPolicy.maxModelCallsPerTask × allocation)`
    - `maxTokens = budgetPolicy.maxTokensPerSession ? budgetPolicy.maxTokensPerSession × allocation : Infinity`
    - For each tool in task: add `toolProfiler.getProfile(tool).avgModelCalls` and token estimates
    - If total model calls > maxModelCalls: call `BudgetAwarePruner.pruneToBudget()`
    - Return `TaskBudget` with `toolSet` and `prunedTools`

#### 2.5 — Implement Fallback Selection
- [ ] **File**: `src/models/selector.ts`
  - `fallbackSelection(task, agentRole)`:
    - Find model with most available rate limit headroom (most tokens accessible)
    - Reduce tool set to essentials only
    - Set `budget.enforcement = 'soft'` (auto-prune, don't fail)
    - Log fallback event with reason

#### 2.6 — Integrate into `resolveModel()`
- [ ] **File**: `src/models/factory.ts`
  - Add overload: `resolveModel(config, options: { modelId?: string; tier?: string; selector?: ModelSelector })`
  - If `selector` provided: use `selector.selectForTask()` to pick model
  - If explicit `modelId` provided: resolve directly (skip selector)
  - If `tier` provided: use existing logic
  - If none: use `config.model` (default)

#### 2.7 — Tests
- [ ] **File**: `test/models/selector.test.ts` (NEW)
  - Test scoring: capability match, context headroom, TPM headroom
  - Test budget calculation: allocation fractions, tool token summation
  - Test pruning: over-budget tool set gets reduced
  - Test fallback: no provider credits → model with most headroom
  - Test rate limit headroom: avoid exhausted providers
  - Test provider diversity: avoid same provider for brain+workers
  - Test explanation: `explainSelection()` returns readable string
- [ ] **File**: `test/models/factory.test.ts` (UPDATE)
  - Test new overload with `selector` option
  - Test fallback to default when no selector

### Deliverables
- `src/models/selector.ts` — `ModelSelector` class with scoring, budget, fallback
- Updated `src/models/factory.ts` — new overload
- ≥20 new tests

---

## 8. Phase 3 — Dynamic Tool Discovery & Budget

> **Goal**: Replace all hardcoded tool lists with runtime discovery from the tool registry. Add budget-aware pruning.

### Dependencies: Phase 0

### Tasks

#### 7.1 — Create `DynamicToolSelector`
- [ ] **File**: `src/tools/tool-selector.ts` (NEW)
  - Class `DynamicToolSelector`:
    - Constructor: `(registry: ToolRegistry, profiler: TokenProfiler, matcher: SkillMatcher)`
    - `selectTools(task: WorkerTask, budget: TaskBudget): string[]`
      1. Start with universal tools: `['updateGraph', 'writeFinding', 'recordEvidence']`
      2. Add skill-specific tools from `matcher.matchSkills(task)`
      3. Add task-inferred tools (e.g., task mentions "SQLi" → add `checkWaf`, `measureTiming`)
      4. If total estimated model calls > budget: prune via `BudgetAwarePruner`
      5. Always keep universal tools (never pruned)
    - `getUniversalTools(): string[]` — returns hardcoded essentials (5-8 tools)
    - `inferToolsFromTask(task: WorkerTask): string[]` — keyword → tool mapping (configurable)
  - Types:
    ```typescript
    interface ToolInferenceRule {
      keywords: string[]           // ["sqli", "sql injection", "blind sqli"]
      tools: string[]              // ["checkWaf", "measureTiming", "httpRequest"]
      priority: 'high' | 'medium' | 'low'
    }
    ```

#### 7.2 — Create `BudgetAwarePruner`
- [ ] **File**: `src/tools/budget-pruner.ts` (NEW)
  - Class `BudgetAwarePruner`:
    - Constructor: `(profiler: TokenProfiler)`
    - `pruneToBudget(tools: string[], budget: TaskBudget): { kept: string[]; pruned: string[] }`
      - Sort tools by priority: universal > skill-required > inferred
      - Accumulate estimated model calls
      - Keep adding tools until budget exhausted
      - Essential tools (configurable list) always kept even if over budget
    - `estimateModelCalls(tools: string[]): number`
    - `estimateTokens(tools: string[]): { input: number; output: number }`

#### 7.3 — Create `TokenProfiler`
- [ ] **File**: `src/tools/token-profiler.ts` (NEW)
  - Class `TokenProfiler`:
    - Constructor: `(dbPath?: string)` — optional SQLite persistence
    - `recordExecution(toolId: string, result: ToolExecutionResult): void`
      - Update running average (EMA) for: avgModelCalls, avgInputTokens, avgOutputTokens
      - Increment sampleCount, update lastUpdated
    - `getProfile(toolId: string): ToolTokenProfile`
      - Return empirical profile if available, else heuristic default
    - `getDefaultProfile(toolId: string): ToolTokenProfile`
      - Heuristic defaults: `httpRequest` = 1.5 calls, `checkWaf` = 2.0, etc.
      - Configurable via `modelCapabilities` tool defaults
    - `getModelSuccessRate(modelId: string, skillId: string): number`
      - Query forensic log for historical success rate
    - `persist()` / `load()`: save/load from SQLite or JSON file
  - Types:
    ```typescript
    interface ToolExecutionResult {
      toolId: string
      modelCalls: number
      inputTokens: number
      outputTokens: number
      externalApiCalls: number
      durationMs: number
      success: boolean
      modelId?: string
      skillId?: string
    }
    ```

#### 7.4 — Create `ToolInferenceRules` Config
- [ ] **File**: `src/tools/tool-selector.ts`
  - Default inference rules (configurable via `toolInferenceRules` in config):
    ```typescript
    const DEFAULT_INFERENCE_RULES: ToolInferenceRule[] = [
      { keywords: ['sqli', 'sql injection', 'blind'], tools: ['checkWaf', 'measureTiming'], priority: 'high' },
      { keywords: ['xss', 'cross-site'], tools: ['evaluateRendered', 'getDialogEvidence'], priority: 'high' },
      { keywords: ['idor', 'access control', 'authorization'], tools: ['findEndpointsInResponse', 'evaluateRendered'], priority: 'high' },
      { keywords: ['ssrf', 'server-side'], tools: ['httpRequest', 'followRedirects'], priority: 'medium' },
      { keywords: ['race', 'concurrent'], tools: ['measureTiming', 'compareResponses'], priority: 'medium' },
      { keywords: ['recon', 'reconnaissance', 'enumerate'], tools: ['runRecon', 'frameworkFingerprint'], priority: 'medium' },
      { keywords: ['jwt', 'token', 'auth'], tools: ['jwtDecode', 'getCapturedHeaders'], priority: 'low' },
      { keywords: ['graphql', 'introspection'], tools: ['graphqlIntrospect'], priority: 'low' },
    ]
    ```

#### 7.5 — Remove Hardcoded `CORE_TOOLS` Array
- [ ] **File**: `src/skills/tool-filter.ts`
  - Keep `resolveToolsForSkills()` but rewrite to use `DynamicToolSelector`
  - `resolveToolsForSkills(skillIds, task?)` → calls `dynamicSelector.selectTools(task, budget)`
  - Keep `getCoreTools()` but return `dynamicSelector.getUniversalTools()`
  - Mark `CORE_TOOLS` constant as `@deprecated` (keep for reference)

#### 7.6 — Update `WorkerFactory`
- [ ] **File**: `src/workers/factory.ts`
  - `WorkerConfig` add: `budget?: TaskBudget`
  - In `create()`: use `DynamicToolSelector.selectTools()` instead of `resolveToolsForSkills()`
  - If budget provided: prune tools to fit
  - If no budget: use full skill toolRefs (backward compatible)

#### 7.7 — Tests
- [ ] **File**: `test/tools/tool-selector.test.ts` (NEW)
  - Test universal tools always included
  - Test skill-specific tools added from matched skills
  - Test task inference (keyword → tools)
  - Test budget pruning: over-budget tools removed
  - Test essential tools never pruned
- [ ] **File**: `test/tools/token-profiler.test.ts` (NEW)
  - Test EMA update on execution record
  - Test default profiles for unknown tools
  - Test persistence (save/load)
- [ ] **File**: `test/tools/budget-pruner.test.ts` (NEW)
  - Test pruning priority order
  - Test budget overflow handling
  - Test empty budget → universal tools only

### Deliverables
- `src/tools/tool-selector.ts` — `DynamicToolSelector`
- `src/tools/budget-pruner.ts` — `BudgetAwarePruner`
- `src/tools/token-profiler.ts` — `TokenProfiler`
- Updated `src/skills/tool-filter.ts` — uses dynamic selector
- Updated `src/workers/factory.ts` — uses dynamic tools
- ≥25 new tests

---

## 9. Phase 4 — Brain & Worker Integration

> **Goal**: Brain agent gets dynamic tools + model selection. Workers get explicit model override. Spawn tool passes model info.

### Dependencies: Phase 2, Phase 3

### Tasks

#### 8.1 — Update Brain Agent to Use Dynamic Tools
- [ ] **File**: `src/solver/brain-tools.ts`
  - Replace hardcoded 30-tool import with `DynamicArgument`:
    ```typescript
    tools: async ({ requestContext }) => {
      const selector = requestContext?.toolSelector
      const task = requestContext?.currentTask
      const budget = requestContext?.brainBudget
      const toolIds = selector.selectTools(task, budget)
      return filterRegistry(fullRegistry, toolIds)
    }
    ```
  - Add `selectModel` tool to brain's tool set:
    ```typescript
    createTool({
      id: 'selectModel',
      description: 'Select optimal model for a worker task based on capabilities, budget, and rate limits',
      inputSchema: z.object({
        skillId: z.string(),
        taskDescription: z.string(),
        complexity: z.enum(['low', 'medium', 'high', 'critical']),
        requiredCapabilities: z.array(z.string()).optional(),
      }),
      execute: async (input) => {
        const selection = modelSelector.selectForTask({ ...input }, 'worker')
        return { ok: true, value: selection }
      }
    })
    ```

#### 8.2 — Update Brain Instructions
- [ ] **File**: `src/solver/brain-instructions.ts`
  - Add section on model-aware delegation:
    - Brain can call `selectModel` to pick the right tier for a worker
    - If task is simple (recon, fingerprint): use `fast` tier
    - If task is complex (chaining, analysis): use `powerful` or `reasoning`
    - If budget constrained: use `balanced` and mention it
  - Add budget awareness section:
    ```
    ## Your Token Budget
    - Total allocation: {maxTokens} tokens across {maxModelCalls} model calls
    - Used so far: {usedTokens} tokens, {usedModelCalls} calls
    - Remaining: {remainingTokens} tokens, {remainingCalls} calls
    - Workers spawned: {count}, their combined usage: {workerTokens} tokens
    When budget is low, prefer balanced/fast tier for workers.
    When budget is critical (<20% remaining), only spawn essential workers.
    ```
  - Update delegation workflow: Step 2 (Plan) now includes model selection + budget check

#### 8.3 — Update `spawnWorker` Tool
- [ ] **File**: `src/manager/tools/spawn-worker.ts`
  - `spawnWorker` input schema add: `modelId?: string`, `tier?: string`, `tokenBudget?: number`
  - If `modelId` provided: use it explicitly
  - If `tier` provided: use `resolveModel(config, tier)`
  - If neither: ask `modelSelector.selectForTask()` to pick
  - If `tokenBudget` provided: pass to worker pool. If not, brain calculates from its remaining budget or uses default allocation.
  - Log model selection event to forensic log
  - Return model info in result: `{ workerId, status, model: { provider, modelId, tier }, tokenUsage, budgetStatus }`

#### 8.4 — Update Worker Pool
- [ ] **File**: `src/workers/pool.ts`
  - `WorkerConfig` add: `modelId?: string`, `budget?: TaskBudget`, `tokenBudget?: number`
  - In `spawn()`:
    - Resolve model: `modelId` > `tier` > skill default > `config.model`
    - Get tools: `dynamicSelector.selectTools(task, budget)` if budget provided, else skill defaults
    - Create `TokenBudgetTracker` for this worker with `tokenBudget` allocation
    - Inject budget status into worker instructions (same pattern as brain G4)
    - Create agent with resolved model + filtered tools
  - Log spawn event: `{ skillId, modelId, toolCount, budget, tokenBudget }`
  - Worker loop: after each tool-result, check `tracker.isOverBudget()`. If over:
    - `hard`: throw `BudgetExceededError`, kill worker, return partial results
    - `soft`: log warning, skip next tool, return partial results to brain
    - `warn`: log only, continue
  - Return worker result includes: `{ tokenUsage: tracker.getUsed(), budgetStatus: 'ok' | 'near-limit' | 'exhausted' }`

#### 8.5 — Update `createAgent()` Factory
- [ ] **File**: `src/mastra/index.ts`
  - `AgentOptions` add: `modelOverride?: string`, `toolFilter?: string[]`
  - If `modelOverride`: use it instead of default
  - If `toolFilter`: only include tools in filter list (dynamic, not hardcoded)

#### 8.6 — Wire Tool Profiler into Solver Loop
- [ ] **File**: `src/solver/solver.ts`
  - Create `TokenBudgetTracker` instance per solve() call:
    ```typescript
    class TokenBudgetTracker {
      private usedInput = 0
      private usedOutput = 0
      private usedModelCalls = 0

      recordUsage(usage: { inputTokens: number; outputTokens: number }): void {
        this.usedInput += usage.inputTokens
        this.usedOutput += usage.outputTokens
        this.usedModelCalls++
      }

      isOverBudget(maxTokens: number): boolean {
        return (this.usedInput + this.usedOutput) >= maxTokens
      }

      isOverModelCalls(maxCalls: number): boolean {
        return this.usedModelCalls >= maxCalls
      }

      getRemaining(maxTokens: number): number {
        return Math.max(0, maxTokens - this.usedInput - this.usedOutput)
      }

      getUsed(): { input: number; output: number; total: number; modelCalls: number } {
        return { input: this.usedInput, output: this.usedOutput, total: this.usedInput + this.usedOutput, modelCalls: this.usedModelCalls }
      }
    }
    ```
  - After each tool execution in the OODA loop:
    - `budgetTracker.recordUsage(chunk.usage)` — accumulate tokens
    - `toolProfiler.recordExecution(toolName, { ... })` — update empirical profiles
  - Before each tool call:
    - Check `budgetTracker.isOverBudget(allocatedTokens)` and `budgetTracker.isOverModelCalls(allocatedModelCalls)`
    - Enforcement: hard (throw), soft (warn + suggest stopping), warn (log only)
  - Pass `budgetTracker` to brain and workers via requestContext

#### 8.7 — Tests
- [ ] **File**: `test/solver/brain-tools.test.ts` (UPDATE)
  - Test brain receives dynamic tools (not hardcoded)
  - Test `selectModel` tool returns valid selection
  - Test brain tools adapt to budget constraints
- [ ] **File**: `test/workers/pool.test.ts` (UPDATE)
  - Test worker spawn with explicit `modelId`
  - Test worker spawn with `tier` override
  - Test worker spawn without budget (backward compatible)
  - Test model selection logged to forensic
- [ ] **File**: `test/solver/solver.test.ts` (UPDATE)
  - Test tool profiler records after each execution
  - Test enriched goal includes budget status

### Deliverables
- Updated `src/solver/brain-tools.ts` — dynamic tools + selectModel
- Updated `src/solver/brain-instructions.ts` — model-aware delegation
- Updated `src/manager/tools/spawn-worker.ts` — modelId/tier params
- Updated `src/workers/pool.ts` — model + budget support
- Updated `src/mastra/index.ts` — modelOverride + toolFilter
- Updated `src/solver/solver.ts` — tool profiler integration
- ≥20 new/updated tests

---

## 10. Phase 5 — Skill Tier Defaults & Target-Aware Matching

> **Goal**: Each skill declares its preferred model tier. Skill matching considers graph state and target, not just user input.

### Dependencies: Phase 0, Phase 3

### Tasks

#### 9.1 — Add `tier` to Skill Frontmatter
- [ ] **Files**: All 21 skill `.md` files under `skills/`
  - Add `tier:` field to YAML frontmatter:
    | Skill | Tier | Rationale |
    |-------|------|-----------|
    | recon | fast | Simple HTTP requests, fingerprinting |
    | vuln-discovery | balanced | Multi-step analysis, timing |
    | exploitation | powerful | Complex payloads, chaining |
    | post-exploitation | balanced | Graph queries, reporting |
    | reporting | fast | Graph queries, template rendering |
    | waf-bypass | balanced | Encode/decode + trial |
    | pentest-flow | balanced | Multi-phase orchestration |
    | web-pentest | balanced | Multi-step web testing |
    | web-security-advanced | powerful | Advanced bypass techniques |
    | crypto-toolkit | balanced | Crypto analysis |
    | ctf-web | fast | Simple CTF challenges |
    | ctf-crypto | balanced | Crypto puzzles |
    | ctf-misc | fast | Misc challenges |
    | osint-recon | fast | Reconnaissance queries |
    | ai-mcp-security | balanced | AI/MCP analysis |
    | intranet-pentest | balanced | Internal network testing |
    | pentest-tools | balanced | Tool orchestration |
    | authorization | reasoning | Complex access control analysis |
    | business-logic | reasoning | Multi-step business logic |
    | information-disclosure | balanced | Data exposure analysis |
    | race-conditions | powerful | Timing-sensitive analysis |
  - Update `src/skills/loader.ts` to parse `tier` from frontmatter
  - Add `tier` to `SkillMetadata` type

#### 9.2 — Create `TargetAwareSkillMatcher`
- [ ] **File**: `src/skills/registry.ts`
  - Extend `SkillRegistry.matchSkills()` signature:
    ```typescript
    matchSkills(input: string, context?: {
      graphSummary?: GraphSummary
      goal?: string
      previousSkills?: string[]
      taskComplexity?: string
    }): SkillMatch[]
    ```
  - Scoring factors:
    - **Keyword match** (existing): +10 per keyword hit
    - **Graph state match** (NEW): if graph has auth flows → boost authorization skill; if SQL endpoints → boost vuln-discovery
    - **Goal alignment** (NEW): if goal mentions "XSS" → boost web-pentest
    - **Skill diversity** (NEW): penalize if same skill used in last 3 turns (avoid repetition)
    - **Complexity alignment** (NEW): if task is "critical" complexity → boost powerful-tier skills
  - Return `SkillMatch[]` with `matchScore`, `matchReasons[]`

#### 9.3 — Add `GraphSummary` Type
- [ ] **File**: `src/skills/registry.ts` (or `src/graph/types.ts`)
  - ```typescript
    interface GraphSummary {
      endpointCount: number
      findingCount: number
      authFlowCount: number
      attackPathCount: number
      untestedEndpoints: number
      recentFindings: string[]      // last 5 finding types
      hasAuth: boolean
      hasSQL: boolean
      hasGraphQL: boolean
      hasFileUpload: boolean
    }
    ```
  - `buildGraphSummary(graphStore): GraphSummary` — utility function

#### 9.4 — Update Session REPL Skill Matching
- [ ] **File**: `src/session.ts`
  - Replace `resolveSkillsForInput(line)` with:
    ```typescript
    const skills = skillRegistry.matchSkills(line, {
      graphSummary: buildGraphSummary(graphStore),
      goal: currentGoal,
      previousSkills: recentSkills,
      taskComplexity: inferredComplexity,
    })
    ```

#### 9.5 — Update Solver Skill Matching
- [ ] **File**: `src/solver/solver.ts`
  - In `enrichedGoal`, include `matchedSkills` with scores and reasons
  - Pass `graphSummary` to skill matcher

#### 9.6 — Tests
- [ ] **File**: `test/skills/target-aware-matcher.test.ts` (NEW)
  - Test keyword-only matching (baseline)
  - Test graph state boost (auth flows → authorization skill)
  - Test goal alignment boost
  - Test skill diversity penalty (same skill used recently)
  - Test complexity alignment
- [ ] **File**: `test/skills/loader.test.ts` (UPDATE)
  - Test `tier` parsed from frontmatter
  - Test all 21 skills have valid `tier` values

### Deliverables
- Updated 21 skill `.md` files with `tier:` field
- Updated `src/skills/loader.ts` — tier parsing
- Updated `src/skills/registry.ts` — target-aware matching
- Updated `src/session.ts` — new skill matching call
- Updated `src/solver/solver.ts` — enriched goal with skill scores
- ≥15 new tests

---

## 11. Phase 6 — Context Window Management

> **Goal**: Validate context fit before each LLM call. Prevent silent overflow. Auto-truncate or warn based on config.

### Dependencies: Phase 0, Phase 2

### Tasks

#### 10.1 — Create `ContextBudgetManager`
- [ ] **File**: `src/models/context-manager.ts` (NEW)
  - Class `ContextBudgetManager`:
    - Constructor: `(capabilities: ModelCapabilities)`
    - `validateContextFit(params: ContextFitParams): ContextValidation`
      ```typescript
      interface ContextFitParams {
        modelId: string
        systemPrompt: string
        toolSchemas: string       // JSON stringified
        conversationHistory: string
        enrichedGoal: string
        expectedOutputTokens?: number
      }

      interface ContextValidation {
        fits: boolean
        totalInputTokens: number
        availableForOutput: number
        breakdown: {
          system: number
          tools: number
          history: number
          goal: number
        }
        suggestions: string[]
        severity: 'ok' | 'warning' | 'critical'
      }
      ```
    - `estimateTokens(text: string): number` — rough token count (words × 1.3)
    - `suggestReductions(breakdown, available): string[]` — actionable suggestions
    - `truncateToFit(params, targetBudget): ContextFitParams` — auto-truncate

#### 10.2 — Integrate into Solver Loop
- [ ] **File**: `src/solver/solver.ts`
  - Before `agent.stream()`:
    ```typescript
    const contextCheck = contextManager.validateContextFit({
      modelId: currentModel.modelId,
      systemPrompt: agent.instructions,
      toolSchemas: JSON.stringify(agent.tools),
      conversationHistory: memory.getHistory(),
      enrichedGoal: truncatedGoal,
    })
    if (contextCheck.severity === 'critical') {
      // Auto-truncate or warn based on budgetPolicy.enforcement
      if (config.budgetPolicy.enforcement === 'hard') throw new Error(...)
      if (config.budgetPolicy.enforcement === 'soft') {
        truncatedGoal = contextManager.truncateToFit(...)
      }
      // 'warn': just log
    }
    ```

#### 10.3 — Integrate into Worker Spawn
- [ ] **File**: `src/workers/pool.ts`
  - Before creating worker agent: validate context fit
  - If tool schemas too large: reduce tool set (remove low-priority tools)

#### 10.4 — Update Enriched Goal Truncation
- [ ] **File**: `src/solver/solver.ts`
  - Replace `getEnrichedGoalCap()` with `ContextBudgetManager.truncateToFit()`
  - Consider tool schemas + system prompt when calculating available space for goal
  - Log truncation events with before/after token counts

#### 10.5 — Tests
- [ ] **File**: `test/models/context-manager.test.ts` (NEW)
  - Test `estimateTokens()` accuracy
  - Test `validateContextFit()` with various model sizes
  - Test `suggestReductions()` produces actionable suggestions
  - Test `truncateToFit()` respects budget
  - Test backward compatibility (no budgetPolicy → no truncation)

### Deliverables
- `src/models/context-manager.ts` — `ContextBudgetManager`
- Updated `src/solver/solver.ts` — context validation before stream
- Updated `src/workers/pool.ts` — context validation at spawn
- ≥10 new tests

---

## 12. Phase 7 — Observability & Forensic Logging

> **Goal**: Extended forensic log with model calls, token usage, budget status. Live dashboard. Token tracking per session.

### Dependencies: Phase 0, Phase 1, Phase 3

### Tasks

#### 11.1 — Extend Forensic Event Schema
- [ ] **File**: `src/logging/forensic-log.ts`
  - Add new event types:
    ```typescript
    // Extend ForensicEvent type union:
    type ForensicEventType =
      | 'tool-call' | 'tool-result' | 'tool-error'
      | 'http-request' | 'http-response'
      | 'graph-mutation' | 'agent-turn' | 'error'
      | 'human-action' | 'screenshot'
      // NEW:
      | 'model-call'           // LLM API call (provider, model, tokens)
      | 'rate-limit-event'     // rate limit acquire/wait/exhaustion
      | 'budget-status'        // budget check results
      | 'tool-token-record'    // tool execution token profile
      | 'config-mismatch'      // header vs config divergence
      | 'model-selection'      // model chosen for task
      | 'context-validation'   // context fit check results
    ```
  - Add structured data to events:
    ```typescript
    interface ForensicEvent {
      // ... existing fields ...
      // NEW structured data
      metadata?: {
        provider?: string
        modelId?: string
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
        budgetRemaining?: number
        rateLimitUsed?: number
        rateLimitRemaining?: number
        toolCount?: number
        prunedTools?: string[]
        contextFit?: 'ok' | 'warning' | 'critical'
      }
    }
    ```

#### 11.2 — Create Budget Dashboard
- [ ] **File**: `src/tools/budget-dashboard.ts` (NEW)
  - Class `BudgetDashboard`:
    - Constructor: `(forensicLog: ForensicLog, budgetPolicy: BudgetPolicy)`
    - `getSessionSummary(): SessionBudgetSummary`
      ```typescript
      interface SessionBudgetSummary {
        totalModelCalls: number
        totalTokens: { input: number; output: number; total: number }
        byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number }>
        byAgentRole: Record<string, { calls: number; tokens: number }>
        byTask: Array<{ task: string; calls: number; tokens: number; tools: string[] }>
        rateLimitStatus: Record<string, { used: number; remaining: number; inCooldown: boolean }>
        warnings: string[]
      }
      ```
    - `printLiveDashboard(): void` — pretty console output during session
    - `getTokenHistory(): TokenEntry[]` — per-call token breakdown

#### 11.3 — Token Tracking Integration
- [ ] **File**: `src/models/middleware.ts`
  - After each model call, if `budgetPolicy.trackTokens`:
    - Record: `inputTokens` and `outputTokens` from response usage
    - Log `model-call` event with token metadata
    - Update `BudgetDashboard` running totals

#### 11.4 — Budget Enforcement in Solver
- [ ] **File**: `src/solver/solver.ts`
  - Before each tool call in OODA loop:
    - Check `budgetStatus.modelCallsUsed >= budgetStatus.maxAllowedModelCalls`
    - If `enforcement === 'hard'`: throw `BudgetExceededError`
    - If `enforcement === 'soft'`: log warning, suggest stopping
    - If `enforcement === 'warn'`: log only
  - At end of solve: log budget summary event

#### 11.5 — Tests
- [ ] **File**: `test/logging/forensic-log.test.ts` (UPDATE)
  - Test new event types logged correctly
  - Test metadata attached to events
- [ ] **File**: `test/tools/budget-dashboard.test.ts` (NEW)
  - Test `getSessionSummary()` aggregates correctly
  - Test token calculation accuracy
  - Test provider breakdown
  - Test warning generation (budget exceeded, rate limit exhausted)

### Deliverables
- Updated `src/logging/forensic-log.ts` — extended event types + metadata
- `src/tools/budget-dashboard.ts` — `BudgetDashboard` class
- Updated `src/models/middleware.ts` — token tracking
- Updated `src/solver/solver.ts` — budget enforcement
- ≥15 new tests

---

## 13. Phase 8 — CLI Extensions

> **Goal**: New CLI commands for model management, budget monitoring, rate limit status, and tool profiling.

### Dependencies: Phase 1, Phase 2, Phase 7

### Tasks

#### 12.1 — `ultimatrix models` Command
- [ ] **File**: `src/cli/models.ts` (NEW)
  - `ultimatrix models list` — show configured tiers + capabilities + context window info
  - `ultimatrix models test <modelId>` — test model connectivity (single call)
  - `ultimatrix models benchmark` — compare tiers on sample task (timing + tokens)

#### 12.2 — `ultimatrix budget` Command
- [ ] **File**: `src/cli/budget.ts` (NEW)
  - `ultimatrix budget status` — live budget dashboard for current/recent session
  - `ultimatrix budget history` — session token usage history from forensic log

#### 12.3 — `ultimatrix ratelimit` Command
- [ ] **File**: `src/cli/ratelimit.ts` (NEW)
  - `ultimatrix ratelimit status` — per-provider rate limit status
  - `ultimatrix ratelimit sync` — force sync from provider headers

#### 12.4 — `ultimatrix tools profile` Command
- [ ] **File**: `src/cli/tools.ts` (NEW)
  - `ultimatrix tools profile` — show empirical tool token usage
  - `ultimatrix tools profile --tool <toolId>` — show specific tool profile
  - `ultimatrix tools calibrate` — run calibration suite (10 calls per tool)

#### 12.5 — Update `init` Wizard
- [ ] **File**: `src/cli/init.ts`
  - Add multi-model tier configuration step
  - Add per-provider rate limit configuration step
  - Add budget policy configuration step
  - Add token tracking opt-in step

#### 12.6 — Register CLI Commands
- [ ] **File**: `src/cli/index.ts`
  - Register `models`, `budget`, `ratelimit`, `tools` subcommands
  - Update help text

#### 12.7 — Tests
- [ ] **File**: `test/cli/models.test.ts` (NEW)
  - Test `models list` output format
  - Test `models test` with mock provider
- [ ] **File**: `test/cli/budget.test.ts` (NEW)
  - Test `budget status` output
  - Test `budget history` from forensic log

### Deliverables
- `src/cli/models.ts`, `src/cli/budget.ts`, `src/cli/ratelimit.ts`, `src/cli/tools.ts`
- Updated `src/cli/init.ts`, `src/cli/index.ts`
- ≥10 new tests

---

## 14. Phase 9 — Legacy Engine Compatibility

> **Goal**: Legacy supervisor works with multi-model setup for comparison. Not primary, but functional.

### Dependencies: Phase 2, Phase 4

### Tasks

#### 13.1 — Legacy Engine Multi-Model Support
- [ ] **File**: `src/session.ts`
  - When `engine: 'multi-model'`:
    - Use solver engine (Phase 4 integration)
    - Legacy supervisor available via `engine switch` command for comparison
  - When `engine: 'legacy'`:
    - Legacy supervisor uses primary model only (existing behavior)
    - Workers use `resolveModel(config, tier)` (existing behavior)
    - No budget enforcement (legacy mode)
  - When `engine: 'solver'`:
    - Solver with dynamic tools but single model (existing v8 behavior)
    - No `ModelSelector` (budget/pruning disabled)

#### 13.2 — Engine Comparison Mode
- [ ] **File**: `src/cli/interact.ts` (or `src/session.ts`)
  - Add `--compare` flag: runs same task through solver AND legacy, reports timing/results
  - Log comparison to forensic log for analysis

#### 13.3 — Tests
- [ ] **File**: `test/session/engine-routing.test.ts` (NEW)
  - Test `engine: 'legacy'` uses primary model only
  - Test `engine: 'solver'` uses dynamic tools, no model selection
  - Test `engine: 'multi-model'` uses full stack
  - Test engine switch mid-session

### Deliverables
- Updated `src/session.ts` — engine routing
- ≥5 new tests

---

## 15. Phase 10 — Testing & Calibration

> **Goal**: Calibrate tool token profiles, run integration tests for multi-model scenarios, verify all edge cases.

### Dependencies: All previous phases

### Tasks

#### 14.1 — Tool Token Calibration Script
- [ ] **File**: `scripts/calibrate-tools.ts` (NEW)
  - For each of 70 tools in registry:
    - Run 10 executions with standard inputs
    - Record: modelCalls, inputTokens, outputTokens, externalApiCalls, duration
    - Store average profiles in `tool_tokens.json`
  - Output: `tool_tokens.json` loaded by `TokenProfiler` as defaults

#### 14.2 — Integration Test: Budget Enforcement
- [ ] **File**: `test/integration/budget-enforcement.test.ts` (NEW)
  - Scenario: set `maxModelCallsPerTask: 5`, run solver
  - Verify: brain + workers stay within budget
  - Verify: soft enforcement warns but continues
  - Verify: hard enforcement throws `BudgetExceededError`

#### 14.3 — Integration Test: Multi-Model Routing
- [ ] **File**: `test/integration/multi-model.test.ts` (NEW)
  - Scenario: configure fast + balanced + powerful tiers
  - Run: simple recon task → verify fast model selected
  - Run: complex chaining task → verify powerful model selected
  - Verify: model selection logged to forensic

#### 14.4 — Integration Test: Rate Limit Fallback
- [ ] **File**: `test/integration/rate-limit-fallback.test.ts` (NEW)
  - Scenario: exhaust Groq quota → verify fallback to OpenAI
  - Verify: cooldown per provider
  - Verify: recovery after cooldown expires

#### 14.5 — Integration Test: Context Overflow
- [ ] **File**: `test/integration/context-overflow.test.ts` (NEW)
  - Scenario: large enriched goal + many tool schemas
  - Verify: context validation catches overflow
  - Verify: auto-truncation in soft mode
  - Verify: error in hard mode

#### 14.6 — Integration Test: Legacy vs Solver Comparison
- [ ] **File**: `test/integration/legacy-vs-solver.test.ts` (NEW)
  - Run same task through both engines
  - Compare: timing, tool usage, findings produced
  - Log comparison for future analysis

#### 14.7 — Full Test Suite Regression
- [ ] Run all 852+ tests
  - Verify no regressions from changes
  - New tests should bring total to ~950+

### Deliverables
- `scripts/calibrate-tools.ts` — token calibration script
- 5 new integration test files
- `tool_tokens.json` — calibrated token defaults
- ≥950 total tests passing

---

## 16. Dependency Graph

```
Phase 0 (Config)
  ├── Phase 0.5 (Token Extraction) ← CRITICAL PREREQUISITE
  │       │
  │       ├── Phase 1 (Rate Limiting) ──── Phase 2 (Model Selector)
  │       │                                    │
  │       │                              Phase 4 (Brain & Workers)
  │       │                                    │
  │       └── Phase 3 (Tool Discovery) ──── Phase 5 (Skill Matching)
  │                                                │
  │                                          Phase 6 (Context)
  │                                          Phase 7 (Observability)
  │                                                │
  │                                          Phase 8 (CLI)
  │                                          Phase 9 (Legacy)
  │                                                │
  │                                          Phase 10 (Testing)
```

### Parallel Tracks

| Track | Phases | Can Run In Parallel |
|-------|--------|---------------------|
| **X: Token Extraction** | 0 → 0.5 | CRITICAL — must complete before all other tracks |
| **A: Config + Rate Limit** | 0.5 → 1 | Yes (independent of B) after 0.5 |
| **B: Tool Discovery** | 0.5 → 3 | Yes (independent of A) after 0.5 |
| **C: Model Selection** | 0.5 → 1 → 2 | Depends on A |
| **D: Brain & Workers** | 2 + 3 → 4 | Depends on B and C |
| **E: Skills + Context** | 0 → 5 + 6 | Yes (independent of A-D) |
| **F: Observability** | 0.5 + 1 + 3 → 7 | Depends on A and B |
| **G: CLI** | 1 + 2 + 7 → 8 | Depends on A, C, F |
| **H: Legacy** | 2 + 4 → 9 | Depends on C and D |
| **I: Testing** | All → 10 | Final phase |

---

## 17. File Impact Matrix

### New Files (21)

| Phase | File | Description |
|-------|------|-------------|
| 0 | `test/config/config.test.ts` | Config validation tests |
| 0.5 | `test/models/token-extraction.test.ts` | Token usage extraction pipeline tests |
| 1 | `src/models/provider-limiter.ts` | Per-provider rate limiter (RPM + TPM) |
| 1 | `src/models/limiter-factory.ts` | Limiter factory + cache |
| 1 | `src/models/quota-tracker.ts` | Quota tracking per provider |
| 2 | `src/models/selector.ts` | Model selection service |
| 3 | `src/tools/tool-selector.ts` | Dynamic tool discovery |
| 3 | `src/tools/budget-pruner.ts` | Budget-aware tool pruning |
| 3 | `src/tools/token-profiler.ts` | Empirical token usage profiling per tool |
| 4 | `src/models/token-budget-tracker.ts` | Real-time token budget tracking in solver/worker loops |
| 6 | `src/models/context-manager.ts` | Context window management |
| 7 | `src/tools/budget-dashboard.ts` | Budget monitoring dashboard |
| 7 | `src/tools/token-dashboard.ts` | Live REPL token display |
| 8 | `src/cli/models.ts` | Model management CLI |
| 8 | `src/cli/budget.ts` | Budget CLI |
| 8 | `src/cli/ratelimit.ts` | Rate limit CLI |
| 8 | `src/cli/tools.ts` | Tool profiling CLI |
| 10 | `scripts/calibrate-tools.ts` | Tool token calibration |
| 10 | `test/integration/*.test.ts` | 5 integration test files |

### Modified Files (29)

| Phase | File | Change |
|-------|------|--------|
| 0 | `src/config.ts` | +ModelCapability (no costTier), +BudgetPolicy (scope, resetOn), +ProviderRateLimits, +EngineType |
| 0 | `src/config/schema.ts` | Merge Zod schemas |
| 0.5 | `src/solver/solver.ts` | Add `finish` chunk handler, capture real token usage, replace `fullText.length` |
| 0.5 | `src/session.ts` | Add `finish` handler to legacy stream consumer |
| 0.5 | `src/models/middleware.ts` | Capture usage from `doGenerate` response |
| 0.5 | `src/usage/tracker.ts` | Add input/output token tracking, deprecate cost field |
| 1 | `src/models/middleware.ts` | Per-provider limiter, header sync (RPM + TPM), configurable backoff |
| 1 | `src/models/rate-limiter.ts` | Mark singletons @deprecated |
| 1 | `src/usage/tracker.ts` | Add token-only mode, deprecate cost field |
| 2 | `src/models/factory.ts` | New overload with selector |
| 3 | `src/skills/tool-filter.ts` | Replace CORE_TOOLS with dynamic |
| 4 | `src/solver/brain-tools.ts` | Dynamic tools + selectModel |
| 4 | `src/solver/brain-instructions.ts` | Model-aware delegation + token budget status |
| 4 | `src/manager/tools/spawn-worker.ts` | modelId/tier/tokenBudget params |
| 4 | `src/workers/pool.ts` | Model + budget + TokenBudgetTracker + mid-execution enforcement |
| 4 | `src/workers/factory.ts` | Dynamic tool selection |
| 4 | `src/mastra/index.ts` | modelOverride + toolFilter |
| 4 | `src/solver/solver.ts` | TokenBudgetTracker + token profiler + context validation |
| 5 | `src/skills/loader.ts` | Parse `tier` from frontmatter |
| 5 | `src/skills/registry.ts` | Target-aware matching |
| 5 | `src/session.ts` | New skill matching + spider budget wiring |
| 5 | All 21 `skills/*.md` | Add `tier:` to frontmatter |
| 7 | `src/logging/forensic-log.ts` | Extended event types + metadata |
| 8 | `src/cli/init.ts` | Multi-model setup wizard + budget scope |
| 8 | `src/cli/index.ts` | Register new commands |
| 10 | `test/workers/pool.test.ts` | Update for model/budget/TokenBudgetTracker |
| 10 | `test/solver/brain-tools.test.ts` | Update for dynamic tools |
| 10 | `test/solver/solver.test.ts` | Update for token profiler + budget enforcement |
| 10 | `test/models/factory.test.ts` | Update for new overload |
| 10 | `test/models/provider-limiter.test.ts` | TPM tracking tests |
| 10 | `test/models/token-budget-tracker.test.ts` | Real-time budget tests |

---

## 18. Migration Checklist

### Pre-Migration (Phase 0)
- [ ] All new interfaces compile with zero errors
- [ ] Existing `loadConfig()` returns valid config with new fields optional
- [ ] Existing tests pass without changes (backward compatible)
- [ ] `costTier` removed from `ModelCapability` interface
- [ ] `BudgetPolicy.scope` and `BudgetPolicy.resetOn` have defaults

### Core Infrastructure (Phases 1-3)
- [ ] `ProviderAwareLimiter` replaces global singleton (RPM + TPM)
- [ ] `ModelSelector` selects optimal model for tasks
- [ ] `DynamicToolSelector` discovers tools at runtime
- [ ] `TokenProfiler` records empirical data
- [ ] `BudgetAwarePruner` prunes to budget
- [ ] Header sync reads both RPM and TPM headers

### Agent Integration (Phases 4-5)
- [ ] `TokenBudgetTracker` accumulates tokens in solver/worker loops
- [ ] Brain agent uses dynamic tools + model selection + token budget awareness
- [ ] Workers get explicit model override + token budget
- [ ] Spawn tool passes model info + token budget
- [ ] Skills have `tier:` in frontmatter
- [ ] Skill matching considers graph state
- [ ] Worker mid-execution budget enforcement works

### Observability (Phases 6-8)
- [ ] Forensic log extended with new event types
- [ ] Budget dashboard available in session
- [ ] Token tracking per session (with scope semantics)
- [ ] Context overflow prevented
- [ ] REPL displays token usage after each turn
- [ ] CLI commands functional

### Compatibility (Phase 9)
- [ ] Legacy engine works with primary model
- [ ] Multi-model engine selectable via config
- [ ] Engine switch mid-session works
- [ ] Spider gets token budget allocation

### Validation (Phase 10)
- [ ] All 950+ tests pass
- [ ] Tool token profiles calibrated
- [ ] Integration tests verify all scenarios
- [ ] No regressions in existing functionality
- [ ] Calibration script runs within budget

---

## 19. Risk Register

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | `DynamicArgument` may not work with all Mastra Agent versions | High | Test with current Mastra version; fallback to static tools if needed |
| R2 | Empirical tool token profiles may vary across models/providers | Medium | Use EMA with large sample size; fallback to heuristic defaults |
| R3 | Header-based rate limit sync may be unreliable across providers | Medium | Validate header parsing per provider; fallback to local-only |
| R4 | Budget pruning may remove essential tools | Medium | Essential tool list configurable; never prune universal tools |
| R5 | Context token estimation may be inaccurate (words × 1.3) | Medium | Use per-model tokenizer estimates; validate with real response `usage` data |
| R6 | Config migration may break existing deployments | High | All new fields optional; backward compatible defaults |
| R7 | Multi-model routing may increase latency | Medium | Cache model selections; skip selection for simple tasks |
| R8 | Legacy engine comparison may confuse users | Low | Clear CLI messaging; legacy is for reference only |
| R9 | Some providers don't return `usage` in response | Medium | Fallback to heuristic estimation; log warning |
| R10 | Existing `UsageTracker` (`src/usage/tracker.ts`) tracks cost — conflicts with token-only approach | Low | Extend UsageTracker to token-only mode or deprecate in favor of new TokenProfiler |
| R11 | Brain may consume entire token budget before spawning any workers | Medium | Budget allocation enforced before `agent.stream()`, not after |
| R12 | Workers spawned mid-loop may exceed their token allocation before check | Medium | Token budget checked per tool-result, not just per turn |
| R13 | Calibration script consumes real tokens — could be expensive | Low | Cap calibration at 5 runs per tool; make configurable |
| **R14** | **Token usage NEVER extracted from model responses** — `fullText.length` used instead | **CRITICAL** | Must add `finish` chunk handler in Phase 1 before any budget work |
| **R15** | **`wrapModel()` Proxy discards response data** — usage never captured | **CRITICAL** | Modify Proxy to intercept response, extract usage, forward to trackers |
| **R16** | **`UsageTracker.record()` never called** — dead code | **CRITICAL** | Wire into middleware in Phase 1 |
| **R17** | **Streaming finish chunk not handled** — usage silently dropped | **CRITICAL** | Add `case 'finish':` to solver and legacy stream consumers |
| **R18** | **Tool schema tokens (~12K) consume 24% of 8K context** — not budgeted | High | Dynamic tool selection reduces this; ContextBudgetManager must account for it |
| **R19** | **No direct `ai` SDK** — types come from `@ai-sdk/provider` transitively | Medium | All imports must use `@ai-sdk/provider` paths |
| **R20** | **Zod v4 may break `createSanitizedInputSchema()`** | Medium | Test Zod v4 Standard Schema compatibility early |

---

## 20. Gap Analysis — Identified & Addressed

> The following gaps were found during plan review. Each is addressed with concrete changes to the plan.

### G1: Existing `UsageTracker` Integration
- **Gap**: `src/usage/tracker.ts` already tracks `{ provider, model, tokens, cost }` per call
- **Decision**: Extend `UsageTracker` to work alongside `TokenProfiler`. UsageTracker handles raw per-call logging; TokenProfiler handles empirical tool-level aggregation. UsageTracker drops `cost` field in token-only mode.
- **Phase 0 change**: Add `UsageTrackerMode: 'tokens' | 'tokens+cost'` to config (default: `'tokens'`)
- **Phase 7 change**: `BudgetDashboard` reads from `UsageTracker` for live totals

### G2: TPM (Tokens-Per-Minute) Limits
- **Gap**: Providers like OpenAI enforce separate TPM limits alongside RPM. Plan only handled RPM.
- **Addressed in**: Phase 0 (RateLimitConfig), Phase 1 (ProviderAwareLimiter), Phase 2 (scoring)
- **Changes**: `RateLimitConfig.tokensPerMinute`, `ModelCapability.maxTokensPerMinute`, header mapping for `x-ratelimit-tokens-remaining`/`x-ratelimit-tokens-reset`, ProviderAwareLimiter tracks both RPM and TPM windows

### G3: Real-Time Token Budget Tracking in OODA Loop
- **Gap**: Plan checks budget before each tool call but doesn't show how tokens accumulate across the loop
- **Phase 4 change**: Add `TokenBudgetTracker` class that accumulates tokens from each `doStream`/`doGenerate` response
  ```
  class TokenBudgetTracker {
    usedTokens: { input: number; output: number }
    usedModelCalls: number
    recordUsage(usage: { inputTokens, outputTokens }): void
    isOverBudget(maxTokens: number): boolean
    isOverModelCalls(maxCalls: number): boolean
    getRemaining(maxTokens: number): number
  }
  ```
- **Phase 4 change (8.6)**: Solver loop records usage after every `agent.stream()` chunk, not just tool results

### G4: Brain Token Budget Awareness in Context
- **Gap**: Brain agent needs to SEE its remaining token budget to make smart delegation decisions
- **Phase 4 change (8.2)**: Brain instructions include budget status block:
  ```
  ## Your Token Budget
  - Total allocation: {maxTokens} tokens across {maxModelCalls} model calls
  - Used so far: {usedTokens} tokens, {usedModelCalls} calls
  - Remaining: {remainingTokens} tokens, {remainingCalls} calls
  - Workers spawned: {count}, their combined usage: {workerTokens} tokens
  When budget is low, prefer balanced/fast tier for workers.
  ```

### G5: Spider Token Budget Allocation
- **Gap**: Spider runs before solver, consumes tokens, but has no budget allocation
- **Phase 0 change**: `BudgetPolicy.allocation.spider` (default 0.1) already defined but not wired
- **Phase 5 change**: Spider gets its own `TokenBudgetTracker` instance. Spider budget = `maxTokensPerSession × allocation.spider`. If spider exhausts its budget, it stops crawling and logs warning.

### G6: Token Budget Scope Definition
- **Gap**: Unclear whether `maxTokensPerSession` is per `solve()` call or per entire REPL session
- **Phase 0 change**: Add `budgetScope: 'turn' | 'session'` to `BudgetPolicy`
  - `'turn'`: budget resets each REPL turn (each `solve()` call gets full budget)
  - `'session'`: budget accumulates across all REPL turns in a session
  - Default: `'session'` (total cap)
- **Phase 7 change**: `BudgetDashboard` tracks cumulative vs per-turn based on scope

### G7: Worker Budget Propagation + Mid-Execution Exhaustion
- **Gap**: How is a worker's token budget communicated? What if it exhausts mid-execution?
- **Phase 4 change (8.4)**: Worker gets `TokenBudgetTracker` with its allocated slice. Budget injected into worker instructions (same as G4 for brain).
- **Phase 4 change**: After each tool-result in worker loop, check `tracker.isOverBudget()`. If over:
  - `hard`: throw `BudgetExceededError`, kill worker
  - `soft`: log warning, skip next tool, return partial results to brain
  - `warn`: log only, continue
- **Phase 4 change (8.3)**: `spawnWorker` result includes `{ tokenUsage: { input, output }, budgetStatus: 'ok' | 'near-limit' | 'exhausted' }`

### G8: REPL Token Display After Each Turn
- **Gap**: Users should see token consumption after each REPL turn
- **Phase 7 change (11.2)**: After each `solve()` or legacy `stream()` completes, print:
  ```
  [tokens] Turn: 12,340 in / 4,200 out (16,540 total) | Session: 145,000 / 500,000 tokens | Rate: groq 28/30 RPM
  ```
- **Phase 8 change**: `ultimatrix budget status` shows same format

### G9: Providers Not Returning Usage Data
- **Gap**: Some providers may not include `usage` in streaming responses
- **Phase 1 change**: In `wrapModel()`, if `response.usage` is undefined:
  - Fallback to `estimateTokens(response.text)` using words × 1.3
  - Log warning: `Token count estimated for ${provider} (no usage in response)`
  - `TokenProfiler` marks the profile entry as `estimated: true`

### G10: Calibration Script Token Budget
- **Gap**: The calibration script (`scripts/calibrate-tools.ts`) itself consumes real tokens
- **Phase 10 change**: 
  - Cap at 5 runs per tool (not 10)
  - Make configurable: `--runs=N`
  - Add `--dry-run` flag that estimates without calling LLM
  - Log total tokens consumed by calibration itself

### G11: Token Budget Reset Semantics
- **Gap**: Unclear when budget counters reset
- **Phase 0 change**: `BudgetPolicy.resetOn: 'turn' | 'never'`
  - `'turn'`: Each REPL turn starts fresh (good for exploration)
  - `'never'`: Cumulative across session (good for controlled spending)
  - Default: `'never'`

### G12: Worker Budget from Parent Brain
- **Gap**: Brain needs to pass its remaining budget to workers
- **Phase 4 change**: `spawnWorker` tool accepts `tokenBudget?: number` parameter. Brain calculates worker allocation from its remaining budget. If not specified, uses default allocation from `BudgetPolicy.allocation.workers × maxTokensPerSession`.

---

## 21. Edge Cases Catalog

### Provider & Rate Limiting
1. Two tiers share same provider (e.g., fast + balanced both Groq) → shared quota
2. Provider returns no rate limit headers → use config-only mode
3. Provider returns malformed headers → graceful fallback, log warning
4. Multiple providers exhaust simultaneously → queue with backoff
5. Provider recovers during session → auto-resume after cooldown
6. Header says 0 remaining but local says available → trust header
7. Provider changes rate limits mid-session → header sync catches it
8. Custom provider with no standard headers → config-only mode
9. Provider enforces TPM separately from RPM → both tracked independently
10. Provider returns tokens-per-minute headers but not request headers → use TPM-only mode

### Budget & Tool Delegation
11. Brain tries to spawn worker with no budget remaining → warn + suggest cheaper model
12. All tools pruned but task requires specific tool → essential tool override
13. Tool profiler has no data for new tool → use heuristic defaults
14. Budget enforcement throws mid-solver-loop → graceful cleanup, return partial results
15. Worker exceeds its token budget mid-execution → kill worker, return partial results to brain
16. Brain uses more than its allocation → soft warn, suggest stopping
17. External tool (Shodan) has separate quota → tracked independently
18. Tool token profiles change between sessions → profiler updates on next execution
19. Budget scope is `'session'` but user runs 50+ REPL turns → cumulative budget degrades
20. Budget scope is `'turn'` but single turn spawns 10 workers → no cross-worker cap

### Token Tracking
21. Provider doesn't return `usage` in response → estimate from text length, log warning
22. Streaming response interrupted mid-chunk → use partial usage data if available
23. `maxTokensPerSession` set but `trackTokens: false` → budget checks still work, just no logging
24. Token profiler has 0 samples for a tool → use heuristic default, mark as `estimated`
25. Brain's token budget injected into instructions but brain ignores it → no enforcement, just advisory

### Model Selection
26. No provider has credits → fallback to model with most rate limit headroom
27. Selected model doesn't support structured output → fallback to compatible model
28. Selected model context too small for task → auto-select larger
29. Model returns 400 (invalid request) → fallback to compatible model
30. Model selection takes too long → timeout, use default tier
31. User specifies explicit tier → override selection
32. Same model used for brain and workers → shared quota risk
33. ModelSelector selects model brain already using → no provider diversity

### Context Management
34. Enriched goal + tool schemas exceed context → auto-truncate based on enforcement
35. Conversation history too long → trim oldest messages
36. Tool schemas too large → reduce tool set
37. System prompt too long → log warning (manual fix)
38. Context overflow in worker → kill worker, report error
39. Token estimation (words × 1.3) significantly differs from actual → recalibrate from response.usage

### Skills & Matching
40. No skills match the input → use default recon skill
41. All skills match equally → pick top 3 by diversity
42. Skill references tool not in registry → log warning, skip tool
43. Skill's default tier conflicts with user-specified tier → user wins
44. Graph state suggests different skill than user input → boost graph match

### Configuration
45. Config file missing new fields → use defaults (backward compatible)
46. Invalid budget allocation (sum > 1.0) → validation error at load
47. Invalid rate limit config (RPM ≤ 0) → validation error at load
48. Config file corrupted → graceful fallback to defaults + warning
49. Environment variable overrides config → env wins, log override
50. `budgetScope` not in existing config → default to `'session'`

### Legacy & Comparison
51. Legacy engine can't use dynamic tools → use static CORE_TOOLS
52. Engine switch mid-session → graceful transition
53. Legacy mode with budget policy → ignore budget (legacy behavior)
54. Comparison mode with different providers → valid comparison

### Observability
55. Forensic log disk full → graceful degradation (in-memory only)
56. Token tracking disabled → skip token recording, budget still enforced
57. Dashboard output too large → truncate with summary
58. Calibration script fails for some tools → use heuristic defaults
59. REPL turn consumes 100% of session budget → log warning, suggest increasing limit
60. Worker returns `budgetStatus: 'exhausted'` but brain keeps spawning → enforce brain budget

---

> **Review requested**: Please review this plan and provide feedback before implementation begins. Key items to confirm:
> 1. Phase ordering and dependency chain
> 2. New file count (~19) and modified file count (~27) — acceptable scope?
> 3. Gap analysis — any remaining gaps?
> 4. Risk mitigations — any concerns?
> 5. Test targets (~950+ total) — realistic?
> 6. Budget scope default (`'session'` vs `'turn'`) — which is preferred?
