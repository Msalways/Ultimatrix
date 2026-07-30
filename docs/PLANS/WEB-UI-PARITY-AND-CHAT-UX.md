# Web UI Parity + Chat UX Overhaul — Task-Level Plan

**Date:** 2026-07-29
**Author:** opencode
**Status:** PLANNING

---

## Scope

Three work streams executed in dependency order:

| Stream | What | Gaps addressed |
|--------|------|----------------|
| **A. WebEngine Parity** | Bring browser, spider, memory, scope, OAST, HAR, observer to WebEngine | G1-G16 |
| **B. Chat UX** | Fix thinking, markdown, streaming, worker cards, loading states, progress | B1-B6 + UX1-UX6 |
| **C. Error Handling** | `_running` stuck, abort signal, concurrent send, client disconnect | C1-C4 |

---

## Design Decisions (Locked)

| Decision | Choice |
|----------|--------|
| Spider timing | Runs on first `solve()` call, not on `init()` — faster init |
| Browser visibility | Follows `config.browser.headless` — user-configurable from settings |
| OAST server | Started in web mode (same as CLI) |
| Spider stream prompt | NOT hardcoded — derived from `spiderInstructions` module |
| Tool elapsed time | Ticks live via interval during tool execution |
| Spider progress | Inline card in message stream (scrolls with conversation) |
| Approach | Call existing standalone functions — zero copy-paste from lifecycle |

---

## Hard Rules (from architectural-no-bandaids)

1. **No hardcoded substring detection** — structured typed fields only
2. **No hardcoded enumerations in descriptions** — live schema discovery
3. **No bandaids** — fix design not symptom
4. **No regex/keyword detection** — relation-native reasoning only
5. **All imports verified** — every function referenced exists at the stated path

---

## Stream A: WebEngine Parity

### A1. Extract shared engine setup

**New file:** `src/session/engine-setup.ts`
**Depends on:** Nothing (pure refactor)

Extract lines 636-738 from `src/session/lifecycle.ts` `setupEngine()` into a standalone function:

```typescript
export interface EngineServices {
  skillRegistry: SkillRegistry
  workerPool: WorkerPool
  solverBrain: any
  council?: any
  modelSelector?: ModelSelector
  blackboard: Blackboard
  evidence: EvidenceGate
  loopDetector: LoopDetector
  reflexion?: ReflexionEngine
  sessionEvidence: EvidenceGate
}

export async function createEngineServices(
  config: UltimatrixConfig,
  browser?: StagehandBrowser,
  memory?: MastraMemory,
  harContext?: string,
): Promise<EngineServices>
```

**Body** = same 110 lines from `setupEngine()`:
- Model capability check via `checkModelCapability()` (from `src/models/capability.ts`)
- `new Blackboard()`, `new EvidenceGate()`, `new LoopDetector()`, `new ReflexionEngine()`
- `new SkillRegistry()` + `loadFromDirectory('skills')`
- `new WorkerPool(config, skillRegistry, browser)` — browser passed as 3rd arg
- `createSolverBrain(config, { skillRegistry, workerPool, browser, memory, extraContext })` (from `src/solver/brain-tools.ts`)
- `createCouncil(config, { skillRegistry, workerPool, browser }, blackboard)` (from `src/council/factory.ts`)
- `new ModelSelector(...)` (from `src/models/selector.ts`)

**Modify:** `src/session/lifecycle.ts` `setupEngine()` — call `createEngineServices()` and assign results to `this._resources`. Zero behavior change for CLI.

**Verify:** `npm test` passes, `npm run build:cli` clean.

---

### A2. Rewrite `src/web/engine.ts`

**Depends on:** A1

**New imports (all verified to exist):**

```typescript
import { getOrCreateBrowser, closeBrowser, getActivePage } from '../browser/manager'
import { startDialogWatcher, stopDialogWatcher } from '../browser/dialog-watcher'
import { startOastServer, stopOastServer, setOastConfig } from '../oast/server'
import { setScopeConfig, deriveScopeFromTarget } from '../safety/scope-guard'
import { getGlobalObserver } from '../capture/human-observer'
import { createSpiderAgent } from '../spider/agent'
import { bridgeHARToGraph } from '../analysis/har-bridge'
import { attachHarCaptureViaCdp } from '../session/cdp-network-capture'
import { createMemoryStore, createMemory } from '../workers/registry'
import { createEngineServices, type EngineServices } from '../session/engine-setup'
import { checkModelCapability } from '../models/capability'
import { finalizeEngagementMemory } from '../intelligence/cross-engagement'
import { buildSpiderPrompt } from '../spider/instructions'
```

