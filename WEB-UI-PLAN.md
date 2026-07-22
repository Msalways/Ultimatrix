# Ultimatrix Web UI — Implementation Plan

> **Status:** Build mode. This plan covers the full web UI/UX for Ultimatrix — a monitoring +
> control dashboard with Omnitrix-themed aesthetic, multi-target support, knowledge graph
> explorer, coverage matrix, council debate viewer, forensic timeline, clean partitioned chat,
> and full worker/stream visibility.
>
> **Current state:** 1639/1639 tests passing, 153 test files, clean tsup build (ESM 1.53MB /
> CJS 1.55MB). Web UI exists as a single-page prototype (`src/app/page.tsx`) with 5 tab panels
> that cannot build — all 26 `src/components/ui/` files are Ink terminal components, and the
> web panels import shadcn components (`Button`, `Input`, `ScrollArea`, `Separator`) that don't
> exist yet. Chat uses legacy `AgentManager.chat()` (supervisor agent), not the solver stream.

---

## Hard Constraints (standing project rules, apply to ALL work)

1. **No hardcoded regex/substring detection.** Structured typed fields + relation-native
   reasoning only. Tool/agent descriptions say WHAT + HOW, never enumerate the value universe.
   The LLM discovers vocabulary by QUERYING a live schema endpoint — never from a frozen string.
2. **No bandaids.** Fix design, not symptom. Platform-native mechanisms only. Every decision
   must survive the next 10 updates.
3. **No hardcoded enumerations in tool/agent DESCRIPTIONS.** Tool descriptions say WHAT + HOW,
   never list node types, edge types, tool names, or scenario kinds.
4. **No blind truncation.** LLM perceives FULL capture via complete structured access.
5. **Buddy, not master/slave.** LLM = experienced attacker; user + LLM mutually decide via
   `askUser`/chat consensus.
6. **`ultimatrix.yaml` has plaintext cred in git history** — EXCLUDE from every commit
   (`git add -- ':!ultimatrix.yaml'`).
7. **All `npm i` must use `--legacy-peer-deps`** (zod@4 vs @ai-sdk/react peer conflict).
8. **No new engine.** Update existing multi-model solver brain + session relationship.

---

## Architecture Overview

### Engine Flow (web UI targets this path)

```
Web UI → POST /api/solve → solve() → agent.stream(fullStream)
  │
  ├─ SolverStreamMessage (6 kinds) → SSE → useRenderModel() → RenderModel reducer
  │     reasoning → collapsible thinking block
  │     answer    → streamed text
  │     tool      → tool card (name, args, duration)
  │     tool-result → tool status (ok/err)
  │     phase     → phase indicator dial
  │     done      → findings summary + session stats
  │
  └─ ForensicLog → NDJSON file (19 event types)
```

### Target Context (gap for future multi-target)

The web UI introduces a `TargetContext` abstraction that replaces global singletons with
per-target scoped state. This is NOT a full multi-target rewrite — it's a thin layer that
keeps the existing `getGlobalGraphStore()` call sites working while enabling the web UI to
query data for any target.

```
TargetContext = {
  target: string               // the URL
  graphStore: GraphStore       // per-target graph (on disk: output/<slug>/graph.json)
  forensicLog: ForensicLog     // per-target log (on disk: output/<slug>/forensic.ndjson)
  scopeConfig: ScopeConfig | null
  evidenceGate: EvidenceGate
  session: SessionLifecycle | null  // null for historical (read-only) targets
}

// One active context at a time, stored in a module-level Map
const contexts = new Map<string, TargetContext>()
let activeTarget: string

getActiveTargetContext() → TargetContext     // current default
getTargetContext(target) → TargetContext     // any target (reads from disk if not loaded)
setActiveTarget(target) → void              // switch active
```

**Why this works for future multi-target:**
- `getGlobalGraphStore()` delegates to `getActiveTargetContext().graphStore` (zero call site changes)
- When you need concurrent multi-target (cross-app scenarios), add a `Map<target, TargetContext>`
  and pass context via dependency injection instead of globals
- The disk layout already partitions per-target: `output/<slug>/graph.json`, `forensic.ndjson`, etc.

### Directory Structure (already exists on disk)

