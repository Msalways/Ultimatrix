# Ultimatrix Web UI — Build Plan

## Goal

Replace the terminal REPL (`session.ts`) with a Next.js web UI as the primary agent interface. The CLI becomes a launcher (`ultimatrix web` opens browser). Chat uses AI SDK streaming (`useChat()` + `@mastra/ai-sdk`), Activity sidebar shows live events, Settings/Findings/Code pages in tabbed layout. Deployable with `DEPLOYED` env var (serverless HTTP-only, no browser).

## Status

- **0 type errors, 270 tests (19 files) passing, clean tsup build**
- `@mastra/core` ^1.42.0, `playwright` ^1.52.0, `zod` ^4.0.0
- Logger.success() missing `return` after `p.info()` — **fixed**
- Readline `terminal: false` fixes Windows double-echo but breaks history — **replaced by web UI**

---

## Phase 0 — Fix Known Bugs

Do this before any new work to clear the deck.

| # | Bug | Fix | File |
|---|-----|-----|------|
| 0.1 | Logger.success() double-logs when Pino is active | Add `return` after `p.info()` | `src/utils/logger.ts:48` ✅ DONE |
| 0.2 | `session.ts` readline uses `terminal:false` (no history) | Replace entire file with web UI | `src/session.ts` → replaced in Phase 8 |
| 0.3 | `session.ts` `getLine()` no timeout on first prompt | Replace entire file with web UI | `src/session.ts` → replaced in Phase 8 |
| 0.4 | Cloudflare challenges block Stagehand crawl | Log clear error + surface in chat | `src/spider/agent.ts` — defer to Phase 8 |

---

## Phase 1 — Scaffold Next.js + shadcn/ui

### 1.1 Add deps to root `package.json`

```
dependencies:
  next@^15.2.0
  react@^19.0.0
  react-dom@^19.0.0
  @ai-sdk/react@^1.2.0
  @mastra/ai-sdk@^1.0.0
  lucide-react (for icons)

devDependencies:
  @types/react@^19.0.0
  @types/react-dom@^19.0.0
  tailwindcss@^3.4.0
  postcss@^8.4.0
  autoprefixer@^10.4.0
  class-variance-authority
  clsx
  tailwind-merge
  tailwindcss-animate
```

### 1.2 Create config files

- `next.config.ts` — `transpilePackages: ['@mastra/core', '@mastra/ai-sdk', '@mastra/memory']`, `outputFileTracingIncludes` for web
- `tailwind.config.ts` — content globs for `./src/**/*.{ts,tsx}`
- `postcss.config.js` — tailwindcss + autoprefixer

### 1.3 Add npm scripts

```
"dev": "next dev",
"build": "tsup && next build",
"lint": "tsc --noEmit"
```

### 1.4 Init shadcn/ui

```
npx shadcn@latest init --yes
```

### 1.5 Add required components

```
npx shadcn@latest add tabs card badge scroll-area sheet select input button separator dialog skeleton
```

### 1.6 Create root layout

`src/app/layout.tsx` — `<html>` with Inter font, `globals.css`, `<body>` with `<Tabs>` sidebar

### 1.7 Create CssBaseline

`src/app/globals.css` — Tailwind directives + shadcn base styles

### 1.8 Verify

```
npm run lint → 0 type errors
npm run test → 270 passing
npm run dev → opens blank page with tab nav
```

---

## Phase 2 — Agent Manager (Server Singleton)

### 2.1 Create `src/lib/agent-manager.ts`

Exports a singleton class:

```ts
class AgentManager {
  private browser: StagehandBrowser | null
  private supervisor: MastraAgent | null
  private workers: Record<string, MastraAgent> | null
  private store: LibSQLStore
  private oastPort: number | null
  private graphStore: GraphStore
  private config: UltimatrixConfig
  private initialized: boolean

  async init(config: UltimatrixConfig): Promise<void>
  async chat(messages: CoreMessage[], opts?: ChatOpts): Promise<StreamResult>
  async getSupervisor(): MastraAgent
  getConfig(): UltimatrixConfig
  async updateConfig(partial: Partial<UltimatrixConfig>): Promise<void>
  async getFindings(): Promise<FindingNode[]>
  async getCode(): Promise<string[]>
  async stop(): Promise<void>
}
```

