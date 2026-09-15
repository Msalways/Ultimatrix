# Phase 5: Budget & Quota UX - Specification

## Overview
Make budget and quota visible, actionable, and user-friendly in both CLI and Web UI.

## Tasks

### 5.1 Per-Turn Budget Guard in Solver (CRITICAL)

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
```typescript
// In solve(), before tool calls:
const budget = new TurnBudgetGuard({
  maxModelCalls: budgetPolicy?.maxModelCallsPerTask ?? 15,
  maxTokens: budgetPolicy?.maxTokensPerSession,
});

// Before each tool call:
const error = budget.check();
if (error) throw error;

budget.recordCall();
// After tool result:
budget.recordTokens(inputTokens, outputTokens);
```

---

### 5.2 Budget Panel in Web UI (HIGH)

**New File:** `src/components/budget-panel.tsx`

**Spec:**
```tsx
export function BudgetPanel() {
  const { 
    toolCallsCount, 
    maxToolCalls,  // from model capabilities
    tokensUsed, 
    tokensMax,
    phase,
    isRunning 
  } = useBudgetStore();
  
  const callsPct = (toolCallsCount / maxToolCalls) * 100;
  const tokensPct = (tokensUsed / tokensMax) * 100;
  const isWarning = callsPct >= 80 || tokensPct >= 80;
  const isCritical = callsPct >= 95 || tokensPct >= 95;
  
  return (
    <div className="relative">
      <button onClick={() => setShowDetail(!showDetail)} className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${isCritical ? 'bg-red-500' : isWarning ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(callsPct, 100)}%` }}
            />
          </div>
          <span className="text-xs text-zinc-500">
            {toolCallsCount} / {maxToolCalls} calls
          </span>
        </div>
        <ChevronDown size={12} className="text-zinc-500" />
      </button>
      
      {showDetail && (
        <div className="absolute bottom-full right-0 mb-2 w-64 p-3 bg-zinc-900 border border-zinc-800 rounded-lg shadow-lg z-50">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between">
              <span>Calls</span>
              <span>{toolCallsCount} / {maxToolCalls}</span>
            </div>
            <div className="flex justify-between">
              <span>Tokens</span>
              <span>{Math.round(tokensUsed/1000)}k / {Math.round(tokensMax/1000)}k</span>
            </div>
            <div className="flex justify-between">
              <span>Duration</span>
              <span>{formatDuration(durationMs)}</span>
            </div>
            <div className="flex justify-between">
              <span>Findings</span>
              <span>{findingsCount}</span>
            </div>
            {isWarning && (
              <div className="text-amber-400 text-xs">
                ⚠️ Approaching budget limit
              </div>
            )}
            {isCritical && (
              <div className="text-red-400 text-xs">
                🔴 Budget nearly exhausted
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Integration:** Add to `src/components/status-bar.tsx` and `src/components/chat-stream.tsx`

---

### 5.2 Budget Warning at 80% (CRITICAL)

**File:** `src/stores/budget-store.ts`

```typescript
interface BudgetState {
  // ... existing
  warningEmitted: boolean;
  
  incrementTokens: (amount: number) => void;
  incrementToolCalls: (count?: number) => void;
}

incrementToolCalls: (count = 1) => set((s) => {
  const newCount = s.toolCallsCount + count;
  const maxCalls = s.maxToolCalls ?? 15;
  const pct = newCount / maxCalls;
  
  if (pct >= 0.8 && !s.warningEmitted) {
    // Emit warning event
    emit('budget:warning', { pct, type: 'toolCalls' });
    return { toolCallsCount: newCount, warningEmitted: true };
  }
  if (pct >= 1.0) {
    return { toolCallsCount: newCount, budgetExceeded: true };
  }
  return { toolCallsCount: newCount };
}),
```

**In `src/components/status-bar.tsx`:**
```tsx
{isWarning && (
  <span className="ml-2 text-amber-400 text-xs animate-pulse">
    ⚠ Budget: {Math.round(pct * 100)}%
  </span>
)}
{isCritical && (
  <span className="ml-2 text-red-400 text-xs animate-pulse">
    ⚠ BUDGET EXCEEDED
  </span>
)}
```

---

### 5.3 Friendly Quota Errors (CRITICAL)

**File:** `src/models/middleware.ts`

**Current:** Raw error `"Worker local total request limit reached (16/16)"`

**Target:**
```typescript
// In wrapModel, before throwing quota error:
const quotaError = quota.admitRequest(provider, sessionRequestLimit);
if (quotaError) {
  const providerName = getProviderDisplayName(provider);
  const limit = quotaStatus.limit;
  const used = quotaStatus.used;
  
  throw new Error(
    `Provider ${providerName} rate limit exceeded (${used}/${limit}). ` +
    `This provider has a local limit of ${limit} requests per worker. ` +
    `Options: 1) Wait for cooldown, 2) Switch provider in config, ` +
    `3) Reduce maxParallel in config. ` +
    `See 'ultimatrix ratelimit status' for details.`
  );
}
```

---

### 5.4 Friendly Quota Errors in Lifecycle (CRITICAL)

**File:** `src/session/lifecycle.ts`

**Current:** Raw error bubbles up

**Target:**
```typescript
} catch (error) {
  if (error.message.includes('rate limit') || error.message.includes('quota')) {
    log.error(`Rate limit exceeded. Provider ${provider} has a local limit of 16 requests per worker. ` +
      `Options: 1) Wait for cooldown, 2) Switch provider in config, ` +
      `3) Reduce maxParallel in config. See 'ultimatrix ratelimit status'`);
  }
  throw error;
}
```

