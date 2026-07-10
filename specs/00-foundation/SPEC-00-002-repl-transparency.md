# SPEC-00-002: REPL Transparency (Tier Map + Per-Turn Cost + Quota)

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-00-001

---

## 1. Problem Statement

The REPL banner (`src/session/lifecycle.ts:512`) shows only `config.provider/config.model`. It does not show the tier-to-model mapping, per-turn token cost, or provider quota status. For a bounty hunter paying per token, this is unacceptable - you cannot tell which model ran, what it cost, or whether you are about to be rate-limited.

---

## 2. Acceptance Criteria

~~~
AC-00-002-1: Banner shows tier->model map when engine=multi-model (fast=/balanced=/powerful=)
AC-00-002-2: Per-turn token cost is printed after each solver turn
AC-00-002-3: Provider quota status is visible (e.g. groq: 28/30 RPM, exhaustions: 0)
AC-00-002-4: /cost REPL command prints cumulative spend + remaining quota per provider
~~~

---

## 3. Technical Design

### 3.1 Banner (`src/session/lifecycle.ts:512`)
Extend `log.banner` lines to include tier map and last-turn cost:
~~~
const tiers = config.modelTiers ?? {};
log.banner(
  'Ultimatrix v8',
  'Target: ' + (target ?? 'none'),
  'Engine: ' + config.engine,
  'Tiers: fast=' + (tiers.fast?.model ?? '-') +
    ' balanced=' + (tiers.balanced?.model ?? '-') +
    ' powerful=' + (tiers.powerful?.model ?? '-'),
  'Last turn: ~' + lastTurnTokens + ' tokens',
);
~~~

### 3.2 Per-turn cost
In `src/solver/solver.ts`, after the stream loop, read `getGlobalUsageTracker()` totals for the turn and log them. Track `lastTurnTokens` on the lifecycle resources.

### 3.3 Quota status + /cost command
Add a REPL command handler in `lifecycle.ts` REPL parser:
~~~
case '/cost': {
  const status = getGlobalQuotaTracker().getStatus();
  for (const [provider, q] of Object.entries(status)) {
    log.info(provider + ': ' + q.used + '/' + q.limit + ' used, exhaustions=' + q.exhaustionCount);
  }
  break;
}
~~~

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/session/lifecycle.ts` | Banner + /cost handler | ~512, ~530 |
| `src/solver/solver.ts` | Per-turn token logging | ~760 |
| `src/models/quota-tracker.ts` | Already has getStatus() (reuse) | - |

---

## 5. Tests

- `test/session/repl-transparency.test.ts`: banner string contains tier models; /cost prints provider status.

---

*Spec Version: 1.0*
