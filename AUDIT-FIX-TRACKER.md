# Ultimatrix Audit Fix Tracker

> Source: `docs/Ultimatrix_Audit_Findings.md`
> Created: 2026-09-15
> Scope: 42 findings (7 Critical, 34 High, 1 Medium) across 11 phases

---

## Status Legend

| Symbol | Meaning |
|--------|---------|
| `- [ ]` | Not started |
| `- [x]` | Done |
| `- [~]` | In progress |
| `- [-]` | Skipped / deferred |

---

## Phase 1: Foundation — Capability Lifecycle + Worker Inheritance

**Findings:** 1, 7, 8, 27 | **Severity:** 2 Critical, 2 High | **Files:** 4

- [x] **F1** [CRITICAL] `resetTurn()` wipes active toolset every turn
  - File: `src/solver/solver.ts:384`, `src/extensions/tool-registry.ts:124-128`
  - Fix: Remove `capabilityRegistry?.resetTurn()` at turn start. Capabilities persist across turns.
  - Verified: TRUE (2026-09-15)

- [x] **F7** [CRITICAL] WorkerFactory `_extensionRegistry` unused
  - File: `src/workers/factory.ts:31-36`
  - Fix: Store as `this.extensionRegistry`, pass to `createAgent()` as `tools` parameter.
  - Verified: TRUE (2026-09-15)

- [x] **F8** [HIGH] Worker tool source of truth defaults to fresh registry
  - File: `src/mastra/index.ts:78`
  - Fix: `createAgent()` accepts parent's `DynamicToolRegistry` via `options.tools`.
  - Verified: TRUE (2026-09-15)

- [x] **F27** [HIGH] Multiple tool registries diverge
  - File: `src/mastra/index.ts:78`, `src/tools/registry.ts`
  - Fix: Consolidate to `buildToolPack()` as single source of truth.
  - Verified: TRUE (2026-09-15)

---

## Phase 2: Context Pressure + Adaptive Context

**Findings:** 3, 20, 21, 22 | **Severity:** 1 Critical, 3 High | **Files:** 4

- [x] **F3** [HIGH] Skill tools at priority 5 (dropped first under pressure)
  - File: `src/models/adaptive-context.ts:180-184`
  - Fix: Elevate to priority 2 (same tier as browser tools).
  - Verified: TRUE (2026-09-15)

- [x] **F20** [CRITICAL] `setTurnTools` doesn't exist — adaptive context dead
  - File: `src/solver/solver.ts:578-583`
  - Fix: Replace with `prepareStep` returning filtered tools on next step.
  - Verified: TRUE (2026-09-15)

- [x] **F21** [HIGH] Prompt compression heading mismatch `##` vs `###`
  - File: `src/models/adaptive-context.ts:204-207`
  - Fix: Match both `##` and `###` headings.
  - Verified: TRUE (2026-09-15)

- [x] **F22** [HIGH] Unknown model falls back to 128k context
  - File: `src/solver/solver.ts:395-396`, `src/solver/brain-tools.ts:262-265`
  - Fix: Replace `|| 128_000` with configurable default or throw on unknown.
  - Verified: TRUE (2026-09-15)

---

## Phase 3: Skill System

**Findings:** 4, 5, 9, 24 | **Severity:** 4 High | **Files:** 4

- [x] **F4** [HIGH] `parseSkillMeta` category loss — `category: domain`
  - File: `src/solver/skills/loader.ts:132`
  - Fix: `category: meta.category ?? domain`
  - Verified: TRUE (2026-09-15)

- [x] **F5** [HIGH] `searchSkillMetadata` whole-string `includes()` — no tokenization
  - File: `src/solver/skills/loader.ts:324-339`
  - Fix: Tokenize query into words, score per-word, sort by relevance.
  - Verified: TRUE (2026-09-15)

- [x] **F9** [HIGH] Skill-worker registry drift (18 toolRefs missing)
  - Fix: Existing `tool-wiring-drift.test.ts` already validates against `TOOL_IDS`. F7/F8 fixes ensure workers inherit parent brain tools.
  - Verified: TRUE (2026-09-15)

- [x] **F24** [HIGH] Lazy-skill contradiction — eager methodology selection
  - File: `src/solver/brain-tools.ts:64-100,267-269`
  - Fix: Remove eager `loadMethodologySkill()`. Let skill registry serve on-demand.
  - Verified: TRUE (2026-09-15)

---

## Phase 4: Intelligence Layer

**Findings:** 15, 16, 17, 18, 19 | **Severity:** 5 High | **Files:** 3

