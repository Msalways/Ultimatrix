# Plan: Proper Terminal Console for `ultimatrix interact` (termcn + Ink)

**Date:** 2026-07-19
**Status:** PROPOSED — awaiting approval
**Supersedes:** `chatbox-revamp.md` (hand-rolled ANSI "bent" terminal — rejected as half-baked) and the earlier chat-only termcn sketch.

## Decision
Build a **proper full-screen terminal console** (not just a chat screen) using **termcn**
(https://termcn.dev) — a shadcn-style, copy-paste terminal UI library **built on Ink** (React renderer
for the terminal). Components are added via the shadcn CLI into `@/components/ui/*` and owned by
us (no runtime lock-in). This is a genuine multi-pane screen, sustainably architected — every CLI
output surface is owned by one Ink `ThemeProvider`, with a single ingestion point.

## Why this is the *proper* fix (not a bandaid)
Two investigations confirmed the real root cause of the broken UX:
1. **No single output owner.** Five subsystems dump to stdout independently (startup/disclaimer, spider,
   REPL prompt, solver card, council/help). A chat-only screen would still leave spider/findings/tools
   as ad-hoc dumps. A multi-pane console owns **all** of them.
2. **Raw `process.stdout.write` + `console.log` bypass the logger sink.** The `log` sink
   (`src/utils/logger.ts:32`) is the chokepoint, but these still escape: spider deltas
   (`lifecycle.ts:495,515`), `askUser` banner (`interaction-tools.ts:92`, `lifecycle.ts:389`),
   the `> ` prompt (`lifecycle.ts:750`), SIGINT newline (`lifecycle.ts:822`), the disclaimer
   (`authorization.ts:20`), and `console.log` in `store.ts`, `budget-dashboard.ts:245`.
   **Proper fix = intercept ALL of these into the store**, not just install a sink.

## Grounded component inventory (verified against the live termcn registry)
Registry: `https://termcn.dev/r/ink/<name>.json`. Install after adding `"@termcn": "https://termcn.dev/r/{name}.json"`
to `components.json.registries`, then `npx shadcn@latest add @termcn/<name>`.

**Confirmed present** (404s excluded):
- Layout: `box`, `stack`, `grid`, `divider`, `scroll-view` ✅
- Data: `card`, `table` (sortable/selectable — *not* `data-table`), `tree`, `list` ✅
- Charts: `gauge`, `line-chart` ✅ (bar/heatmap 404 → gap, see Risks)
- Navigation: `tabs`, `sidebar`, `command-palette`, `menu`, `pagination` ✅
- Feedback: `spinner`, `progress-bar`, `alert`, `dialog`, `modal`, `toast` ✅
- AI: `chat-message`, `streaming-text`, `tool-approval`, `tool-call` ✅
  (thinking/reasoning 404 → use `chat-message` `collapsed`)