**New fields on `WebEngine`:**

```typescript
private browser?: StagehandBrowser
private memory?: MastraMemory
private services?: EngineServices
private harContext?: string
private threadId?: string
private resourceId = 'ultimatrix'
private _spiderRan = false
private oastPort = 0
```

**A2.1 — `init()` rewrite:**

Lightweight setup — config, workspace, stores, browser, OAST, scope, memory. NO spider (runs on first solve).

Steps:
1. Load config + merge overrides (existing)
2. `workspace.switchTarget()` → graphStore, oastStore (existing)
3. Forensic log (existing)
4. `getOrCreateBrowser(config)` + `ensureReady()` — launch browser
5. `setOastConfig(config.oast)` + `startOastServer()` — start OAST
6. `startDialogWatcher(browser)` — dialog interception
7. Initial navigation: `page.goto(target)` if target set
8. Human observer: `getGlobalObserver().attach(page)` (deferred 3s)
9. Scope guard: `setScopeConfig(deriveScopeFromTarget(target))`
10. Memory: `createMemoryStore(dbPath)` + `createMemory(config, store, dbPath)` (from `src/workers/registry.ts`)
11. Thread resumption: `memory.listThreads()` → find or create thread (prefix: `ultimatrix-web-<target>` to avoid CLI conflicts)
12. Shared services: `createEngineServices(config, browser, memory)` (from A1)
13. Set `_initialized = true`

**A2.2 — New `runSpider()` method:**

Called on first `solve()`, not on `init()`.

Steps:
1. Guard: skip if no target, already ran, or `config.spider.enabled === false`
2. Check existing graph data — skip if endpoints already discovered
3. `createSpiderAgent(config, memory, browser)` — standalone function from `src/spider/agent.ts`
4. Use `buildSpiderPrompt(target)` from `src/spider/instructions.ts` — NOT hardcoded string
5. Stream spider agent with deadline guard (`Promise.race` + timeout)
6. Consume stream: loop detection via `LoopDetector`, progress tracking (endpoint/page/finding deltas)
7. HAR bridge: `attachHarCaptureViaCdp()` during crawl → `bridgeHARToGraph()` after
8. Save graph + HAR file
9. `finalizeEngagementMemory(store, targetOrigin)` for cross-session learning

**A2.3 — `solve()` rewrite:**

Pass all missing params to `createSolverBrain()` and `solve()`:

```typescript
const brain = createSolverBrain(this.config, {
  skillRegistry: this.services!.skillRegistry,
  workerPool: this.services!.workerPool,
  browser: this.browser,           // enables stagehand_* tools
  memory: this.memory,             // enables conversation memory
  modelSelector: this.services?.modelSelector,
  extraContext: this.harContext,    // HAR bridge intelligence
})

const result = await solve(brain, {
  origin: this.target,
  goal: params.goal,
  model: this.config.model,              // context budget accuracy
  memory: this.memory                    // conversation persistence
    ? { thread: this.threadId!, resource: this.resourceId }
    : undefined,
  config: params.solverConfig,
  ultimatrixConfig: this.config,
  blackboard: this.services!.blackboard,
  evidence: this.services!.evidence,
  loopDetector: this.services!.loopDetector,
  reflexion: this.services!.reflexion,
  onMessage: params.onMessage,
  onPhase: params.onPhase,
  onToolComplete: () => {                // graph auto-save
    getGlobalWorkspace().getGraphStore()?.scheduleSave()
  },
})
```

**A2.4 — `destroy()` cleanup:**

```typescript
async destroy(): Promise<void> {
  this._running = false
  this._initialized = false
  try { getGlobalObserver().detach() } catch {}
  try { stopDialogWatcher() } catch {}
  try { await stopOastServer() } catch {}
  try { await closeBrowser() } catch {}
  this.forensicLog = undefined
}
```

---

### A3. `src/web/target-manager.ts` — TTL + cleanup

**Depends on:** A2

- Add 30-min idle eviction: track `lastAccess` per engine, evict oldest when count > 10
- Call `engine.destroy()` in `destroyEngine()`
- Add concurrency lock on `getOrCreateEngine()` (prevent duplicate creation)

---

### A4. `src/app/api/solve/route.ts` — abort + error fixes

**Depends on:** A2

- Client disconnect → abort engine solve via `AbortController`
- `String(err)` → `err instanceof Error ? err.message : String(err)`
- Fix TOCTOU: call `listTargets()` once, store result
- Malformed JSON → 400 (detect `SyntaxError` from `req.json()`)

---

## Stream B: Chat UX