- [x] **F15** [HIGH] Anti-loop reads wrong channel (tool-result, not assistant text)
  - File: `src/solver/solver.ts:782-786`
  - Fix: Parse `[PATH:]` from assistant text deltas, not tool-result output.
  - Verified: TRUE (2026-09-15)

- [x] **F16** [HIGH] `PATH_TAG_RE` rejects hyphens
  - File: `src/intelligence/anti-loop.ts:25`
  - Fix: Change `[a-z_]+` to `[a-z_-]+`.
  - Verified: TRUE (2026-09-15)

- [x] **F17** [HIGH] Stale-round conflates tool calls with progress
  - File: `src/solver/solver.ts:806-807`
  - Fix: Only call `recordRound()` on meaningful progress (finding/endpoint change).
  - Verified: TRUE (2026-09-15)

- [x] **F18** [HIGH] Reflexion only records failures
  - File: `src/solver/solver.ts:809-822`
  - Fix: Add `recordAttempt(toolName, true, ...)` on successful tool steps.
  - Verified: TRUE (2026-09-15)

- [x] **F19** [HIGH] Reflexion state not consumed (save works, load missing)
  - File: `src/tools/context-tools.ts`, `src/intelligence/reflexion-store.ts`
  - Fix: Call `loadRelevantHints()` at turn start, inject into brain instructions.
  - Verified: TRUE (2026-09-15)

---

## Phase 5: Session Context + Turn Accounting

**Findings:** 6, 14 | **Severity:** 1 Critical, 1 High | **Files:** 2

- [x] **F6** [HIGH] `getSessionContext` returns empty stubs
  - File: `src/tools/context-tools.ts:49-50,38-39`
  - Fix: Return real target, real context window, blackboard facts, reflexion hints.
  - Verified: TRUE (2026-09-15)

- [x] **F14** [CRITICAL] Turn completion accounting — snapshot mutation
  - File: `src/solver/solver.ts:634-640,799-801,966-972`
  - Fix: Immutable `turnStartSnapshot` for `newFindings` delta.
  - Verified: TRUE (2026-09-15)

---

## Phase 6: Worker Quality

**Findings:** 10, 11, 12, 13 | **Severity:** 3 High, 1 Medium | **Files:** 4

- [x] **F10** [HIGH] Worker prompt contradiction — instructions reference unavailable tools
  - File: `src/mastra/index.ts:199-230`
  - Fix: Filter orchestration instructions when `role === 'worker'`.
  - Verified: TRUE (2026-09-15)

- [x] **F11** [MEDIUM] Worker task duplication (instructions + user prompt)
  - File: `src/workers/factory.ts:49-51`, `src/workers/pool.ts:179`
  - Fix: Send task in either instructions OR user prompt, not both.
  - Verified: TRUE (2026-09-15)

- [x] **F12** [HIGH] Worker context budgeting — `toolSchemas: '[]'`
  - File: `src/workers/pool.ts:117-127`
  - Fix: Pass actual tool schemas to `validateWorkerContext()`.
  - Verified: TRUE (2026-09-15)

- [x] **F13** [HIGH] Worker success contract — no acceptance criteria
  - File: `src/manager/tools/spawn-worker.ts:88-108`
  - Fix: Populate `acceptanceCriteria` from skill/task metadata.
  - Verified: TRUE (2026-09-15)

---

## Phase 7: Model + HITL Wiring

**Findings:** 23, 25, 26 | **Severity:** 3 High | **Files:** 3

- [x] **F23** [HIGH] Model routing feedback unwired
  - File: `src/models/selector.ts`
  - Fix: Call `recordSuccess()`/`recordFailure()` in solver loop.
  - Verified: TRUE (2026-09-15)

- [x] **F25** [HIGH] Human collaboration wiring dead
  - File: `src/tools/interaction-tools.ts`
  - Fix: Call `setConsoleInputResolver()` from lifecycle.
  - Verified: TRUE (2026-09-15)

- [x] **F26** [HIGH] Interaction mode semantics — pure passthrough
  - File: `src/solver/solver.ts:149,178,1172`
  - Fix: Make `interactionMode` control auto-approve behavior.
  - Verified: TRUE (2026-09-15)

---

## Phase 8: Streaming Core Architecture

**Findings:** 28, 29, 37, 39, 40, 41, 42 | **Severity:** 2 Critical, 5 High | **Files:** 7

- [x] **F28** [CRITICAL] Final-answer synthesis from reasoning
  - File: `src/solver/solver.ts:1092-1137`
  - Fix: Remove reasoning-to-answer synthesis. Synthesize from findings only.
  - Verified: TRUE (2026-09-15)

- [x] **F29** [CRITICAL] Web reasoning persistence — transient becomes durable
  - File: `src/app/api/chat-history/route.ts:19-28`
  - Fix: Filter `type: 'thinking'` from `sanitizeMessages()`.
  - Verified: TRUE (2026-09-15)

