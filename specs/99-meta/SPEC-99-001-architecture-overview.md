# SPEC-99-001: Architecture Overview & Dependency Graph

**Status:** ✅ Draft  
**Phase:** Meta  
**Author:** Architecture Analysis  
**Date:** 2026-07-09

---

## 1. System Context

Ultimatrix v8 is an **autonomous security analyst** that combines:

- **Dual Engine**: Legacy Supervisor (v6/v7 Observe-Learn-Attack) + OODA Solver (v8 REASON→EXPLORE→CONCLUDE)
- **Multi-Model Routing**: Tiered model selection (fast/balanced/powerful) via `ModelSelector` with per-provider rate limiting
- **Campaign Autonomy**: Primitive-based technique execution (invariantProbe, workflowBypass, concurrencyHarness, etc.) orchestrated by Campaign Planner/Executor
- **Intelligence Layers**: EvidenceGate (anti-hallucination), ReflexionEngine (failure classification), LoopDetector (stale/dead-end detection), Blackboard (fact/intent state-space)
- **Human-in-the-Loop**: Browser action capture, hypothesis ingestion, session replay
- **Skills Library**: 21 skills (7 core + 14 specialized) loaded from Markdown with YAML frontmatter, driving tool filtering and methodology

---

## 2. High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ULTIMATRIX v8 DATA FLOW                            │
└─────────────────────────────────────────────────────────────────────────────┘

  USER INPUT (CLI/Web)                    HUMAN OBSERVER (Browser)
       │                                           │
       ▼                                           ▼
┌──────────────────┐                    ┌──────────────────────┐
│  SessionLifecycle │                    │  HumanObserver.ts    │
│  (REPL / Solve)   │                    │  (clicks, nav, input) │
└────────┬─────────┘                    └──────────┬───────────┘
         │                                         │
         ▼                                         ▼
┌────────────────────────────────────────────────────────────────┐
│              ENGINE SELECTOR (config.engine)                   │
│   legacy │ solver │ multi-model                                │
└────────────────────────┬───────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │      SOLVER BRAIN (Agent)      │
        │  Tools + Skills + Intelligence │
        │  selectModel, spawnWorker,     │
        │  httpRequest, graph*, browser* │
        └───────────────┬────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
   ┌─────────┐    ┌───────────┐   ┌──────────┐
   │ WORKER  │    │ CAMPAIGN  │   │ INTEL    │
   │ POOL    │    │ EXECUTOR  │   │ LAYERS   │
   │         │    │           │   │          │
   │ Spawns  │    │ Runs      │   │ Evidence │
   │ tiered  │    │ slices    │   │ Gate     │
   │ models  │    │ parallel  │   │ Reflexion│
   └────┬────┘    └─────┬─────┘   │ LoopDet  │
        │               │         │ Blackboard│
        └───────────────┼─────────┴────┬─────┘
                        │              │
                        ▼              ▼
              ┌───────────────────────────────┐
              │     KNOWLEDGE GRAPH (JSON)    │
              │  11 Node Types, 12 Edge Types │
              │  + NEW: ValueOrigin,          │
              │  HeaderSemantic, AuthScheme,  │
              │  UseCase, Hypothesis          │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │      BUSINESS-LOGIC ANALYSER  │
              │  (UPSTREAM DIFFERENTIATOR)    │
              │  Value Provenance + Auth      │
              │  Decode + Use-Case +          │
              │  Invariant Extraction         │
              └───────────────┬───────────────┘
                              │
                              ▼
              ┌───────────────────────────────┐
              │       STRATEGIST LLM          │
              │  Emits CampaignPlans          │
              │  (not single tool calls)      │
              └───────────────────────────────┘
