# Web UI Gap Closure Plan

## Phase 0 — Foundation (blocks everything else)

| # | Task | Files | Effort |
|---|------|-------|--------|
| 0.1 | **Smart `updateConfig()`** — skip stop/init when only `target` changes. Just update `this.config.target` in memory. Full reinit only on provider/model/creds/headless/timeout change. | `src/lib/agent-manager.ts:89-97` | S |
| 0.2 | **Create `ToolEventEmitter`** — singleton EventEmitter that AgentManager pushes tool calls/results/errors/reasoning to. SSE stream subscribes to it. | `src/lib/tool-events.ts` (new) | M |
| 0.3 | **Wire AgentManager → event emitter** — push events from `chat()`, `init()`, browser state, OAST status. | `src/lib/agent-manager.ts`, `src/manager/agent.ts` | M |
| 0.4 | **Wire `/api/activity` SSE → ToolEventEmitter** — replace stub ReadableStream with real subscription that pushes events as SSE data frames. | `src/app/api/activity/route.ts` | M |

## Phase 1 — Core UX Feedback Loops

| # | Task | Files | Effort |
|---|------|-------|--------|
| 1.1 | **Add `browserReady`, `oastPort`, `status` fields to `/api/status`** — expose detailed agent lifecycle state instead of just `initialized: bool`. | `src/app/api/status/route.ts` | XS |
| 1.2 | **Add init loading state to Chat panel** — show "Starting browser..." / "Launching OAST server..." / "Initializing agent..." progress messages between config save and first streaming response. Poll `/api/status` at 1s interval during init. | `src/components/chat.tsx` | S |
| 1.3 | **Auto-refresh Findings panel** — poll `/api/findings` every 3s while agent is running, or push via activity SSE event with `type: 'finding-update'`. Add count badge to sidebar nav icon. | `src/components/findings-panel.tsx`, `src/app/page.tsx` | S |
| 1.4 | **Auto-refresh Code panel** — same polling/push pattern for `/api/code`. Show snippet count in sidebar. | `src/components/code-panel.tsx` | S |
| 1.5 | **Human-friendly tool display in chat** — replace raw `{toolName} — {state}` with descriptive messages. Map `stagehand_navigate` → "Navigating to {url}...", `injectInContext` → "Injecting SQLi payload at {endpoint}...". | `src/components/chat.tsx` | S |
| 1.6 | **Fix sidebar icons** — Findings gets `Bug` (✓), Chat gets `MessageSquare`, Code gets `FileCode`. No duplicates. | `src/app/page.tsx` | XS |
| 1.7 | **Faster status bar polling** — change `/api/status` poll from 30s to 3s. Add `browserReady` and `oastPort` display. | `src/components/status-bar.tsx` | XS |

## Phase 2 — Error Handling & Recovery

| # | Task | Files | Effort |
|---|------|-------|--------|
| 2.1 | **Error recovery in Chat** — after `useChat` error state, show "Restart Agent" button that calls `fetch('/api/config', {method:'POST', body: JSON.stringify({...})})` to re-init. Also "Clear Messages" button. | `src/components/chat.tsx` | S |
| 2.2 | **Confirmation dialog before destructive actions** — "Save & Re-initialize" in settings shows a dialog if a scan is active (check `isLoading` from parent or `/api/status`). Use shadcn `Dialog` + `AlertDialog`. | `src/components/settings-panel.tsx`, new `ui/alert-dialog.tsx` | M |
| 2.3 | **Guard against rapid concurrent agent streams** — disable quick-action buttons and send-input while `isLoading`. Only one agent stream at a time. | `src/components/chat.tsx` | XS |

## Phase 3 — Findings & Code Deep Dive

