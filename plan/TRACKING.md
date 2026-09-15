# Implementation Tracking

## Overall Progress
- **Total Phases:** 7
- **Completed:** 2 (Phase 1, 4, 5 - partially)
- **In Progress:** Phase 2 (Chat Stream UX)
- **Pending:** Phase 3, 6, 7

---

## Phase Status

### Phase 1: Critical Fixes (Errors + Budget) ✅ COMPLETE
| Task | Status | Files |
|------|--------|-------|
| Per-turn budget guard | ✅ | `src/solver/turn-budget.ts` (new), `solver.ts` |
| Model-aware maxToolCalls/maxSteps | ✅ | `config.ts`, `solver.ts` |
| Friendly quota errors | ✅ | `middleware.ts`, `lifecycle.ts` |
| Budget warning at 80% | ✅ | `budget-store.ts`, `status-bar.tsx` |
| Model-aware limits in solver | ✅ | `solver.ts` |
| Friendly quota errors in middleware | ✅ | `middleware.ts` |
| Friendly quota errors in lifecycle | ✅ | `lifecycle.ts` |
| Budget warning at 80% | ✅ | `budget-store.ts`, `status-bar.tsx` |
| Turn router removed | ✅ | `turn-router.ts` (deleted) |
| Activation policy/observer | ✅ | `solver.ts` |

### Phase 2: Chat Stream UX Overhaul
| Task | Status | Files |
|------|--------|-------|
| Fix message jumping | 🔄 | `chat-stream.tsx` |
| Format tool calls (not raw JSON) | ⬜ | `tool-call-card.tsx` |
| Add message search (Ctrl+K) | ⬜ | `chat-stream.tsx` |
| Add progress indicators | ⬜ | `chat-stream.tsx` |
| Add message copy/export | ⬜ | `chat-stream.tsx` |
| Fix live answer preview flickering | ⬜ | `chat-stream.tsx` |
| Add streaming status indicators | ⬜ | `chat-stream.tsx` |
| Add message timestamps | ⬜ | `chat-stream.tsx` |
| Add tool call duration display | ⬜ | `tool-call-card.tsx` |
| Add message copy button | ⬜ | `chat-stream.tsx` |

### Phase 3: CLI UX Overhaul
| Task | Status | Files |
|------|--------|-------|
| Add command examples to help | ⬜ | `cli/index.ts` |
| Add `/help` in REPL | ⬜ | `session.ts` |
| Add history navigation (↑/↓) | ⬜ | `session.ts` |
| Add progress spinners | ⬜ | `cli/solve.ts`, `cli/scan.ts` |
| Add command completion hints | ⬜ | `cli/index.ts` |
| [ ] Friendly CLI errors | ⬜ | `cli/index.ts` |

### Phase 4: Model-Aware Limits & Budget (DONE)
| Task | Status | Files |
|------|--------|-------|
| ModelCapability extended | ✅ | `config.ts` |
| Default model capabilities | ✅ | `config.ts` |
| Solver uses model-aware limits | ✅ | `solver.ts` |
| CLI shows model limits | ✅ | `cli/models.ts` |
| `models limits <model>` command | ✅ | `cli/models.ts` |

### Phase 5: Budget & Quota UX (MOSTLY DONE)
| Task | Status | Files |
|------|--------|-------|
| Per-turn budget guard | ✅ | `turn-budget.ts`, `solver.ts` |
| Budget panel in Web UI | ⬜ | `budget-panel.tsx` (new) |
| Budget warning at 80% | ✅ | `budget-store.ts`, `status-bar.tsx` |
| Campaign pheromone scheduling | ✅ | `executor.ts` |
| Exploitation loop pheromones | ✅ | `exploitation-loop.ts` |
| Friendly quota errors | ✅ | `middleware.ts`, `lifecycle.ts` |

### Phase 6: Web UI Polish
| Task | Status | Files |
|------|--------|-------|
| Fix message jumping | ⬜ | `chat-stream.tsx` |
| Format tool calls | ⬜ | `tool-call-card.tsx` |
| Message search (Ctrl+K) | ⬜ | `chat-stream.tsx` |
| Progress indicators | ⬜ | `chat-stream.tsx` |
| Budget panel component | ⬜ | `budget-panel.tsx` (new) |
| Graph panel filtering | ⬜ | `graph-panel.tsx` |
| Session sidebar search | ⬜ | `session-sidebar.tsx` |
| Mobile responsive layout | ⬜ | `home-client.tsx`, `globals.css` |
| Settings validation feedback | ⬜ | `settings-modal.tsx` |
| Message copy/export | ⬜ | `chat-stream.tsx` |

### Phase 7: Error Handling & Recovery
| Task | Status | Files |
|------|--------|-------|
| Global error boundary | ⬜ | `error-boundary.tsx` (new) |
| Retry actions for failed ops | ⬜ | `chat-stream.tsx`, `api/*` |
| Offline detection & queue | ⬜ | `data-fetcher.ts` |
| Graceful degradation for quota | ⬜ | `middleware.ts` |
| "Report Issue" button | ⬜ | `chat-stream.tsx` |
| Global error boundary | ⬜ | `error-boundary.tsx` |

---

## Current Sprint Focus

### This Week: Phase 2 (Chat Stream UX)
1. Fix message jumping in chat stream
2. Format tool calls (not raw JSON)
3. Add message search (Ctrl+K)
4. Add progress indicators
5. Fix live answer preview flickering

### Next Week: Phase 3 + Phase 6
1. CLI UX overhaul
2. Web UI polish (budget panel, graph filtering, session search)

---

## Blockers / Questions

1. **Mobile support needed?** Currently desktop-only, but mobile layout broken
2. **Budget panel scope:** Simple status bar dropdown vs full panel?
3. **Chat search scope:** Text only, or filter by type (tool calls, findings, errors)?
4. **Mobile support needed?** Or desktop-only for now?

---

## Commands to Run

```bash
# Run tests
npm test

# Type check
npx tsc --noEmit

# Build
npm run build:cli

# Run specific test file
npx vitest run test/path/to/test.ts
```

---

## Commands Run History

```bash
# Recent commands run
npm test                    # All 2226 tests pass
npm run build:cli           # Clean build
npx tsc --noEmit            # TypeScript clean
npx vitest run test/...     # Specific test files
```

---

## Notes

- All 2226 tests currently passing
- TypeScript compiles clean
- Build produces ESM, CJS, DTS
- Phase 1 & 4 & 5 mostly complete
- Phase 2 (Chat UX) is next priority
- Phase 3 (CLI) and Phase 6 (Web UI) next