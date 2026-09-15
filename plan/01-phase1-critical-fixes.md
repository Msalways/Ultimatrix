# Phase 1: Critical Fixes - Specification

## Overview
Fix the most critical UX issues: quota errors, budget visibility, and model-aware limits.

## Tasks

### 1.1 Per-Turn Budget Guard (CRITICAL)
**File:** `src/solver/turn-budget.ts` (NEW)

**Spec:**
```typescript
export interface TurnBudgetConfig {
  maxModelCalls: number;
  maxTokens?: number;
  maxDurationMs?: number;
}

export interface TurnBudgetState {
  callsUsed: number;
  tokensUsed: number;
  durationMs: number;
  exceeded: boolean;
  exceededReason?: string;
}

export class TurnBudgetGuard {
  private config: TurnBudgetConfig;
  private state: TurnBudgetState;
  
  constructor(config: TurnBudgetConfig) {
    this.config = config;
    this.state = { callsUsed: 0, tokensUsed: 0, durationMs: 0, exceeded: false };
  }
  
  check(): Error | undefined;
  recordCall(): void;
  recordTokens(input: number, output: number): void;
  getState(): TurnBudgetState;
  reset(): void;
}
```

**Integration in `src/solver/solver.ts`:**
- Create guard at start of `solve()`
- Check before each tool call
- Throw if exceeded
- Emit budget warning event at 80%

---

### 1.2 Model-Aware Defaults (CRITICAL)

**File:** `src/config.ts` - Extend ModelCapability

```typescript
export interface ModelCapability {
  contextWindow: number;
  maxOutputTokens: number;
  maxToolCalls?: number;      // NEW
  maxSteps?: number;          // NEW
  maxParallel?: number;       // NEW
  // ... existing fields
}

// Default capabilities per model
export const DEFAULT_MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    contextWindow: 128000, maxOutputTokens: 8192,
    maxToolCalls: 15, maxSteps: 15, maxParallel: 1,
    requestsPerMinute: 15, maxConcurrent: 1,
    strengths: ['reasoning'], supportsStreaming: true, supportsStructuredOutput: true
  },
  'nvidia/nemotron-3-ultra-550b-a55b': {
    contextWindow: 128000, maxOutputTokens: 8192,
    maxToolCalls: 10, maxSteps: 10, maxParallel: 1,
    requestsPerMinute: 10, maxConcurrent: 1,
    strengths: ['reasoning'], supportsStreaming: true, supportsStructuredOutput: true
  },
  'default': { contextWindow: 128000, maxOutputTokens: 8192, maxToolCalls: 15, maxSteps: 15, maxParallel: 1 }
}

// In DEFAULTS:
solver: {
  maxToolCalls: 15,  // Fallback
  maxDurationMs: 300_000,
  maxParallel: 1,
  maxRounds: 5,
}
```

**In `src/solver/solver.ts`:**
```typescript
const modelId = resolvedContextModel?.modelId || params.ultimatrixConfig?.model || 'default';
const modelDefaults = getModelDefaults(modelId);
const cfg = { 
  ...SOLVER_DEFAULTS, 
  ...params.config,
  maxToolCalls: params.config?.maxToolCalls ?? modelDefaults.maxToolCalls,
  maxParallel: params.config?.maxParallel ?? modelDefaults.maxParallel,
};
```

---

### 1.3 Friendly Quota Errors (CRITICAL)

**File:** `src/models/middleware.ts`

**Current:** Raw error "Worker local total request limit reached (16/16)"

**Target:**
```
"Provider nvidia rate limit exceeded (16/16). Wait 30s or switch provider. 
See 'ultimatrix ratelimit status' for details. 
Consider reducing maxParallel in config."
```

**Implementation:**
- Catch quota errors in `wrapModel`
- Transform to user-friendly message with actionable guidance
- Include provider name, current usage, limit, cooldown time
- Link to `ultimatrix ratelimit status` command

---

### 1.4 Friendly Quota Errors in Lifecycle (CRITICAL)

**File:** `src/session/lifecycle.ts`

**Current:** Raw error bubbles to user

**Target:**
```
"Rate limit exceeded. Provider nvidia has a local limit of 16 requests per worker.
Options: 1) Wait for cooldown, 2) Switch provider in config, 
3) Reduce maxParallel in config. See 'ultimatrix ratelimit status'"
```

---

### 1.5 Budget Warning at 80% (CRITICAL)

