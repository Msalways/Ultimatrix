# Phase 4: Model-Aware Limits & Budget - Specification

## Overview
Connect model capabilities to solver defaults and rate limiting. Make limits model-aware instead of hardcoded.

## Tasks

### 4.1 Extend ModelCapability Interface (CRITICAL)

**File:** `src/config.ts`

**Current ModelCapability:**
```typescript
export interface ModelCapability {
  contextWindow: number;
  maxOutputTokens: number;
  maxTokensPerMinute?: number;
  reservedMargin?: number;
  strengths: string[];
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision?: boolean;
}
```

**Target:**
```typescript
export interface ModelCapability {
  contextWindow: number;
  maxOutputTokens: number;
  maxTokensPerMinute?: number;
  reservedMargin?: number;
  strengths: string[];
  supportsStreaming: boolean;
  supportsStructuredOutput: boolean;
  supportsVision?: boolean;
  
  // NEW: Execution limits
  maxToolCalls?: number;        // Max tool calls per turn
  maxSteps?: number;            // Max agent steps per turn
  maxParallel?: number;         // Max parallel operations
  // Rate limits are provider-level
}
```

---

### 4.2 Add Default Model Capabilities (CRITICAL)

**File:** `src/config.ts`

```typescript
// Add after ModelCapability interface
export const DEFAULT_MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // Nvidia models
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning': {
    contextWindow: 128000,
    maxOutputTokens: 8192,
    maxToolCalls: 15,
    maxSteps: 15,
    maxParallel: 1,
    requestsPerMinute: 15,
    maxConcurrent: 1,
    maxRetries: 3,
    backoffStrategy: 'stepped',
    backoffSteps: [5000, 15000, 30000],
    baseBackoffMs: 2000,
    maxBackoffMs: 30000,
    strengths: ['reasoning', 'coding'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
  'nvidia/nemotron-3-ultra-550b-a55b': {
    contextWindow: 128000,
    maxOutputTokens: 8192,
    maxToolCalls: 10,
    maxSteps: 10,
    maxParallel: 1,
    requestsPerMinute: 10,
    maxConcurrent: 1,
    maxRetries: 3,
    backoffStrategy: 'stepped',
    backoffSteps: [10000, 30000, 60000],
    baseBackoffMs: 5000,
    maxBackoffMs: 60000,
    strengths: ['reasoning'],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  },
  // Add more as needed
  'default': { 
    contextWindow: 128000, 
    maxOutputTokens: 8192, 
    maxToolCalls: 15, 
    maxSteps: 15, 
    maxParallel: 1,
    requestsPerMinute: 15,
    maxConcurrent: 1,
    maxRetries: 3,
    backoffStrategy: 'stepped',
    backoffSteps: [5000, 15000, 30000],
    baseBackoffMs: 2000,
    maxBackoffMs: 30000,
    strengths: [],
    supportsStreaming: true,
    supportsStructuredOutput: true,
  }
};
```

---

### 4.3 Make DEFAULTS Model-Aware (CRITICAL)

**File:** `src/config.ts`

**Current DEFAULTS.solver:**
```typescript
solver: {
  maxToolCalls: 50,  // Hardcoded!
  maxDurationMs: 300_000,
  maxParallel: 1,
  maxRounds: 5,
  maxActiveChainSteps: 3,
},
```

**Target:**
```typescript
// Remove hardcoded solver defaults, make them dynamic
// In solver.ts, resolve at runtime:
const modelId = resolvedContextModel?.modelId || params.ultimatrixConfig?.model || 'default';
const modelDefaults = getModelDefaults(modelId);
const cfg = { 
  ...SOLVER_DEFAULTS, 
  ...params.config,
  maxToolCalls: params.config?.maxToolCalls ?? modelDefaults.maxToolCalls,
  maxParallel: params.config?.maxParallel ?? modelDefaults.maxParallel,
};
```

**Helper function in config.ts:**
```typescript
export function getModelDefaults(modelId: string): ModelCapability {
  // 1. Check user-configured modelCapabilities
  if (config.modelCapabilities?.[modelId]) return config.modelCapabilities[modelId];
  
  // 2. Check built-in defaults
  if (DEFAULT_MODEL_CAPABILITIES[modelId]) return DEFAULT_MODEL_CAPABILITIES[modelId];
  
  // 3. Try provider-level defaults
  const provider = getProviderFromModelId(modelId);
  if (DEFAULT_PROVIDER_DEFAULTS[provider]) return DEFAULT_PROVIDER_DEFAULTS[provider];
  
  // 4. Return safe default
  return DEFAULT_MODEL_CAPABILITIES['default'];
}
```

