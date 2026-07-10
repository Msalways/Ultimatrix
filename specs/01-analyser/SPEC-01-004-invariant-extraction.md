# SPEC-01-004: Use-Case Inference + Invariant Extraction

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1 (Highest leverage)  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-002, SPEC-01-003

---

## 1. Problem Statement

LLM hypothesizes blindly. The Invariant Extractor derives **oracle-verifiable business rules** from observed behavior: "must call A before B", "balance never increases without deposit", "value X from response A must be used in request B". These become the input to primitives (invariantProbe, workflowBypass, idorSwapper, concurrencyHarness) so attacks are targeted, not random.

---

## 2. Acceptance Criteria

~~~
AC-01-004-1: Extracts workflow invariants (required step ordering) from observed flows
AC-01-004-2: Extracts value-flow invariants (param must equal source response field)
AC-01-004-3: Extracts state invariants (illegal transitions) from state machines
AC-01-004-4: Each invariant carries an oracle function usable by primitives
AC-01-004-5: Invariants are written as FactNodes (derived invariant + oracle spec)
~~~

---

## 3. Technical Design

New `src/analysis/invariant-extractor.ts`:
~~~
export interface Invariant {
  id: string;
  type: 'workflow' | 'value-provenance' | 'state' | 'auth';
  description: string;
  oracle: (requests: HttpRequest[]) => Promise<boolean>;
}
export class InvariantExtractor {
  extractFromGraph(graph: GraphStore, flows: ValueFlow[]): Invariant[] {
    // workflow: order of VALUE_ORIGIN edges
    // value-provenance: source field -> target param
    // state: stateChanges on WorkflowNode
  }
}
~~~

Wire into Campaign Planner (SPEC-02-003) so slices are prioritized by invariant confidence, and into primitives (SPEC-02-001) so `generate()` uses the invariant.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/invariant-extractor.ts` | NEW | ~250 |
| `src/campaign/planner.ts` | Consume invariants | ~100 |
| `src/primitives/*.ts` | Consume invariants in generate() | ~50 each |

---

## 5. Tests

- `test/analysis/invariant-extractor.test.ts`: workflow invariant detected from ordered flows; oracle returns true on bypass.

---

*Spec Version: 1.0*