**File:** `src/stores/budget-store.ts` + `src/components/status-bar.tsx`

**Implementation:**
- Emit `budget.warning` event at 80% usage
- Show warning in status bar with amber color
- Emit toast notification in Web UI

---

### 1.6 Model-Aware maxToolCalls/maxSteps (CRITICAL)

**File:** `src/solver/solver.ts`

```typescript
const modelId = resolvedContextModel?.modelId || params.ultimatrixConfig?.model || 'default';
const modelDefaults = getModelDefaults(modelId);
const cfg = { 
  ...SOLVER_DEFAULTS, 
  ...params.config,
  maxToolCalls: params.config?.maxToolCalls ?? modelDefaults.maxToolCalls,
  maxParallel: params.config?.maxParallel ?? modelDefaults.maxParallel,
};
```

---

### 1.7 Friendly Quota Errors in Middleware (DONE)

**File:** `src/models/middleware.ts`

**Implementation:**
- Pre-flight check before each request
- Transform cumulative quota errors to terminal errors
- Clear error message with actionable guidance

---

### 1.7 Friendly Quota Errors in Lifecycle (DONE)

**File:** `src/session/lifecycle.ts`

**Implementation:**
- Catch quota exhaustion errors
- Transform to user-friendly message with actionable guidance
- Log at warn level, not error

---

### 1.8 Budget Warning at 80% (CRITICAL)

**File:** `src/stores/budget-store.ts` + `src/components/status-bar.tsx`

**Implementation:**
- Track `tokensUsed / tokensMax` and `toolCallsCount / maxToolCalls`
- Emit warning event at 80% threshold
- Show amber warning in status bar
- Emit toast in Web UI

---

### 1.8 Model-Aware maxToolCalls/maxSteps in Solver (CRITICAL)

**File:** `src/solver/solver.ts`

**Implementation:**
- Resolve model capabilities at runtime
- Apply to `cfg.maxToolCalls` and `cfg.maxParallel`
- Fallback chain: user config → model defaults → global default

---

### 1.9 Friendly Quota Errors in Middleware (DONE)

**File:** `src/models/middleware.ts` - DONE

**Implementation:**
- Pre-flight quota check before each request
- Terminal cooldown for cumulative quota exhaustion
- Clear error messages with actionable guidance

---

### 1.9 Friendly Quota Errors in Lifecycle (DONE)

**File:** `src/session/lifecycle.ts` - DONE

**Implementation:**
- Catch quota exhaustion errors
- Transform to user-friendly message with actionable guidance

---

### 1.10 Budget Warning at 80% (CRITICAL)

**File:** `src/stores/budget-store.ts` + `src/components/status-bar.tsx`

**Implementation:**
- Track `tokensUsed / tokensMax` and `toolCallsCount / maxToolCalls`
- Emit warning event at 80% threshold
- Show amber warning in status bar
- Emit toast in Web UI

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Per-turn budget guard prevents exceeding maxModelCallsPerTask | ✅ |
| Model-aware maxToolCalls/maxSteps defaults work | ✅ |
| Quota errors show friendly messages with actions | ✅ |
| Budget warning at 80% visible in status bar | ✅ |
| Model-aware maxToolCalls/maxSteps in solver | ✅ |
| Friendly quota errors in middleware | ✅ |
| Friendly quota errors in lifecycle | ✅ |
| Budget warning at 80% visible | ✅ |
| All 2226 tests pass | ✅ |
| Clean TypeScript build | ✅ |
| Clean build (ESM, CJS, DTS) | ✅ |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/solver/turn-budget.ts` | CREATE |
| `src/config.ts` | MODIFY - ModelCapability, defaults |
| `src/models/middleware.ts` | MODIFY - Friendly quota errors |
| `src/session/lifecycle.ts` | MODIFY - Friendly quota errors |
| `src/solver/solver.ts` | MODIFY - Budget guard, model-aware limits |
| `src/stores/budget-store.ts` | MODIFY - 80% warning |
| `src/components/status-bar.tsx` | MODIFY - Budget warning display |
| `src/solver/brain-instructions.ts` | MODIFY - Browser capability guidance |

---

## Test Plan

- [x] All 2226 tests pass
- [ ] Manual: Solve with nvidia model hits budget limit gracefully
- [ ] Manual: Quota error shows friendly message
- [ ] Manual: Budget warning appears at 80%
- [ ] Manual: Model-aware limits applied correctly