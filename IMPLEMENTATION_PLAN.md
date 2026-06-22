# Ultimatrix Autonomous Security Engine — Implementation Plan

> **Status**: Living document — tasks checked off as completed with test results.

---

## Overview

Transform Ultimatrix from a chat-based tool into an **autonomous Observe→Learn→Attack engine** with:
- **Mastra Workflows** (suspend/resume for human checkpoints) instead of a custom loop
- **Background tasks** for parallel swarm execution
- **Dynamic skill→worker mapping** (Octogent-inspired: one agent per skill, pooled)
- **Full network tracing** (HAR + LLM-optimized trace JSON per attack)
- **Unified LibSQL storage** (graph + traces + workflow state + session)
- **Single shared Memory instance** across all agents — full context visibility
- **Human-in-the-loop** via workflow `suspend()` + existing chat UI

---

## Architecture Principles

| Octogent Concept | Ultimatrix Adaptation |
|---|---|
| Child terminals → parallel workers | Mastra Background Tasks (`streamUntilIdle`) |
| Tentacles → Skills | Skill registry with `toolRefs` → tool resolver |
| Parent coordinator → Swarm coordinator | Workflow `.parallel()` + background dispatch |
| Worktree mode → Isolated execution | **Shared Memory** — all agents share one `Memory` instance, no isolation |
| Channel messages → Inter-worker comms | Shared graph store + HAR correlation via `traceId` |
| `todo.md` → Hypothesis queue | Prioritized `Hypothesis[]` per cycle |

---

## Unified Memory Architecture

```typescript
// src/mastra/memory.ts — single shared memory instance
const sharedMemory = new Memory({
  workingMemory: { enabled: true },      // Current cycle context
  observational: { enabled: true },       // Agent self-reflections
  semanticRecall: { enabled: true },      // Cross-session knowledge
  storage: mastraStorage,                 // Same LibSQL store
})
```
- **Every agent** (supervisor, spider, all workers) receives this same `memory` instance
- Agents distinguish their own contributions via `threadId` in messages
- LLM can query any agent's observations, findings from any session
- No per-skill memory isolation — the LLM sees everything

---

## Dependency Graph (Visual)

```
P0.1 ──┬── P0.2 ── P0.7 ── P0.8 ── P2.1 ── P2.2 ── P2.3 ── P2.4
       │                                                       │
       ├── P0.3 ──┬── P0.4                                     │
       │          └── P1.1 ── P1.2 ── P1.3 ── P1.4             │
       │                                    │                  │
       ├── P0.5 ── P0.6                     ├── P1.5           │
       │                                    └── P1.6           │
       │                                                       │
       ├── S0.1 ── S0.2 ── S0.3 ── S0.4                       │
       │                                                       │
P3.1 ──┴── P3.2 ── P3.3 ── P3.4 ── P4.1 ── P4.2 ── P4.3 ── U1.1 ── U1.2
```

---

## Task Table Legend

| Column | Meaning |
|--------|---------|
| **ID** | Task identifier (`PX.Y`) |
| **Task** | What to build/fix |
| **Files** | Source files to create/modify |
| **Deps** | Must-complete task IDs before this |
| **Test** | How to verify (unit test name / assertion) |
| **Status** | `⬜ Pending` / `🔄 In Progress` / `✅ Done` / `❌ Failed` |

Every task MUST have a corresponding unit test. Mark `✅ Done` only after:
1. Code compiles (`npm run lint` = 0 errors)
2. Unit test passes
3. Any existing tests still pass (`npm run test`)

## Hard Rule: No Bandaids, No Hacks

**Every task must be a proper implementation from scratch.** Absolutely forbidden:

- **Bandaids** — patching over a bug without fixing the root cause. If the old `AgentManager` is broken, rewrite it; don't add a wrapper.
- **Hardcoded logic** — no magic strings, no inline config, no `if (provider === 'openai')` branches. Everything configurable via `ultimatrix.yaml` or the Mastra instance.
- **Bending to old conventions** — if existing code does something wrong (e.g., duplicate tool definitions, `any` types, JSON file storage), the fix is to **replace** it, not adapt the new code to fit the old pattern.
- **"It was there before"** — not a justification. If touching a file, clean it fully. No partial refactors.