```

---

## 3. Core Modules & Responsibilities

| Module | Location | Responsibility | Key Interfaces |
|--------|----------|----------------|----------------|
| **SessionLifecycle** | `src/session/lifecycle.ts` | Resource orchestration, phase management, REPL loop | `SessionResources`, `SessionPhase` |
| **Solver Brain** | `src/solver/brain-tools.ts` | Tool wiring for brain agent (selectModel, spawnWorker, HTTP, Graph, Browser) | `createSolverBrain(config, deps)` |
| **Worker Pool** | `src/workers/pool.ts` | Spawns tiered workers per slice; multi-model fan-out | `WorkerPool.spawn(slice, role)` |
| **Model Selector** | `src/models/selector.ts` | Routes tasks to models by tier/complexity; learns success/failure | `ModelSelector.selectForTask()` |
| **Campaign Planner** | `src/campaign/planner.ts` | Builds coverage matrix from graph; emits CampaignPlan slices | `planCampaign(graphStore, options)` |
| **Campaign Executor** | `src/campaign/executor.ts` | Executes slices in parallel with budget/scope/rate-limit guards | `runCampaign(plan, options)` |
| **Primitive Runner** | `src/campaign/runner.ts` | Executes primitive.generate → executor → oracle per slice | `PrimitiveRunner` callback |
| **Technique Primitives** | `src/primitives/*.ts` | Self-contained tests: generate/execute/oracle (evidence-gated) | `TechniquePrimitive` interface |
| **Evidence Gate** | `src/intelligence/evidence-gate.ts` | Anti-hallucination: verifies claims against recorded tool output | `EvidenceGate.verifyClaim()` |
| **Reflexion Engine** | `src/intelligence/reflexion.ts` | Failure classification (L0-L4), escalation hints, experience extraction | `ReflexionEngine.recordAttempt()` |
| **Loop Detector** | `src/intelligence/anti-loop.ts` | Stale detection, dead-end detection, structured PATH extraction | `LoopDetector.recordRound()` |
| **Blackboard** | `src/solver/blackboard.ts` | Fact/Intent state-space for OODA solver | `Blackboard.addFact/Intent()` |
| **Business-Logic Analyser** | `src/analysis/*.ts` (NEW) | Correlates UI/API/DOM → ValueOrigin, AuthScheme, UseCase, Invariants | `Analyser.analyse()` |
| **Skill Registry** | `src/solver/skills/registry.ts` | Loads 21 skills from Markdown; provides toolRefs, triggers, tier hints | `SkillRegistry.loadFromDirectory()` |
| **Graph Store** | `src/graph/store.ts` | JSON-backed persistence for nodes/edges; query + summary | `GraphStore.queryNodes/Edges()` |
| **Browser Manager** | `src/browser/manager.ts` | Playwright/Stagehand lifecycle; active page; screenshot capture | `getOrCreateBrowser`, `getActivePage` |
| **OAST Server** | `src/oast/server.ts` | Blind callback detection (SSRF, XXE, etc.) | `startOastServer`, `stopOastServer` |

---

## 4. Multi-Model Routing Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    MODEL SELECTION FLOW                         │
└─────────────────────────────────────────────────────────────────┘

  TASK (WorkerTask: skillId, complexity, requiredCapabilities)
           │
           ▼
  ┌────────────────────────┐
  │   ModelSelector        │
  │  .selectForTask(task)  │
  └───────────┬────────────┘
              │
              ▼
  ┌────────────────────────┐     ┌─────────────────────┐
  │  Score Candidates      │────►│  ModelCapabilities  │
  │  - tier match          │     │  (contextWindow,    │
  │  - capability match    │     │   strengths, etc.)  │
  │  - quota health        │     └─────────────────────┘
  │  - success history     │              │
  │  - budget fit          │              ▼
  └───────────┬────────────┘     ┌─────────────────────┐
              │                  │  ProviderLimiters   │
              ▼                  │  (RPM, concurrency) │
  ┌────────────────────────┐     └─────────────────────┘
  │  ModelSelection        │
  │  { tier, provider,     │
  │    modelId, reasoning, │
  │    budget, estTokens } │
  └───────────┬────────────┘
              │
              ▼
  ┌────────────────────────┐
  │  resolveModel()        │
  │  → LanguageModelV2     │
  └───────────┬────────────┘
              │
              ▼
  ┌────────────────────────┐
  │  wrapModel()           │
  │  (rate-limit, retry,   │
  │   quota-track, log)    │
  └────────────────────────┘
```

**Tiers:**
- `fast` (≤8K ctx): Recon, fingerprinting, discovery — cheap/fast models
- `balanced` (≤32K ctx): General analysis, exploitation — default models
- `powerful` (>32K ctx): Complex reasoning, chain construction, report writing — strongest models

---

## 5. Campaign Autonomy Loop

```
┌─────────────────────────────────────────────────────────────────┐
│                    SOLVER → CAMPAIGN REWIRE (T2.6)              │
└─────────────────────────────────────────────────────────────────┘

  CURRENT (Tool-Call Loop):           TARGET (Campaign Loop):
  ─────────────────────────           ──────────────────────
  solve() {                          solve() {
    while (!done) {                    // 1. STRATEGIST emits campaign
      toolCall = brain.stream(goal)      campaign = strategist.plan(goal, graph)
      result = execute(toolCall)         
      observe(result)                    // 2. EXECUTOR runs slices in parallel
    }                                    result = executeCampaign(campaign)
  }                                        // 3. RESULTS → Blackboard + Graph
                                           // 4. STRATEGIST replans with new context
                                        }
```

**CampaignExecutor** already supports:
- Slice-level multi-model routing (via `modelSelector`)
- Per-slice budget (model calls, tokens)
- Scope guard (inScope/outOfScope)
- EvidenceGate integration (confirmed/unconfirmed only)
- Concurrency control (`maxConcurrency`)

---

## 6. Intelligence Layer Integration Points

| Layer | Input | Output | Consumers |
|-------|-------|--------|-----------|
| **EvidenceGate** | Tool output (recordToolOutput) | `verifyClaim(claim) → {verified, evidence}` | Primitives (oracle), `writeFinding` (maker/checker) |
| **ReflexionEngine** | `recordAttempt(tool, success, error, context)` | `getHints() → escalation hints`, `extractExperience() → lessons` | Solver (per-turn), WorkerPool (per-slice) |
| **LoopDetector** | `recordRound(progress)`, `recordTarget(endpoint)` | `isStale()`, `isDeadEnd()`, `extractAttackPath()` | Solver (stale check), CampaignExecutor (dead-end slices) |
| **Blackboard** | `addFact/Intent()`, `getFacts/Intents()` | Structured state-space for OODA | Solver (REASON phase), Strategist (planning) |
| **Business-Logic Analyser** | HAR, Graph, Browser events | `ValueOrigin` edges, `AuthScheme` nodes, `Endpoint.useCase`, `Hypothesis` nodes | Campaign Planner, Primitive context builder, Strategist |

---

## 7. Dependency Rules (Enforced by Spec Index)

1. **No Phase N+1 without Phase N foundation** — Campaign autonomy (P2) requires Analyser (P1) output
2. **Multi-model correctness (P0) before any autonomy** — Selector must persist, tiers must be validated
3. **Evidence Gate hardening (P0) before primitives trusted** — Findings must be receipt-backed
4. **Scope guard (P0) before autonomous execution** — Legal/safety non-negotiable
5. **Graph schema extensions (P1.1) before analyser writers** — Nodes/edges must exist

---

## 8. Current Implementation Status (Codebase Reality)

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| Dual Engine | ✅ Implemented | `src/session.ts`, `src/solver/solver.ts` | `engine: legacy|solver|multi-model` |
| Model Selector | ✅ Implemented | `src/models/selector.ts` | Scores by tier/capability/quota/history |
| Provider Limiters | ✅ Implemented | `src/models/limiter-factory.ts`, `provider-limiter.ts` | Per-provider RPM + concurrency |
| Quota Tracker | ✅ Implemented | `src/models/quota-tracker.ts` | Exhaustion detection + cooldown |
| Primitive Framework | ✅ Implemented | `src/primitives/framework.ts` | Generator/Executor/Oracle pattern |
| Flagship Primitives | ✅ Implemented | `src/primitives/*.ts` | 9 primitives registered |
| Campaign Planner | ✅ Implemented | `src/campaign/planner.ts` | Matrix: endpoint×param×role×state×technique |
| Campaign Executor | ✅ Implemented | `src/campaign/executor.ts` | Parallel slices, budget, scope |
| Evidence Gate | ✅ Implemented | `src/intelligence/evidence-gate.ts` | Cross-checks claims vs tool output |
| Reflexion Engine | ✅ Implemented | `src/intelligence/reflexion.ts` | L0-L4 escalation, experience extraction |
| Loop Detector | ✅ Implemented | `src/intelligence/anti-loop.ts` | Stale/dead-end, PATH extraction |
| Blackboard | ✅ Implemented | `src/solver/blackboard.ts` | Fact/Intent state-space |
| Skills Library | ✅ Implemented | `skills/` (21 skills) | Markdown + YAML frontmatter |
| Skill Loader | ✅ Implemented | `src/solver/skills/loader.ts` | Frontmatter parsing, toolRefs |
| Skill Tool Filter | ✅ Implemented | `src/solver/skills/tool-filter.ts` | **Advisory only** (T0.3: drop gate) |
| Graph Schema | ✅ Extended | `src/graph/schema.ts` | New nodes: HeaderSemantic, AuthScheme, Hypothesis, OutcomeFeedback |
| Business-Logic Analyser | ❌ NOT BUILT | `src/analysis/` (missing) | **Critical gap — Phase 1** |
| Attack-Path Solver | ❌ NOT BUILT | `src/solver/attack-path.ts` (missing) | Phase 3 |
| Verified Case File | ❌ NOT BUILT | `src/report/case-file.ts` (missing) | Phase 3 |
| Agent Fleet | ❌ NOT BUILT | `src/workers/pool.ts` (partial) | Phase 4 |
| Cross-Engagement Memory | ❌ NOT BUILT | — | Phase 4 |

---

## 9. Key Architectural Decisions (Recorded)

| Decision | Rationale | Spec Reference |
|----------|-----------|----------------|
| **Flat toolset on brain** (drop skill gate) | Skill filter is heuristic; misses tools; CORE_TOOLS already has observation primitives | SPEC-00-003, MULTIMODEL-INTERACT-PLAN.md |
| **ModelSelector persists in lifecycle** | Learning (success/failure history) must survive across REPL turns | SPEC-00-001 |
| **Campaigns = primary solver loop** | Single tool calls don't scale; matrix coverage needed for authz/race/logic flaws | SPEC-02-006 |
| **Analyser upstream of everything** | LLM hypothesizes, engine proves; analyser derives invariants from observation | SPEC-01-006, BUILD-ROADMAP.md |
| **EvidenceGate = proof layer** | No finding enters graph without receipt (request/response/state) | SPEC-00-004, SPEC-02-005 |
| **Human hypotheses as first-class nodes** | Collaborative colleague model; human + LLM both write to graph | SPEC-01-005 |

---

*This document is the single source of truth for architecture. Update when major changes occur.*
