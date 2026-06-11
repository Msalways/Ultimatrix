# TUI Migration Plan: terminui → Silvery

**Goal**: Replace terminui with Silvery (React-for-terminal) for a responsive, chat-first TUI with no output leaks, no double-character input, and proper Windows support.

**Runtime**: Node.js v24.16.0, tsx v4.22.4, TypeScript ESM

**Mastra Streaming API**: `agent.stream(text)` returns `{ textStream: AsyncIterable<string> }` — tokens arrive per-chunk via `for await`. Used instead of `agent.generate()` for live token-by-token display.

---

## Phase 0 — Dependency Setup

### Task 0.1: Remove terminui
- `npm uninstall terminui`
- Delete `src/tui/backend.ts` (ANSI backend no longer needed)
- Clean tsup external config if terminui was listed there

### Task 0.2: Install silvery + react
- `npm install silvery react`
- Check peer deps: React 18+ or 19+
- Verify `npx tsx -e "import { render, Box, Text } from 'silvery'; console.log('ok')"` works

### Task 0.3: Configure TypeScript
- Ensure `tsconfig.json` has `"jsx": "react-jsx"` — already set from terminui, confirm it works with React
- Silvery ships TypeScript source (no `dist/`), so tsconfig needs `"skipLibCheck": true` or explicit module resolution for `.tsx` files in `node_modules`

### Task 0.4: Verify base render
- Create a minimal test file `src/tui/test-render.tsx` that renders `<Box><Text>Hello</Text></Box>` with `render()` and exits
- Run with `npx tsx src/tui/test-render.tsx` to confirm Silvery boots

**Exit criteria**: `npx tsx` can render a Silvery component without errors. `npx tsc --noEmit` passes.

---

## Phase 1 — Core Layout Components

Create the 70/30 responsive split layout.

### Task 1.1: Delete old TUI files
- Delete `src/tui/index.tsx` (old terminui JSX)
- Delete `src/tui/backend.ts` (ANSI backend)
- Keep `src/tui/tui.test.ts` (will rewrite tests)

### Task 1.2: Create `src/tui/App.tsx` — Root component
```
<Screen flexDirection="row">          ← full terminal, auto-resize-aware
  <ChatPanel flexGrow={7} />          ← 70% left column
  <Sidebar flexGrow={3} />            ← 30% right column
</Screen>
```
- Uses `<Screen>` for fullscreen + auto-resize
- Flexbox 7:3 ratio
- Responsive: use `useBoxRect()` to detect width — if terminal < 80 cols, stack vertically

### Task 1.3: Create `src/tui/ChatPanel.tsx`
```
<Box flexDirection="column" height="100%">
  <Box flexGrow={1} overflow="scroll" scrollTo={messages.length - 1}>
    → MessageList
  </Box>
  <Box height={1}>
    → StatusLine
  </Box>
  <Box height={3}>
    → InputBar
  </Box>
</Box>
```
- Message list: scrollable, auto-scrolls to bottom on new messages
- Status line shows: target URL, model name, findings count, session timer
- Input bar: `<TextInput>` with `> ` prompt prefix

### Task 1.4: Create `src/tui/MessageList.tsx`
- Renders `messages[]` as list of `<Box>` entries
- User messages styled with `color="cyan"`
- Assistant messages styled with `color="white"`
- Separator between messages (blank line or `───`)
- Handles streaming: if `message.streaming === true`, append tokens in-place

### Task 1.5: Create `src/tui/InputBar.tsx`
- `<TextInput>` with `prompt="> "` and `promptColor="cyan"`
- `onSubmit` fires user message → appends to messages → calls `sendMessage(text)`
- Disabled while response is pending
- Ctrl+C quits

### Task 1.6: Create `src/tui/StatusLine.tsx`
- Single-line `<Text>` at bottom of chat column
- Shows: `Target: {url} | Model: {name} | Findings: {n} | {elapsed}`
- Updates every second (timer)

### Task 1.7: Create `src/tui/Sidebar.tsx`
```
<Box flexDirection="column" height="100%">
  <Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
    → ActivityLog
  </Box>
  <Box flexGrow={1} borderStyle="round" borderColor="gray" paddingX={1}>
    → GraphStats
  </Box>
</Box>
```
- Two panels stacked vertically, each with round border
- Border color: gray

### Task 1.8: Create `src/tui/ActivityLog.tsx`
- Renders `activities[]` as a scrollable list
- Each entry: `[TYPE] message`
- Color-coded by type (START=dim, DONE=green, ERROR=red, FIND=yellow, SPIDER=blue)
- Auto-scrolls to bottom
- Shows "No activity yet..." when empty

### Task 1.9: Create `src/tui/GraphStats.tsx`
- Renders `graphStats` as key-value list
- Items: Pages, Actions, Tests, Findings, Auth Flows, RBAC Roles
- Values color-coded (findings > 0 = red, else green)