**Test for this rule**: Before marking `✅ Done`, ask — *"Did I fix the root cause, or did I just make it work?"* If the latter, redo it properly.

---

## Phase P0: Mastra Foundation (Week 1)

**Goal**: Replace custom `AgentManager` with `Mastra` instance. Create unified storage + shared memory. Register workflow engine.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P0.1 | Create `Mastra` instance with LibSQL storage, shared Memory, and empty workflow/agent registries | `src/mastra/index.ts`, `src/mastra/memory.ts` | None | `unit: mastra-instance.test.ts` — `mastra.getStorage()` returns LibSQLStore, `mastra.memory` is Memory instance | ⬜ |
| P0.2 | Create unified LibSQL schema: `graph_nodes`, `graph_edges`, `traces`, `trace_actions`, `har_entries`, `sessions`, `workflow_state`, `agent_memory` | `src/mastra/schema.ts` | P0.1 | `unit: libsql-schema.test.ts` — all tables queryable via `mastra.getStorage()` | ⬜ |
| P0.3 | Migrate `GraphStore` from JSON filesystem to LibSQL — rewrite to use `mastra.getStorage()` | `src/graph/store.ts` | P0.2 | `unit: graph-store-libsql.test.ts` — CRUD nodes/edges, same API as JSON store | ⬜ |
| P0.4 | Add migration path: first load copies `output/graph.json` → LibSQL, renames old file to `.backup` | `src/graph/migrate.ts` | P0.3 | `unit: graph-migration.test.ts` — old JSON data appears in LibSQL after migration | ⬜ |
| P0.5 | Define Zod schemas for all workflow I/O: `AutonomousInput`, `ObservationResult`, `ThreatModel`, `Hypothesis`, `AttackPlan`, `AttackResult`, `FeedbackResult`, `HumanDecision` | `src/orchestrator/types.ts` | None | `unit: workflow-schemas.test.ts` — `z.infer<>` compiles, valid/invalid test cases | ⬜ |
| P0.6 | Register `autonomousWorkflow` skeleton in Mastra instance (steps added in P3) | `src/orchestrator/autonomous-workflow.ts` | P0.1, P0.5 | `unit: workflow-registration.test.ts` — `mastra.getWorkflow('autonomous-security-scan')` returns workflow | ⬜ |
| P0.7 | Refactor `AgentManager` to wrap Mastra instance — `mastra.getAgent('supervisor')`, `mastra.memory` | `src/lib/agent-manager.ts` | P0.1 | `unit: agent-manager-mastra.test.ts` — `AgentManager.getInstance().getSupervisor()` works, memory is shared | ⬜ |
| P0.8 | Kill all direct `new Agent(...)` calls outside `src/mastra/index.ts` — route through mastra agent map | `src/lib/agent-manager.ts`, `src/workers/factory.ts`, `src/spider/agent.ts` | P0.7 | `grep -r "new Agent(" src/ --include="*.ts"` returns only `src/mastra/index.ts` | ⬜ |
| P0.9 | Register all tools in centralized Mastra tool registry (`createTool()` with consistent IDs) | `src/mastra/tools.ts` | P0.1 | `unit: tool-registry.test.ts` — all tool IDs resolve, no duplicates | ⬜ |
| P0.10 | Remove `AgentManager` singleton — inline into `src/mastra/index.ts` exports | `src/lib/agent-manager.ts` | P0.8 | `unit: no-singleton.test.ts` — no `static instance` in codebase | ⬜ |

---

## Phase P1: Tracing & Observability (Week 1-2)