### 2.2 Move init logic from `session.ts`

- Browser creation via `getOrCreateBrowser()`
- Store via `createMemoryStore()` (static `LibSQLStore` import)
- OAST via `startOastServer()`
- Workers via `createAllWorkers()`
- Supervisor via `createSupervisor()`

### 2.3 Handle `DEPLOYED` flag

When `process.env.DEPLOYED === 'true'`:
- Skip browser init (`browser = null`)
- Skip OAST server
- Workers skip stagehand-dependent tools
- Supervisor gets reduced tool set (HTTP-only + graph + observation)

### 2.4 Chat method

```ts
async chat(input: string | CoreMessage[], opts?: {
  threadId?: string
  resourceId?: string
  maxSteps?: number
}): Promise<StreamResult> {
  const messages = typeof input === 'string' ? [{ role: 'user', content: input }] : input
  return this.supervisor!.stream(messages, {
    memory: { thread: opts?.threadId ?? 'ultimatrix-' + Date.now(), resource: 'ultimatrix' },
    maxSteps: opts?.maxSteps ?? 50,
    format: 'aisdk',
  })
}
```

### 2.5 Tests

`src/lib/agent-manager.test.ts` — verify singleton pattern, DEPLOYED flag behavior

---

## Phase 3 — Chat API Route + Frontend

### 3.1 `src/app/api/chat/route.ts`

POST handler:
```ts
export async function POST(req: Request) {
  const { messages, threadId } = await req.json()
  const manager = AgentManager.getInstance()
  if (!manager.isInitialized()) {
    const config = loadConfig()
    await manager.init(config)
  }
  const result = await manager.chat(messages, { threadId })
  return handleChatStream({ data: result.toUIMessageStreamResponse() })
}
```

Also validate `messages` array, return 400 on invalid input.

### 3.2 `src/app/api/status/route.ts`

GET handler — returns agent state:
```json
{
  "ok": true,
  "initialized": true,
  "target": "https://...",
  "model": "openai/gpt-4o",
  "oastPort": 12345,
  "uptime": 3600,
  "findings": 7,
  "deployed": false
}
```

### 3.3 Chat page component

`src/components/chat.tsx`:
- Uses `useChat()` from `@ai-sdk/react`
- Renders messages with text + tool cards + screenshots
- Input bar with send button
- Auto-scroll to bottom
- Collapsible reasoning blocks (dimmed, expand on click)
- Markdown rendering for assistant messages

### 3.4 Message components

- `src/components/message.tsx` — Bubble wrapper (user/assistant role)
- `src/components/tool-call-card.tsx` — shadcn `Card` with tool name, args (collapsible JSON), result
- `src/components/reasoning-block.tsx` — Collapsible dimmed block for reasoning
- `src/components/screenshot-viewer.tsx` — Embedded image from `stagehand_screenshot`

### 3.5 Integrate into page

`src/app/page.tsx` renders `<Chat />` component (the main view).

---

## Phase 4 — Activity Panel (Live Event Log)

### 4.1 SSE activity endpoint

`src/app/api/activity/route.ts` — GET SSE endpoint:
- Opens SSE connection
- Emits `process.stdout.write`-style events as SSE data
- Uses `AgentManager` event emitter for tool calls, reasoning, errors

### 4.2 Activity component

`src/components/activity-panel.tsx`:
- Right sidebar (collapsible)
- shadcn `ScrollArea` with color-coded entries
- Types: tool-call (dim), tool-result (green), error (red), reasoning (blue), info (white)
- Filter by type (optional)

### 4.3 Wire into layout

`src/app/layout.tsx` — right sidebar toggle button, `<ActivityPanel />` shown/hidden

---

## Phase 5 — Settings (Config Sheet)

### 5.1 `src/app/api/config/route.ts`

- GET: returns current config (redacted API key)
- POST: updates config, re-inits agent manager

### 5.2 Settings sheet component

`src/components/settings-panel.tsx`:
- shadcn `Sheet` slides in from right
- Fields: LLM provider (`Select`), model (`Input`), API key (`Input type=password`), output dir, headless (`Switch`), timeout (number)
- "Save & Re-initialize" button → POST `/api/config`
- Status indicator showing if agent is already initialized