### B1. Fix thinking/reasoning display

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

**Problem:** `updateMessage(thinkingId, ...)` on a message that was never `addMessage`'d → silent no-op.

**Fix:**
1. Add `let thinkingMessageAdded = false` alongside `thinkingId`
2. On first reasoning chunk: `addMessage({ id: thinkingId, type: 'thinking', content: thinkingBuffer, collapsed: true, timestamp })` then set `thinkingMessageAdded = true`
3. On subsequent chunks: `updateMessage(thinkingId, { content: thinkingBuffer })`
4. On thinking→answer transition: finalize thinking message, reset flag

---

### B2. Wire markdown rendering

**New file:** `src/components/markdown-block.tsx`
**Depends on:** Nothing (independent)

Extract `MarkdownBlock` from `src/components/BuddyMessage.tsx` (lines 56-114) into standalone component:
- `react-markdown` + `remark-gfm` (already installed)
- `react-syntax-highlighter` with `oneDark` theme (already installed)
- Custom components: h1-h3, strong, a, code (block + inline), table/th/td
- Streaming cursor (blinking `animate-pulse` span when `streaming={true}`)
- No `rehype-raw` (XSS-safe)
- Uses `.ultimatrix-md` CSS class (already in `globals.css:77-81`)

**Modify:** `src/components/chat-stream.tsx` `MessageBubble` default branch:
```tsx
// BEFORE: {chatMsg.content}
// AFTER:
import { MarkdownBlock } from './markdown-block'
<div className="markdown-body ultimatrix-md">
  <MarkdownBlock content={chatMsg.content} streaming={isStreaming && isLastAssistant} />
</div>
```

---

### B3. Use `appendDelta()` for streaming

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

**Problem:** `answerBuffer += msg.text` double-counts with cumulative providers (Nvidia/Llama).

**Fix:** Import or inline `appendDelta()` from `src/output/render-model.ts:107`:
```typescript
function appendDelta(current: string, delta: string): string {
  if (delta === current) return current
  if (delta.startsWith(current)) return delta
  if (current.endsWith(delta)) return current
  return current + delta
}
```

Replace:
- `thinkingBuffer += msg.text` → `thinkingBuffer = appendDelta(thinkingBuffer, msg.text)`
- `answerBuffer += msg.text` → `answerBuffer = appendDelta(answerBuffer, msg.text)`

---

### B4. Handle `kind:'done'` solver event

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

**Problem:** `case 'done': break` — structured `SolverAnswer` (final content, reasoning, findings) silently discarded.

**Fix:**
```typescript
case 'done':
  if (msg.answer?.content) {
    answerBuffer = msg.answer.content
    const existing = useChatStore.getState().messages.find(m => m.role === 'assistant')
    if (existing) updateMessage(existing.id, { content: answerBuffer } as any)
  }
  if (msg.answer?.reasoning) {
    thinkingBuffer = msg.answer.reasoning
    updateMessage(thinkingId, { content: thinkingBuffer } as any)
  }
  break
```

---

### B5. Fix worker lifecycle cards

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

**Problem:** `worker:spawned` creates message A, `worker:completed` creates separate message B. A shows infinite spinner.

**Fix:** On `worker:completed`, find and update the existing spawned message:
```typescript
} else if (event === 'worker:completed') {
  const d = JSON.parse(data)
  const state = useChatStore.getState()
  const spawned = [...state.messages].reverse().find(
    m => m.type === 'worker-spawned' && m.workerId === d.workerId
  )
  if (spawned) {
    updateMessage(spawned.id, {
      type: 'worker-completed', status: 'completed', duration: d.durationMs,
    } as any)
  } else {
    // Fallback if spawned wasn't found
    addMessage({ id: nextId(), type: 'worker-completed', workerId: d.workerId, name: d.workerName || 'Worker', status: 'completed', duration: d.durationMs, timestamp: Date.now() } as any)
  }
}
```

---

### B6. Add `toolCallIndex` to store

**File:** `src/stores/chat-store.ts`
**Depends on:** Nothing (independent)

Add missing fields to `ToolCallMessage` and `PhaseMessage` (currently passed via `as any` cast — type-unsafe):
```typescript
export interface PhaseMessage {
  id: string
  type: 'phase'
  phase: string
  step: number
  timestamp: number
  label?: string  // NEW — spider progress label, currently cast as any
}
```
```typescript
export interface ToolCallMessage {
  id: string
  type: 'tool-call'
  name: string
  args?: Record<string, unknown>
  status: 'running' | 'done' | 'error'
  result?: string
  duration?: number
  timestamp: number
  workerId?: string
  workerName?: string   // NEW — currently cast as any, needs real field
  toolCallIndex?: number  // NEW — for future dedup
}
```

