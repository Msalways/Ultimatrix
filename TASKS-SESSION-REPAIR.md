# Ultimatrix v8 Session Repair — Task Breakdown

**Date:** 2026-06-29
**Problem:** v8 solver produces worse output than v7 — 50 tool calls of pure recon, no testing, no conversational depth. Infrastructure improvements degraded output quality.
**Root Cause:** Mastra memory dropped from solver, brain instructions are tool-name-heavy (fragile), no session stability enforcement.

---

## Dependency Graph

```
Batch 1 (Core Fixes)          Batch 2 (Stability)           Batch 3 (Polish)
─────────────────────         ───────────────────           ──────────────────
1.1 Restore Mastra Memory ──► 2.2 Truncate Enriched Goal   3.1 Session Summary
        │                             │
1.2 Brain Instructions ─────► 2.1 Enforce maxDurationMs    3.2 Stale Threshold
        │                             │
1.3 Reflexion Scoping ──────► 2.3 Fix harContextForLLM
        │                             │
1.4 Filename Sanitize ──────► 2.4 Ctrl+C Handler
                                      │
                               2.5 askUser Timeout
                                      │
                               2.6 Fix maxTokens Naming

All batches → Final: Tests + Build
```

**No cross-batch dependencies within Batch 1 or Batch 2.** All tasks within a batch can be done in any order. Batch 3 is independent.

---

## Batch 1: Core Fixes (Reply Quality + Testing Behavior)

### 1.1 Restore Mastra Memory to Solver
- **Files:** `src/solver/solver.ts`, `src/session.ts`
- **Change:** `SolveParams` accepts `memory?: { thread: string; resource: string }`. `solve()` passes it to `agent.stream()`. Session passes Mastra thread/resource IDs.
- **Why:** v7 supervisor used thread memory. Solver dropped it. LLM has zero conversation history — this is the #1 reason reply quality degraded.
- **Risk:** Memory stores all tool results. Could grow large. Mitigated by `lastMessages` config (already dynamically computed per model).

### 1.2 Rewrite Brain Instructions — Capabilities, Not Tool Names
- **Files:** `src/solver/brain-instructions.ts`
- **Change:** Remove all 20+ hardcoded tool names. Replace with phase-based workflow (UNDERSTAND → PLAN → TEST → REPORT). Re-include CORE_CONTRACT. All rules describe behavior, not tool calls.
- **Why:** Hardcoded tool names cause silent breakage on refactor, LLM over-fits to named tools, duplicates skill metadata. Phases enforce recon→attack transition.
- **Dependency:** None. Standalone rewrite.

### 1.3 Reflexion Target Scoping
- **Files:** `src/intelligence/reflexion-store.ts`, `src/solver/solver.ts`
- **Change:** `loadRelevantHints(vulnType, targetOrigin?)` — filter by hostname. Only load hints from sessions that targeted the same origin.
- **Why:** Currently loads ALL reflexion nodes from ALL past sessions. Cross-target contamination.
- **Dependency:** None. Isolated fix.

### 1.4 Test Filename Sanitization
- **Files:** `src/tools/control-tools.ts`
- **Change:** `buildFindingId()` returns `type:endpoint:param`. Add `sanitizeForFilesystem()` before using as filename. Replace colons with dashes, strip `<>:"/\|?*`.
- **Why:** Windows filenames cannot contain colons. Test generation crashes with ENOENT.
- **Dependency:** None. Isolated fix.

---

## Batch 2: Stability Fixes (Prevents Session Breakage)

### 2.1 Enforce maxDurationMs in Solver
- **Files:** `src/solver/solver.ts`
- **Change:** Wrap `agent.stream()` in `Promise.race` with a `setTimeout` based on `cfg.maxDurationMs`. On timeout, abort the stream and return `SolveResult` with `reason: 'budget_reached'`.
- **Why:** `maxDurationMs` is defined but never enforced. Single turn can run indefinitely.
- **Dependency:** None. Adds timeout around existing stream call.