**Exit criteria**: `render(<App />, { fullscreen: true }).run()` shows the 70/30 layout with placeholder text and keyboard input works (no double chars).

---

## Phase 2 — State Management & Event Wiring

### Task 2.1: Create `src/tui/types.ts`
```
interface TuiMessage { role: 'user' | 'assistant'; text: string; streaming: boolean }
interface TuiActivity { type: string; message: string; timestamp: number }
interface TuiGraphStats { pages: number; actions: number; tests: number; findings: number; authFlows: number; rbacRoles: number }
```

### Task 2.2: Create `src/tui/useTuiState.ts` — Custom hook
- `useState<TuiMessage[]>` for messages
- `useState<TuiActivity[]>` for activities (ring buffer, max 200)
- `useState<TuiGraphStats>` for graph stats
- `useState<string>` for input buffer
- `useState<boolean>` for `isResponding` (disable input during LLM response)
- `useEffect` to subscribe to global event emitter:
  - `activity:start` → push to activities
  - `activity:complete` → push to activities
  - `activity:error` → push to activities
  - `finding` → push to activities + increment stats.findings
  - `spider:progress` → push to activities
  - `recorder:interaction` → push to activities
  - `graph:update` → re-read graph store, update stats
- `sendMessage` callback type: `(text: string, onToken?: (token: string) => void) => Promise<string>`
- Provide `sendMessage(text: string)` that:
  1. Appends user message
  2. Sets `isResponding = true`
  3. Creates empty assistant message with `streaming: true`
  4. Calls `sendMessage(text, (token) => appendToLastMessage(token))` — each token triggers React re-render via Silvery's incremental renderer (~169µs per token)
  5. On response promise resolve: sets `streaming = false`, finalizes message
  6. Sets `isResponding = false`
- `onInput(text)` for input changes
- `onSubmit(text)` for enter key

### Task 2.3: Wire useTuiState into App
- `App.tsx` calls `useTuiState()` and passes state down as props or context
- ChatPanel receives messages, isResponding, onSubmit, onInput
- Sidebar receives activities, graphStats
- StatusLine receives target, modelName, elapsed

**Exit criteria**: Event emitter subscriptions fire React state updates, chat messages appear in the UI, graph stats update live.

---

## Phase 3 — Output Isolation

### Task 3.1: Create `src/tui/console-capture.ts`
- Save `originalLog = console.log`, `originalError = console.error`
- Replace `console.log` with function that:
  - Pushes args to a `debugBuffer[]` (ring buffer, max 500)
  - Optionally dispatches to an activity event for visibility
- Replace `console.error` with same approach
- Return `restore()` function to undo on exit

### Task 3.2: Integrate capture into TUI startup
- In `startTUI()` (new entry point), call `captureConsole()` before `render()`
- Pass `restore` to cleanup handlers (SIGINT, SIGTERM, exit)
- Captured logs can be shown as `[DEBUG]` entries in activity log if desired

### Task 3.3: Verify no stdout leakage
- Run a test with a simulated Mastra `console.log` call
- Confirm it does NOT appear on terminal
- Confirm it appears in the debug buffer

**Exit criteria**: `console.log('secret')` from any code (Mastra, supervisor, tools) is captured, not leaked to terminal. `restore()` brings back normal console.

---

## Phase 4 — Entry Point & Cleanup

### Task 4.1: Create `src/tui/startTUI.ts`
```
export async function startTUI(
  targetUrl?: string,
  modelName?: string,
  sendMessage?: (text: string, onToken?: (token: string) => void) => Promise<string>,
): Promise<void>
```

Implementation:
1. `captureConsole()` → get `restore`
2. Determine if TTY (input.isTTY, output.isTTY) — if not, fallback to REPL
3. Call `render(<App targetUrl={} modelName={} sendMessage={} />, { fullscreen: true })`
4. `app.waitUntilExit()` — blocks until user quits
5. `restore()` in finally block
6. SIGINT/SIGTERM handlers call `restore()` + `app.unmount()`

### Task 4.2: Update CLI wiring (`src/cli/index.ts`)
- Replace `import('../tui/index')` with `import('../tui/startTUI')`
- Old terminui's `startTUI` had the same signature — should be drop-in
- Remove any old cleanup that assumed terminui

### Task 4.3: Handle supervisor streaming feedback loop
- `sendMessage` callback now uses `supervisor.stream()` instead of `supervisor.generate()`
- Implementation in CLI:
```
startTUI(target, modelName, async (text: string, onToken?: (token: string) => void) => {
  const stream = await supervisor.stream(text, {
    memory: { thread: threadId, resource: 'ultimatrix' }
  })
  let fullText = ''
  for await (const chunk of stream.textStream) {
    fullText += chunk
    onToken?.(chunk)          ← each token → React state → Silvery incremental re-render
  }
  // Stream finished — persist state
  await getGlobalGraphStore().save()
  await getGlobalOastStore().save()
  return fullText || '(no response)'
})
```
- Tool calls within the supervision loop still use `worker.generate()` (non-streaming, internal)
- Error handling: wrap stream in try/catch, show error message in chat, don't crash TUI
- The `onToken` callback fires for each text chunk — typically 1-5 characters per chunk
- Silvery's cell-level incremental rendering updates only the changed text node (~169µs per update)

