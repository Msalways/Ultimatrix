# SPEC-00-006: Config Schema Extensions for Multi-Model & Campaigns

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0  
**Date:** 2026-07-09  
**Depends On:** SPEC-99-001

---

## 1. Problem Statement

The config schema lacks the fields required by the other P0 specs: `modelTiers` (multi-model), `scope` (safety), `providerRateLimits` (per-host), and richer `modelCapabilities` (selector). Without these typed fields the features above cannot be validated or persisted.

---

## 2. Acceptance Criteria

~~~
AC-00-006-1: UltimatrixConfig accepts modelTiers { fast, balanced, powerful }
AC-00-006-2: UltimatrixConfig accepts scope { inScope, outOfScope }
AC-00-006-3: UltimatrixConfig accepts providerRateLimits (per provider RateLimitConfig)
AC-00-006-4: loadConfig/saveProjectConfig round-trip these fields to YAML
~~~

---

## 3. Technical Design

Add to `src/config.ts`:
~~~
export interface ScopeConfig { inScope: string[]; outOfScope: string[]; }
// UltimatrixConfig additions:
//   modelTiers?: ModelTiers;
//   scope?: ScopeConfig;
//   providerRateLimits?: Record<string, RateLimitConfig>;
//   modelCapabilities?: ModelCapabilities;
~~~

Update `saveProjectConfig()` (already writes `modelTiers`, `modelCapabilities`, `providerRateLimits`) to also write `scope`. Update `validateConfig()` to type-check these.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/config.ts` | Interfaces + save/load | ~140, ~960 |

---

## 5. Tests

- `test/config/config.test.ts`: round-trip of modelTiers + scope through save/load.

---

*Spec Version: 1.0*