### 2.2 Truncate Enriched Goal
- **Files:** `src/solver/solver.ts`
- **Change:** After building `enrichedGoal`, check total length against model-appropriate cap (4K for 8K, 8K for 32K, 16K for 128K+, 24K for 1M+). Truncate oldest sections first (reflexion hints → blackboard → graph state). Never truncate user's original goal.
- **Why:** Enriched goal has no length cap. Long sessions → context overflow → API errors or silent truncation.
- **Dependency:** None. Independent cap.

### 2.3 Fix harContextForLLM Declaration Order
- **Files:** `src/session.ts`
- **Change:** Move `let harContextForLLM: string | undefined` declaration BEFORE the HAR capture block. Currently declared at line 353 but assigned at line 331 — temporal dead zone.
- **Why:** HAR bridge result is silently lost every time due to TDZ. The catch swallows the error.
- **Dependency:** None. One-line move.

### 2.4 Add Ctrl+C Graceful Shutdown
- **Files:** `src/session.ts`
- **Change:** Register `process.on('SIGINT')` handler at session start. On SIGINT: print "Shutting down...", save graph, stop OAST, close browser, print session summary, exit. Use `process.exit()` after cleanup.
- **Why:** Ctrl+C during a long solver turn kills process instantly. Graph data, browser, OAST port leaked.
- **Dependency:** Should come after 3.1 (session summary) for clean output, but can be done independently.

### 2.5 Add Timeout on askUser
- **Files:** `src/tools/interaction-tools.ts`
- **Change:** Wrap readline promise in `Promise.race` with `setTimeout(300_000)` (5 min default, configurable). On timeout, return `{ answer: '__TIMEOUT__', message: 'Human input timed out after 5 minutes' }`.
- **Why:** If user walks away, session hangs forever. The solver can't continue.
- **Dependency:** None. Isolated fix.

### 2.6 Fix maxTokens Naming
- **Files:** `src/solver/solver.ts`, `src/config.ts`
- **Change:** Rename `maxTokens` to `maxSteps` in `SolverConfig` to match Mastra's `maxSteps` semantics. Or: actually enforce it as a token budget (harder). Rename is simpler and honest.
- **Why:** `maxTokens: 100000` sounds like a token budget but is never used. `maxToolCalls: 50` is passed as `maxSteps` (LLM rounds, not tool calls). Misleading naming.
- **Dependency:** None.

---

## Batch 3: Polish

### 3.1 Session Summary at Exit
- **Files:** `src/session.ts`
- **Change:** In the `finally` block, after saving, print a summary: duration, endpoints discovered, findings by severity, tool calls made, OAST callbacks received.
- **Why:** User exits with no feedback on what happened. Poor UX.
- **Dependency:** None.

### 3.2 Consistent Stale Threshold
- **Files:** `src/session.ts`, `src/cli/solve.ts`
- **Change:** Use the same default (`3`) in both files. `cli/solve.ts` currently uses `5`, session uses `3`.
- **Why:** Same feature behaves differently depending on entry point.
- **Dependency:** None.

---

## Final: Tests + Build

- `npx vitest run` — verify all 805+ tests pass
- `npx tsup` — verify clean build
- Update `AGENTS.md` test count if changed
- Update memory blocks

---

## Implementation Order

1. Create this MD file ✓
2. Batch 1.3 — Reflexion scoping (smallest, isolated)
3. Batch 1.4 — Filename sanitize (smallest, isolated)
4. Batch 2.3 — Fix harContextForLLM declaration (one-line fix)
5. Batch 2.6 — Fix maxTokens naming (rename)
6. Batch 2.2 — Truncate enriched goal
7. Batch 2.1 — Enforce maxDurationMs
8. Batch 2.5 — askUser timeout
9. Batch 1.1 — Restore Mastra memory
10. Batch 1.2 — Rewrite brain instructions (largest change)
11. Batch 2.4 — Ctrl+C handler
12. Batch 3.1 — Session summary
13. Batch 3.2 — Stale threshold consistency
14. Final — Tests + build