**Exit criteria**: `ultimatrix -t <url>` launches Silvery TUI, shows layout, accepts input, sends messages to supervisor, displays responses, and exits cleanly.

---

## Phase 5 — Polish & Error Handling

### Task 5.1: Add ErrorBoundary
- `src/tui/ErrorBoundary.tsx` — catches render errors in component tree
- Shows "Something went wrong" with retry option

### Task 5.2: Keyboard shortcuts
- Ctrl+C / Escape: confirm exit dialog or immediate exit
- Ctrl+L: clear messages (or clear screen)
- Up/Down arrows: message history navigation (if we want it)
- PageUp/PageDown: scroll message list

### Task 5.3: Responsive breakpoints
- `useBoxRect()` in App.tsx
- If terminal width < 80: stack panels vertically (sidebar below chat)
- If terminal height < 20: hide graph stats, keep activity and chat

### Task 5.4: Theme colors
- Use Silvery's `ThemeProvider` with `@silvery/theme`
- Semantic tokens: `$primary` for inputs, `$success`/`$error`/`$warning` for activity types

### Task 5.5: Streaming indicator
- While waiting for first token: show `<Spinner>` inline in the assistant message
- After first token arrives: spinner disappears, tokens stream in-place
- If streaming fails: show error message, set `streaming = false`

### Task 5.6: Spinner while waiting
- Before streaming starts (during Mastra tool calls/internal processing), show an indeterminate `<Spinner>` in the last message area
- When textStream yields the first chunk, replace spinner with text

---

## Phase 6 — Testing

### Task 6.1: Rewrite `src/tui/tui.test.ts`
- Use `@silvery/test` with `createRenderer()` instead of old terminui/ink testing
- Test: App renders without crash
- Test: 70/30 layout proportions
- Test: Input handling (simulate keypress)
- Test: Message rendering
- Test: Event emitter integration
- Test: Console capture

### Task 6.2: Full test suite run
- `vitest run` — all 307 tests (or whatever the count is) must pass
- `npx tsc --noEmit` — 0 type errors
- `npx tsup` — clean build

---

## File Inventory

### Files to Create
- `src/tui/App.tsx` — Root Screen component
- `src/tui/ChatPanel.tsx` — Left 70% column
- `src/tui/MessageList.tsx` — Message rendering
- `src/tui/InputBar.tsx` — TextInput wrapper
- `src/tui/StatusLine.tsx` — Bottom status
- `src/tui/Sidebar.tsx` — Right 30% column
- `src/tui/ActivityLog.tsx` — Activity display
- `src/tui/GraphStats.tsx` — Graph stats display
- `src/tui/types.ts` — Shared types
- `src/tui/useTuiState.ts` — State management hook (handles streaming token appends)
- `src/tui/console-capture.ts` — Console override
- `src/tui/startTUI.ts` — Entry point (receives streaming-aware callback)
- `src/tui/ErrorBoundary.tsx` — Error handling

### Files to Delete
- `src/tui/backend.ts` — terminui ANSI backend
- `src/tui/index.tsx` — Old terminui JSX

### Files to Modify
- `src/cli/index.ts` — Update import path, replace `supervisor.generate()` with `supervisor.stream()` in TUI path
- `src/tui/tui.test.ts` — Rewrite for Silvery
- `package.json` — Remove terminui, add silvery + react
- `tsconfig.json` — Verify jsx config
- `vitest.config.ts` — Maybe add alias for silvery if needed
- `tsup.config.ts` — Remove terminui from external if present

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Silvery v0.19 API changes | Low-Medium | High | Pin exact version. Pure TS — can fork if abandoned. |
| Silvery render fails on Windows | Low | High | Test immediately in Phase 0. Fallback: use `@silvery/ink` compat layer or revert to Ink. |
| Mastra `stream()` blocks tool calls | Low | Medium | Tool calls still use `worker.generate()` internally. Supervisor `stream()` returns textStream with tool call data interleaved — `for await` only iterates text chunks. |
| Yoga-layout top-level-await conflict | N/A | N/A | Silvery uses Flexily (pure JS), not Yoga. No TLA issue. |
| Console override blocks needed errors | Low | Low | Route `console.error` to both debug buffer AND stderr (or activity log). |
| Silvery test library not compatible with vitest | Medium | Medium | Fallback: test React components in isolation with `@testing-library/react` or just snapshot test. |
