# Termcn Console — Phase-wise Task Breakdown

**Goal:** Replace the broken hand-rolled terminal output (`chatbox.ts` + scattered `process.stdout.write`/`console.log`) with a **proper full-screen Ink-based terminal console** built from termcn components. One `ThemeProvider`, one `store` (single source of truth), all output surfaces routed through it. No bandaids: platform-native (Ink) renderer, structured data, documented fallbacks for termcn gaps.

**Repos/config reused (no new alias config):** `tsconfig.json` `@/*` → `./src/*`; `components.json` already declares `@/components`, `@/components/ui`, `@/hooks`, `@/lib`.

**Registry:** `@termcn` → `https://termcn.dev/r/{name}.json`. Install: `npx shadcn@latest add @termcn/<name>`.

---

## Phase 0 — Single ingestion point (root-cause fix, no UI yet)
- [x] **P0.1** `npm i ink --legacy-peer-deps` → ink@7.1.1 (React 19.2.7 compatible). `ink` in `package.json`.
- [x] **P0.2** `components.json` `@termcn` registry entry added (rsc:false + registries block).
- [x] **P0.3** Installed termcn components via `ink/` prefix (badge, tabs, table, card, dialog, modal, code, chat-message, streaming-text, markdown, gauge, spinner, progress-bar, list, tree, text-input, command-palette, tool-approval, tool-call, alert, scroll-view, box, stack, divider, types, theme-default) + hooks (use-input, use-focus, use-animation) + `cli-spinners`/`mnemonist`/`marked`.
- [x] **P0.4** `src/ui/store.ts`: single source of truth — `model` (RenderModel) + `turns[]` history, `findings[]`, `spider[]`, `spiderCounts`, `tools[]`, `status`, `logLines`, `approval`, `activeTab`. Observer (subscribe/notify). `resetUiStore`/`getUiStore` singleton.
- [x] **P0.5** Double-fold fixed structurally: `createSolverRenderer` folds once via `reduceMessage` into the store's `RenderModel`; console branch dispatches each `SolverStreamMessage` exactly once (`dispatchSolver`) and `commitTurn()` snapshots history. Legacy `ChatBox` path untouched.
- [ ] **P0.6** Raw stdout interception: only the REPL `> ` prompt + activity sink were routed. Remaining `log.*` calls in `main()` are forwarded into the store via `setLogSink` when console mode is on (so Ink's screen stays clean). Full raw-write sweep deferred to P9.
- [x] **P0.7** Logger sink: in console mode, `setLogSink` forwards lines into `store.pushLog` (P1 status pane). Legacy ChatBox sink path preserved.
- [x] **P0.8** `test/ui/store.test.ts` (9 green): one answer delta folds once; commitTurn snapshots; addFinding/recordTool upsert; setSpiderCounts; requestApproval resolves; setTab; subscribe notify; log buffer bounds.

## Phase 1 — Store + Ink scaffold
- [x] **P1.1** Layout components installed (`box`, `stack`, `divider`, `scroll-view`).
- [x] **P1.2** `src/ui/app.tsx`: `<AutoThemeProvider><App/></AutoThemeProvider>` full-screen `<Box flexDirection="column" height="100%">`. `App` subscribes via `useUiStore()` and re-renders on notify.
- [x] **P1.3** `src/ui/main.tsx`: `render(<App/>)` via Ink; returns `{ store, unmount }`. Mounted in `main()` after init (console mode only), unmount deferred to exit.
- [x] **P1.4** `test/ui/store.test.ts` covers store fold; full `app` renderToString smoke deferred (build green, will add in P8).

## Phase 2 — TopBar + Tabs shell
- [x] **P2.1** `badge`, `gauge`, `tabs` installed.
- [x] **P2.2** `src/ui/topbar.tsx`: `Badge`s (engine/target/tools/quota) + `Gauge` (steps) from `useTheme()`.
- [x] **P2.3** `src/ui/tab-bar.tsx`: **custom** TabBar (termcn `tabs` does raw `stdout.write("\u001B[2J...")` — conflicts with Ink cursor ownership, so build our own from `Box`/`Text`/`useInput`). Switches panes; `store.setTab` on change.
- [x] **P2.4** `main()` renders TopBar + Tabs shell (Chat active). Legacy `ChatStream`/`ChatBox` fallback when `!chatEnabled || --plain`.

## Phase 3 — Chat pane
- [x] **P3.1** `chat-message`, `streaming-text`, `markdown` installed.
- [x] **P3.2** `src/ui/chat-pane.tsx`: `ScrollView` → mapped `chat-message` rows from `store.turns` (history) + `store.model` (live). `assistant` row via `Markdown`; reasoning → `chat-message collapsed`; tool calls → `tool-call` rows (✓/✗).
- [x] **P3.3** Subscribes via `useUiStore`; re-renders per dispatch; `useStdout` height for scroll.
- [ ] **P3.4** `test/ui/chat-pane.test.ts` deferred to P8 (renderToString smoke).

## Phase 4 — Findings pane (real upgrade)
- [x] **P4.1** `table`, `card`, `modal`, `code` installed.
- [x] **P4.2** `src/ui/findings-pane.tsx`: `Table` (severity, endpoint, type, status) from `store.findings`; `onSelect` → `Modal` with detail + `Code` block (payload/request).
- [ ] **P4.3** Wire `writeFinding` → `store.addFinding`: not yet connected (findings currently seeded via `addFinding` only in tests; need a callback seam in `writeFinding`/report). Deferred.
- [ ] **P4.4** `test/ui/findings-pane.test.ts` deferred to P8.

## Phase 5 — Spider + Tools panes
- [x] **P5.1** `tool-call`, `spinner`, `progress-bar`, `list`, `tree` installed.
- [x] **P5.2** `src/ui/spider-pane.tsx`: `ScrollView` → `tool-call` rows + `Spinner` (running) + `progress-bar` (endpoints/pages/findings) from `store.spider`/`spiderCounts`. Fed by `runSpider(sink)` → `UiActivity.setSpiderActivity`/`setSpiderCounts`.
- [x] **P5.3** `src/ui/tools-pane.tsx`: `List` of discovered tools + last result from `store.tools`.
- [ ] **P5.4** `test/ui/spider-pane.test.ts` deferred to P8.

## Phase 6 — Input bar + command palette + HITL
- [x] **P6.1** `text-input`, `command-palette`, `tool-approval` installed (no `text-area`/`confirm` needed).
- [x] **P6.2** `src/ui/input-bar.tsx`: `text-input` (goal) → `onSubmit` → `uiGoalEmitter.emit('goal', line)`, which `getLine` races into the existing REPL loop. Reuses all REPL command handling unchanged.
- [x] **P6.3** `command-palette` (Ctrl+K) over REPL commands — fuzzy search (termcn built-in).
- [x] **P6.4** HITL: `src/ui/approval.tsx` → `tool-approval` (risk badge low/med/high, args JSON, `[y]/[n]/[a]`, auto-deny timeout) bound to `store.approval`; `onApprove/onDeny/onAlwaysAllow` → `store.resolveApproval` (resolves the gate promise).
- [ ] **P6.5** `test/ui/approval.test.ts` deferred to P8.

## Phase 7 — Council / help / report on-screen
- [ ] **P7.1** `/council` output, `/help`, `/report` results render as typed cards/blocks in the store (via `chat-message`/`badge`/`alert`), not raw `log.*`.
- [ ] **P7.2** Retire `ChatBox` `LogSink` (`src/output/chatbox.ts`) in favor of the store. Keep `ChatStream` as `--plain`/`chat:false` fallback.
- [ ] **P7.3** `test/ui/council.test.ts`: a `/council` result added to store renders as a typed block.

## Phase 8 — Config + tests
- [ ] **P8.1** Reuse `InteractionConfig.chat?: boolean` (already added) as the Ink-enable flag; `--plain` disables Ink → legacy `ChatStream`.
- [ ] **P8.2** `test/ui/store.test.ts` (P0.8) + `app`/`chat-pane`/`findings-pane`/`spider-pane`/`approval`/`council` tests all green.
- [ ] **P8.3** Full suite green (pre-existing `context-manager.test.ts:213` fail tolerated). No regressions in solver/council/graph/evidence.

## Phase 9 — Build + verification
- [x] **P9.1** `npm run build:cli` clean (tsup compiles `.tsx`, ESM 1.57MB / CJS 1.60MB + DTS).
- [ ] **P9.2** `npx vitest run` green (store.test.ts 9/9; full suite pending P8 tests).
- [ ] **P9.3** Manual smoke: `npx ultimatrix interact -t <target>` shows a real full-screen console (top bar + tabs + 5 panes + input + palette + native approval), no bleeding, no duplication, no raw-stdout escapes. **Not yet done** — needs a TTY + live target.
- [ ] **P9.4** This doc updated; `chatbox-revamp.md` retired reference still valid (ChatBox retained as fallback).

---

## Status (2026-07-19)
- **P0–P6 core build COMPLETE**: store, Ink app, TopBar, custom TabBar, Chat/Findings/Spider/Tools/Status panes, InputBar + command palette, HITL approval overlay. Wired into `main()` with legacy `ChatBox`/`ChatStream` fallback (reversible). `build:cli` clean; `test/ui/store.test.ts` 9/9 green.
- **STDIN-OWNERSHIP ROOT-CAUSE FIX (2026-07-19) — COMPLETE**: the console was a non-interactive overlay because the legacy `readline` (bound to `process.stdin`, `lifecycle.ts`) owned stdin while Ink only painted. Fixed structurally:
  - **P1** `ui/main.tsx`: `render(<App/>, { alternateScreen: true, exitOnCtrlC: false, patchConsole: true })` — Ink owns the screen and raw stdin.
  - **P2** `lifecycle.ts`: in console mode `init({ consoleMode })` does NOT attach a readline to `process.stdin` (`readline: null`). `SessionResources.consoleMode` added; `startInfrastructure` guards the readline block.
  - **P3** `lifecycle.ts`: `runREPL` uses `getConsoleLine()` (emits-only via `uiGoalEmitter`, zero readline listeners) in console mode; `getLine(rl)` kept for non-console (reversible). Startup invariant: `consoleMode && rl !== null` throws.
  - **P4** `interaction-tools.ts` + `session.ts`: `askUser`/`askUserConfirm`/council `humanApprove` route free-text + approval through the Ink InputBar (`store.requestInput`/`requestApproval`) via `setConsoleInputResolver`. One input surface, routed by context. Council approval reuses the same `tool-approval` overlay (y/n/a).
  - **P5** `input-bar.tsx`: `TextInput autoFocus`; pending question rendered above input; submit resolves pending input instead of emitting a goal. `tab-bar.tsx`: keyboard nav via `Tab`/`Shift+Tab`/`Ctrl+←/→` (no plain arrows/digits, so text entry is never hijacked — Ink has no mouse).
  - **P6** `test/ui/console-input.test.ts` (6 tests): getConsoleLine resolves only from emitter with no readline listener; store requestInput/resolveInput round-trip; console resolver delegation; askUserConfirm boolean mapping; uiGoalEmitter vs uiInputEmitter channel separation. Build clean; UI/tools/council suites green (281/281).
- **Remaining before full verification**: P4.3 (writeFinding seam), P7 (council/help/report on-screen cards), P8 (pane renderToString tests), P9.3 (manual TTY smoke).
- **Key design decisions**: no `text-area`/`confirm` (unneeded); custom TabBar (termcn `tabs` raw-clears the screen — incompatible with Ink); **Ink is the single owner of `process.stdin` in console mode** — the legacy readline is detached (not patched), so there is exactly one input system (no bandaid proxy). Ink has no mouse support → keyboard-only TUI.


---

## Notes / non-bandaid fallbacks (termcn gaps)
- No `status-bar` → compose `Box` + `divider` + `badge`/`gauge` (TopBar).
- No `thinking`/`reasoning` → `chat-message` `collapsed` (native toggle).
- No `chart-bar`/`heatmap` → `gauge` (single metric) / `line-chart` (time-series); hand-roll bar with `Box`/`Text` + `theme.colors` only if ever needed.
- No `data-table` → use `table` (the real one).
- No `chat-message-list` → compose `scroll-view` + mapped `chat-message`.

## Exclusions
- `ultimatrix.yaml` EXCLUDED from every commit (`git add -- ':!ultimatrix.yaml'`).