| # | Task | Files | Effort |
|---|------|-------|--------|
| 3.1 | **Findings detail view** — click a finding card → expand to full view with: all evidence lines, full HTTP request/response if available, confidence score, related attack chain, repro curl command. Use shadcn `Sheet` (slide-out) or inline expansion. | `src/components/findings-panel.tsx`, new `src/components/finding-detail.tsx` | L |
| 3.2 | **Technique filter in Findings** — add filter pills for technique type alongside severity. Extract unique techniques from findings data. | `src/components/findings-panel.tsx` | S |
| 3.3 | **Findings severity badge in sidebar** — red badge with critical+high count, gray badge with total count. | `src/app/page.tsx` | XS |
| 3.4 | **Code panel — syntax highlighting** — add basic syntax highlighting for Playwright TypeScript code in `<pre>` blocks. Use `prismjs` or `highlight.js` or simple CSS token coloring. | `src/components/code-panel.tsx` | S |

## Phase 4 — Persistence & Session

| # | Task | Files | Effort |
|---|------|-------|--------|
| 4.1 | **Fix thread continuity** — generate stable `threadId` per session (stored in localStorage), pass to `/api/chat`. Agent memory persists across messages within a session. | `src/components/chat.tsx`, `src/app/api/chat/route.ts` | S |
| 4.2 | **Persist messages to localStorage** — save last N messages IDs/content to survive page refresh. Rehydrate on mount. | `src/components/chat.tsx` | S |
| 4.3 | **Findings export** — JSON download button (`data:text/json` blob) and basic HTML report generation. | `src/components/findings-panel.tsx` | S |
| 4.4 | **Code export** — download generated Playwright test as `.spec.ts` file. | `src/components/code-panel.tsx` | XS |

## Phase 5 — Polish & Quality of Life

| # | Task | Files | Effort |
|---|------|-------|--------|
| 5.1 | **Tooltips on quick action cards** — add `title` attribute or Radix `Tooltip` showing the exact prompt that will be sent. | `src/components/chat.tsx`, new `ui/tooltip.tsx` | S |
| 5.2 | **Keyboard shortcuts** — Ctrl+Enter to send, Escape to stop streaming, Ctrl+K to focus target URL, Ctrl+, for settings. | `src/components/chat.tsx`, `src/app/page.tsx` | M |
| 5.3 | **Dark/light mode toggle** — `next-themes` + `ThemeProvider` + toggle button in status bar. Lighten all card/muted colors for light mode. | `src/app/layout.tsx`, `src/app/providers.tsx` (new), `src/components/status-bar.tsx` | M |
| 5.4 | **Target URL deduplication** — keep target URL input only in chat header. Remove it from settings panel (settings shows it as read-only display). Single source of truth. | `src/components/settings-panel.tsx`, `src/components/chat.tsx` | XS |

## Phase 6 — Strategic/Advanced

| # | Task | Files | Effort |
|---|------|-------|--------|
| 6.1 | **First-run onboarding wizard** — detect no creds configured → show multi-step dialog: (1) Welcome, (2) Pick provider + enter key, (3) Set target, (4) Run first scan. Dismissible. | `src/components/onboarding.tsx` (new), `src/app/page.tsx` | L |
| 6.2 | **Scan history** — persist completed scan summaries to `ultimatrix.yaml` or SQLite. Show history sidebar with timestamp, target, finding counts per severity. Click to restore. | `src/lib/scan-history.ts` (new), new `src/components/history-panel.tsx` | XL |
| 6.3 | **Report generation** — HTML report with executive summary, finding breakdown by severity, evidence snippets, timeline. Download button. | `src/lib/report-generator.ts` (new) | L |

---

## Effort Key
- **XS** — <10 lines changed, no new files
- **S** — single file, <50 lines
- **M** — 1-3 files, some new logic
- **L** — multi-file, new components, moderate complexity
- **XL** — new subsystem, several files

## Priority Recommendation

```
Phase 0 (foundation) → Phase 1 (feedback) → Phase 2 (errors) → Phase 3 (findings) → Phase 4 (persistence) → Phase 5 (polish)
```

Within Phase 0: **0.1 → 0.2 → 0.3 → 0.4** (strict order — each depends on previous).

Within Phase 1: **1.1 + 1.6 + 1.7 in parallel** → **1.2 + 1.3 + 1.4 + 1.5 in parallel**.

After Phase 1 completion, the product goes from "feels like a prototype" to "feels like a real tool" — users see agent actions streaming live, findings auto-populate, and chat shows readable status.