**Goal**: Every attack generates a searchable trace (HAR + LLM-optimized JSON) persisted via Mastra storage.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P1.1 | Create `HARCapture` — `page.route('**/*')` interceptor capturing request/response headers+body as HAR 1.2 | `src/tracing/har-capture.ts` | P0.1 | `unit: har-capture.test.ts` — capture produces valid HAR JSON with entries | ⬜ |
| P1.2 | Create `LLMTrace` builder — condensed trace: hypothesisId, technique, endpoint, request/response headers+body, wafDetected, verdict | `src/tracing/llm-trace.ts` | P1.1 | `unit: llm-trace.test.ts` — output matches LLMTrace schema | ⬜ |
| P1.3 | Create Mastra span processor — merges tool call spans + HAR → LLMTrace on span end | `src/tracing/span-processor.ts` | P1.2 | `unit: span-processor.test.ts` — span end triggers LLMTrace save | ⬜ |
| P1.4 | Extend `src/observability.ts` — register security span processor, `serviceName: 'ultimatrix'`, request context keys | `src/observability.ts` | P1.3 | `unit: observability-config.test.ts` — config includes security processor | ⬜ |
| P1.5 | Create `SessionStore` — CRUD sessions + trace index + HAR refs via Mastra storage | `src/tracing/session-store.ts` | P0.2 | `unit: session-store.test.ts` — create/load/list sessions, data persists | ⬜ |
| P1.6 | Propagate `traceId`/`hypothesisId`/`cycle` through all tool calls — wrap `createTool()` to inject tracing context | `src/tools/*.ts`, `src/mastra/tools.ts` | P1.1 | `unit: trace-context.test.ts` — every tool call has traceId in context | ⬜ |
| P1.7 | Create `ActionTraceRecorder` — `startTrace()`, `recordAction()`, `completeTrace()` with auto HAR + screenshot | `src/tracing/action-trace.ts` | P1.1, P1.5 | `unit: action-trace.test.ts` — worker execution produces full trace | ⬜ |
| P1.8 | Add auto-screenshot on `writeFinding` — screenshot linked to trace via screenshot ID | `src/tracing/screen-capture.ts`, `src/tools/write-finding.ts` | P1.7 | `unit: finding-screenshot.test.ts` — finding includes screenshot ref | ⬜ |
| P1.9 | Add `GET /api/trace/:sessionId` — returns trace list for session | `src/app/api/trace/[sessionId]/route.ts` | P1.5 | `int: trace-list-api.test.ts` — `fetch('/api/trace/ses_1')` returns trace array | ⬜ |
| P1.10 | Add `GET /api/trace/:sessionId/:traceId` — returns full trace with HAR/actions/screenshots | `src/app/api/trace/[sessionId]/[traceId]/route.ts` | P1.5 | `int: trace-detail-api.test.ts` — `fetch(...)` returns full LLMTrace JSON | ⬜ |

---

## Phase P2: Skill Delegation Engine (Week 2)

**Goal**: Dynamic worker creation from skills, Octogent-style swarm spawning with shared memory.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P2.1 | Create `SkillResolver` — maps `skillId` → `SkillCapability` (techniques, requiredTools, optionalTools, modelTier, contextRequirements) | `src/delegation/skill-resolver.ts` | P0.1 | `unit: skill-resolver.test.ts` — `resolveSkill('sql-injection')` returns capability with tools | ⬜ |
| P2.2 | Create `WorkerDelegator` — dynamic agent pool `Map<skillId, Agent>` with **shared Memory** from mastra instance | `src/delegation/worker-delegator.ts` | P2.1 | `unit: worker-delegator.test.ts` — spawns agent from skill, same memory ref on all agents | ⬜ |
| P2.3 | Create `SwarmCoordinator` — dispatches `DelegationRequest[]` as background tasks, concurrency limit | `src/delegation/swarm-coordinator.ts` | P2.2 | `unit: swarm-coordinator.test.ts` — 5 workers run with ≤3 concurrency | ⬜ |
| P2.4 | Wire delegator into supervisor `spawn_worker`/`spawn_swarm` tools — replace `WorkerPool.spawn()` | `src/supervisor/tools/spawn-worker.ts`, `src/supervisor/tools/spawn-swarm.ts` | P2.2 | `int: supervisor-spawn.test.ts` — supervisor tool creates traced, shared-memory worker | ⬜ |
| P2.5 | Create `ToolContext` builder — injects required/optional tools + trace context + auth/session data per skill | `src/delegation/tool-context.ts` | P2.1 | `unit: tool-context.test.ts` — context includes all tools from SKILL.md toolRefs | ⬜ |
| P2.6 | Delete old `WorkerFactory` — no remaining imports | `src/workers/factory.ts` | P2.4 | `grep -r "WorkerFactory" src/` returns nothing | ⬜ |
| P2.7 | Delete old `WorkerPool` — no remaining imports | `src/workers/pool.ts` | P2.6 | `grep -r "WorkerPool" src/` returns nothing | ⬜ |

