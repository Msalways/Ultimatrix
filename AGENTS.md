## Ultimatrix v5 — Web UI Migration (Complete)

### Status
- **0 type errors, 270 tests (19 files), clean tsup build (ESM 109KB + CJS 114KB)**
- **Next.js 15.5.19 + shadcn/ui + Radix primitives** — 6 API routes, 5 component panels
- `@mastra/core` ^1.42.0, `playwright` ^1.52.0, `zod` ^4.0.0, `@ai-sdk/react` ^1.2.12

### Architecture
- **Supervisor Agent** (`src/manager/agent.ts`): Mastra Agent with tools — Observe-Learn-Attack loop. Delegates to 4 workers, chains findings, records evidence.
- **4 Specialist Workers** (`src/workers/`): `injection`, `authControl`, `advanced`, `recon`
- **Spider Agent** (`src/spider/agent.ts`): Stagehand-based hybrid crawler
- **Action Recorder** (`src/recorder/`): Records browser actions → test cases → Playwright code
- **TypeGraph** (`src/graph/`): 8 node types, 10 edge types, JSON-backed
- **Intelligence** (`src/intelligence/`): Auth flows, RBAC, chain detection, hypotheses
- **OAST Server** (`src/oast/`): Blind callback detector
- **AgentManager** (`src/lib/agent-manager.ts`): Singleton — owns browser, workers, supervisor, OAST. `init()`, `chat()`, `getFindings()`, `getCode()`, `stop()`. Handles `DEPLOYED` env var (skip browser).
- **Next.js Web UI** (`src/app/`, `src/components/`): Primary interface. Chat via `useChat()` + `toAISdkV5Stream` SSE.

### Web UI (shadcn-based)

| Component | shadcn/radix | File |
|-----------|-------------|------|
| Chat panel | `Button`, `Input`, `ScrollArea` | `src/components/chat.tsx` |
| Findings | `Card`, `Badge` | `src/components/findings-panel.tsx` |
| Code viewer | `Card`, pre, copy button | `src/components/code-panel.tsx` |
| Settings | `Select`, `Input`, `Label`, `Button`, `Separator` | `src/components/settings-panel.tsx` |
| Activity log | `ScrollArea`, `Badge`, SSE stream | `src/components/activity-panel.tsx` |
| Status bar | Fetching `/api/status` | `src/components/status-bar.tsx` |

### API Routes

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | Agent streaming via `toAISdkV5Stream(result, {from:'agent'})` |
| `/api/status` | GET | Agent state (initialized, model, target, findings count) |
| `/api/config` | GET/POST | Read/update LLM config + browser settings |
| `/api/findings` | GET | Finding nodes from graph, filterable by severity/type |
| `/api/code` | GET | Generated Playwright test code from recorder |
| `/api/activity` | GET | SSE event stream for live activity log |

### CLI Commands
- `ultimatrix web` — starts Next.js dev server (primary interface)
- `ultimatrix interact -t <url>` — terminal REPL (legacy fallback)
- `ultimatrix assess/scan/verify/init` — unchanged

### Key Files
- `src/lib/agent-manager.ts` — Server singleton: init, chat, getFindings, stop. DEPLOYED flag.
- `src/app/api/chat/route.ts` — POST handler: Agent.stream() → toAISdkV5Stream → SSE Response
- `src/app/page.tsx` — Tabbed layout: Chat | Findings | Code | Settings + Activity sidebar
- `src/cli/web.ts` — Programmatic Next.js start via `next({dev,port})` + `getRequestHandler()`
- `src/session.ts` — REPL loop (kept for `interact` subcommand)
- `src/components/ui/` — 11 shadcn components (button, badge, card, tabs, dialog, sheet, select, etc.)

### Config Files Added
- `next.config.ts` — transpilePackages for @mastra/*, serverExternalPackages
- `tailwind.config.ts` — dark mode, CSS variables for shadcn
- `postcss.config.cjs` — tailwindcss + autoprefixer (`.cjs` because `"type":"module"` in package.json)
- `components.json` — shadcn config

### Fixes
- Logger.success() double-log when Pino active — added missing `return` after `p.info()`
- postcss.config.js broke under `"type":"module"` — renamed to `.cjs`
- tsconfig.json auto-modified by Next.js (allowJs, noEmit, incremental, isolatedModules, next plugin)
- `.next` added to tsconfig exclude to prevent rootDir errors
- `tsBuildInfoFile` added to support incremental + tsup DTS build
- `claude/` dir in root form-plan directory kept as-is

### Known Issues
- Windows `readline` REPL still used in `interact` subcommand (web is default now)
- Activity panel SSE endpoint is a stub (ready for tool event wiring)
- Cloudflare challenges block Stagehand crawl — deferred