---

### 4.4 Wire Model Limits into Solver (CRITICAL)

**File:** `src/solver/solver.ts`

**Current:**
```typescript
const cfg = { ...SOLVER_DEFAULTS, ...params.config };
// Uses hardcoded DEFAULTS.solver.maxToolCalls (50)
```

**Target:**
```typescript
const modelId = resolvedContextModel?.modelId || params.ultimatrixConfig?.model || 'default';
const modelDefaults = getModelDefaults(modelId);

const cfg = { 
  ...SOLVER_DEFAULTS, 
  ...params.config,
  maxToolCalls: params.config?.maxToolCalls ?? modelDefaults.maxToolCalls ?? SOLVER_DEFAULTS.maxToolCalls,
  maxParallel: params.config?.maxParallel ?? modelDefaults.maxParallel ?? SOLVER_DEFAULTS.maxParallel,
};
```

Also update agent:
```typescript
agent: {
  maxSteps: 25,  // Hardcoded!
},
```

Should become:
```typescript
agent: {
  maxSteps: modelDefaults.maxSteps ?? 25,
},
```

---

### 4.5 Update CLI to Show Model Limits

**File:** `src/cli/models.ts`

**Add to `models list` output:**
```
Configured Models:

  nvidia/nemotron-3-nano-omni-30b-a3b-reasoning [balanced]
    Context: 128,000 tokens
    Max output: 8,192 tokens
    Max tool calls: 15
    Max steps: 15
    Max parallel: 1
    Streaming: yes
    Strengths: reasoning, coding

  nvidia/nemotron-3-ultra-550b-a55b [powerful]
    Context: 128,000 tokens
    Max output: 8,192 tokens
    Max tool calls: 10
    Max steps: 10
    Max parallel: 1
    Streaming: yes
    Strengths: reasoning
```

**Add `models limits <modelId>` command:**
```
$ ultimatrix models limits nvidia/nemotron-3-ultra-550b-a55b
Model: nvidia/nemotron-3-ultra-550b-a55b
  Context window: 128,000 tokens
  Max output: 8,192 tokens
  Max tool calls/turn: 10
  Max steps/turn: 10
  Max parallel: 1
  Rate limit: 10 req/min
  Max concurrent: 1
  Strengths: reasoning
  Streaming: yes
  Structured output: yes
```

---

### 4.4 Update ultimatrix.yaml with Model Capabilities

```yaml
modelCapabilities:
  nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:
    contextWindow: 128000
    maxOutputTokens: 8192
    maxToolCalls: 15
    maxSteps: 15
    maxParallel: 1
    requestsPerMinute: 15
    maxConcurrent: 1
    strengths: ["reasoning", "coding"]
    supportsStreaming: true
    supportsStructuredOutput: true
```

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| ModelCapability has maxToolCalls, maxSteps, maxParallel | ⬜ |
| Default model capabilities defined for all used models | ⬜ |
| Solver uses model-aware maxToolCalls/maxSteps | ⬜ |
| CLI shows model limits in `models list` | ⬜ |
| `models limits <modelId>` works | ⬜ |
| ultimatrix.yaml supports modelCapabilities | ⬜ |
| Solver respects model maxToolCalls | ⬜ |
| Agent maxSteps uses model default | ⬜ |
| All 2226 tests pass | ⬜ |
| Clean TypeScript build | ⬜ |
| Clean build (ESM, CJS, DTS) | ⬜ |

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/config.ts` | ModelCapability extension, default capabilities, getModelDefaults() |
| `src/solver/solver.ts` | Use model-aware defaults |
| `src/cli/models.ts` | Show limits in list, add limits command |
| `src/config.ts` | Add to ultimatrix.yaml schema |
| `ultimatrix.yaml` | Add modelCapabilities section |

---

## Test Plan

- [ ] `npm test` - all 2226 tests pass
- [ ] `npm run build:cli` - clean build
- [ ] `npm run typecheck` - clean TypeScript
- [ ] Manual: `ultimatrix models list` shows limits
- [ ] Manual: `ultimatrix models limits <model>` shows details
- [ ] Manual: Solver with nvidia model respects maxToolCalls=15
- [ ] Manual: Solver with unknown model uses defaults