---

## Phase P3: Autonomous Workflow Steps (Week 2-3)

**Goal**: Observe→Learn→Attack→Feedback workflow using Mastra Workflow with suspend/resume.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P3.1 | Create `observeStep` — incremental spider crawl + HAR capture + tech fingerprint + auth detection | `src/orchestrator/steps/observe.ts` | P0.5, P1.1 | `unit: observe-step.test.ts` — step outputs ObservationResult with endpoints/HAR | ⬜ |
| P3.2 | Create `learnStep` — LLM threat model builder from graph + HAR, generates prioritized Hypothesis[] | `src/orchestrator/steps/learn.ts` | P0.5, P3.1 | `unit: learn-step.test.ts` — generates ≥3 hypotheses per mock target | ⬜ |
| P3.3 | Create `attackStep` — picks top N hypotheses, dispatches via SwarmCoordinator, returns AttackResult[] | `src/orchestrator/steps/attack.ts` | P0.5, P2.3, P3.2 | `unit: attack-step.test.ts` — dispatches workers, results include traceId | ⬜ |
| P3.4 | Create `feedbackStep` — LLM chain detection, dedup findings, update threat model, adapt hypotheses | `src/orchestrator/steps/feedback.ts` | P0.5, P3.3 | `unit: feedback-step.test.ts` — chains detected, hypotheses re-prioritized | ⬜ |
| P3.5 | Create `humanCheckpointStep` — `suspend()` with findings summary, `resumeSchema: { continue, focusOn[], skip[] }` | `src/orchestrator/steps/human-checkpoint.ts` | P0.5, P3.4 | `unit: checkpoint-step.test.ts` — step suspends on first call, resumes on second | ⬜ |
| P3.6 | Compose workflow: `.then(observe).then(learn).then(attack).then(feedback).then(checkpoint).dountil(loopBack, shouldStop).commit()` | `src/orchestrator/autonomous-workflow.ts` | P3.1–P3.5 | `int: workflow-cycle.test.ts` — `createRun().start()` runs full cycle end-to-end | ⬜ |
| P3.7 | Create `loopBack` step — maps human decision → next cycle input, carries adapted hypotheses | `src/orchestrator/steps/loop-back.ts` | P3.5 | `unit: loopback-step.test.ts` — non-continue stops, continue feeds next cycle | ⬜ |
| P3.8 | Add cycle budget enforcement — `maxCycles`, `maxTotalTime`, `maxHypotheses` in input schema, `shouldStop` checks | `src/orchestrator/steps/loop-back.ts` | P3.7 | `unit: budget-enforcement.test.ts` — workflow stops after maxCycles | ⬜ |
| P3.9 | Add progress detection — 3 consecutive cycles with ≤1 finding → auto-stop "stuck" | `src/orchestrator/steps/feedback.ts` | P3.4 | `unit: progress-detection.test.ts` — workflow terminates early on no progress | ⬜ |

---

## Phase P4: Human-in-the-Loop (Week 3)

**Goal**: Workflow suspend/resume wired to Web UI for human approval at cycle boundaries.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P4.1 | Create `POST /api/workflow/resume` — calls `workflow.resume(runId, data)` | `src/app/api/workflow/resume/route.ts` | P3.6 | `int: workflow-resume-api.test.ts` — `POST` resumes suspended workflow | ⬜ |
| P4.2 | Create `GET /api/workflow/checkpoint` SSE — streams suspend events | `src/app/api/workflow/checkpoint/route.ts` | P3.6 | `int: checkpoint-sse.test.ts` — SSE event received when workflow suspends | ⬜ |
| P4.3 | Create `ApprovalModal` — shadcn Dialog: cycle summary, findings, Continue/Stop/Focus actions | `src/components/approval-modal.tsx` | P4.1, P4.2 | `int: approval-modal.test.ts` — modal renders on suspend, button triggers resume API | ⬜ |
| P4.4 | Extend Activity panel — show cycle number, step name, duration, findings count | `src/components/activity-panel.tsx` | P4.2 | `int: activity-cycle.test.ts` — activity shows "Cycle 3: attack complete (5 findings)" | ⬜ |
| P4.5 | Wire auto-resume on user chat — `autoResumeSuspendedTools: true` in Mastra config | `src/lib/agent-manager.ts` | P3.6 | `int: chat-resume.test.ts` — user message during suspend resumes workflow | ⬜ |
| P4.6 | Add "Start Autonomous Scan" button — triggers `mastra.getWorkflow().createRun().start({ targetUrl })` | `src/components/chat.tsx` | P4.1 | `int: start-scan.test.ts` — button starts workflow, cycle state visible | ⬜ |

