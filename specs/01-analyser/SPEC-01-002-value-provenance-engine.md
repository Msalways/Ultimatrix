# SPEC-01-002: Value Provenance Engine

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-001, SPEC-00-007

---

## 1. Problem Statement

The ValueFlowTracker (SPEC-00-007) records raw flows. The Value Provenance Engine turns HAR + DOM captures into **structured provenance**: which response field of endpoint A becomes which request param of endpoint B, with confidence. This is what lets the system ask "can I swap this ID?" instead of guessing.

---

## 2. Acceptance Criteria

~~~
AC-01-002-1: Given HAR entries, the engine maps response.field -> request.param across endpoints
AC-01-002-2: DOM input values are linked to the form submission API param
AC-01-002-3: Output is written as VALUE_ORIGIN edges + ValueFlow records
AC-01-002-4: Confidence computed from name similarity + co-occurrence
~~~

---

## 3. Technical Design

New `src/analysis/value-provenance.ts`:
~~~
export class ValueProvenanceEngine {
  constructor(private tracker: ValueFlowTracker) {}
  recordHarEntry(entry: HarEntry): void {
    // extract response JSON scalar fields
    // extract request params (query + body)
    // match by name similarity + value co-occurrence -> recordFlow
  }
  recordDomEvent(ev: DomEvent): void {
    // input.value -> form submit param -> recordFlow(type:'ui')
  }
  private confidence(field: string, param: string): number {
    const a = field.toLowerCase(), b = param.toLowerCase();
    if (a === b) return 0.9;
    if (a.includes(b) || b.includes(a)) return 0.7;
    return 0.4;
  }
}
~~~

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/value-provenance.ts` | NEW | ~180 |
| `src/analysis/index.ts` | wire singleton | ~10 |

---

## 5. Tests

- `test/analysis/value-provenance.test.ts`: two HAR entries with shared field name produce a high-confidence flow.

---

*Spec Version: 1.0*
