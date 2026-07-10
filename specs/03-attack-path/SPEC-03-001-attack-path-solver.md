# SPEC-03-001: Attack-Path Solver (Graph Traversal Unauth -> Sensitive)

**Status:** 📋 Planned  
**Phase:** 03 - Attack-Path + Case File  
**Priority:** P2  
**Date:** 2026-07-09  
**Depends On:** SPEC-01-004 (Invariants), SPEC-02-003 (Planner)

---

## 1. Problem Statement

The graph has `CHAINS_TO`, `REQUIRES_ROLE`, `PRODUCED`, `ALTERNATIVE` edges but **no planner** that computes multi-step attack paths from an unauthenticated entry to a sensitive asset. Today chains are only detected post-hoc (`detectChains` in lifecycle). The differentiator is to PLAN the path, then prove each step.

---

## 2. Acceptance Criteria

~~~
AC-03-001-1: Given the graph, produces ordered paths: unauth node -> auth flow -> role-gated endpoint -> sensitive endpoint
AC-03-001-2: Each path step carries the required technique + primitive id
AC-03-001-3: Paths are emitted as CampaignPlans (reuse executor)
AC-03-001-4: Paths are written as ATTACK/CHAINS_TO edges for visualization
~~~

---

## 3. Technical Design

New `src/solver/attack-path.ts`:
~~~
export function planAttackPaths(graph: GraphStore): AttackPath[] {
  // BFS/dijkstra over nodes using REQUIRES_ROLE / PRODUCED / CHAINS_TO
  // start set = anonymous-accessible endpoints
  // goal set = sensitive endpoints (authRequired or high-severity findings)
  // return ordered node lists with technique annotations
}
~~~

Integrate into solve() after the analyser: feed produced paths to planCampaign as pre-seeded slices.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/solver/attack-path.ts` | NEW | ~200 |
| `src/solver/solver.ts` | Feed paths into campaign | ~330 |

---

## 5. Tests

- `test/solver/attack-path.test.ts`: simple 3-node graph yields a 2-step path.

---

*Spec Version: 1.0*