```
output/
  <slugified-target>/          ← per target
    graph.json                 ← graph store (findings, endpoints, pages, actions)
    forensic.ndjson            ← tool calls, events, phase transitions
    oast-callbacks.json        ← OAST state
    ultimatrix.db              ← optional libsql
    captures/
      <timestamp>.har          ← HTTP traffic
    scans/                     ← scan contexts
    reports/                   ← generated reports
  global/
    cross-engagement-memory.json  ← anonymized patterns across ALL targets
```

---

## Design System

### Color Tokens

```css
/* Background layers (darkest → lightest) */
--bg-void:       #050508       /* page background — near-black with blue tint */
--bg-panel:      #0a0b0f       /* panels, cards */
--bg-surface:    #12131a       /* elevated surfaces, hover states */
--bg-input:      #181920       /* input fields, text areas */

/* Border system */
--border-dim:    #1a1c24       /* default borders — barely visible */
--border-glow:   rgba(43, 224, 138, 0.2)    /* holographic green — Omnitrix signature */
--border-active: rgba(43, 224, 138, 0.4)    /* focused/active elements */

/* Omnitrix green (primary) */
--green-100:     #e6fff0       /* text on dark bg */
--green-200:     #7dffc0       /* secondary text */
--green-400:     #2be08a       /* primary — buttons, links, active states */
--green-500:     #1ecc77       /* hover state */
--green-600:     #15a362       /* pressed state */
--green-glow:    rgba(43, 224, 138, 0.25)   /* box-shadow glow */
--green-glow-lg: rgba(43, 224, 138, 0.1)    /* larger spread glow */

/* Accent (holographic cyan — secondary) */
--cyan-400:      #36c9e6       /* instruments, secondary actions */
--cyan-glow:     rgba(54, 201, 230, 0.25)

/* Severity */
--critical:      #ff4d4d
--high:          #ff8c42
--medium:        #ffb020
--low:           #4dabf7
--info:          #868e96

/* Typography */
--font-display:  'Exo 2', sans-serif       /* headers — slightly alien, geometric */
--font-body:     'Inter', sans-serif       /* body text */
--font-mono:     'JetBrains Mono', monospace /* code, tool output, terminal */
```

### Omnitrix Signature Elements

1. **Holographic panel borders** — subtle green glow on hover/active:
   `box-shadow: 0 0 15px var(--green-glow), inset 0 0 15px var(--green-glow);`
2. **Circular status indicators** — `●` active (green pulse), `○` idle (dim), `◌` loading (spin), `◉` complete
3. **Phase dial** — circular SVG with phase dots (observe/learn/attack/record/complete)
4. **Hourglass logo** — diamond/hourglass shape (Omnitrix symbol) as app icon + loading indicator

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ ◇ ULTIMATRIX   ▾ https://example.com ▾    ● ATTACK  02:34  ⚙      │
├────────┬────────────────────────────────────────────────────────────┤
│ ◇ DASH │                                                            │
│ ◇ CHAT │              MAIN CONTENT AREA                             │
│ ◇ GRAP │            (follows selected target)                       │
│ ◇ FIND │                                                            │
│ ◇ TIME │                                                            │
│ ◇ SETT │                                                            │
├────────┴────────────────────────────────────────────────────────────┤
│ Status: Phase: ATTACK | Step: 12 | Tokens: 45.2k | Model: groq/70b│
└─────────────────────────────────────────────────────────────────────┘
  56px                  Remaining width
  Sidebar
