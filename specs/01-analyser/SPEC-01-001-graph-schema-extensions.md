# SPEC-01-001: Graph Schema Extensions (Analyser Nodes/Edges)

**Status:** 📋 Planned  
**Phase:** 01 - Business-Logic Analyser  
**Priority:** P1 (Upstream differentiator)  
**Date:** 2026-07-09  
**Depends On:** SPEC-99-001

---

## 1. Problem Statement

The graph already declares `HeaderSemantic`, `AuthScheme`, `Hypothesis`, `OutcomeFeedback` node types and `VALUE_ORIGIN` edge type (`src/graph/schema.ts`), but there are **no writers** that populate them from observation. The analyser (Phase 1) needs these nodes to be created from real captured traffic.

---

## 2. Acceptance Criteria

~~~
AC-01-001-1: A writer exists that creates HeaderSemantic nodes (header -> role) from captured responses
AC-01-001-2: A writer exists that creates AuthScheme nodes (decoded basic/jwt/custom + reusedAcross)
AC-01-001-3: A writer exists that creates Hypothesis nodes (origin human|llm, status open)
AC-01-001-4: EndpointNode gains useCase + preconditions writer helpers
~~~

---

## 3. Technical Design

Add to `src/graph/tools.ts` (or a new `src/analysis/graph-writers.ts`):
~~~
export function addHeaderSemantic(header: string, role: 'identity'|'required'|'static'|'anti-bot'|'correlation', endpoint?: string): HeaderSemanticNode
export function addAuthScheme(scheme: 'basic'|'jwt'|'bearer'|'api-key'|'custom', decoded: boolean, reusedAcross: string[]): AuthSchemeNode
export function addHypothesis(input: { title: string; kind: string; reason: string; origin: 'human'|'llm'; targetEndpoints?: string[] }): HypothesisNode
~~~

These wrap `graphStore.upsertNode` with the existing node interfaces. No schema change needed - types already exist.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/graph-writers.ts` | NEW writers | ~120 |
| `src/graph/schema.ts` | (already has types) reuse | - |

---

## 5. Tests

- `test/analysis/graph-writers.test.ts`: addHeaderSemantic/addAuthScheme/addHypothesis create correct node types.

---

*Spec Version: 1.0*