- [x] **F37** [HIGH] Dual completion protocol — two `done` events
  - File: `src/solver/solver.ts:1155-1169`, `src/app/api/solve/route.ts:104-113`
  - Fix: Single terminal event.
  - Verified: TRUE (2026-09-15)

- [x] **F39** [HIGH] Stream model destroys chronological interleaving
  - File: `src/output/render-model.ts:45-61,147-206`
  - Fix: Ordered `StreamSegment[]` array instead of flat channels.
  - Verified: TRUE (2026-09-15)

- [x] **F40** [HIGH] No stable tool call ID
  - File: `src/solver/solver.ts:97-104`
  - Fix: Add `toolCallId` counter to stream messages.
  - Verified: TRUE (2026-09-15)

- [x] **F41** [HIGH] Worker execution opaque to stream
  - File: `src/workers/pool.ts:163-180`, `src/workers/worker-context.ts`
  - Fix: Wire `WorkerContext.wrap()` into worker creation.
  - Verified: TRUE (2026-09-15)

- [x] **F42** [HIGH] No resumable event identity
  - File: `src/app/api/solve/route.ts:51-55`
  - Fix: Add `{runId, seq, timestamp}` envelope to SSE frames.
  - Verified: TRUE (2026-09-15)

---

## Phase 9: Streaming CLI

**Findings:** 30, 31, 32, 33, 34, 35 | **Severity:** 6 High | **Files:** 4

- [x] **F30** [HIGH] Web ignores `showReasoning` config
  - File: `src/components/chat-stream.tsx:182-199`
  - Fix: Read config, skip thinking card when disabled.
  - Verified: TRUE (2026-09-15)

- [x] **F31** [HIGH] CLI hides live reasoning
  - File: `src/output/chatbox.ts:139-154`
  - Fix: Add optional `streamReasoning` mode.
  - Verified: TRUE (2026-09-15)

- [x] **F32** [HIGH] `/reasoning` command broken — `assistantActive` guard
  - File: `src/output/chatbox.ts:307-310`
  - Fix: Remove guard or store last-turn reasoning state.
  - Verified: TRUE (2026-09-15)

- [x] **F33** [HIGH] Non-TTY ChatBox duplicates output
  - File: `src/session.ts:329-335`, `src/output/chatbox.ts:148`
  - Fix: Skip ChatBox live paint when `!tty`.
  - Verified: TRUE (2026-09-15)

- [x] **F34** [HIGH] Terminal row accounting not chunk-safe
  - File: `src/output/chatbox.ts:186-188`
  - Fix: Buffer and render complete answer on finalization.
  - Verified: TRUE (2026-09-15)

- [x] **F35** [HIGH] Partial Markdown rendered per delta
  - File: `src/output/chatbox.ts:180-189`
  - Fix: Buffer deltas, render complete segments.
  - Verified: TRUE (2026-09-15)

---

## Phase 10: Streaming Web

**Findings:** 36, 38 | **Severity:** 2 High | **Files:** 2

- [x] **F36** [HIGH] No stream coalescing / backpressure
  - File: `src/app/api/solve/route.ts:51-55`
  - Fix: 50ms batching + `controller.desiredSize` check.
  - Verified: TRUE (2026-09-15)

- [x] **F38** [HIGH] Web destroys stable message identity
  - File: `src/components/chat-stream.tsx:513-525`
  - Fix: Transition message state instead of remove+recreate.
  - Verified: TRUE (2026-09-15)

---

## Phase 11: Verification

- [x] `npm test` — all existing tests pass (2389/2389, +10 new)
- [x] `npm run build:cli` — clean build (ESM/CJS/DTS)
- [x] New tests: worker-context (7), render-model segments (3) — covering F39/F41/F42
- [ ] Manual CLI test: `npx ultimatrix interact -t https://httpbin.org`

---

## Summary

| Phase | Findings | Severity | Status |
|-------|----------|----------|--------|
| 1 | 4 | 2C, 2H | ✅ Done |
| 2 | 4 | 1C, 3H | ✅ Done |
| 3 | 4 | 4H | ✅ Done |
| 4 | 5 | 5H | ✅ Done |
| 5 | 2 | 1C, 1H | ✅ Done |
| 6 | 4 | 3H, 1M | ✅ Done |
| 7 | 3 | 3H | ✅ Done |
| 8 | 7 | 2C, 5H | ✅ Done |
| 9 | 6 | 6H | ✅ Done |
| 10 | 2 | 2H | ✅ Done |
| 11 | — | — | In progress |
| **Total** | **42** | **7C, 34H, 1M** | **42/42 done** |