```

---

## Phase 0: Foundation

> Delete Ink components, install shadcn, build app shell with Omnitrix theme.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 0.1 | **Delete Ink components** — remove all 26 files from `src/components/ui/` (alert, badge, box, card, chat-message, code, command-palette, dialog, divider, gauge, list, markdown, modal, progress-bar, scroll-view, spinner, stack, streaming-text, table, tabs, text-input, theme-provider, tool-approval, tool-call, tree, types). These are Ink terminal components, dead code for web. | `src/components/ui/*.tsx` (26 files) | S | — |
| 0.2 | **Install shadcn web components** — `npx shadcn@latest add button input label scroll-area separator sheet tabs tooltip card badge dropdown-menu popover switch select dialog command scroll-area`. Infrastructure exists: `components.json`, tailwind config, CSS variables, `cn()` utility, all Radix primitives installed. | `src/components/ui/` (new files) | S | 0.1 |
| 0.3 | **Remove `@termcn` registry** from `components.json` — it references the Ink registry we're deleting. | `components.json` | XS | 0.1 |
| 0.4 | **Omnitrix theme tokens** — add CSS custom properties to `globals.css` for all design tokens (colors, fonts, glows). Keep existing `--ultimatrix-green: #2be08a` as reference. Add `@import url()` for Exo 2 + Inter + JetBrains Mono fonts. | `src/app/globals.css` | M | — |
| 0.5 | **App shell** — rewrite `src/app/layout.tsx` with: `<html>` + `<body>` + `<Providers>` (next-themes). Sidebar (56px) + main content area + optional right panel. | `src/app/layout.tsx` | M | 0.2, 0.4 |
| 0.6 | **Sidebar component** — `src/components/sidebar.tsx`. Navigation icons (Dashboard, Chat, Graph, Findings, Timeline, Settings). Target status indicator. Omnitrix hourglass logo at top. Active state = green glow border-left. | `src/components/sidebar.tsx` (new) | M | 0.2, 0.4 |
| 0.7 | **Header component** — `src/components/header.tsx`. Target dropdown selector, engine status, model info, session duration timer. | `src/components/header.tsx` (new) | M | 0.2, 0.4 |
| 0.8 | **Status bar** — `src/components/status-bar.tsx`. Rewrite to use new theme tokens. Phase indicator, step counter, token usage, model info. | `src/components/status-bar.tsx` | S | 0.4 |
| 0.9 | **Page router** — rewrite `src/app/page.tsx` as layout shell: sidebar + header + active page content (no tabs — use URL-based routing or state-based page switching). | `src/app/page.tsx` | M | 0.5, 0.6, 0.7 |

### Phase 0 Verification
- `npx shadcn@latest add` succeeds without errors
- `npm run build:cli` passes (tsup build unaffected)
- `npm run build` (next build) passes — no Ink imports, no missing component errors
- All 26 Ink files deleted, zero references remain
- Sidebar renders with Omnitrix logo + nav icons
- Header renders with target dropdown placeholder

---

## Phase 1: Target Context + API Layer

> Introduce TargetContext abstraction, create API routes for multi-target data access.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 1.1 | **TargetContext type** — define `TargetContext` interface: `{ target, graphStore, forensicLog, scopeConfig, evidenceGate, session }`. Define `TargetStatus`: `'active' | 'paused' | 'history'`. Define `TargetMeta`: `{ target, slug, status, findingsCount, coveragePercent, lastActivity, durationMs }`. | `src/web/target-context.ts` (new) | M | — |
| 1.2 | **TargetContext manager** — `TargetContextManager` class with: `listTargets()` (scan `output/` dir for slugified subdirs), `getTargetContext(target)` (load from disk if not cached), `setActiveTarget(target)` (swap global singletons), `getActiveTarget()`, `createTarget(url)` (init workspace + lifecycle). Module-level singleton via `getTargetManager()`. | `src/web/target-context.ts` (new) | L | 1.1 |
| 1.3 | **Target metadata extraction** — for each target dir, read `graph.json` to count findings by severity, count endpoints, compute coverage %. Read `forensic.ndjson` last line for last activity timestamp. Compute duration from first to last forensic event. | `src/web/target-context.ts` | M | 1.2 |
| 1.4 | **`GET /api/targets`** — list all targets with metadata. Returns `TargetMeta[]`. No hardcoded target enumeration — reads from filesystem dynamically. | `src/app/api/targets/route.ts` (new) | S | 1.2 |
| 1.5 | **`POST /api/targets`** — create new target. Body: `{ url: string }`. Validates URL, calls `TargetContextManager.createTarget()`, returns `TargetMeta`. | `src/app/api/targets/route.ts` | S | 1.2 |
| 1.6 | **`POST /api/targets/[target]/activate`** — switch active target. Calls `setActiveTarget()`, returns new `TargetMeta`. | `src/app/api/targets/[target]/route.ts` (new) | S | 1.2 |
| 1.7 | **`GET /api/targets/[target]/graph`** — query graph for specific target. Params: `nodeTypes`, `edgeTypes`, `limit`. Reads from target's `graph.json` without loading into global state. | `src/app/api/targets/[target]/graph/route.ts` (new) | M | 1.2 |
| 1.8 | **`GET /api/targets/[target]/findings`** — findings for specific target. Params: `severity`, `type`. Reads from target's graph store on disk. | `src/app/api/targets/[target]/findings/route.ts` (new) | S | 1.2 |
| 1.9 | **`GET /api/targets/[target]/timeline`** — forensic events for specific target. Params: `type`, `limit`, `offset`. Reads from target's `forensic.ndjson`. | `src/app/api/targets/[target]/timeline/route.ts` (new) | M | 1.2 |
| 1.10 | **Update existing APIs** — `GET /api/findings` gets `target` query param (defaults to active). `GET /api/config` includes `targets` array. `POST /api/config` `target` field switches active target via context manager. | `src/app/api/findings/route.ts`, `src/app/api/config/route.ts` | S | 1.2 |

### Phase 1 Verification
- `GET /api/targets` returns list of targets found in `output/` directory
- `POST /api/targets` with a new URL creates workspace dir + returns metadata
- `POST /api/targets/[target]/activate` switches active target
- Graph/finding/timeline queries work for any target without loading into global state
- Existing `/api/findings` still works (defaults to active target)
- No hardcoded target lists — everything reads from filesystem

---

## Phase 2: Solver Stream + Chat Rewrite

> Wire web chat to solver stream via new `/api/solve` SSE endpoint.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 2.1 | **`POST /api/solve` SSE endpoint** — accepts `{ target, goal }`. Calls `solve()` directly (not AgentManager). Streams `SolverStreamMessage` events as SSE `data:` lines. Handles errors gracefully (returns SSE `error` event). Includes target context setup (calls `setActiveTarget()` if needed). | `src/app/api/solve/route.ts` (new) | L | 1.2 |
| 2.2 | **`useRenderModel()` hook wiring** — the hook at `src/components/use-render-model.ts` already parses `SolverStreamMessage` SSE → `RenderModel` reducer. Verify it works with the new `/api/solve` endpoint. Fix any compatibility issues (it currently expects `AsyncIterable<string>` from SSE). | `src/components/use-render-model.ts` | M | 2.1 |
| 2.3 | **Rewrite chat panel** — replace `useChat()` (legacy AgentManager) with `useRenderModel()` hook connected to `/api/solve`. Input field sends goal to SSE endpoint. Messages render from `RenderModel.answer`. Tool timeline renders from `RenderModel.tools[]`. Phase renders from `RenderModel.phase`. Done renders findings from `RenderModel.done`. | `src/components/chat.tsx` | L | 2.2 |
| 2.4 | **Reasoning block** — `src/components/reasoning-block.tsx`. Collapsible thinking display. Green border, Brain icon, dim text (`opacity: 0.7`). Click to expand/collapse. Smooth height animation. Shows `RenderModel.reasoning` content. | `src/components/reasoning-block.tsx` (new) | M | 2.3 |
| 2.5 | **Tool card** — `src/components/tool-card.tsx`. Shows tool name (mapped from ID via dynamic lookup, not hardcoded enum), args (expandable JSON with syntax highlighting), duration (computed from start/end timestamps), status icon (pending spinner / done checkmark / error X). | `src/components/tool-card.tsx` (new) | M | 2.3 |
| 2.6 | **Phase indicator** — `src/components/phase-indicator.tsx`. Circular SVG dial with phase dots. Phases detected from `RenderModel.phase` via `detectPhase()` (already maps tool names to phases in solver.ts). Completed phases = filled green dots, current = pulsing, future = dim outlines. | `src/components/phase-indicator.tsx` (new) | M | 2.3 |
| 2.7 | **Chat input** — rewrite input area. Goal/command text input + Send button. Disable during streaming. Escape to stop. Ctrl+Enter to send. | `src/components/chat.tsx` | S | 2.3 |
| 2.8 | **Session persistence** — persist last 50 messages + threadId to localStorage. Rehydrate on mount. Survives page refresh. | `src/components/chat.tsx` | S | 2.3 |

### Phase 2 Verification
- `POST /api/solve` returns SSE stream with `SolverStreamMessage` events
- Chat panel receives reasoning, answer, tool, tool-result, phase, done events
- Reasoning block collapses/expands smoothly
- Tool cards show name, args, duration, status
- Phase indicator updates as solver progresses
- Session survives page refresh (localStorage)
- No reference to `AgentManager.chat()` in chat path

---

## Phase 3: Worker Cards + Multi-Model Display

> Enrich worker metadata and display in chat stream.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 3.1 | **Enrich `spawnWorker` return** — add `skillName`, `skillDescription`, `modelUsed`, `durationMs` to the tool return value. Read skill metadata from `loadSkill(skillId)` in the tool handler. Compute duration from start timestamp. `modelUsed` comes from the `WorkerConfig` that was passed to `WorkerFactory.create()`. | `src/manager/tools/spawn-worker.ts` | M | — |
| 3.2 | **Enrich `spawnSwarm` return** — same enrichment per worker in the swarm result. | `src/manager/tools/spawn-swarm.ts` | S | 3.1 |
| 3.3 | **`worker-completed` forensic event** — add new `ForensicEventType` value. Emit from `WorkerPool.execute()` after worker completes. Payload: `{ workerId, skillId, skillName, modelUsed, durationMs, status, graphDiff }`. | `src/logging/forensic-log.ts`, `src/workers/pool.ts` | M | 3.1 |
| 3.4 | **Worker card component** — `src/components/worker-card.tsx`. Detects `tool` + `tool-result` pairs for `spawnWorker`/`spawnSwarm` in the stream. Renders: skill name, task description, model used (provider/model), status (running spinner / done checkmark / error), graph diff (+N nodes, +M findings), duration. Green holographic border during execution. | `src/components/worker-card.tsx` (new) | L | 2.5 |
| 3.5 | **Model selector display** — `src/components/model-selector-card.tsx`. Shows which model is active for brain + each worker tier. Reads from `config.modelTiers` and forensic `model-selection` events. | `src/components/model-selector-card.tsx` (new) | M | — |
| 3.6 | **Worker panel (right sidebar)** — `src/components/worker-panel.tsx`. Live list of active/recent workers. Click to expand details. Shows total workers spawned, success rate, average duration. Scrollable with `ScrollArea`. | `src/components/worker-panel.tsx` (new) | M | 3.4 |

### Phase 3 Verification
- `spawnWorker` returns enriched data (skillName, modelUsed, durationMs)
- Worker cards render in chat stream when brain spawns workers
- Worker panel shows live worker activity
- Forensic log includes `worker-completed` events
- No hardcoded worker name lists — skill names read from `loadSkill()`

---

## Phase 4: Dashboard + Findings + Settings

> Core page implementations.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 4.1 | **Dashboard page** — `src/app/dashboard/page.tsx`. Stats cards: findings count (by severity), endpoints discovered, coverage %, session duration. Severity timeline chart (Recharts line chart). Worker activity feed. Recent forensic events. All data from `/api/targets/[target]/*` endpoints. | `src/app/dashboard/page.tsx` (new) | L | 1.4-1.9 |
| 4.2 | **Findings page** — rewrite `src/components/findings-panel.tsx`. Severity filter pills (all/critical/high/medium/low). Technique filter (dynamically extracted from findings, not hardcoded). Each finding = expandable card: technique, severity badge, endpoint, evidence, confidence %, CWE, remediation. Export button (JSON download). | `src/components/findings-panel.tsx` | L | 1.8 |
| 4.3 | **Finding detail sheet** — `src/components/finding-detail.tsx`. Slide-out panel (shadcn `Sheet`) showing full finding details: all evidence lines, HTTP request/response, confidence score, related attack chain, repro curl command. | `src/components/finding-detail.tsx` (new) | M | 4.2 |
| 4.4 | **Settings page (Phase 1)** — `src/app/settings/page.tsx`. Progressive config editing. Phase 1 fields: provider, model, engine, tiers (fast/balanced/powerful), headless, timeout, target (read-only display — changed via header dropdown). Uses shadcn form components. | `src/app/settings/page.tsx` (new) | M | 1.10 |
| 4.5 | **Settings page (Phase 2)** — add solver params (maxToolCalls, maxTokens, maxDurationMs), scope config, budget policy, antiLoop, reflexion. | `src/app/settings/page.tsx` | M | 4.4 |
| 4.6 | **Settings page (Phase 3)** — add council config, MCP config, OAST config, plugins, rate limiting. | `src/app/settings/page.tsx` | M | 4.5 |

### Phase 4 Verification
- Dashboard shows live stats for active target
- Findings page filters by severity + technique (techniques extracted from data)
- Finding detail sheet shows full evidence chain
- Settings saves config correctly for all phases
- No hardcoded technique lists — extracted dynamically from findings data

---

## Phase 5: Knowledge Graph Explorer

> D3.js force-directed graph visualization.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 5.1 | **`GET /api/targets/[target]/graph` enhancement** — add `getGraphSchema()` endpoint that returns node types, edge types, and counts dynamically (no hardcoded lists). Tool/agent descriptions reference this endpoint for vocabulary discovery. | `src/app/api/targets/[target]/graph/route.ts` | M | 1.7 |
| 5.2 | **Graph explorer component** — `src/components/graph-explorer.tsx`. D3.js force-directed layout. Node type filtering (checkboxes populated from schema endpoint). Click-to-inspect: opens inspector panel with node details. Zoom/pan with mouse/touch. Node colors by type (green for findings, cyan for endpoints, dim for pages, etc.). Edge labels by type. | `src/components/graph-explorer.tsx` (new) | L | 5.1 |
| 5.3 | **Graph inspector panel** — `src/components/graph-inspector.tsx`. Slide-out panel showing: node type, properties (all fields), connected edges, related nodes. Click an edge to navigate to connected node. | `src/components/graph-inspector.tsx` (new) | M | 5.2 |
| 5.4 | **Graph page** — `src/app/graph/page.tsx`. Hosts `GraphExplorer` + filter controls + inspector panel. | `src/app/graph/page.tsx` (new) | S | 5.2, 5.3 |

### Phase 5 Verification
- Graph renders with real data from target's graph.json
- Node types filter dynamically from schema endpoint (no hardcoded list)
- Click node → inspector shows all properties + connections
- Zoom/pan works with mouse
- No hardcoded node/edge type enumerations in component code

---

## Phase 6: Data Visualization

> Coverage matrix, severity timeline, event timeline, council debate viewer.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 6.1 | **`GET /api/targets/[target]/campaign`** — campaign plan + coverage stats from graph. Returns `CampaignPlan` + `CoverageStats`. | `src/app/api/targets/[target]/campaign/route.ts` (new) | S | 1.2 |
| 6.2 | **`GET /api/targets/[target]/council`** — council debate history from graph. Returns `DebateCycleResult[]`. | `src/app/api/targets/[target]/council/route.ts` (new) | S | 1.2 |
| 6.3 | **Coverage matrix** — `src/components/coverage-matrix.tsx`. Endpoint × param × role heatmap. Color-coded by test status (tested=green, pending=yellow, untested=dim). Hover for details. | `src/components/coverage-matrix.tsx` (new) | L | 6.1 |
| 6.4 | **Severity timeline** — `src/components/severity-timeline.tsx`. Findings over time. Recharts line/area chart. Severity color-coded. Interactive time scrubbing. | `src/components/severity-timeline.tsx` (new) | M | 1.9 |
| 6.5 | **Event timeline** — `src/components/event-timeline.tsx`. Forensic events (19 types) rendered as vertical timeline. Filterable by type. Expandable event cards with full payload. Color-coded by type. | `src/components/event-timeline.tsx` (new) | L | 1.9 |
| 6.6 | **Council debate viewer** — `src/components/council-debate.tsx`. 4 members (strategist, operator, skeptic, analyst) with persona avatars. Debate turns displayed as conversation. Proposals with impact level + stances (agree/disagree/abstain). Critiques inline. | `src/components/council-debate.tsx` (new) | L | 6.2 |
| 6.7 | **Timeline page** — `src/app/timeline/page.tsx`. Hosts event timeline + severity timeline + coverage matrix. | `src/app/timeline/page.tsx` (new) | S | 6.3-6.6 |

### Phase 6 Verification
- Coverage matrix renders from real campaign data
- Severity timeline plots findings chronologically
- Event timeline shows forensic events filterable by type
- Council debate viewer shows member personas + proposals + stances
- No hardcoded event types in display code — types read from data

---

## Phase 7: Multi-Target Management

> Target switching, creation, session lifecycle in the UI.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 7.1 | **Target dropdown** — `src/components/target-dropdown.tsx`. Dropdown in header. Shows all targets with status indicators (active/paused/history). Click to switch. `[+ Add Target]` button opens creation modal. | `src/components/target-dropdown.tsx` (new) | M | 1.4 |
| 7.2 | **Add target modal** — `src/components/add-target-modal.tsx`. shadcn `Dialog` with URL input. Validates URL format. Calls `POST /api/targets`. Shows loading spinner during creation. | `src/components/add-target-modal.tsx` (new) | M | 1.5 |
| 7.3 | **Target context switching** — when user selects a different target in dropdown, call `POST /api/targets/[target]/activate`. All pages (dashboard, chat, graph, findings, timeline) reload data for the new target. | All page components | M | 7.1, 1.6 |
| 7.4 | **Session controls** — active target shows Pause/Stop/Report buttons. Pause = solver stops but session preserved. Stop = full teardown. Report = generate report. | `src/components/header.tsx` | M | 2.1 |
| 7.5 | **Read-only mode for historical targets** — when viewing a non-active target, chat input is disabled (read-only), graph/finding/timeline are read-only. Show "Switch to active" banner. | All page components | S | 7.3 |
| 7.6 | **Delete target** — `DELETE /api/targets/[target]` removes target's output directory. Confirmation dialog before deletion. | `src/app/api/targets/[target]/route.ts` | S | 1.6 |

### Phase 7 Verification
- Target dropdown shows all targets from filesystem
- Clicking target switches all pages to that target's data
- Add target modal creates new target + starts session
- Historical targets show read-only data
- Delete target removes directory with confirmation
- Active target shows session controls (pause/stop/report)

---

## Phase 8: Polish + Responsive

> Keyboard shortcuts, responsive layout, accessibility.

| # | Task | Files | Effort | Depends |
|---|------|-------|--------|---------|
| 8.1 | **Keyboard shortcuts** — Cmd+K command palette (shadcn `Command`). Cmd+/ toggle sidebar. Escape stop streaming. Ctrl+Enter send message. | `src/hooks/use-keyboard.ts` (new), page components | M | — |
| 8.2 | **Responsive sidebar** — collapse to icons on tablet (<1024px), hide on mobile (<768px) with hamburger toggle. | `src/components/sidebar.tsx` | S | 0.6 |
| 8.3 | **Responsive panels** — graph/findings/timeline stack vertically on mobile. Chat takes full width. | Page components | S | — |
| 8.4 | **Loading states** — skeleton loaders for each page. Spinner for SSE connection. Phase-aware loading (show phase indicator during solver execution). | All page components | M | — |
| 8.5 | **Error boundaries** — per-page error boundaries with "Restart" button. Graceful degradation when API is unreachable. | `src/app/error.tsx` (new), page components | S | — |
| 8.6 | **Tooltip polish** — add Radix `Tooltip` to all icon buttons, nav items, status indicators. | All components | S | 0.2 |

### Phase 8 Verification
- Cmd+K opens command palette
- Sidebar collapses on tablet/mobile
- Pages stack vertically on mobile
- Loading skeletons appear during data fetch
- Error boundaries catch rendering errors
- All icon buttons have tooltips

---

## File Structure Summary

### New Files

```
src/web/
  target-context.ts              ← TargetContext type + manager

src/app/api/targets/
  route.ts                       ← GET (list) + POST (create)
  [target]/
    route.ts                     ← POST (activate) + DELETE
    graph/
      route.ts                   ← GET (query graph)
    findings/
      route.ts                   ← GET (query findings)
    timeline/
      route.ts                   ← GET (forensic events)
    campaign/
      route.ts                   ← GET (campaign plan)
    council/
      route.ts                   ← GET (council debates)

src/app/api/solve/
  route.ts                       ← POST (SSE solver stream)

src/app/dashboard/page.tsx       ← Dashboard page
src/app/graph/page.tsx           ← Graph explorer page
src/app/timeline/page.tsx        ← Timeline + coverage page
src/app/settings/page.tsx        ← Settings page (progressive)

src/components/
  sidebar.tsx                    ← Navigation sidebar
  header.tsx                     ← Header with target dropdown
  target-dropdown.tsx            ← Target switcher dropdown
  add-target-modal.tsx           ← New target creation dialog
  reasoning-block.tsx            ← Collapsible thinking block
  tool-card.tsx                  ← Tool invocation card
  worker-card.tsx                ← Worker spawn card
  phase-indicator.tsx            ← Circular phase dial
  model-selector-card.tsx        ← Model tier display
  worker-panel.tsx               ← Worker activity sidebar
  finding-detail.tsx             ← Finding detail sheet
  graph-explorer.tsx             ← D3.js force graph
  graph-inspector.tsx            ← Node inspector panel
  coverage-matrix.tsx            ← Endpoint × param heatmap
  severity-timeline.tsx          ← Findings over time chart
  event-timeline.tsx             ← Forensic event timeline
  council-debate.tsx             ← Council debate viewer

src/hooks/
  use-keyboard.ts                ← Keyboard shortcut handler

src/app/error.tsx                ← Error boundary
```

### Modified Files

```
src/components/ui/               ← 26 Ink files DELETED, shadcn files INSTALLED
src/components/chat.tsx          ← REWRITTEN (solver stream, not AgentManager)
src/components/findings-panel.tsx ← REWRITTEN (target-scoped, dynamic filters)
src/components/status-bar.tsx    ← UPDATED (new theme tokens)
src/app/page.tsx                 ← REWRITTEN (layout shell, not tabs)
src/app/layout.tsx               ← UPDATED (providers, fonts)
src/app/globals.css              ← UPDATED (Omnitrix theme tokens)
src/app/api/findings/route.ts    ← UPDATED (target query param)
src/app/api/config/route.ts      ← UPDATED (targets array, target switch)
src/manager/tools/spawn-worker.ts ← UPDATED (enriched return)
src/manager/tools/spawn-swarm.ts  ← UPDATED (enriched return)
src/logging/forensic-log.ts      ← UPDATED (worker-completed event type)
src/workers/pool.ts              ← UPDATED (emit worker-completed event)
components.json                  ← UPDATED (remove @termcn registry)
```

---

## Effort Summary

| Phase | Tasks | Effort | Description |
|-------|-------|--------|-------------|
| P0 | 9 | Medium | Foundation (Ink deletion, shadcn, app shell, theme) |
| P1 | 10 | Large | TargetContext + API layer |
| P2 | 8 | Large | Solver stream + chat rewrite |
| P3 | 6 | Medium | Worker cards + multi-model display |
| P4 | 6 | Large | Dashboard + findings + settings |
| P5 | 4 | Large | Knowledge graph explorer |
| P6 | 7 | Large | Data visualization (coverage, timeline, council) |
| P7 | 6 | Medium | Multi-target management |
| P8 | 6 | Medium | Polish + responsive |
| **Total** | **62** | | |

### Execution Order

```
P0 (foundation) → P1 (target context) → P2 (chat rewrite) → P3 (workers)
                  ↓
P4 (pages) ← P5 (graph) ← P6 (visualization)
                  ↓
P7 (multi-target) → P8 (polish)
```

P4-P6 can be parallelized once P1 is done. P7 depends on P2 (chat needs to work for session controls). P8 is independent.

---

## Anti-Bandaid Checklist

Before merging any phase, verify:

- [ ] **No hardcoded node/edge type lists** in any tool/agent/component description
- [ ] **No hardcoded technique lists** in any filter/selector — extracted from data
- [ ] **No hardcoded event type lists** in display code — read from forensic log schema
- [ ] **No hardcoded target URLs** — all read from filesystem or config
- [ ] **No hardcoded worker/skill names** — read from `loadSkill()` or registry
- [ ] **No `includes()` substring detection** for state/type discrimination
- [ ] **No regex pattern matching** for vocabulary extraction
- [ ] **No blind truncation** of graph data, forensic logs, or finding evidence
- [ ] **No global singletons** introduced — all state scoped via TargetContext
- [ ] **No dead Ink imports** remaining after P0 deletion
- [ ] **All new components use shadcn primitives** (Button, Input, Card, Sheet, etc.)
- [ ] **All API routes are target-aware** (accept `target` param or use active context)
- [ ] **`npm run build` passes** (next build + tsup build)
- [ ] **`npm test` passes** (existing 1639 tests unaffected)