---

## Phase P5: Complete Missing Skills (Week 3-4)

**Goal**: Fill all empty skill directories so the autonomous engine has a complete attack library.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P5.1 | Write `file-upload/SKILL.md` — unrestricted upload, content-type bypass, path traversal, zip-slip. Uses `multipartUpload` | `src/skills/exploit/file-upload/SKILL.md` | None | `unit: skill-file-upload.test.ts` — skill loads, tools resolve | ⬜ |
| P5.2 | Write `graphql/SKILL.md` — introspection, batching, depth DoS, injection. Uses `graphqlIntrospect` | `src/skills/exploit/graphql/SKILL.md` | None | `unit: skill-graphql.test.ts` — skill loads, tools resolve | ⬜ |
| P5.3 | Write `oauth/SKILL.md` — CSRF on auth flow, redirect_uri bypass, token leakage, scope escalation | `src/skills/exploit/oauth/SKILL.md` | None | `unit: skill-oauth.test.ts` — skill loads, tools resolve | ⬜ |
| P5.4 | Create WebSocket tools — `wsConnect`, `wsSend`, `wsReceive`, `wsClose` | `src/tools/websocket-tools.ts` | None | `unit: websocket-tools.test.ts` — connect/send/receive/close cycle works | ⬜ |
| P5.5 | Write `websocket/SKILL.md` — WS message injection, auth bypass, replay, DoS | `src/skills/exploit/websocket/SKILL.md` | P5.4 | `unit: skill-websocket.test.ts` — skill loads, tools resolve | ⬜ |
| P5.6 | Write `ssrf/SKILL.md` — open redirect, blind SSRF via OAST, protocol smuggling, cloud metadata | `src/skills/advanced/ssrf/SKILL.md` | None | `unit: skill-ssrf.test.ts` — skill loads, tools resolve | ⬜ |
| P5.7 | Write `api-security/SKILL.md` — BOLA, BFLA, mass assignment, rate limit bypass, GraphQL depth | `src/skills/advanced/api-security/SKILL.md` | None | `unit: skill-api-security.test.ts` — skill loads, tools resolve | ⬜ |
| P5.8 | Write `xxe/SKILL.md` — in-band XXE, blind OOB XXE, XInclude, SVG XXE | `src/skills/advanced/xxe/SKILL.md` | None | `unit: skill-xxe.test.ts` — skill loads, tools resolve | ⬜ |
| P5.9 | Write `deserialization/SKILL.md` — PHP gadget chains, Java deser, JS proto pollution, ViewState | `src/skills/advanced/deserialization/SKILL.md` | None | `unit: skill-deserialization.test.ts` — skill loads, tools resolve | ⬜ |
| P5.10 | Write `template-injection/SKILL.md` — SSTI Jinja2/Pug/Handlebars, freemarker, EL | `src/skills/advanced/template-injection/SKILL.md` | None | `unit: skill-template-injection.test.ts` — skill loads | ⬜ |
| P5.11 | Write `csp-bypass/SKILL.md` — CDN bypass, nonce bypass, dangling markup, policy misconfig | `src/skills/advanced/csp-bypass/SKILL.md` | None | `unit: skill-csp-bypass.test.ts` — skill loads | ⬜ |

---

## Phase P6: Security-Specific Engine Fixes (Week 4)