---

### 5.5 Campaign Executor Pheromone Scheduling (DONE)

**File:** `src/campaign/executor.ts` - DONE

**Already implemented:**
- PheromoneScheduler for stigmergic coordination
- `emitSlicePheromones` on slice completion
- Slice prioritization via pheromone levels

---

### 5.5 Exploitation Loop Pheromone Emission (DONE)

**File:** `src/solver/exploitation-loop.ts` - DONE

**Already implemented:**
```typescript
await emitWorkerPheromones(
  `exploitation-loop:${item.findingId}`,
  primitiveId,
  { url: targetEndpoint, finding: { confirmed: true, findingId: item.findingId }, technique },
  targetEndpoint
);
```

---

### 5.6 Budget Warning at 80% in Status Bar

**File:** `src/components/status-bar.tsx`

**Implementation:**
```tsx
{toolCallsCount > 0 && maxToolCalls > 0 && (
  <>
    <span className="h-3 w-px bg-zinc-800" />
    {toolCallsCount > (maxToolCalls * 0.8) && (
      <span className="text-amber-400 text-xs animate-pulse">
        ⚠ Budget: {Math.round((toolCallsCount/maxToolCalls)*100)}%
      </span>
    )}
    {toolCallsCount >= maxToolCalls && (
      <span className="text-red-400 text-xs animate-pulse">
        ⚠ BUDGET EXCEEDED
      </span>
    )}
  </>
}
```

---

### 5.6 Friendly Quota Errors in Middleware (DONE)

**File:** `src/models/middleware.ts` - DONE

**Already implemented:**
- Pre-flight quota check before each request
- Terminal cooldown for cumulative quota exhaustion
- Clear error messages with actionable guidance

---

### 5.7 Friendly Quota Errors in Lifecycle (DONE)

**File:** `src/session/lifecycle.ts` - DONE

**Already implemented:**
- Catch quota exhaustion errors
- Transform to user-friendly message with actionable guidance

---

### 5.7 Budget Warning at 80% (CRITICAL)

**File:** `src/stores/budget-store.ts` + `src/components/status-bar.tsx`

**Implementation:**
- Track `tokensUsed / tokensMax` and `toolCallsCount / maxToolCalls`
- Emit warning event at 80% threshold
- Show amber warning in status bar
- Emit toast in Web UI

---

### 5.8 Campaign Executor Pheromone Scheduling (DONE)

**File:** `src/campaign/executor.ts` - DONE

**Already implemented:**
- PheromoneScheduler for stigmergic coordination
- `emitSlicePheromones` on slice completion
- Slice prioritization via pheromone levels

---

### 5.8 Exploitation Loop Pheromone Emission (DONE)

**File:** `src/solver/exploitation-loop.ts` - DONE

**Already implemented:**
```typescript
await emitWorkerPheromones(
  `exploitation-loop:${item.findingId}`,
  primitiveId,
  { url: targetEndpoint, finding: { confirmed: true, findingId: item.findingId }, technique },
  targetEndpoint
);
```

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Per-turn budget guard prevents exceeding maxModelCallsPerTask | ⬜ |
| Budget panel visible in Web UI | ⬜ |
| Budget warning at 80% in status bar | ⬜ |
| Friendly quota errors with actionable guidance | ⬜ |
| Campaign executor uses pheromone scheduling | ✅ |
| Exploitation loop emits pheromones | ✅ |
| Budget warning at 80% in status bar | ⬜ |
| Friendly quota errors in middleware | ✅ |
| Friendly quota errors in lifecycle | ✅ |
| All 2226 tests pass | ⬜ |
| Clean TypeScript build | ⬜ |
| Clean build (ESM, CJS, DTS) | ⬜ |

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/solver/turn-budget.ts` | CREATE - TurnBudgetGuard |
| `src/solver/solver.ts` | MODIFY - Budget integration |
| `src/stores/budget-store.ts` | MODIFY - 80% warning |
| `src/components/status-bar.tsx` | MODIFY - Budget warning |
| `src/components/budget-panel.tsx` | CREATE - Budget panel |
| `src/components/chat-stream.tsx` | MODIFY - Add budget panel |
| `src/models/middleware.ts` | MODIFY - Friendly quota errors |
| `src/session/lifecycle.ts` | MODIFY - Friendly quota errors |
| `src/components/status-bar.tsx` | MODIFY - Budget warning |

---

## Test Plan

- [ ] Manual: Solve with nvidia model hits budget limit gracefully
- [ ] Manual: Quota error shows friendly message with actions
- [ ] Manual: Budget warning appears at 80% in status bar
- [ ] Manual: Budget panel shows in Web UI
- [ ] Manual: Campaign executor uses pheromone scheduling
- [ ] Manual: Exploitation loop emits pheromones
- [ ] All 2226 tests pass
- [ ] Clean TypeScript build
- [ ] Clean build (ESM, CJS, DTS)