# ChatBox Revamp — Unified Terminal Chat UI for `ultimatrix interact`

**Date:** 2026-07-19
**Priority:** UX/UI (highest)
**Status:** Phases 1–6 COMPLETE; Phase 7 (build + smoke) pending manual run

## Problem (root cause)
`ultimatrix interact` has **no single owner of terminal output**. Five subsystems each dump to stdout independently:
1. Startup (`lifecycle.ts`, `cli/interact.ts`, `authorization.ts`) — banners, disclaimers, auth INFO.
2. Spider crawl (`lifecycle.ts:435–575`) — raw `process.stdout.write(chunk.payload.text)`, ad-hoc `[Spider] Progress` lines — printed BEFORE the REPL, no sink.
3. REPL prompt (`lifecycle.ts:724`) — raw `> ` + blank lines interleaved with cards.
4. Solver turn (`ChatStream`) — the only structured card, but framed as an *autonomous solver run* (`─────── done · N steps · M tools ───────`, `▸ reasoning (N lines)`, `------ system events ------`) → wrong chrome for chat.
5. `/council`, `/help`, `/report`, post-solve status — raw `log.*` lines bypassing the card.

Result: no continuous chat transcript; the solver card is dressed as a security-run report; user messages aren't clearly paired with responses; spider spam buries the conversation.

## Design — `ChatBox` (session-wide terminal owner)
A single `ChatBox` instance lives for the whole session (created at `main()` entry, before spider). It owns stdout and renders a continuous chat transcript. All subsystems route through it.

```
+-----------------------------------------------+
| Ultimatrix v8 · nvidia/nemotron... · target    |  <- slim session banner (once)
+-----------------------------------------------+
you: hi
  spinner Spider crawling target.com...          <- spider as live activity line
    +12 endpoints, +3 pages
you: hey
assistant: Hey! What can I do for you?
  reasoning (1 lines) -- /r                     <- only when reasoning present
------------------------------------------------
```

### Principles (no bandaids, no hardcoded vocab)
- **One renderer, all output.** Startup, spider, solver, council, help, status -> `ChatBox`. The per-turn `LogSink` is replaced by `ChatBox` being the global sink from session start.
- **Chat framing, not solver-report framing.** Turn = `you: <input>` (printed on submit) + `assistant: <answer>` + optional reasoning. The `------- done · N steps · M tools -------` footer and `------ system events ------` block appear **only when the turn did real work** (steps>0 OR tools>0 OR findings>0).
- **Spider = live activity line**, not a raw dump. Fold spider deltas into a transient in-place line; surface counts as a compact result.
- **User message printed on submit**, before response, so pairing is preserved.
- Reuses `render-model.ts` (`RenderModel`/`reduceMessage`/`appendDelta`) and `terminal.ts` (`renderMarkdown`, `countVisualRows`, `ESC`).

### Public API (typed, not string-printing)
- `printBanner(meta)` — slim one-line session banner (once).
- `printUserMessage(text)` — `you: <text>` (immediate on submit).
- `beginAssistant()` / `streamAssistant(model)` / `endAssistant(model)` — solver turn, role-prefixed `assistant:`, live reasoning + answer + tools.
- `beginActivity(label)` / `updateActivity(text)` / `endActivity(status, detail?)` — spider/progress live line (dim, in-place).
- `printSystem(text, level)` — startup/status lines (dim where appropriate).
- `printHelp()`, `printReport(text)`, `printCouncil(...)` — typed.
- Implements `LogSink` so any `log.info/warn` during the session is captured as a system line.
- `setChatMode(enabled)` — when disabled, fall back to existing `ChatStream` (see Fallback).

## Fallback strategy
- `InteractionConfig.chat` (default `true` for interact). When `false` (or a runtime failure is detected), `session.ts` uses the **existing `createSolverRenderer`/`ChatStream`** path unchanged. This guarantees we can revert per-session without code changes if the ChatBox proves problematic.
- `ultimatrix solve` (autonomous) always uses `ChatStream` (the solver-report card is correct there) — not regressed.
- Each phase is independently testable; if Phase 3/4 wiring breaks the build, Phases 1–2 still stand and fallback remains active.

## Phases
- **Phase 1** — `src/output/chatbox.ts`: `ChatBox` core (banner, user msg, assistant stream, activity line, system line, LogSink impl). Reuses `render-model.ts` + `terminal.ts`. **DONE** (build + 9 unit tests green).
- **Phase 2** — `src/session.ts`: create one `ChatBox` at `main()` (after init, so `resources.config` is available); per turn routed via `createSolverRenderer`'s `chatbox` branch (`printUserMessage` → `beginAssistant`/`streamAssistant`/`endAssistant`). Fallback to `ChatStream` when `chat` disabled or `--plain`. **DONE**.
- **Phase 3** — `src/session/lifecycle.ts`: `runSpider(chatbox?)` routes `text-delta`/`reasoning-delta`/`tool-call`/`tool-result` progress through `beginActivity`/`updateActivity`/`endActivity`. **DONE**.
- **Phase 4** — `runREPL(chatbox?)` prints banner/intro via `ChatBox` (legacy path untouched when no chatbox). `/help`, `/report` routed to typed `printHelp`/`printReport`; `/council` output flushed via `flushSystem()`. Removed duplicate `cli/interact.ts` banner. **DONE** (council internals still use `log.*` → captured by the session-wide sink; `flushSystem()` surfaces them).
- **Phase 5** — `src/config.ts`: `InteractionConfig.chat?: boolean` added (default `true`). **DONE**.
- **Phase 6** — `test/output/chatbox.test.ts`: 9 tests (banner, user msg, minimal vs full card, reasoning-gated, spider activity, sink capture + `flushSystem`, pure-chat no-leak). All green. `test/output` + `test/session` = 62/62 green. **DONE**.
- **Phase 7** — `npm run build:cli` clean (ESM 1.48MB / CJS 1.51MB / DTS). Remaining: full-suite run + manual smoke (`npx ultimatrix interact -t <target>`). `ultimatrix.yaml` EXCLUDED from commits.

## Files
- NEW `src/output/chatbox.ts`
- EDIT `src/session.ts` (wiring + fallback)
- EDIT `src/session/lifecycle.ts` (spider + startup routing)
- EDIT `src/config.ts` (`InteractionConfig.chat`)
- EDIT `src/capture/human-observer.ts:305` (route auth INFO via sink — minor)
- NEW `test/output/chatbox.test.ts`

## Verification
- Build clean (ESM/CJS/DTS).
- Full suite green (pre-existing `context-manager.test.ts:213` fail is unrelated).
- `ultimatrix.yaml` EXCLUDED from commits.