**Goal**: Address security-specific flaws — auth persistence, WAF cache, payload mutator, blind detection, evidence packaging, rate limiter.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P6.1 | Add auth session persistence — encrypted cookies/session tokens in LibSQL, associated with sessionId | `src/tracing/session-store.ts`, `src/intelligence/auth.ts` | P0.2 | `unit: auth-persistence.test.ts` — restart loads same auth state | ⬜ |
| P6.2 | Create WAF fingerprint cache — `Map<string, WafProfile>` shared across workers, populated by `checkWaf` | `src/intelligence/waf-cache.ts` | None | `unit: waf-cache.test.ts` — second worker on same endpoint gets cached profile | ⬜ |
| P6.3 | Create `PayloadMutator` — fuzzing grammar with encoder chains (URL/base64/hex/unicode), mutation templates per technique | `src/intelligence/payload-mutator.ts` | None | `unit: payload-mutator.test.ts` — generates 10+ variants per base payload | ⬜ |
| P6.4 | Integrate `PayloadMutator` into attack step — each hypothesis gets mutated payloads before dispatch | `src/orchestrator/steps/attack.ts` | P3.3, P6.3 | `unit: mutated-attack.test.ts` — attack sends variant payloads | ⬜ |
| P6.5 | Add blind detection automation — auto-poll OAST per cycle, correlate callbacks to hypothesisId | `src/intelligence/blind-detector.ts` | None | `unit: blind-detector.test.ts` — OAST callback auto-correlated to trace | ⬜ |
| P6.6 | Create `EvidencePackager` — finding includes curl command, HAR entry ref, screenshot URL, Playwright repro script | `src/intelligence/evidence-packager.ts` | P1.7 | `unit: evidence-packager.test.ts` — finding JSON has all PoC fields | ⬜ |
| P6.7 | Hook `EvidencePackager` into `writeFinding` tool — auto-generates PoC on finding creation | `src/tools/write-finding.ts` | P6.6 | `unit: write-finding-evidence.test.ts` — created finding includes evidence | ⬜ |
| P6.8 | Add rate limiter to `httpRequest` tool — token bucket per endpoint, backoff on 429 | `src/tools/http-tools.ts` | None | `unit: rate-limiter.test.ts` — 10 requests to same endpoint → backoff | ⬜ |
| P6.9 | Add rate limit config — `rateLimit: { requestsPerSecond, burstSize, backoffMs }` | `src/config.ts` | P6.8 | `unit: rate-limit-config.test.ts` — config validated on load | ⬜ |

---

## Phase P7: UI Integration (Week 4-5)

**Goal**: Web UI shows cycle progress, trace viewer, approval queue, session management.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P7.1 | Create `AutonomousPanel` — start/stop scan, cycle counter, current step, findings/cycle chart | `src/components/autonomous-panel.tsx` | P4.6 | `int: autonomous-panel.test.ts` — panel shows live cycle state | ⬜ |
| P7.2 | Create `TraceViewer` — tabbed: HTTP trace (HAR table), Action trace (timeline), Screenshots (gallery) | `src/components/trace-viewer.tsx` | P1.10 | `int: trace-viewer.test.ts` — each tab renders correct data | ⬜ |
| P7.3 | Add Trace tab to sidebar — links to `/trace/:sessionId` | `src/app/page.tsx` | P7.2 | `int: trace-tab.test.ts` — new tab navigable, content renders | ⬜ |
| P7.4 | Create `ApprovalQueue` — queues pending checkpoints from multiple cycles | `src/components/approval-queue.tsx` | P4.3 | `int: approval-queue.test.ts` — multiple checkpoints stack correctly | ⬜ |
| P7.5 | Add session export — JSON download, "Download HAR", "Download Trace" per hypothesis | `src/components/trace-viewer.tsx` | P7.2 | `int: trace-export.test.ts` — export produces downloadable file | ⬜ |
| P7.6 | Create `ScanHistory` — list past sessions with summary (findings, cycles, status) | `src/components/scan-history.tsx` | P1.5 | `int: scan-history.test.ts` — history shows last 10 sessions | ⬜ |
| P7.7 | Add `GET /api/sessions` — returns session list with summaries | `src/app/api/sessions/route.ts` | P1.5 | `int: sessions-api.test.ts` — `fetch('/api/sessions')` returns array | ⬜ |