### 5.3 Provider-specific config

Show/hide fields based on provider:
- OpenAI: model dropdown (gpt-4o, gpt-4o-mini, o3-mini)
- Anthropic: model dropdown (claude-sonnet-4-20250514, claude-3.5-haiku)
- Custom/openai-compatible: baseUrl + model

---

## Phase 6 — Findings (Vulnerability List)

### 6.1 `src/app/api/findings/route.ts`

- GET: returns all `Finding` nodes from `GraphStore`
- Filters: `?severity=critical|high|medium|low` and `?type=xss|sqli|idor|...`
- Returns sorted by severity (critical first)

### 6.2 Findings component

`src/components/findings-panel.tsx`:
- Grid/list of shadcn `Card`s
- Each card: severity `Badge`, technique name, target URL/param, evidence snippet
- Filter by severity tabs
- Click to expand full evidence
- "Re-test" button (future: re-runs specific finding)

---

## Phase 7 — Playwright Code Viewer

### 7.1 `src/app/api/code/route.ts`

- GET: returns generated Playwright test code
- Returns array of test files/snippets with metadata (createdAt, scenario type)

### 7.2 Code component

`src/components/code-panel.tsx`:
- List of code snippets in shadcn `Card`s
- Syntax highlighting (optional: simple pre/code block)
- Copy-to-clipboard button per snippet
- File name header with language tag

---

## Phase 8 — CLI Integration

### 8.1 Rewrite `src/cli/web.ts`

Current: bare Node.js HTTP server with static HTML.
New: programmatic Next.js start:
```ts
import next from 'next'
import { createServer } from 'http'

const app = next({ dev: process.env.NODE_ENV !== 'production', hostname: HOST, port: PORT })
const handle = app.getRequestHandler()

await app.prepare()
createServer((req, res) => handle(req, res)).listen(PORT, HOST)
```

Update `ultimatrix web` command to start Next.js dev server and print URL.

### 8.2 Update `src/cli/index.ts`

- `ultimatrix web` → starts Next.js (Phase 8.1)
- `ultimatrix -t <url>` → runs spider crawl + starts web UI (or starts web UI and passes target)
- `ultimatrix` (no args) → `ultimatrix web` (default)

### 8.3 Clean up `session.ts`

- `session.ts` remains for backward compat as `ultimatrix interact` (REPL fallback)
- Default command changed to `web` instead of REPL

### 8.4 Update bin scripts in package.json

```json
"scripts": {
  "dev": "next dev",
  "web": "next dev",
  "build": "tsup && next build"
}
```

---

## Phase 9 — DEPLOYED Mode

### 9.1 Agent-manager HTTP-only path

When `DEPLOYED=true`:
- No `StagehandBrowser` initialization
- No `Stagehand`-dependent agents (spider skipped)
- Reduced tool set (HTTP + observation + graph)
- Findings from pre-loaded graph JSON
- Screenshots from archive (static files)

### 9.2 UI indicator

- Status bar shows cloud icon for deployed mode
- Disable spider-related buttons
- Show "HTTP-only mode" banner in chat

### 9.3 Deployment config

- `next.config.ts` detects `DEPLOYED` and adjusts build
- Serverless-ready: no `better-sqlite3` (use Turso or in-memory)
- Graph persists to JSON or remote LibSQL (Turso)

---

## Architecture Diagrams

### File Structure