- Typography/Input: `badge`, `markdown`, `code`, `text-input`, `text-area`, `select`, `checkbox`, `confirm` ✅
- Theme: `theme-provider` + `theme-default` + `types` ✅ (violet primary #7C3AED, full token set)
- Hooks: `use-input`, `use-focus`, `use-animation` ✅

**Existing repo config we REUSE (no new config):** `tsconfig.json` already has
`"@/*": ["./src/*"]` → termcn's `@/components/ui` alias works as-is.
`components.json` already declares `@/components`, `@/components/ui`, `@/hooks`, `@/lib` (shadcn base-nova).

## Architecture — multi-pane security console
```
┌─ TopBar: Badge(engine) · Badge(target) · Gauge(steps) · Badge(tools) · Badge(quota) ─┐
├─ Tabs: [Chat] [Findings] [Spider] [Tools]                                  ┤
│  Chat:     ScrollView → chat-message(user / assistant+streaming-text+markdown / system) │
│  Findings: table(severity,endpoint,type,status) → onSelect → modal(detail + code)  │
│  Spider:   ScrollView → tool-call(status,result) + Spinner + progress-bar          │
│  Tools:    tree/list of discovered tools + last result                              │
├─ ToolApproval (when HITL fires): tool-approval(risk badge, args, y/n/a, timeout) ─┤
└─ InputBar: text-input(goal) + command-palette(/help /report /council /r)       ─┘
```
- **One Ink `<ThemeProvider>`** owns the whole screen. All panes read from a single `store`.
- **Single ingestion point:** `solve()` → `onMessage` → exactly **one** `reduceMessage` into a shared
  `RenderModel` in the store (fixes the current double-fold bug). Spider/logger/raw-stdout → store.
- Solver brain, spider, council, graph, evidence, HITL gate — **all unchanged**. Only the
  *presentation layer* (session.ts / lifecycle.ts output routing + raw-stdout interception) is swapped.
- `ultimatrix solve` (autonomous, non-interactive) keeps plain/legacy output (unaffected).

## Tooling setup
1. `npm i ink` (React 19 already a dep; verify Ink 7 ↔ React 19 compat at install, pin if needed).
2. Add `"@termcn": "https://termcn.dev/r/{name}.json"` to `components.json.registries`.
3. `npx shadcn@latest add @termcn/box @termcn/stack @termcn/divider @termcn/scroll-view \
   @termcn/card @termcn/table @termcn/list @termcn/gauge @termcn/tabs @termcn/sidebar \
   @termcn/command-palette @termcn/spinner @termcn/progress-bar @termcn/alert @termcn/modal \
   @termcn/toast @termcn/chat-message @termcn/streaming-text @termcn/tool-approval \
   @termcn/tool-call @termcn/badge @termcn/markdown @termcn/code @termcn/text-input \
   @termcn/text-area @termcn/theme-provider` (+ transitive `use-input`/`use-focus`/`use-animation`/`types`/`theme-default`).
4. tsup already compiles TSX via esbuild; `tsx` already used for `src/cli/index.ts`. Confirm `.tsx`
   entry is picked up; no new bundler config.

## Implementation phases

### P0 — Single ingestion point (prereq, no UI yet)
- **Fix double-fold:** `solve()`'s `onMessage` reduces into ONE shared `RenderModel` in the store.
  Remove the duplicate `reduceMessage` in `createSolverRenderer` (session.ts:93) and `chatbox.ts:157`.
- **Intercept raw stdout:** Add a thin stdout interceptor (or route the known raw writers through the
  store) so spider deltas, `askUser` banner, `> ` prompt, SIGINT, disclaimer, and `console.log`
  in store/budget-dashboard all feed the store instead of raw `process.stdout`. Concretely:
  wrap `process.stdout.write` for the session OR replace each call site (lifecycle.ts:495/515/750/822,
  interaction-tools.ts:92, authorization.ts:20, store.ts, budget-dashboard.ts:245) with store calls.
- **Logger sink:** keep `setLogSink` (logger.ts:32) → store; ensure Pino (cli/index.ts:32) is gated
  by the sink (per memory, fixed). All `log.*` during a session → store.
- Test: one `answer` delta folds once (mirrors `layout.test.ts` "delta dedup"); a `console.log`/raw
  write is captured into the store, not stdout.

### P1 — Store + Ink scaffold
- `src/ui/store.ts`: single source of truth — `RenderModel` (chat), `findings[]`, `spiderActivity[]`,
  `tools[]`, `status{engine,target,steps,tools,quota}`, `pendingApproval`, `activeTab`.
  Methods: `dispatch(msg)`, `addFinding`, `setSpider`, `addToolCall`, `setStatus`, `requestApproval`,
  `resolveApproval`, `setTab`. Plain observer (subscribe/notify), no Redux.
- `src/ui/app.tsx`: `<ThemeProvider><App/></ThemeProvider>` full-screen `Box flexDirection="column"`.
- `src/ui/main.tsx`: `render(<App/>)`; returns `{ waitUntilExit, onSubmit, onApproval }`.

### P2 — TopBar + Tabs shell
- `TopBar`: `Badge`s (engine/target/tools/quota) + `Gauge` (steps). Token colors from `useTheme()`.
- `Tabs` (`tabs` component) switches panes (clears screen on switch — correct for full-screen).
  Panes lazy-mounted; store is the data backbone.

### P3 — Chat pane
- `ChatPane`: `ScrollView` → mapped `chat-message` rows. `assistant` row uses `streaming-text` for
  the answer + `markdown` for rendering; reasoning rendered as a `collapsed` `chat-message` (toggle
  via Enter/Space — native to the component). Tool calls → `chat-message sender="system"` summarizing
  `✓/✗ name args result` (or `tool-call` rows). Subscribes to store → re-renders per `dispatch`.

### P4 — Findings pane (real upgrade — none exists in CLI today)
- `FindingsPane`: `table` (severity, endpoint, type, status) from `store.findings`. `onSelect` →
  `modal` with finding detail + `code` block (payload/request). Mirrors web `findings-panel.tsx`.
- Feed: `writeFinding` → store (wire a callback), plus end-of-session `printSummary()` (lifecycle.ts:830).

### P5 — Spider + Tools panes
- `SpiderPane`: `ScrollView` → `tool-call` rows (status/elapsed/result) + `Spinner` + `progress-bar`
  (endpoints/pages/findings). Fed by `lifecycle.runSpider` callbacks (replace the ChatBox
  `beginActivity/updateActivity/endActivity` calls with `store.setSpider`).
- `ToolsPane`: `tree`/`list` of discovered tools + last result (from `store.tools`).

### P6 — Input bar + command palette + HITL
- `InputBar`: `text-input` (goal) → `onSubmit` → existing REPL command handling
  (`/help`, `/report`, `/council`, `/reasoning`, goal → `solve()`).
- `command-palette` (Ctrl+K or `/`) over REPL commands — VS Code style fuzzy search.
- **HITL:** when the approval gate fires, render `tool-approval` (risk badge low/med/high, args JSON,
  `[y] approve / [n] deny / [a] always-allow`, auto-deny timeout) inside the screen;
  `onApproval` resolves the gate promise. Maps 1:1 onto our existing approval gate.

### P7 — Council / help / report on-screen
- `/council`, `/help`, `/report` results render as typed cards/blocks in the store (via `chat-message`/
  `badge`/`alert`), not raw `log.*`. Retire the ChatBox `LogSink` in favor of the store.

### P8 — Config + tests
- Reuse `InteractionConfig.chat?: boolean` (already added) as the Ink-enable flag; `--plain` disables
  Ink → legacy `ChatStream` fallback (kept).
- Tests:
  - `test/ui/store.test.ts`: single-fold reducer (no duplication); raw-stdout/console capture.
  - `test/ui/app.test.ts`: smoke via Ink `renderToString` — assert top bar + a `user`/`assistant` row
    present with a mock store; assert findings `table` renders when findings seeded.
  - `test/ui/approval.test.ts`: `tool-approval` y/n/a resolves the gate promise.
- Full suite green (pre-existing `context-manager.test.ts:213` fail tolerated).

### P9 — Build + verification
- `npm run build:cli` clean (tsup compiles `.tsx`).
- `npx vitest run` green.
- Manual smoke: `npx ultimatrix interact -t <target>` shows a real full-screen console
  (top bar + tabs + chat/findings/spider/tools + input + palette + native approval), no bleeding,
  no duplication, no raw-stdout escapes.

## Files
- NEW `src/ui/{store,app,main,topbar,tabs,chat-pane,findings-pane,spider-pane,tools-pane,input-bar,approval}.tsx`
- NEW `src/components/ui/*` (termcn components, copied by shadcn CLI)
- NEW `src/hooks/*` (termcn hooks), `src/lib/terminal-themes/*`, `src/components/ui/types.ts`
- EDIT `src/session.ts` (single-fold `onMessage` + Ink wiring + fallback)
- EDIT `src/session/lifecycle.ts` (spider → store callbacks; remove raw `> ` prompt)
- EDIT raw-stdout call sites (lifecycle.ts, interaction-tools.ts, authorization.ts, store.ts, budget-dashboard.ts) → store
- EDIT `src/utils/logger.ts` (sink → store; keep Pino gated)
- EDIT `package.json` (add `ink`), `components.json` (add `@termcn` registry)
- RETIRE `src/output/chatbox.ts` (replaced by Ink); keep `ChatStream` as `--plain` fallback.
- NEW `test/ui/*.test.ts`

## Risks / decisions to confirm
- **React 19 + Ink 7 compat:** verify at install; pin a compatible Ink if needed.
- **Stagehand/browser vs Ink:** Ink owns stdout; Stagehand browser is headless — no conflict. Spider
  output routes through the store, not raw stdout.
- **termcn gaps (use Ink primitives, no bandaid):**
  - No `status-bar` → compose `Box` + `divider` + `badge`/`gauge` (TopBar).
  - No `thinking`/`reasoning` → `chat-message` `collapsed` (native).
  - No `chart-bar`/`heatmap` → `gauge` (single metric) / `line-chart` (time-series); hand-roll bar with
    `Box`/`Text` + `theme.colors` if ever needed.
  - No `data-table` → use `table` (the real one).
  - No `chat-message-list` → compose `scroll-view` + mapped `chat-message`.
- **`ultimatrix.yaml`** EXCLUDED from commits.

## Verification gate
- Single `reduceMessage` per `SolverStreamMessage` (no duplicated answer) — P0 test.
- Raw `process.stdout.write` / `console.log` during a session are captured into the store, not echoed raw — P0 test.
- Real full-screen console renders (top bar + tabs + 4 panes + input + palette + approval) via Ink — P9 smoke.
- No regressions in solver/council/graph/evidence suites.