---

### UX1. Tool elapsed time (live ticking)

**File:** `src/components/tool-call-card.tsx`
**Depends on:** Nothing (independent)

When `message.status === 'running'`, show live elapsed time:
```typescript
import { useState, useEffect } from 'react'

// Inside ToolCallCard when status === 'running':
const [elapsed, setElapsed] = useState(0)
useEffect(() => {
  if (message.status !== 'running') return
  const start = message.timestamp
  const interval = setInterval(() => {
    setElapsed((Date.now() - start) / 1000)
  }, 100)
  return () => clearInterval(interval)
}, [message.status, message.timestamp])

// Render: {elapsed.toFixed(1)}s next to the spinner
```

---

### UX2. Worker attribution on tool cards

**File:** `src/components/tool-call-card.tsx`
**Depends on:** Nothing (independent)

When `message.workerName` is present, show it:
```tsx
{message.workerName && (
  <span className="text-zinc-600 text-[10px]">({message.workerName})</span>
)}
```

---

### UX3. Spider progress inline card

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

Handle `spider:progress` SSE event (currently silently dropped):
```typescript
} else if (event === 'spider:progress') {
  const d = JSON.parse(data)
  addMessage({
    id: nextId(),
    type: 'phase',
    phase: 'spider',
    step: d.step || 0,
    timestamp: Date.now(),
    label: d.message || `Crawling... ${d.endpoints || 0} endpoints`,
  } as any)
}
```

Update the `type === 'phase'` rendering in `MessageBubble` to show spider progress with a distinct icon:
```tsx
if (m.phase === 'spider') {
  return (
    <div className="ml-8 my-1 px-3 py-1.5 rounded-md bg-zinc-900 border border-zinc-800 text-xs text-zinc-400 flex items-center gap-2">
      <Loader2 size={12} className="animate-spin" />
      <span>{m.label || `Crawling... step ${m.step}`}</span>
    </div>
  )
}
```

---

### UX4. Better phase indicator

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

Replace tiny gray text with colored phase badge:
```tsx
if (m.phase === 'spider') { /* UX3 above */ }

// Other phases:
const phaseColors: Record<string, string> = {
  observe: 'text-blue-400 bg-blue-950/20 border-blue-900/30',
  reason: 'text-violet-400 bg-violet-950/20 border-violet-900/30',
  attack: 'text-emerald-400 bg-emerald-950/20 border-emerald-900/30',
  record: 'text-amber-400 bg-amber-950/20 border-amber-900/30',
  complete: 'text-zinc-400 bg-zinc-800/20 border-zinc-700/30',
}
return (
  <div className={cn('ml-8 my-1 px-3 py-1 rounded-md border text-xs flex items-center gap-2', phaseColors[m.phase] || 'text-zinc-400')}>
    <span className="capitalize font-medium">{m.phase}</span>
    <span className="text-zinc-600">step {m.step}</span>
  </div>
)
```

---

### UX5. Connect budget store to actual events

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

**Problem:** Duration and tokens never update — status bar shows 0% progress always.

**Fix:**
1. Live duration: `setInterval` in `handleSend` that calls `setDuration(Date.now() - startTime)` every second
2. Token count: In `kind:'done'` handler, read `msg.answer.usage` and call `incrementTokens()`
3. Clear interval in `cleanup()`

```typescript
// In handleSend, after setStreaming(true):
const startTime = Date.now()
const durationInterval = setInterval(() => setDuration(Date.now() - startTime), 1000)

// In cleanup():
clearInterval(durationInterval)
```

---

### UX6. Streaming cursor on answer

**File:** `src/components/chat-stream.tsx`
**Depends on:** B2 (MarkdownBlock)

Pass `streaming={isStreaming}` to `MarkdownBlock` for the last assistant message. The `MarkdownBlock` component (from B2) already renders a blinking cursor when `streaming={true}`.

---

## Stream C: Error Handling

### C1. Fix `_running` flag stuck

**File:** `src/web/engine.ts`
**Depends on:** A2 (part of the rewrite)

Move `_running = true` inside `try` block (after `createSolverBrain()`, before `solve()`):

```typescript
const brain = createSolverBrain(this.config, { ... })  // can throw safely
try {
  this._running = true  // inside try, finally resets
  const result = await solve(brain, { ... })
  return result
} finally {
  this._running = false
}
```

---

### C2. Add abort signal to `solve()`

**File:** `src/web/engine.ts`
**Depends on:** A2