---

## Phase P8: Config & CLI (Week 5)

**Goal**: `ultimatrix auto` CLI command, config validation, model fallback, proxy support, scan resume.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P8.1 | Create `ultimatrix auto` CLI — `-t <url>`, `--cycles N`, `--budget N`, `--headless` | `src/cli/auto.ts` | P3.6 | `unit: cli-auto.test.ts` — parses args, starts workflow | ⬜ |
| P8.2 | Add config validation — Zod schema for `ultimatrix.yaml`, descriptive error messages | `src/config.ts` | None | `unit: config-validation.test.ts` — invalid config shows line-numbered error | ⬜ |
| P8.3 | Add model fallback chain — primary → secondary → tertiary on provider failure | `src/models/registry.ts` | None | `unit: model-fallback.test.ts` — primary failure auto-fallsback | ⬜ |
| P8.4 | Add proxy/Tor support — `--proxy <url>` in config, passed to Stagehand + httpRequest | `src/config.ts`, `src/browser/manager.ts` | None | `unit: proxy-config.test.ts` — browser + HTTP route through proxy | ⬜ |
| P8.5 | Add scan resume — `ultimatrix auto --resume <sessionId>` loads last state, continues | `src/cli/auto.ts` | P1.5, P3.6 | `int: scan-resume.test.ts` — resume replays from last checkpoint | ⬜ |

---

## Cross-Cutting Technical Debt

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| T1 | Deduplicate `httpRequest` — single in `src/mastra/tools.ts`, remove from workers | `src/tools/http-tools.ts`, `src/workers/*.ts` | P0.9 | `unit: no-duplicate-tools.test.ts` — each tool defined once | ⬜ |
| T2 | Add per-skill tool timeout — `timeout: number` in `SkillCapability`, passed to tool calls | `src/delegation/skill-resolver.ts`, `src/tools/*.ts` | P2.1 | `unit: skill-timeout.test.ts` — tool respects per-skill timeout | ⬜ |
| T3 | Add worker cleanup — `AbortController` on termination, remove from activeWorkers | `src/delegation/worker-delegator.ts` | P2.2 | `unit: worker-cleanup.test.ts` — terminated worker removed from pool | ⬜ |
| T4 | Fix `any` in supervisor tools — strict Zod schemas for `skill-search`, `execute-direct`, `spawn-worker` | `src/supervisor/tools/*.ts` | P0.9 | `unit: supervisor-tool-types.test.ts` — all inputs strictly typed | ⬜ |
| T5 | Add integration test scaffold — Playwright test server + test target + workflow run | `tests/integration/` | P3.6 | `npm run test:int` runs 1 integration test | ⬜ |
| T6 | Add HAR retention — `maxHarEntries: 100` in config, cleanup on session save | `src/tracing/session-store.ts` | P1.5 | `unit: har-retention.test.ts` — old entries pruned at save | ⬜ |
| T7 | Add graceful browser crash — workflow catches error, logs "restarting browser", re-inits | `src/orchestrator/autonomous-workflow.ts` | P3.6 | `unit: crash-recovery.test.ts` — browser crash triggers re-init | ⬜ |

---

## Complete Dependency Map

