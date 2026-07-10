# SPEC-00-007: Observation-Driven Value Flow Tracking

**Status:** 📋 Planned  
**Phase:** 00 - Foundation  
**Priority:** P0 (The wiring that makes observation useful)  
**Date:** 2026-07-09  
**Depends On:** SPEC-00-001, SPEC-00-003

---

## 1. Problem Statement

Tools and observation memory already exist (`src/tools/observation-tools.ts`, `src/capture/human-observer.ts`, `src/graph/store.ts`). What is missing is **systematic value-flow tracking**: correlating where a value comes from (response field, UI input, auth header) to where it goes (next request parameter). Without this the brain guesses attacks instead of deriving them from what it observed. This is the upstream input the Business-Logic Analyser (Phase 1) needs.

We do NOT need chaos/random attacks. We need: observe target -> record flows -> flag suspicious flows (user-controlled value reaching a sensitive operation) -> derive hypotheses.

---

## 2. Acceptance Criteria

~~~
AC-00-007-1: httpRequest automatically records value flows (request param -> endpoint, response field -> next endpoint)
AC-00-007-2: ValueFlowTracker identifies IDOR patterns (user-controlled field flowing to /transfer, /user/{id}, etc.)
AC-00-007-3: ValueFlowTracker identifies auth-bypass patterns (auth token flowing to protected endpoint)
AC-00-007-4: Flows are persisted to the graph as VALUE_ORIGIN edges
AC-00-007-5: A query returns all flows for a given parameter in O(1)
~~~

---

## 3. Technical Design

### 3.1 New module `src/analysis/value-flow-tracker.ts`
~~~
export interface ValueFlow {
  id: string;
  source: string;        // '/api/user/123' or 'UI.click' or 'response.field'
  target: string;        // '/api/transfer'
  field: string;         // 'user_id', 'amount', 'token'
  type: 'auth' | 'data' | 'state' | 'ui';
  confidence: number;    // 0..1
  evidence: string[];
  createdAt: number;
}

export class ValueFlowTracker {
  private flows = new Map<string, ValueFlow>();
  private byField = new Map<string, ValueFlow[]>();
  recordFlow(f: Omit<ValueFlow,'id'|'createdAt'>): ValueFlow { /* dedupe by id */ }
  getFlowsForField(field: string): ValueFlow[] { return this.byField.get(field) ?? []; }
  getFlowsToEndpoint(ep: string): ValueFlow[] { return [...this.flows.values()].filter(f => f.target === ep); }
  findSuspiciousFlows(): SuspiciousFlow[] { /* IDOR + auth_bypass heuristics */ }
}
~~~

### 3.2 Auto-record in httpRequest (`src/tools/http-tools.ts`)
After a successful response, record:
- each query/body param -> target url (type 'data')
- each JSON scalar field in the response -> 'potential-next-endpoint' (type 'data', confidence 0.8)
- Authorization header presence -> flag auth flow

Use a module-level singleton `getGlobalValueFlowTracker()`.

### 3.3 Persist to graph (`src/graph/tools.ts` / store)
On recordFlow, also `graphStore.addEdge({ fromId, toId, type: EdgeType.VALUE_ORIGIN, properties: { field, confidence } })`. Reuse existing `VALUE_ORIGIN` edge type already declared in `src/graph/schema.ts:47`.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/analysis/value-flow-tracker.ts` | NEW module | ~150 |
| `src/tools/http-tools.ts` | Auto-record flows | ~20 |
| `src/graph/store.ts` | VALUE_ORIGIN edge writer (exists) | reuse |
| `src/analysis/index.ts` | singleton getter | ~10 |

---

## 5. Tests

- `test/analysis/value-flow-tracker.test.ts`: record + getFlowsForField + findSuspiciousFlows (IDOR case).
- `test/integration/flow-http.test.ts`: two sequential httpRequests produce a VALUE_ORIGIN edge.

---

*Spec Version: 1.0*