Add `signal?: AbortSignal` to `solve()` params. Wire to underlying solver if supported, or listen for abort and throw `AbortError`:

```typescript
async solve(params: {
  goal: string
  solverConfig?: SolverConfig
  onMessage?: (msg: SolverStreamMessage) => void
  onPhase?: (event: PhaseEvent) => void
  signal?: AbortSignal  // NEW
}): Promise<SolveResult> {
  if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  // ... pass signal through or listen for it
}
```

---

### C3. Guard concurrent sends

**File:** `src/components/chat-stream.tsx`
**Depends on:** Nothing (independent)

Add early return at top of `handleSend`:
```typescript
const handleSend = useCallback((goal: string) => {
  if (useChatStore.getState().isStreaming) return  // prevent double-send
  // ... rest of handler
```

---

### C4. Client disconnect → abort engine

**File:** `src/app/api/solve/route.ts`
**Depends on:** C2

Wire `req.signal` abort to engine cancel:
```typescript
const abortController = new AbortController()
req.signal.addEventListener('abort', () => abortController.abort())

try {
  const result = await engine.solve({
    goal, solverConfig,
    onMessage: (msg) => send('solver', msg),
    onPhase: (event) => send('phase', event),
    signal: abortController.signal,  // NEW
  })
} catch (err) {
  if (err.name === 'AbortError') return  // client disconnected
  send('error', { message: err instanceof Error ? err.message : String(err) })
}
```

---

## Implementation Order

```
Phase 1:  A1  — Extract createEngineServices (pure refactor, no behavior change)
Phase 2:  A2  — WebEngine rewrite (the big one, includes C1, C2)
Phase 3:  A3 + A4 — TargetManager + route fixes (includes C4)
Phase 4:  B1-B6 — All chat UX fixes (independent of A)
Phase 5:  UX1-UX6 — Loading/progress enhancements (independent of A)
Phase 6:  C3 — Concurrent send guard (independent)
Phase 7:  Tests
Phase 8:  npm test + npm run build:cli + npm run lint
```

Phases 4-6 can run in parallel since they touch different files.

---

## File Change Summary

| File | Stream | Type | Est. lines |
|------|--------|------|-----------|
| `src/session/engine-setup.ts` | A1 | **New** | ~120 |
| `src/session/lifecycle.ts` | A1 | Modify (call createEngineServices) | ~-100, +15 |
| `src/web/engine.ts` | A2+C1+C2 | **Major rewrite** | ~200 (was 153) |
| `src/web/target-manager.ts` | A3 | Modify | ~30 |
| `src/app/api/solve/route.ts` | A4+C4 | Modify | ~30 |
| `src/components/chat-stream.tsx` | B+C3+UX | Modify | ~100 |
| `src/components/markdown-block.tsx` | B2 | **New** | ~65 |
| `src/components/tool-call-card.tsx` | UX1+UX2 | Modify | ~25 |
| `src/stores/chat-store.ts` | B6 | Modify | ~2 |
| `src/spider/instructions.ts` | A2 | Modify (add buildSpiderPrompt) | ~5 |
| Tests | All | **New** | ~250 |
| **Total** | | | **~840** |

---

## Verification Checklist

- [ ] `npm test` — all 1761+ tests pass
- [ ] `npm run build:cli` — clean (ESM + CJS + DTS)
- [ ] `npm run lint` — 0 errors
- [ ] Manual test: `npx ultimatrix web` → send a message → thinking visible, markdown renders, tools show elapsed time
- [ ] Manual test: browser opens visibly when `headless: false`
- [ ] Manual test: spider runs on first solve, endpoints appear in graph
- [ ] Manual test: abort/cancel stops engine, no resource leak
- [ ] Manual test: concurrent sends don't create duplicate streams

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| A1 refactor breaks CLI lifecycle | A1 is pure extraction — same code, just moved. CLI calls `createEngineServices()` and assigns to `this._resources`. |
| WebEngine browser conflicts with existing browser singleton | `getOrCreateBrowser()` is already a singleton — both CLI and Web share it. Web's `destroy()` calls `closeBrowser()`. |
| Spider on first solve adds latency to first response | Spider is fast (configurable `maxSteps`, `maxDurationMs`). Graph is pre-populated for all subsequent turns. |
| Markdown rendering XSS | No `rehype-raw` — raw HTML from LLM not rendered. Same approach as `BuddyMessage.tsx`. |
| Memory/thread resumption conflicts with CLI sessions | Web uses thread prefix `ultimatrix-web-<target>`, CLI uses `ultimatrix-<target>`. No overlap. |
