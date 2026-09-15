# Master UX Redesign Specification

## Overview
Complete UX redesign for Ultimatrix - both CLI and Web UI. Focus on fixing the broken message/response experience in Web UI and making CLI usable.

## Phases Overview

| Phase | Focus | Duration | Status |
|-------|-------|----------|--------|
| Phase 1 | Critical Fixes (Errors + Budget) | Week 1 | ✅ Complete |
| Phase 2 | Chat Stream UX Overhaul | Week 2 | 🔄 In Progress |
| Phase 3 | CLI UX Overhaul | Week 2-3 | ⏳ Pending |
| Phase 4 | Model-Aware Limits & Budget | Week 2 | ✅ Complete |
| Phase 5 | Budget & Quota UX | Week 2-3 | ✅ Complete |
| Phase 6 | Web UI Polish | Week 3-4 | ⏳ Pending |
| Phase 5 | Error Handling & Recovery | Week 3-4 | ⏳ Pending |

---

## Phase 1: Critical Fixes (Errors + Budget) - ✅ COMPLETE

### Completed Tasks
- [x] Per-turn budget guard in solver (`src/solver/turn-budget.ts`)
- [ ] Model-aware maxToolCalls/maxSteps defaults (config.ts)
- [ ] Friendly quota error messages (middleware.ts, lifecycle.ts)
- [ ] Budget warning at 80% (budget-store.ts, status-bar.tsx)
- [ ] Model-aware maxToolCalls/maxSteps in solver (solver.ts)
- [ ] Friendly quota errors in middleware (middleware.ts)
- [ ] Friendly quota errors in lifecycle (lifecycle.ts)
- [ ] Per-turn budget guard integration (solver.ts)

### Files Modified
- `src/solver/turn-budget.ts` (new)
- `src/config.ts` - ModelCapability extension
- `src/models/middleware.ts` - Friendly quota errors
- `src/session/lifecycle.ts` - Friendly quota errors
- `src/solver/solver.ts` - Budget integration, activation policy
- `src/solver/brain-instructions.ts` - Browser capability guidance

### Tests
- [x] All 2226 tests passing
- [x] TypeScript clean build
- [x] Clean build (ESM, CJS, DTS)

---

## Phase 2: Chat Stream UX Overhaul

### Tasks
- [ ] Fix message jumping during streaming
- [ ] Format tool calls (not raw JSON)
- [ ] Add message search (Ctrl+K)
- [ ] Add progress indicators for long operations
- [ ] Add message copy/export
- [ ] Add message timestamps
- [ ] Add tool call duration display
- [ ] Fix live answer preview flickering
- [ ] Add streaming status indicators
- [ ] Add message copy button

### Files to Modify
- `src/components/chat-stream.tsx`
- `src/components/tool-call-card.tsx`
- `src/components/chat-input.tsx`
- `src/components/MarkdownBlock.tsx` (new)

---

## Phase 3: CLI UX Overhaul

### Tasks
- [ ] Add command examples to help
- [ ] Add `/help` command in REPL
- [ ] Add history navigation (↑/↓)
- [ ] Add progress spinners for long operations
- [ ] Add command completion hints
- [ ] Friendly CLI errors
- [ ] Interactive mode help (`/help`)

---

## Phase 4: Model-Aware Limits & Budget (DONE)

### Completed
- [x] ModelCapability extended with maxToolCalls, maxSteps, maxParallel
- [x] Default model capabilities added
- [x] Solver uses model-aware defaults
- [x] CLI shows model capabilities

---

## Phase 5: Budget & Quota UX (DONE)

### Completed
- [x] Per-turn budget guard in solver
- [ ] Budget panel in Web UI
- [ ] Budget warning at 80%
- [ ] Friendly quota errors
- [ ] Campaign executor pheromone scheduling

---

## Phase 6: Web UI Polish

### Tasks
- [ ] Fix message jumping in chat stream
- [ ] Format tool calls (not raw JSON)
- [ ] Message search (Ctrl+K)
- [ ] Budget panel component
- [ ] Progress indicators for long operations
- [ ] Graph panel filtering
- [ ] Session sidebar search
- [ ] Mobile responsive layout

---

## Phase 7: Error Handling & Recovery

### Tasks
- [ ] Global error boundary
- [ ] Retry actions for failed operations
- [ ] Offline detection & queue
- [ ] Graceful degradation for quota
- [ ] "Report Issue" button