```
project-sentinal/
├── next.config.ts              ← NEW
├── tailwind.config.ts          ← NEW
├── postcss.config.js           ← NEW
├── components.json             ← NEW (shadcn)
├── package.json                ← MODIFIED (add next, react, shadcn deps)
├── src/
│   ├── app/                    ← NEW — Next.js App Router
│   │   ├── layout.tsx          ← Root layout (tab nav sidebar)
│   │   ├── page.tsx            ← Chat page (default)
│   │   ├── globals.css         ← Tailwind + shadcn styles
│   │   ├── api/
│   │   │   ├── chat/route.ts   ← POST: agent streaming
│   │   │   ├── status/route.ts ← GET: agent state
│   │   │   ├── config/route.ts ← GET/POST: config
│   │   │   ├── findings/route.ts ← GET: findings
│   │   │   ├── code/route.ts   ← GET: Playwright code
│   │   │   └── activity/route.ts ← GET: SSE event log
│   │   └── settings/
│   │       └── page.tsx        ← Full settings page (alt to sheet)
│   ├── components/             ← NEW
│   │   ├── ui/                 ← shadcn components
│   │   ├── chat.tsx
│   │   ├── message.tsx
│   │   ├── tool-call-card.tsx
│   │   ├── reasoning-block.tsx
│   │   ├── screenshot-viewer.tsx
│   │   ├── activity-panel.tsx
│   │   ├── findings-panel.tsx
│   │   ├── code-panel.tsx
│   │   ├── settings-panel.tsx
│   │   ├── status-bar.tsx
│   │   └── provider-select.tsx
│   ├── lib/                    ← NEW
│   │   ├── agent-manager.ts    ← Singleton agent manager
│   │   └── agent-manager.test.ts
│   ├── cli/                    ← EXISTING
│   │   ├── index.ts            ← MODIFIED (web default command)
│   │   ├── web.ts              ← REWRITTEN (programmatic Next.js)
│   │   └── ...rest
│   ├── session.ts              ← KEPT (as `interact` fallback)
│   └── ...rest EXISTING
```

### API Flow

```
Browser (useChat)           Next.js Server              AgentManager
     │                           │                          │
     │──── POST /api/chat ──────>│                          │
     │     {messages}            │                          │
     │                           │──── chat(messages) ─────>│
     │                           │                          │── supervisor.stream({format:'aisdk'})
     │                           │<── StreamResult ────────│
     │<── SSE Response ──────────│                          │
     │  (text-delta, tool-call,  │                          │
     │   reasoning-delta, etc.)  │                          │
```

### shadcn Component Map

| Component | Usage | shadcn Name |
|-----------|-------|-------------|
| Tab navigation sidebar | Chat / Findings / Code tabs | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| Findings list cards | Vulnerability items | `Card`, `CardHeader`, `CardTitle`, `CardContent` |
| Settings form | LLM config | `Sheet`, `SheetTrigger`, `SheetContent` |
| | | `Form`, `FormField`, `FormItem`, `FormLabel` |
| | | `Select`, `SelectContent`, `SelectItem` |
| | | `Input`, `Button`, `Switch` |
| Activity sidebar | Live event log | `ScrollArea` |
| Evidence viewer | Finding detail | `Dialog`, `DialogContent` |
| Loading state | Chat waiting | `Skeleton` |
| Severity labels | Finding severity | `Badge` |
| Layout dividers | Between sections | `Separator` |

---

## Known Edge Cases & Mitigations

| Case | Mitigation |
|------|-----------|
| Agent not initialized | `/api/chat` returns 503 with retry-after header |
| Browser doesn't start (headless fail) | Falls back to HTTP-only tools, UI shows browser warning |
| SSE disconnect during streaming | `useChat()` auto-reconnects via `fetch` abort controller |
| Config change mid-session | AgentManager re-initializes, previous thread preserved in LibSQL |
| `DEPLOYED` + browser tool used | Agent returns error message, no crash |
| Large findings list | Pagination via `?page&limit` query params |
| API key in URL | Never logged, masked in config GET response |
| OAST port conflict | Retry with next port, log warning |
| Cloudflare challenge | Agent detects "Not Found" pattern, logs suggestion to use `--no-spider` |

---

## Session-by-Session Task Execution

### Session 1 (this session)
- [ ] Phase 0.1: Logger.success() fix ✅ DONE
- [x] Rest of Phase 0: Verify all existing tests pass (270 ✅)
- [x] PLAN.md created ✅
- [ ] Phase 1: Scaffold Next.js + deps + shadcn
- [ ] Phase 2: AgentManager singleton
- [ ] Phase 3: Chat API + frontend

### Session 2
- [ ] Phase 4: Activity panel
- [ ] Phase 5: Settings sheet
- [ ] Phase 6: Findings page

### Session 3
- [ ] Phase 7: Code viewer
- [ ] Phase 8: CLI integration
- [ ] Phase 9: DEPLOYED mode
- [ ] Full test pass + typecheck
- [ ] Edge case audit

---

*Plan continues below as phases are completed.*
