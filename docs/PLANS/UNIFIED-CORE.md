# Ultimatrix — Unified Execution Core

> Created 2026-07-11 (T4.3). Documents the Wave Core architecture that all subsequent waves build on.

## Problem

Pre-Wave-Core, the codebase had three separate engine paths in `session.ts`:
1. **Legacy supervisor** — `resources.supervisor!.stream()` with legacy worker agents
2. **Solver** — `solve(resources.solverBrain!, {...})` with intelligence layers
3. **Council** — `runCouncil({members, bus, blackboard, ...})` with multi-agent deliberation

Each path duplicated initialization logic, created its own blackboard/evidence instances, and had different wiring for tools, memory, and skills.

## Solution: Unified Core (`src/core/`)

A single `CoreServices` object + `ExecutionStrategy` interface + `buildToolPack()` builder means both engines share the same foundation.

### Architecture

```
                    ┌──────────────────────┐
                    │   Engine Selector    │ ← config.engine: 'legacy' | 'multi-model' | 'council'
                    │   (runner.ts)        │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │  Legacy      │  │  Multi-Model │  │  Council         │
    │  Supervisor  │  │  (solver)    │  │  (deliberation)  │
    │  @deprecated │  │              │  │                  │
    └──────────────┘  └──────────────┘  └──────────────────┘
              │                │                 │
              └────────────────┼────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │  Shared CoreServices │
                    │  (lifecycle.ts)      │
                    │                      │
                    │  • EvidenceLedger    │
                    │  • Blackboard        │
                    │  • LoopDetector      │
                    │  • ReflexionEngine   │
                    └──────────────────────┘
```

### Key Modules

| Module | Location | Purpose |
|--------|----------|---------|
| **CoreServices** | `src/core/types.ts` | Shared intelligence state (evidence, blackboard, loop, reflexion) |
| **ExecutionStrategy** | `src/core/types.ts` | Interface that single/council strategies implement |
| **runSession()** | `src/core/runner.ts` | Resolves engine preset, builds/uses CoreServices, delegates to strategy |
| **buildToolPack()** | `src/core/toolpack.ts` | Composes all tool groups for brain/strategy consumption |
| **decideApproval()** | `src/core/approval.ts` | Re-exports from council/approval — impact-based HITL gating |
| **Blackboard** | `src/core/blackboard.ts` | Merged solver+council state-space (facts, intents, plan, dedup) |
| **EvidenceLedger** | `src/core/evidence.ts` | Singleton ledger shared by all tools and strategies |
| **SingleAgentStrategy** | `src/core/strategies/single.ts` | Wraps `solve()` behind `ExecutionStrategy` interface |
| **CouncilStrategy** | `src/core/strategies/council.ts` | Wraps `runCouncil()` behind `ExecutionStrategy` interface |

### Flow

1. **`lifecycle.init()`** — Config, browser, OAST, human observer, HAR capture
2. **`lifecycle.runSpider()`** — Spider crawl + HAR bridge
3. **`lifecycle.setupEngine()`** — Builds `CoreServices` ONCE (blackboard, evidence, loop, reflexion). Legacy gets separate workers/supervisor. Solver/Council get SkillRegistry + WorkerPool + brain.
4. **`session.ts` REPL loop** — For each user input:
   - Council path: `runCouncil()` with factory-created LLM members
   - Solver path: `runSession()` → `SingleAgentStrategy.run()` → `solve()`
   - Legacy path (deprecated): `supervisor.stream()`
5. **Cleanup** — LIFO stack of cleanup functions

### Engine Routing in session.ts

```typescript
if (useCouncil && target && resources.council) {
  // Council: factory creates LLM-backed members, runCouncil drives deliberation
  const { runCouncil } = await import('./council/orchestrator')
  await runCouncil({ members, bus, blackboard, goal, config })
} else if (useSolver && target && resources.coreServices) {
  // Solver: unified runner resolves strategy, uses pre-built CoreServices
  const toolPack = buildToolPack({ config, skillRegistry, workerPool, browser })
  await runSession({ config, goal, toolPack, services: resources.coreServices })
} else {
  // Legacy (deprecated): supervisor streams conversation
  await resources.supervisor!.stream(line, { memory, maxSteps })
}
```

### What Changed (Wave Core Tasks)

| Task | What |
|------|------|
| T0.1 | Core types + barrel exports |
| T0.2 | Shared `EvidenceLedger` singleton |
| T0.3 | Merged `Blackboard` (solver + council features) |
| T0.4 | `buildToolPack()` builder |
| T0.5 | Shared approval policy re-export |
| T1.1 | Council factory gets orchestration tools via `extraTools` |
| T1.2 | `CouncilStrategy` implements `ExecutionStrategy` |
| T2.1 | `SingleAgentStrategy` implements `ExecutionStrategy` |
| T2.2 | `solve()` wrapper unchanged (backward compat) |
| T3.1 | `runSession()` runner + `resolveEnginePreset()` |
| T3.2 | Session routes solver through runner |
| T3.3 | Lifecycle builds CoreServices once |
| T4.1 | Config validation accepts `council`/`solver`/`multi-model` |
| T4.2 | Legacy deprecated with warnings |

### Config

```yaml
engine: multi-model  # 'multi-model' | 'council' | 'solver' (deprecated alias)

council:
  maxRounds: 10
  budgetPerRound: 20
  approvalMode: autonomous  # 'autonomous' | 'hitl' | 'both'

solver:
  maxToolCalls: 50
  maxDurationMs: 300000

antiLoop:
  staleThreshold: 3
```
