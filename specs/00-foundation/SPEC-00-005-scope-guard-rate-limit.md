# SPEC-00-005: Scope Guard + Per-Host Rate Limiting (Safety / Legal)

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0 (Legal risk)  
**Date:** 2026-07-09  
**Depends On:** SPEC-00-001

---

## 1. Problem Statement

There is **no scope enforcement** and **no per-host rate limiting**. A bounty hunter can accidentally fire requests at out-of-scope assets (program ban / legal exposure) and can get their IP banned mid-engagement. `config.ts` has no `scope` interface; `http-tools.ts` performs no host check; `limiter-factory.ts` is per-provider, not per-host.

---

## 2. Acceptance Criteria

~~~
AC-00-005-1: config.scope.inScope / outOfScope is enforced before any outbound HTTP request
AC-00-005-2: Out-of-scope requests are blocked with a clear error and logged
AC-00-005-3: Per-host rate limiting (RPM + concurrency) is enforced using existing ProviderAwareLimiter pattern
AC-00-005-4: Campaign executor refuses slices whose endpoint is out of scope
~~~

---

## 3. Technical Design

### 3.1 Config (`src/config.ts`)
~~~
export interface ScopeConfig {
  inScope: string[];   // glob: ['*.example.com']
  outOfScope: string[]; // glob: ['admin.example.com']
}
// add `scope?: ScopeConfig` to UltimatrixConfig
~~~

### 3.2 Enforcement (`src/tools/http-tools.ts`)
~~~
function isOutOfScope(host: string, scope?: ScopeConfig): boolean {
  if (!scope) return false;
  if (scope.outOfScope.some(p => minimatch(host, p))) return true;
  if (scope.inScope.length && !scope.inScope.some(p => minimatch(host, p))) return true;
  return false;
}
// at top of httpRequest.execute:
if (isOutOfScope(new URL(url).hostname, config.scope)) {
  throw new Error('OUT OF SCOPE: ' + host);
}
const hostLimiter = getHostLimiter(host);
await hostLimiter.acquire();
~~~

### 3.3 Campaign guard (`src/campaign/executor.ts`)
Before running a slice, check `isOutOfScope(new URL(slice.endpoint.url).hostname, config.scope)` and skip + log.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/config.ts` | ScopeConfig + field | ~140 |
| `src/tools/http-tools.ts` | Scope + host limiter | ~20 |
| `src/campaign/executor.ts` | Slice scope check | ~106 |

---

## 5. Tests

- `test/tools/scope-guard.test.ts`: out-of-scope URL throws; in-scope passes.

---

*Spec Version: 1.0*