```
P0 Phase:
  P0.1 ─┬─→ P0.2 ─→ P0.3 ─→ P0.4
         ├─→ P0.7 ─→ P0.8 ─→ P0.10
         ├─→ P0.9 ─→ T1, T4
         └─→ P0.6 (← P0.5)

P1 Phase:
  P0.2 ─→ P1.5 ─→ P1.9 ─→ P1.10 ─→ P7.2
                 └→ P7.6 ─→ P7.7
  P0.1 ─→ P1.1 ─┬─→ P1.2 ─→ P1.3 ─→ P1.4
                 ├─→ P1.6
                 └─→ P1.7 ─→ P1.8 ─→ P6.6
  P1.5 ─→ T6

P2 Phase:
  P0.1 ─→ P2.1 ─┬─→ P2.2 ─→ P2.3 ─→ P2.4 ─→ P2.6 ─→ P2.7
                 ├─→ P2.5 ─→ P2.2
                 └─→ T2
  P2.2 ─→ T3

P3 Phase:
  P3.1 ─→ P3.2 ─→ P3.3 ─→ P3.4 ─┬─→ P3.5 ─→ P3.7 ─→ P3.8
                                  ├─→ P3.9
                                  └─→ P3.6 (← P3.1-3.5)
  P3.6 ─→ P4.1, P4.2, P4.5, P8.1, T5, T7

P4 Phase:
  P3.6 ─→ P4.1 ─→ P4.3 ─→ P7.4
         ─→ P4.2 ─→ P4.3, P4.4
         ─→ P4.5
  P4.1 ─→ P4.6 ─→ P7.1

P5 Phase (parallelizable):
  P5.4 ─→ P5.5
  P5.1-5.3, P5.6-5.11 (no deps)

P6 Phase:
  P0.2 ─→ P6.1
  P3.3 + P6.3 ─→ P6.4
  P1.7 ─→ P6.6 ─→ P6.7
  P6.8 ─→ P6.9

P7 Phase:
  P4.6 ─→ P7.1
  P1.10 ─→ P7.2 ─→ P7.3, P7.5
  P4.3 ─→ P7.4
  P1.5 ─→ P7.6 → P7.7

P8 Phase:
  P3.6 ─→ P8.1 ─→ P8.5
```

---

## Execution Order (Recommended Batches)

| Batch | Tasks | Why Together |
|-------|-------|-------------|
| **Week 1** | P0.1, P0.2, P0.3, P0.5, P0.7, P0.9, P5.1-P5.3, P5.6-P5.8 | Foundation + parallel skill writing |
| **Week 1-2** | P0.4, P0.6, P0.8, P0.10, P1.1, P1.2, P1.5, P1.6, P2.1, P2.5, T1, T4 | Tracing start + skill resolver |
| **Week 2** | P1.3, P1.4, P1.7, P2.2, P2.3, P3.1, P3.2, P5.4, P5.5, P5.9-P5.11, P6.2, P6.3, P6.5, P6.8, P8.2, P8.3 | Core loop steps + more skills + engine fixes |
| **Week 2-3** | P1.8, P1.9, P1.10, P2.4, P2.6, P2.7, P3.3, P3.4, P3.5, P3.6, P3.7, P3.8, P3.9, P6.4, P6.9, T2, T3 | Workflow composition + attack/feedback |
| **Week 3** | P4.1, P4.2, P4.3, P4.4, P4.5, P4.6, P6.1, P6.6, P6.7, P8.4, T5 | Human-in-the-loop + auth + evidence |
| **Week 3-4** | P7.1, P7.2, P7.3, P7.4, P7.5, P7.6, P7.7, T6, T7 | UI integration |
| **Week 4-5** | P8.1, P8.5 | CLI auto command + resume |

---

## Verification Gates

| Gate | What Passes | Tasks Required |
|------|-------------|---------------|
| **G1: Foundation** | `npm run lint` 0 errors, `npm run test` all pass, `ultimatrix web` starts | P0.1-P0.10 |
| **G2: Tracing** | HAR capture produces valid JSON, traces persist to LibSQL, API returns traces | P1.1-P1.10 |
| **G3: Delegation** | `spawn_worker` creates agent from skill, `spawn_swarm` runs 5 parallel workers | P2.1-P2.7 |
| **G4: Workflow** | `autonomousWorkflow.createRun().start()` runs full O→L→A→F→C cycle | P3.1-P3.9 |
| **G5: Human** | Workflow suspends at checkpoint, resume via API, UI shows approval modal | P4.1-P4.6 |
| **G6: Skills** | 11 skills loadable, `SkillResolver` maps all techniques to skills | P5.1-P5.11 |
| **G7: Engine** | Auth persists, WAF caches, PayloadMutator works, OAST auto-polls, evidence packaged, rate limiter active | P6.1-P6.9 |
| **G8: UI** | Autonomous panel, trace viewer, approval queue, scan history all render | P7.1-P7.7 |
| **G9: CLI** | `ultimatrix auto -t http://test.com` runs, `--resume` continues | P8.1-P8.5 |
| **G10: Debt** | No `any` types in supervisor tools, no duplicate tool defs, worker cleanup verified | T1-T7 |
