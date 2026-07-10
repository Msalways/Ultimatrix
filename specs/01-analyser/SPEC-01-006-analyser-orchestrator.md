# SPEC-01-006: Analyser Orchestrator

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-002, SPEC-01-003, SPEC-01-004, SPEC-01-005

---

## 1. Problem Statement

The individual analyser pieces (provenance, auth decode, invariants, hypotheses) must be orchestrated into one pipeline that runs after spider/human observation and feeds the graph + planner. Today there is no single entry point.

---

## 2. Acceptance Criteria

~~~
AC-01-006-1: BusinessLogicAnalyser.analyse(har, graph, dom) runs all sub-engines in order
AC-01-006-2: Output is: ValueFlows + AuthSchemes + Invariants + boosted Hypotheses, all in the graph
AC-01-006-3: Incremental mode: re-running only processes new HAR entries
AC-01-006-4: Results are queryable by the Campaign Planner
~~~

---

## 3. Technical Design

New `src/analysis/analyser.ts`:
~~~
export class BusinessLogicAnalyser {
  constructor(
    private provenance: ValueProvenanceEngine,
    private auth: AuthDecodeDetector,
    private invariants: InvariantExtractor,
    private ingest: HypothesisIngestor,
  ) {}
  analyse(input: { har?: HarCapture; graph: GraphStore; dom?: DomCapture }): AnalysisResult {
    // 1 provenance.recordHarEntry per entry
    // 2 auth.decodeAndTrack per auth header
    // 3 invariants.extractFromGraph
    // 4 return aggregated result
  }
}
~~~

Call `analyse()` from `src/session/lifecycle.ts` after the spider phase (mirror `src/cli/solve.ts` lines 75-88).

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/analyser.ts` | NEW orchestrator | ~100 |
| `src/session/lifecycle.ts` | Call analyse() post-spider | ~480 |
| `src/cli/solve.ts` | Call analyse() post-spider | ~75 |

---

## 5. Tests

- `test/analysis/analyser.test.ts`: end-to-end analyse() populates graph with VALUE_ORIGIN + AuthScheme + Invariant.

---

*Spec Version: 1.0*
