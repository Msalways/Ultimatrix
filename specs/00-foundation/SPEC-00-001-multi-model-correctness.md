# SPEC-00-001: Multi-Model Engine Correctness

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0 (Critical - Blocks all autonomy)  
**Date:** 2026-07-09  
**Depends On:** SPEC-99-001 (Architecture Overview)

---

## 1. Problem Statement

The `multi-model` engine (the core differentiator: cheap model for recon, powerful model for exploitation) is currently a **silent no-op** when `modelTiers` is not configured.

Verified by code read:
- `src/models/factory.ts:50` - `tierCfg` is optional; falls back to `config.model` silently with no warning.
- `src/session/lifecycle.ts:476` - brain created WITHOUT a shared `ModelSelector`.
- `src/solver/brain-tools.ts:152` - a **throwaway** `ModelSelector` is created inside brain-tools, so `recordSuccess/recordFailure` history is lost every turn.
- `src/session.ts:44` - `interact` defaults to the **legacy** engine (known type errors per AGENTS.md).

**Impact:** Users believe they are getting tiered routing + cost savings, but everything runs on a single model. Routing cannot learn across a session.

---

## 2. Acceptance Criteria

~~~
AC-00-001-1: validateConfig() throws a hard error if engine === 'multi-model' and modelTiers is empty/undefined
AC-00-001-2: SessionLifecycle creates ONE ModelSelector instance and passes it into createSolverBrain()
AC-00-001-3: ModelSelector.recordSuccess/recordFailure history persists across REPL turns (same instance)
AC-00-001-4: interact defaults to solver/multi-model engine (legacy no longer the default)
AC-00-001-5: resolveModel(config, { tier, selector }) uses the passed selector; throws if the tier is absent from modelTiers
~~~

---

## 3. Root Cause

Multi-model routing was designed but never fully wired:
1. No validation that `engine: multi-model` requires `modelTiers`.
2. `ModelSelector` instantiated in the wrong place (brain-tools instead of lifecycle) -> learning lost.
3. Default engine still legacy -> type-error-prone path is the entry point.

---

## 4. Technical Design

### 4.1 Config validation (`src/config.ts`)
Add to `validateConfig()`:
~~~
if (config.engine === 'multi-model') {
  if (!config.modelTiers || Object.keys(config.modelTiers).length === 0) {
    throw new Error('engine: "multi-model" requires modelTiers (fast/balanced/powerful)');
  }
  for (const [tier, tc] of Object.entries(config.modelTiers)) {
    if (!tc?.provider || !tc?.model) throw new Error('modelTiers.' + tier + ': missing provider or model');
    // verify creds exist for the provider
  }
}
~~~

### 4.2 Lifecycle creates + passes selector (`src/session/lifecycle.ts` ~476)
~~~
import { ModelSelector } from '../models/selector';
const modelSelector = (config.engine === 'multi-model')
  ? new ModelSelector(config.modelCapabilities, config.budgetPolicy, config)
  : undefined;

const solverBrain = createSolverBrain(config, {
  skillRegistry, workerPool, browser, memory,
  extraContext: harContextForLLM,
  modelSelector, // shared instance
});
this._resources.modelSelector = modelSelector;
~~~

### 4.3 brain-tools accepts (not creates) selector (`src/solver/brain-tools.ts`)
~~~
export function createSolverBrain(config, options) {
  // ...
  const selector = options.modelSelector ?? new ModelSelector(config.modelCapabilities ?? {}, config.budgetPolicy ?? DEFAULTS.budgetPolicy, config);
  // REMOVE the unconditional new ModelSelector(...) that currently discards learning
}
~~~

### 4.4 Workers report back (`src/workers/pool.ts`)
After a slice worker completes, call `modelSelector.recordSuccess(provider, modelId)` on success and `recordFailure(...)` on error.

### 4.5 Default engine (`src/config.ts` DEFAULTS + `src/session.ts`)
Change DEFAULT `engine` to `'solver'`. Keep `legacy` available but deprecated.

---

## 5. File Change Summary

| File | Change | Lines |
|------|--------|-------|
| `src/config.ts` | Validation + default engine | ~557, ~200 |
| `src/session/lifecycle.ts` | Create/pass selector | ~476 |
| `src/solver/brain-tools.ts` | Accept selector option | ~155 |
| `src/workers/pool.ts` | recordSuccess/recordFailure | ~220 |
| `src/session.ts` | solver default | ~43 |

---

## 6. Test Requirements

- `test/config/config.test.ts`: throws when multi-model + empty tiers; accepts valid tiers.
- `test/models/selector.test.ts`: add `getSuccessHistory()` getter; assert accumulation.
- `test/integration/multi-model.test.ts`: same selector instance across two REPL turns; history size > 0 after a turn.

---

## 7. Rollback

All changes additive except the validation throw and engine default. Revert those two if needed.

---

*Spec Version: 1.0 | Author: Architecture Analysis*
