# SPEC-02-006: Rewire solve() to Campaign Loop (Strategist Emits Campaigns)

**Status:** 📋 Planned  
**Phase:** 02 - Campaign Autonomy  
**Priority:** P1  
**Date:** 2026-07-09  
**Depends On:** SPEC-02-004 (Executor), SPEC-00-003 (Flat Toolset), SPEC-01-004 (Invariants)

---

## 1. Problem Statement

`src/solver/solver.ts` runs a single `agent.stream()` loop where the LLM emits one tool call at a time. The Campaign Planner + Executor (already built) support parallel, budgeted, scoped slices - but `solve()` only conditionally calls `executeCampaign` as a fallback, not as the primary loop. Autonomy requires the strategist to emit campaigns, not single tool calls.

---

## 2. Acceptance Criteria

~~~
AC-02-006-1: solve() builds a CampaignPlan from goal + graph + invariants each round
AC-02-006-2: CampaignExecutor runs slices in parallel with budget/scope guards
AC-02-006-3: Results feed back into the Blackboard before the next plan
AC-02-006-4: solve() stops on completion/stale like today (no regression)
~~~

---

## 3. Technical Design

In `src/solver/solver.ts`, replace the unconditional tool-call loop body with:
~~~
const plan = planCampaign(graphStore, { maxSlices, roleFilter, techniqueFilter });
const result = await executeCampaign(plan, { graphStore, config, executor, modelSelector, primitives });
board.addFacts(result.findings.map(f => f.description));
// then checkCompletion(result)
~~~

Keep the streaming/token/forensic plumbing intact. The brain still reasons, but its "action" is to approve/refine the plan, not fire raw HTTP.

---

## 4. Files

| File | Change | Lines |
|------|--------|-------|
| `src/solver/solver.ts` | Rewire primary loop | ~330 |
| `src/campaign/executor.ts` | Already supports modelSelector + primitives | reuse |

---

## 5. Tests

- `test/integration/solver-campaign.test.ts`: solve() on a mock target produces CampaignResult with findings, not single tool calls.

---

*Spec Version: 1.0*
