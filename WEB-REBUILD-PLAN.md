# Ultimatrix Web Rebuild — Chat-First Architecture

> **Goal:** Unify CLI (v8) and web into a single system with perfect UX. Chat-first interface where everything renders inline. Graph is persistent memory per target, visible as a primary panel alongside chat.

---

## Mental Model

```
Target (example.com)
  ├── Graph = persistent memory (endpoints, findings, auth flows, facts, attack paths)
  ├── Sessions = conversation threads (ephemeral chat against the same memory)
  │   ├── Thread 1: "test for SQLi" → agent reads graph, acts, updates graph
  │   ├── Thread 2: "now test auth" → agent reads SAME graph, continues
  └── Config = target-specific settings
```

**Persistent:** Graph nodes + edges (per-target, survives across sessions)
**Ephemeral:** Chat messages, tool call history, worker activity (per-thread, browser-only)

## Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ [☰] Ultimatrix   https://example.com   llama3-8b            [⚙] [?] │
├───────┬──────────────────────────────┬─────────────────────────────────┤
│       │                              │                                 │
│  S    │      CHAT STREAM             │       GRAPH PANEL               │
│  E    │      (primary interface)     │       (persistent memory)       │
│  S    │                              │                                 │
│  S    │  👤 Test for SQL injection   │  ┌─ D3 Graph ────────────────┐ │
│  I    │                              │  │  [interactive viz]         │ │
│  O    │  🤖 I'll analyze...          │  │                           │ │
│  N    │                              │  └───────────────────────────┘ │
│  S    │  ▶ Tool: GET /api/users      │  ┌─ Memory ──────────────────┐ │
│       │  ▶ Tool: GET /api/users?id=  │  │ Findings: 3               │ │
│  (    │                              │  │ Endpoints: 12             │ │
│  t    │  🚨 SQL Injection found      │  │ Auth Flows: 2             │ │
│  o    │  ┌────────────────────────┐  │  │ Last: 2m ago              │ │
│  g    │  │ CRITICAL | /api/users  │  │  └───────────────────────────┘ │
│  g    │  └────────────────────────┘  │                                 │
│  l    │                              │                                 │
│  e    │  ✅ Done in 45s              │                                 │
│  s    │                              │                                 │
├───────┴──────────────────────────────┴─────────────────────────────────┤
│ 💬 Type a message...                                           [Send] │
├────────────────────────────────────────────────────────────────────────┤
│ Phase: attack │ Tokens: 12k/100k │ Duration: 0:45 │ Findings: 3      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 0: Delete Dead Code

| # | Task | File | Status |
|---|------|------|--------|
| 0.1 | Delete entire `src/ui/` directory (15 files) | `src/ui/*` | ⬜ |
| 0.2 | Delete dead `src/components/ui/badge-ink.tsx` | `src/components/ui/badge-ink.tsx` | ⬜ |
| 0.3 | Delete dead `src/components/ui/card-ink.tsx` | `src/components/ui/card-ink.tsx` | ⬜ |
| 0.4 | Delete dead `src/components/ui/streaming-text.tsx` | `src/components/ui/streaming-text.tsx` | ⬜ |
| 0.5 | Delete dead `src/components/ui/dialog.tsx` (Ink remnant) | `src/components/ui/dialog.tsx` | ⬜ |
| 0.6 | Delete dead `src/components/ui/chat-message.tsx` | `src/components/ui/chat-message.tsx` | ⬜ |
| 0.7 | Delete dead `src/components/ui/command-palette.tsx` | `src/components/ui/command-palette.tsx` | ⬜ |
| 0.8 | Delete dead `src/components/ui/modal.tsx` | `src/components/ui/modal.tsx` | ⬜ |
| 0.9 | Delete dead `src/components/ui/scroll-view.tsx` | `src/components/ui/scroll-view.tsx` | ⬜ |
| 0.10 | Delete dead `src/components/ui/text-input.tsx` | `src/components/ui/text-input.tsx` | ⬜ |
| 0.11 | Delete `src/app/api/stub-legacy.ts` | `src/app/api/stub-legacy.ts` | ⬜ |
| 0.12 | Delete `src/components/swarm-panel.tsx` (legacy v6) | `src/components/swarm-panel.tsx` | ⬜ |
| 0.13 | Delete `src/components/skills-panel.tsx` (inline in chat) | `src/components/skills-panel.tsx` | ⬜ |
| 0.14 | Delete `src/components/code-panel.tsx` (rebuild later) | `src/components/code-panel.tsx` | ⬜ |
| 0.15 | Delete `test/ui/store.test.ts` | `test/ui/store.test.ts` | ⬜ |
| 0.16 | Delete `test/ui/console-input.test.ts` | `test/ui/console-input.test.ts` | ⬜ |
| 0.17 | Remove `import type { UiStore }` from `src/session.ts` | `src/session.ts` | ⬜ |
| 0.18 | Remove `import type { ActivitySink }` from `src/session/lifecycle.ts` | `src/session/lifecycle.ts` | ⬜ |
| 0.19 | Remove 5 webpack aliases from `next.config.ts` | `next.config.ts` | ⬜ |
| 0.20 | Verify build + tests pass after deletions | — | ⬜ |

---

## Phase 1: Backend Engine

| # | Task | File | Status |
|---|------|------|--------|
| 1.1 | Create `src/web/engine.ts` — `WebEngine` class | `src/web/engine.ts` | ⬜ |
| 1.2 | Create `src/web/target-manager.ts` — `TargetManager` singleton | `src/web/target-manager.ts` | ⬜ |
| 1.3 | Create `src/web/config-bridge.ts` — config helpers | `src/web/config-bridge.ts` | ⬜ |

### WebEngine Design

```typescript
class WebEngine {
  readonly target: string
  private graphStore: GraphStore     // persistent, per-target
  private config: UltimatrixConfig   // persistent, global
  private skillRegistry: SkillRegistry
  private workerPool: WorkerPool
  private modelSelector?: ModelSelector
  private evidenceGate: EvidenceGate
  private blackboard: Blackboard
  private loopDetector: LoopDetector
  private reflexion?: ReflexionEngine

  async init(target: string, configOverrides?: Partial<UltimatrixConfig>): Promise<void>
  async solve(goal: string, opts: { onMessage?, onPhase? }): Promise<SolveResult>
  getGraph(): GraphStore
  getConfig(): UltimatrixConfig
  getFindings(): FindingNode[]
  getSkillRegistry(): SkillRegistry
  isInitialized(): boolean
  async destroy(): Promise<void>
}
```

### TargetManager Design

```typescript
class TargetManager {
  private engines: Map<string, WebEngine>

  async getOrCreateEngine(target: string): Promise<WebEngine>
  async listTargets(): Promise<TargetInfo[]>
  getActiveEngine(): WebEngine | null
  async destroyEngine(target: string): Promise<void>
}

export const targetManager = new TargetManager()
```

---

## Phase 2: Modify Existing API Routes

| # | Task | File | Status |
|---|------|------|--------|
| 2.1 | Rewrite `api/config/route.ts` — use `getWebConfig()` + `saveWebConfig()` | `src/app/api/config/route.ts` | ⬜ |
| 2.2 | Rewrite `api/status/route.ts` — use `targetManager.getActiveEngine()` | `src/app/api/status/route.ts` | ⬜ |
| 2.3 | Rewrite `api/findings/route.ts` — use `engine.getGraph()` | `src/app/api/findings/route.ts` | ⬜ |
| 2.4 | Rewrite `api/graph/route.ts` — use `engine.getGraph()`, query all 20 node types | `src/app/api/graph/route.ts` | ⬜ |
| 2.5 | Rewrite `api/skills/route.ts` — use `engine.getSkillRegistry().list()` | `src/app/api/skills/route.ts` | ⬜ |
| 2.6 | Rewrite `api/workers/route.ts` — use global emitter events | `src/app/api/workers/route.ts` | ⬜ |
| 2.7 | Delete `api/chat/route.ts` — replaced by `/api/solve` | `src/app/api/chat/route.ts` | ⬜ |
| 2.8 | Delete `api/activity/route.ts` — unified into `/api/solve` SSE | `src/app/api/activity/route.ts` | ⬜ |

---

## Phase 3: Chat-First SSE Endpoint

| # | Task | File | Status |
|---|------|------|--------|
| 3.1 | Create `src/app/api/solve/route.ts` — unified SSE endpoint | `src/app/api/solve/route.ts` | ⬜ |

### SSE Event Types

| Event | Source | When |
|-------|--------|------|
| `solver` | SolverStreamMessage | Tool calls, reasoning, answer deltas, done |
| `phase` | PhaseEvent | OODA phase transitions |
| `worker:spawned` | EventMap | Worker agent created |
| `worker:completed` | EventMap | Worker finished |
| `worker:tool` | EventMap | Worker tool call |
| `swarm:started` | EventMap | Swarm initiated |
| `swarm:completed` | EventMap | Swarm finished |
| `finding:discovered` | EventMap | New finding recorded |
| `finding:verified` | EventMap | Finding verified by evidence gate |
| `graph:node` | EventMap | Graph node added/updated |
| `evidence:recorded` | EventMap | Evidence recorded |
| `reflexion:escalation` | EventMap | Reflexion escalation |
| `anti-loop:stale` | EventMap | Anti-loop stale detection |
| `browser:reaction` | EventMap | Browser reaction detected |
| `spider:progress` | EventMap | Spider crawl progress |
| `council:debate` | EventMap | Council debate cycle |
| `council:decision` | EventMap | Council decision made |
| `done` | SolveResult | Final result |
| `error` | catch | Error |

---

## Phase 4: Store Decomposition

| # | Task | File | Status |
|---|------|------|--------|
| 4.1 | Create `src/stores/session-store.ts` — target/thread state | `src/stores/session-store.ts` | ⬜ |
| 4.2 | Create `src/stores/chat-store.ts` — messages + SSE connection | `src/stores/chat-store.ts` | ⬜ |
| 4.3 | Create `src/stores/graph-store.ts` — graph panel state | `src/stores/graph-store.ts` | ⬜ |
| 4.4 | Create `src/stores/ui-store.ts` — sidebar, settings, overlays | `src/stores/ui-store.ts` | ⬜ |
| 4.5 | Rewrite `src/stores/app-store.ts` — thin aggregator | `src/stores/app-store.ts` | ⬜ |

---

## Phase 5: Chat-First UI Components

| # | Task | File | Status |
|---|------|------|--------|
| 5.1 | Create `src/components/chat-stream.tsx` — main chat stream | `src/components/chat-stream.tsx` | ⬜ |
| 5.2 | Create `src/components/graph-panel.tsx` — right panel (D3 + memory) | `src/components/graph-panel.tsx` | ⬜ |
| 5.3 | Create `src/components/session-sidebar.tsx` — left sidebar | `src/components/session-sidebar.tsx` | ⬜ |
| 5.4 | Create `src/components/chat-input.tsx` — bottom input + slash commands | `src/components/chat-input.tsx` | ⬜ |
| 5.5 | Create `src/components/status-bar.tsx` — bottom status bar | `src/components/status-bar.tsx` | ⬜ |
| 5.6 | Create `src/components/tool-call-card.tsx` — inline tool call | `src/components/tool-call-card.tsx` | ⬜ |
| 5.7 | Create `src/components/worker-card.tsx` — inline worker activity | `src/components/worker-card.tsx` | ⬜ |
| 5.8 | Create `src/components/council-card.tsx` — inline council debate | `src/components/council-card.tsx` | ⬜ |
| 5.9 | Create `src/components/finding-card.tsx` — inline finding | `src/components/finding-card.tsx` | ⬜ |
| 5.10 | Create `src/components/settings-modal.tsx` — settings overlay | `src/components/settings-modal.tsx` | ⬜ |
| 5.11 | Create `src/components/graph-explorer.tsx` — D3 visualization | `src/components/graph-explorer.tsx` | ⬜ |
| 5.12 | Create `src/components/memory-summary.tsx` — graph stats | `src/components/memory-summary.tsx` | ⬜ |
| 5.13 | Create `src/components/slash-commands.ts` — command registry | `src/components/slash-commands.ts` | ⬜ |
| 5.14 | Create `src/components/ui/skeleton.tsx` — loading skeleton | `src/components/ui/skeleton.tsx` | ⬜ |
| 5.15 | Create `src/components/error-boundary.tsx` — React error boundary | `src/components/error-boundary.tsx` | ⬜ |

### Message Types (unified)

```typescript
type ChatMessage =
  | { id: string; role: 'user'; content: string; timestamp: number }
  | { id: string; role: 'assistant'; content: string; timestamp: number }
  | { id: string; type: 'thinking'; content: string; collapsed: boolean }
  | { id: string; type: 'tool-call'; name: string; args: Record<string,unknown>; status: 'running'|'done'|'error'; result?: string; duration?: number }
  | { id: string; type: 'phase'; phase: SolverPhase; step: number }
  | { id: string; type: 'worker-spawned'; workerId: string; name: string; skillId?: string; task: string }
  | { id: string; type: 'worker-completed'; workerId: string; name: string; status: string; findings: number; duration?: number }
  | { id: string; type: 'swarm-started'; swarmId: string; mode: string; totalWorkers: number }
  | { id: string; type: 'swarm-completed'; swarmId: string; completed: number; failed: number; total: number }
  | { id: string; type: 'finding'; findingId: string; severity: string; technique: string; endpoint?: string }
  | { id: string; type: 'graph-update'; nodeType: string; nodeId: string; label?: string }
  | { id: string; type: 'evidence'; evidenceId: string; kind: string; confidence: number }
  | { id: string; type: 'warning'; kind: string; message: string }
  | { id: string; type: 'browser-event'; eventType: string; detail: string }
  | { id: string; type: 'council-debate'; member: string; stance: string; content: string }
  | { id: string; type: 'council-decision'; decision: string; reason: string }
  | { id: string; type: 'summary'; result: SolveResult }
```

---

## Phase 6: App Shell Rewrite

| # | Task | File | Status |
|---|------|------|--------|
| 6.1 | Rewrite `src/app/home-client.tsx` — chat + graph split view | `src/app/home-client.tsx` | ⬜ |
| 6.2 | Rewrite `src/app/page.tsx` — add Suspense + ErrorBoundary | `src/app/page.tsx` | ⬜ |
| 6.3 | Delete old `src/components/findings-panel.tsx` (replaced by inline) | `src/components/findings-panel.tsx` | ⬜ |
| 6.4 | Delete old `src/components/session-header.tsx` (replaced by header in shell) | `src/components/session-header.tsx` | ⬜ |
| 6.5 | Delete old `src/components/settings-panel.tsx` (replaced by modal) | `src/components/settings-panel.tsx` | ⬜ |
| 6.6 | Delete old `src/components/chat.tsx` (replaced by chat-stream) | `src/components/chat.tsx` | ⬜ |
| 6.7 | Delete old `src/components/graph-explorer.tsx` (replaced by new) | `src/components/graph-explorer.tsx` | ⬜ |
| 6.8 | Keep `src/components/voice-command-palette.tsx` (already fixed) | — | ✅ |
| 6.9 | Keep `src/components/attack-animation-layer.tsx` (clean) | — | ✅ |
| 6.10 | Keep `src/components/activity-panel.tsx` (fix SSE endpoint) | — | ✅ |
| 6.11 | Keep `src/components/glyphs.tsx` (clean) | — | ✅ |

---

## Phase 7: Cleanup & Verify

| # | Task | File | Status |
|---|------|------|--------|
| 7.1 | Clean `src/app/globals.css` — remove heavy animations, unused light mode | `src/app/globals.css` | ⬜ |
| 7.2 | Update `src/app/layout.tsx` — proper meta, title | `src/app/layout.tsx` | ⬜ |
| 7.3 | Verify CLI build (`npm run build:cli`) | — | ⬜ |
| 7.4 | Verify web build (`npm run build` or `next build`) | — | ⬜ |
| 7.5 | Verify all tests pass (`npm test`) | — | ⬜ |
| 7.6 | Manual smoke test of all panels | — | ⬜ |

---

## File Count Summary

| Phase | New | Modified | Deleted | Total |
|-------|-----|----------|---------|-------|
| Phase 0 | 0 | 3 | ~40 | ~43 |
| Phase 1 | 3 | 0 | 0 | 3 |
| Phase 2 | 0 | 6 | 2 | 8 |
| Phase 3 | 1 | 0 | 0 | 1 |
| Phase 4 | 5 | 1 | 0 | 6 |
| Phase 5 | 15 | 0 | 0 | 15 |
| Phase 6 | 0 | 1 | 5 | 6 |
| Phase 7 | 0 | 2 | 0 | 2 |
| **Total** | **24** | **13** | **~47** | **~84** |

---

## Design Principles

1. **No hardcoded substring detection** — structured types only at all seams
2. **No hardcoded enumerations in descriptions** — live `getGraphSchema` discovery
3. **No bandaids** — fix design, not symptom
4. **Chat-first** — everything renders inline in the chat stream
5. **Graph = persistent memory** — per-target, survives across sessions
6. **On-demand rendering** — workers, council, tool calls appear only when triggered
7. **Split view** — chat (left/center) + graph (right) as primary panels
8. **SSE unified stream** — single `/api/solve` endpoint bridges solver + event bus
9. **Client-side sessions** — conversation threads are browser state, not server state
10. **Keyboard-first** — slash commands, keyboard shortcuts, minimal mouse clicks
