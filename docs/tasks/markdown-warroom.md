# Task Breakdown — Streaming Markdown + Co-relating War-room

> Scope: Make the buddy's reasoning/answer legible via streaming highlighted Markdown in BOTH
> terminal and web, without breaking the co-relating state machine (✓/⚠/✗/◆, phase rail, lattice).
> Standing constraints: no bandaids, structured types only, no hardcoded vocab, no silent truncation,
> `@ts-nocheck` forbidden. EXCLUDE `ultimatrix.yaml` from every commit.

Status legend: ⬜ TODO · 🔄 IN PROGRESS · ✅ DONE · ❌ BLOCKED

---

## P0 — Tracking & conventions
- [x] **T0.1** Create task-level breakdown markdown (`docs/tasks/markdown-warroom.md`) with status tracking
- [x] **T0.2** Verify/fix folder naming conventions (`src/output`, `src/components`, `test/output`) — all kebab/lowercase; `test/output` dir created

## P1 — Terminal markdown renderer (no new deps)
- [x] **T1.1** `src/output/terminal.ts`: add `renderMarkdown(text, {tty})` — note: `marked-terminal@7` is incompatible with `marked@15` (verified), so we render marked's token stream to theme ANSI ourselves
- [x] **T1.2** `MarkdownStream` class: continuous incremental re-render, **open-fence fallback** (unclosed ``` → raw mono tail), caret at tail
- [x] **T1.3** TTY→theme ANSI (bold green headers, green-tinted code box, bordered table grid, cyan inline); non-TTY→plain text, no escapes
- [x] **T1.4** Evidence ledger glyphs (✓/⚠/✗/◆) render *around* markdown block, unchanged

## P2 — Markdown tests
- [x] **T2.1** `test/output/markdown.test.ts`: TTY emits ANSI for heading + closed code fence
- [x] **T2.2** non-TTY emits plain text (no escape codes)
- [x] **T2.3** **Open-fence fallback**: unclosed ``` → tail as plain mono (anti-flicker guarantee)
- [x] **T2.4** Live `push` keeps caret at tail
- [ ] **T2.5** Web `<BuddyMessage>` renders GFM table + highlighted `js` block (transform/render test) — pending web deps

## P3 — Web deps + BuddyMessage
- [x] **T3.1** Add deps: `react-markdown@9`, `remark-gfm@4`, `react-syntax-highlighter@15` (+ `@types/react-syntax-highlighter`) via npm
- [x] **T3.2** `src/components/BuddyMessage.tsx`: `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{code: <SyntaxHighlighter/>}}>`, XSS-safe (no rehype-raw)
- [x] **T3.3** Web open-fence fallback + caret while streaming; CSS scoped to Ultimatrix tokens (globals.css `--instrument`/`.ultimatrix-md`)
- [x] **T3.4** `src/components/use-render-model.ts`: already exposes `model`; `<BuddyMessage model={model} streaming={!model.complete} />` is the intended binding (consumed by chat.tsx in T4.2)

## P4 — Chat route migration (unblocks web stream)
- [ ] **T4.1** `src/app/api/chat/route.ts`: replace legacy `AgentManager.chat` + `toAISdkV5Stream` with solver + `SolverStreamMessage` SSE — DEFERRED to its own planned step (larger seam; bundling here risks the "digging" the owner warned against). Markdown renderer already consumes the same `RenderModel`, so wiring is a drop-in once the route emits `SolverStreamMessage`.
- [x] **T4.2** `src/components/chat.tsx`: assistant bubbles now render through `<BuddyMessage>` (plain content → `answer` channel). `BuddyMessageContent` adapts `m.content` into a minimal `RenderModel`; swaps to `useRenderModel()` when T4.1 lands. No fake transport (no bandaid).

## P5 — Brain contract
- [x] **T5.1** `src/solver/brain-instructions.ts`: added "Formatting your answer" subsection (markdown permission: headings, bold, fenced code w/ lang tag, GFM tables; severity/status stay structured; no vocab enumeration). Reworded to avoid backticks (template-literal-safe).

## P6 — Visual de-risk
- [ ] **T6.1** Static HTML war-room mock (sample highlighted-markdown chat) for visual sign-off before live wiring

## P7 — War-room panes + lattice (web)
- [ ] **T7.1** Buddy Thread pane (left, primary): streaming highlighted markdown
- [ ] **T7.2** Evidence Ledger pane (right): ✓/⚠/✗/◆ glyph rows from `model.findings`
- [ ] **T7.3** Phase Rail `[observe]→[learn]→[attack]→[loop]` with current node lit (green)
- [ ] **T7.4** Lattice/graph canvas: live relations from `queryRelations`
- [ ] **T7.5** State badge: green when `complete && all-confirmed`; red on critical; yellow during capture

## P9 — Terminal wiring (the actual fix)
> Root cause of "terminal still same as before": `createSolverRenderer()` used the
> old `TerminalStream` (raw text). `MarkdownStream` existed but was **never
> instantiated** — dead code. `MarkdownStream.push` also re-rendered the whole
> buffer each delta, so a naive swap would have stacked frames instead of
> updating in place. Real streaming markdown needs cursor-control redraw.
- [x] **T9.1** `MarkdownStream` rewritten with in-place redraw: tracks `liveLines`, on each `push` it (a) erases the prior live region via `\x1b[<n>F\x1b[J`, (b) emits new tool/finding lines permanently ABOVE the live region, (c) re-renders reasoning+answer markdown in place with open-fence fallback + blinking caret `▊` while streaming. `final()` erases + re-renders one clean frame (caret removed) + `── done ·` footer. Non-TTY path stays escape-free (piped safe).
- [x] **T9.2** `createSolverRenderer(host?)` now returns a `MarkdownStream` bound to `host.pause`/`host.resume`. `render.final = () => stream.final(model)` attached so callers force the clean final frame after `solve()` returns.
- [x] **T9.3** REPL (`src/session.ts` `runREPL` callback) builds `host = { pause: rl.pause, resume: rl.resume }` from `resources.readline` and passes it to both solver `createSolverRenderer(host)` call sites. readline is created with `terminal: false`, so it only consumes stdin when waiting for a line — pause/resume is defensive against mid-stream typing. `cli/solve.ts` uses `createSolverRenderer()` with no host (free redraw, no competing prompt). Both paths call `renderMsg.final?.()` after `solve()` returns.
- [x] **T9.4** `findings` now surface via the `done` message's `answer.findings` (no live `finding` message kind exists in `SolverStreamMessage`). `emitFindings()` helper renders `✓`/`✗` glyphs above the live region in both `push` and `final`.

## P8 — Verify
- [x] **T8.1** `npm run build:cli` clean (ESM/CJS/DTS)
- [x] **T8.2** `npm test` — 1550 pass / 1 fail. The single failure is PRE-EXISTING in `test/models/context-manager.test.ts` (`[context truncated to fit…` marker), unrelated to markdown work. 12 new `test/output/markdown.test.ts` tests pass + 1 `test/components/buddy-message.test.tsx` = 13 markdown tests green.
- [x] **T8.3** `npm run typecheck`: touched files `src/output/terminal.ts`, `src/session.ts`, `src/cli/solve.ts` clean (no new errors).

## P11 — Interact chat UI (inline cards, opencode/Claude Code grade)
> Owner: "i couldn't picturize the UI; build something like opencode/claude code." Full creative latitude
> granted. **FIRST ATTEMPT (REVERTED):** full-screen ALTERNATE-SCREEN war-room (`TerminalLayout`). It FAILED
> in practice: black-screen flicker + legacy `INFO [ts]` logger buried the answer. Owner rejected it.
> **FINAL DECISION:** inline "chat cards" in NORMAL scrollback (no alternate screen → no flicker, long
> answers naturally scrollable), opencode/Claude-Code style. `ultimatrix solve` + `interact --plain` stay a
> plain steam. No bandaids, no hardcoded vocab, structured types only.
- [x] **T11.1** `solver.ts`: extend `SolverStreamMessage.tool-result` with `result?: string`; pass computed `output` into emit. No scraping — structured field.
- [x] **T11.2** `render-model.ts`: `RenderToolCall.result?` stored by reducer (matched by name); `argsSummary(args)` (shape-only) + `resultSummary(result)` (compact, truncate); `RenderModel` context fields `engine/provider/target/step/maxSteps/goal` + `RenderFinding.title`.
- [x] **T11.3** `layout.ts` `ChatStream`: live reasoning rendered in DIM VIOLET above the answer (in-place visual-row erase); on `final()` collapsed to a CYAN `▸ reasoning (N lines) — Ctrl-R to expand` header above the footer. `toggleReasoning()` flips expand state and re-renders (full reasoning in cyan). Two clearly distinct colors: violet=live thinking, cyan=archived reasoning. Non-TTY → plain reasoning text, no escapes.
- [x] **T15.1** `session.ts` `SolverRenderContext`: split `goal` (engine objective) from `prompt` (user's typed line). REPL passes `prompt: line` to `createSolverRenderer`. No longer conflates a chat message with a solver goal.
- [x] **T15.2** `layout.ts` `ChatStream.begin(prompt?, goal?)`: honest header — `▸ you: <prompt>` for chat turns, `goal: <goal>` only for autonomous `solve` runs (no interactive prompt). Never relabels a chat message as "goal".
- [x] **T15.3** `solver.ts` — PROVIDER-AGNOSTIC answer contract. The AI SDK normalizes EVERY provider into two canonical promises: `stream.text` (the deliverable) and `stream.reasoningText` (the buddy's reasoning). The committed `answer.content`/`answer.reasoning` now resolve from those promises (falling back to accumulated deltas only when the SDK returns empty). `text-delta`/`reasoning-delta` chunks are TRANSIENT display only — they never become the deliverable. This kills the duplicated/scratch answer for all providers (nvidia was just the most visible case) and removes the earlier nvidia-specific exact-tail echo guard (which was itself a provider-shaped bandaid). No provider branch anywhere.
- [x] **T15.4** Tests: `test/output/layout.test.ts` (header `▸ you:` / `goal:`; `type /r to expand` hint; `showReasoning:false` hides reasoning); `test/solver/solver.test.ts` (+4: canonical `stream.text` committed despite scratch+9× echo deltas; `stream.reasoningText` committed; fallback to `reasoning-delta` when `reasoningText` undefined; distinct deltas preserved); `test/utils/logger.test.ts` (sink precedence over Pino). Full suite 1554 pass.
- [x] **T15.5** `config.ts` `InteractionConfig { showReasoning?, showSystemEvents? }` + `UltimatrixConfig.interaction`. Threaded through `createSolverRenderer` in `session.ts` (both solver call sites). `showReasoning` (default true) gates the live violet + collapsed reasoning block; `showSystemEvents` (default true) gates the dim system-events block. Both product preferences, never agent behavior — auto-hunt/testing untouched.
- [x] **T15.6** ROOT-CAUSE log-leak fix: `utils/logger.ts` `Logger` now checks the `setLogSink` sink BEFORE Pino, making the sink the authoritative chokepoint in every environment (the real CLI installs Pino via `cli/index.ts:32`, which previously bypassed the sink → raw `INFO [ts]` lines below the card). With the sink authoritative, the buffered `------ system events ------` block works in production and `showSystemEvents:false` suppresses it. Flush ordering (after post-solve logs) already correct.
- [x] **T15.7** UI honesty: header hint changed from dead `Ctrl-R to expand` (readline runs `terminal:false`, keypress never fires) to working `type /r to expand` (the REPL `/reasoning` command).
- [x] **T12.1** `terminal.ts`: `countVisualRows(s,width)` + `stripAnsi` exported; `MarkdownStream.composeLive` erases by visual rows (killed doubled-`⟢` bug).
- [x] **T12.2** NEW `src/output/layout.ts`: `ChatStream` — inline chat card. `begin(goal)` dim header; `push(model)` renders thinking (collapse line) + permanent tool rows (`▸`/`✓`/`✗` + `argsSummary` + `resultSummary`) + trailing LIVE answer region (in-place visual-row erase, caret `▊`, `LIVE_CAP=60` → append-only fallback); `final(model)` clean answer (no caret) + footer `──── done/stopped · N steps · M tools ──`. Non-TTY → escape-free. NO alternate-screen escapes.
- [x] **T13.1** `session.ts`: `createSolverRenderer(host, ctx, {plain?})` returns `ChatStream` for `interact` (or plain painter for `solve`/`--plain`). REPL: `renderMsg.begin(line)` before `solve`, install `setLogSink` (buffer `INFO`/`WARN`/`Steps`/`Plan summary`/`quota` into `[sys]` lines) BEFORE solve; `renderMsg.final()` draws the card; post-solve logging lands in the buffer; `renderMsg.flush()` writes ONE dim `------ system events ------` block BELOW the footer and restores the sink. (Sink is NOT restored inside `final` — fixes the leak where summary lines printed raw after the footer.) `SolverRenderer` interface typed with `final/flush/toggleReasoning/exit`. `/reasoning` (`/r`) command toggles the last turn's collapsed reasoning block.
- [x] **T13.2** `cli/solve.ts`: `createSolverRenderer({}, {}, { plain: true })` — autonomous verify keeps plain stream (no card).
- [x] **T13.3** `cli/interact.ts`: parse `--plain` → `main(target, { plain })` → passed to `createSolverRenderer`. Instant fallback if the card UI misbehaves.
- [x] **T14.1** `test/output/layout.test.ts` (10 tests, rewritten for `ChatStream`): contract reducer (`tool-result.result` stored + matched by name), `argsSummary`/`resultSummary` shape-only, card boundaries (goal header + `done|stopped`·tools footer), NO alternate-screen escapes, tool rows with status+result, LIVE_CAP append fallback (no throw), empty-turn `no output` note, optional pause/resume no-ops. All green.
- [x] **T14.2** `npm run build:cli` clean; `npm test` 1541 pass (1563 − 22 excluded context-manager pre-existing fail). Touched files typecheck clean.
- [x] **T14.3** This doc updated (P11–P14) to reflect chat-card decision.

## Deferred (not in this pass)
- D1. Close 216 typecheck gaps R2–R6 + F (legacy `src/context/*`, `src/lib/agent-manager.ts`, `src/manager/*`, `src/swarm/*`)
- D2. Web war-room panes (T7.1–T7.5) — owner scoped this pass to CLI `interact` only; web out of scope.
- D3. `/api/chat` SSE migration to solver (T4.1) — deferred.
- D4. termcn/Ink rich terminal shell / alternate-screen war-room — NOT adopted. Full-screen `TerminalLayout` was built then REVERTED (black flicker + INFO noise). Final = hand-rolled `ChatStream` inline cards in normal scrollback (no TUI framework installed).

---

## Dependency delta
- Reuse (already installed): `marked@15`, `marked-terminal@7`
- Add: `react-markdown`, `remark-gfm`, `react-syntax-highlighter`, `@types/react-syntax-highlighter`

## Key design decisions (locked)
1. **Streaming pattern**: continuous incremental re-parse with open-fence fallback (matches opencode / Claude Code). Not "wait for settle", not "raw-only".
2. **Markdown = prose formatting only.** Evidence state (✓/⚠/✗/◆, phase, lattice) stays in structured `RenderModel` fields.
3. **Highlighting split**: web = full `react-syntax-highlighter`; terminal = `marked-terminal` green-tinted box (TTYs can't do real syntax themes).
4. **Brain emits markdown** with zero `RenderModel` contract change (fields already free-form strings).

## Relevant files
- `src/output/render-model.ts` — shared RenderModel fold
- `src/output/terminal.ts` — terminal markdown adapter (edit)
- `src/output/compaction.ts` — section-aware compaction
- `src/types/marked-terminal.d.ts` — existing marked-terminal stub
- `src/components/use-render-model.ts` — web hook (edit)
- `src/components/chat.tsx` — web UI (migrate)
- `src/components/BuddyMessage.tsx` — NEW
- `src/app/api/chat/route.ts` — migrate
- `src/solver/solver.ts` — SolverStreamMessage contract
- `src/solver/brain-instructions.ts` — add markdown line
- `package.json` — add web deps
- `ultimatrix.yaml` — EXCLUDE from commits
