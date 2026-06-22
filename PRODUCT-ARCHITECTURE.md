# Ultimatrix Product Architecture — The Claude Pattern

> Single entry point. Conversational. Parallel execution. No flags, no subcommands.

---

## The User Experience

```bash
# Just start — Ultimatrix asks what you want
$ ultimatrix
Ultimatrix Security AI. What would you like to assess?
> https://example.com — find all vulnerabilities

# Or jump straight in with a prompt
$ ultimatrix "Find SQL injection and XSS on https://example.com"

# Or be vague — it will ask clarifying questions
$ ultimatrix "Check my app"
What app would you like me to check? Please provide a URL.
> https://staging.myapp.com
```

Once started, the experience is **one continuous conversation** with parallel background work:

```
🕷️  Crawling https://example.com ... (Stagehand browser)
    Found: /, /login, /api/v1/users, /api/v1/search, /admin

🔍  Analyzing attack surface from crawl results ...
    Detected: login form, API endpoints, search parameter

🚀  Spawning specialist workers:
    → SQL Injection Specialist (checking /api/v1/users, /api/v1/search)
    → Authentication Specialist (checking /login)
    → IDOR Specialist (checking /api/v1/users)

🔴  CRITICAL: Confirmed SQL injection in /api/v1/users?id=1'
    Proof: PostgreSQL error message leaked — "column \"id\" does not exist"
    Next: extracting database version ...

🟡  HIGH: XSS reflected in /search?q=<script>alert(1)</script>
    Proof: Script executed in response body

🔗  Chain detected: XSS → Session Hijack → Admin Panel Access
    The XSS can steal session cookies, and /admin lacks auth checks.

> also check for SSRF on the api endpoints

🚀  Spawning SSRF Specialist ...
    → Checking /api/v1/users?url=... and /api/v1/search?callback=...
```

---

## Core Product Principle

**One runtime. One chat. Parallel background work. Streaming results.**

The user never types `assess`, `scan`, or `interact`. They simply **converse** with Ultimatrix as they would with Claude Code. The system decides what to do in the background based on intent, and streams progress back into the chat.

---

## Architecture

```
┌────────────────────────────────────────────────────────────┐
│  ULTIMATRIX CLI                                              │
│  ultimatrix [intent]                                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────┐  │
│  │ Chat Engine  │  │ Background Engine │  │ Event Bus      │  │
│  │ (REPL)       │◄─┤ (Orchestrator)   ├──┤ (progress,     │  │
│  │              │  │                  │  │  findings)     │  │
│  └──────────────┘  └──────────────────┘  └────────────────┘  │
│         │                    │                    │            │
│         └────────────────────┼────────────────────┘            │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Shared State                                           │   │
│  │ • Intent (what user wants)                             │   │
│  │ • Crawl Results (endpoints, forms, params, HAR)        │   │
│  │ • Findings Graph (TypeGraph)                            │   │
│  │ • Active Workers (who's running what)                   │   │
│  │ • Chat History (Mastra Memory)                          │   │
│  └─────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

---

## The Three Threads

### 1. Chat Thread (User ←→ Supervisor)
- Reads user input from stdin
- Streams supervisor responses to stdout
- **Non-blocking**: background work continues while user types
- Background events are injected as "system messages" into the chat stream

### 2. Background Thread (Orchestrator)
- Parses user intent (URL, technique, scope)
- Decides what to do:
  - If URL given → start spider crawl
  - If technique given → spawn workers directly
  - If vague → ask clarifying questions (via chat)
- Monitors active workers, spawns new ones based on findings
- Detects chains across findings
- Generates HAR + endpoint summary for LLM context

### 3. Event Stream (UI Layer)
- Progress events ("crawling X", "testing Y")
- Finding events (confirmed vulnerabilities)
- Chain events (cross-technique combinations)
- Worker events (spawned, completed, failed)
- All events are formatted and streamed to the chat output

---

## File Architecture

```
src/
├── cli/
│   └── index.ts              # Single entry: ultimatrix [intent]
│
├── engine/
│   ├── runtime.ts            # UltimatrixRuntime — orchestrates everything
│   ├── background.ts         # BackgroundOrchestrator — spider, workers, chains
│   ├── chat.ts               # ChatEngine — REPL + streaming output
│   ├── events.ts             # EventBus — shared pub/sub for all threads
│   ├── state.ts              # SharedState — intent, crawl, findings, workers
│   ├── persistence.ts        # Save/resume run state (from Octogent pattern)
│   └── har-collector.ts      # Stagehand HAR capture + endpoint extraction
│
├── skills/
│   ├── loader.ts             # YAML + markdown parser
│   ├── registry.ts           # BM25 search + listing
│   └── resolver.ts           # toolRefs → actual tools
│
├── workers/
│   ├── factory.ts            # Skill → Mastra Agent
│   ├── pool.ts               # Spawn, track, kill + lifecycle states
│   └── registry.ts           # Legacy: createAllWorkers (backward compat)
│
├── supervisor/
│   ├── agent.ts              # createSupervisor (dynamic + legacy overloads)
│   ├── instructions.ts       # Skill-driven instructions
│   └── tools/                # 5 dynamic tools + existing tools
│       ├── skill-search.ts
│       ├── skill-load.ts
│       ├── spawn-worker.ts
│       ├── spawn-swarm.ts
│       └── execute-direct.ts
│
├── swarm/
│   ├── builder.ts            # runSwarm (parallel execution)
│   ├── chains.ts             # detectCrossWorkerChains
│   └── formatter.ts          # Human-readable swarm results
│
├── spider/
│   ├── agent.ts              # Stagehand crawler agent
│   ├── instructions.ts       # Crawl prompt
│   └── har-collector.ts      # Capture browser network as HAR
│
├── graph/
│   ├── schema.ts             # Node/Edge types
│   ├── store.ts              # SQLite-backed graph
│   └── tools.ts              # queryGraph, updateGraph
│
├── intelligence/
│   ├── chaining.ts             # detectChains (same-worker)
│   ├── hypotheses.ts           # generateDynamicHypotheses (skill search)
│   └── auth-recorder.ts        # Auth flow detection
│
├── tools/
│   ├── registry.ts           # All 20+ tool implementations
│   └── resolver.ts           # toolRefs → tool objects
│
├── config.ts               # YAML/ENV config + model tiers
├── models/registry.ts        # fast/balanced/powerful tier resolution
├── browser/manager.ts        # Stagehand singleton
├── oast/                     # Callback server for blind payloads
├── memory/                   # Mastra Memory + LibSQL
├── recorder/                 # Action → Playwright codegen
├── utils/logger.ts           # CLI output (colored, styled)
└── observability.ts          # Pino telemetry
```

---

## The Runtime Flow

### Step 1: Intent Parsing (Immediate)

```typescript
// engine/runtime.ts
class UltimatrixRuntime {
  async start(intent?: string) {
    const state = new SharedState()
    const events = new EventBus()
    const chat = new ChatEngine(supervisor, events, state)
    const background = new BackgroundOrchestrator(agentManager, events, state)

    // Start chat thread (non-blocking)
    chat.start()

    // If intent provided, start background work immediately
    if (intent) {
      const parsed = parseIntent(intent)
      state.setIntent(parsed)
      background.start(parsed)
    } else {
      // Ask user what they want
      chat.ask("What would you like to assess? Provide a URL or describe the target.")
    }

    // Main loop: run until user says exit or all work done
    await chat.runLoop()
    await background.shutdown()
  }
}
```

### Step 2: Background Orchestrator

```typescript
// engine/background.ts
class BackgroundOrchestrator {
  async start(intent: Intent) {
    // Phase 1: Recon (if URL provided)
    if (intent.url) {
      this.events.emit('progress', { phase: 'recon', message: `Crawling ${intent.url} ...` })
      const crawlResult = await this.spider.crawl(intent.url)
      const har = await this.harCollector.getHar()
      const endpoints = this.harCollector.extractEndpoints(har)

      this.state.setCrawlResult({ endpoints, har, forms: crawlResult.forms })
      this.events.emit('crawl-complete', { endpoints: endpoints.length, forms: crawlResult.forms.length })

      // Feed crawl results to supervisor as context
      await this.chat.injectContext(this.formatCrawlContext(endpoints, har))
    }

    // Phase 2: Skill Discovery
    const skills = this.skillRegistry.search(intent.technique || 'web security')
    this.state.setPlannedSkills(skills)
    this.events.emit('progress', { phase: 'plan', message: `Planned ${skills.length} techniques: ${skills.map(s => s.name).join(', ')}` })

    // Phase 3: Spawn Workers (parallel)
    for (const skill of skills) {
      const worker = this.workerPool.spawn({ skillId: skill.id, modelTier: 'balanced', task: `Test ${intent.url}` })
      this.events.emit('worker-spawned', { skillId: skill.id, workerId: worker.id })
    }

    // Phase 4: Monitor + Chain Detection
    while (this.workerPool.hasRunning()) {
      await sleep(1000)
      const findings = this.graph.getFindings()
      const chains = detectCrossWorkerChains(findings)
      if (chains.length > 0) {
        this.events.emit('chain-detected', { chains })
        this.chat.injectContext(`Chain detected: ${chains.map(c => c.rule.name).join(', ')}`)
      }
    }

    this.events.emit('complete', { findings: this.graph.getFindings().length })
  }
}
```

### Step 3: Chat Engine (Streaming)

```typescript
// engine/chat.ts
class ChatEngine {
  async runLoop() {
    for (;;) {
      // Print prompt
      process.stdout.write('\n> ')
      const line = await this.getLine()
      if (!line) break

      // User input might be:
      // - A question ("what did you find?")
      // - A directive ("also check for XSS")
      // - An exit command ("exit", "quit", "done")

      if (isExitCommand(line)) break

      // Inject any pending background events as context
      const events = this.events.drainPending()
      const context = events.map(e => this.formatEvent(e)).join('\n')

      // Stream supervisor response
      const stream = await this.supervisor.stream(`${context}\n\nUser: ${line}`)
      for await (const chunk of stream) {
        this.renderChunk(chunk)
      }
    }
  }

  renderChunk(chunk: any) {
    switch (chunk.type) {
      case 'text-delta': process.stdout.write(chunk.payload.text); break
      case 'tool-call': this.renderToolCall(chunk.payload.toolName); break
      case 'tool-result': this.renderToolResult(chunk.payload.toolName); break
      case 'finding': this.renderFinding(chunk.payload.finding); break
      case 'progress': this.renderProgress(chunk.payload); break
    }
  }
}
```

---

## Intent Parsing

```typescript
// engine/state.ts
interface Intent {
  url?: string            // extracted URL from prompt
  technique?: string      // "SQL injection", "XSS", "all vulnerabilities"
  scope?: string          // specific paths, endpoints, forms
  depth?: 'quick' | 'standard' | 'deep'
  prompt: string          // raw user input
}

function parseIntent(prompt: string): Intent {
  // Extract URL with regex
  const urlMatch = prompt.match(/https?:\/\/[^\s]+/)
  const url = urlMatch ? urlMatch[0] : undefined

  // Detect technique keywords
  const techniques = ['sql injection', 'sqli', 'xss', 'csrf', 'idor', 'ssrf', 'file upload', 'all vulnerabilities']
  const technique = techniques.find(t => prompt.toLowerCase().includes(t))

  // Detect depth
  const depth = prompt.includes('quick') ? 'quick' : prompt.includes('deep') ? 'deep' : 'standard'

  return { url, technique, prompt, depth }
}
```

---

## HAR + Endpoint Extraction

Stagehand captures all network requests during crawl. The HAR is parsed to:

1. **Extract endpoints** — URLs, methods, parameters, headers
2. **Detect auth patterns** — cookies, tokens, redirects
3. **Find API endpoints** — `/api/*`, JSON responses, CORS headers
4. **Identify forms** — POST endpoints, input fields, CSRF tokens
5. **Feed to LLM** — structured as attack surface context

```typescript
// engine/har-collector.ts
class HarCollector {
  async getHar(): Promise<Har> {
    return this.browser.getHar() // Stagehand exposes HAR
  }

  extractEndpoints(har: Har): Endpoint[] {
    return har.entries.map(e => ({
      url: e.request.url,
      method: e.request.method,
      params: e.request.queryString.map(q => q.name),
      headers: e.request.headers.map(h => h.name),
      responseType: e.response.content.mimeType,
      status: e.response.status,
    }))
  }

  formatForLLM(endpoints: Endpoint[]): string {
    return endpoints.map(e =>
      `${e.method} ${e.url}\n  Params: ${e.params.join(', ') || 'none'}\n  Response: ${e.responseType}`
    ).join('\n\n')
  }
}
```

---

## Event Bus (Pub/Sub)

```typescript
// engine/events.ts
interface Event {
  type: 'progress' | 'crawl-complete' | 'worker-spawned' | 'worker-complete' | 'finding' | 'chain-detected' | 'error'
  timestamp: number
  payload: any
}

class EventBus {
  private listeners: Map<string, Set<(e: Event) => void>> = new Map()
  private pending: Event[] = []

  on(type: string, handler: (e: Event) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(handler)
  }

  emit(type: string, payload: any) {
    const event: Event = { type, timestamp: Date.now(), payload }
    this.pending.push(event)
    this.listeners.get(type)?.forEach(h => h(event))
  }

  drainPending(): Event[] {
    const batch = [...this.pending]
    this.pending = []
    return batch
  }
}
```

---

## CLI Entry Point (Single Command)

```typescript
// cli/index.ts
import { UltimatrixRuntime } from '../engine/runtime'
import { log } from '../utils/logger'

const args = process.argv.slice(2)
const intent = args.join(' ').trim() || undefined

const runtime = new UltimatrixRuntime()

// Handle Ctrl+C gracefully
process.on('SIGINT', async () => {
  log.info('\nShutting down...')
  await runtime.shutdown()
  process.exit(0)
})

runtime.start(intent).catch(err => {
  log.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

**Remove all subcommands.** No `assess`, `scan`, `interact`, `verify`. Just `ultimatrix [prompt]`.

---

## Product: Key UX Decisions

### 1. Narrative Over Logs
Instead of:
```
[SPIDER] Crawling https://example.com ...
[SPIDER] Found: /api/v1/users
[WORKER] Spawned: sqli-worker-123
```

Use narrative:
```
🕷️  I'm crawling https://example.com to map the attack surface.
    Found 12 endpoints, including 2 API endpoints and 3 forms.

🔍  Based on the crawl, I'm planning tests for SQL injection, XSS, and authentication bypass.

🚀  Launching 3 specialist workers in parallel ...
    → SQL Injection Specialist (checking search, user endpoints)
    → XSS Specialist (checking reflected inputs)
    → Auth Specialist (checking login flow)
```

### 2. Findings as Cards
When a vulnerability is found, format it as a readable card:
```
🔴 CRITICAL: SQL Injection in /api/v1/users?id=1

    Endpoint: GET /api/v1/users
    Parameter: id (query string)
    Payload: ' AND 1=1--
    Proof: Database error message leaked in response

    Impact: Attacker can read, modify, or delete database contents.
    Next: Would you like me to extract database schema or move to the next finding?
```

### 3. User Can Interrupt / Redirect
At any point:
```
> skip auth and focus on API endpoints only

    OK, stopping Auth Specialist and redirecting XSS + SQLi to API endpoints only.
```

### 4. Chains as Stories
```
🔗 Chain Detected: XSS → Session Hijack → Admin Access

    The XSS in /search can steal the session cookie.
    The session cookie works on /admin (no additional auth).
    This means an attacker can: inject XSS payload → victim visits →
    session stolen → attacker accesses /admin as victim.

    Combined severity: CRITICAL
```

### 5. Progress is Always Visible
```
    Progress: 3/12 endpoints tested | 2 findings | 1 chain detected
    Workers: 2 active (SQLi, XSS) | 1 completed (Auth) | 0 failed
```

---

## Product: Value Proposition

| Before (v5) | After (v6 Product) |
|---|---|
| `ultimatrix assess -t <url>` | `ultimatrix "find vulns on https://example.com"` |
| Separate commands for different modes | One command, intent-driven |
| Spider runs, then REPL starts | Spider + chat + workers all in parallel |
| User waits for spider to finish | User can chat while crawl happens |
| Findings shown in panel/UI | Findings streamed into chat as narrative |
| Workers spawn manually | Workers auto-spawn based on crawl + skill search |
| No chains until user asks | Chains detected automatically and narrated |
| HAR file generated but unused | HAR parsed into attack surface context for LLM |
| Static skill set | Dynamic skill discovery from crawl results |
| No resume | Resume from `.ultimatrix/state.json` (Octogent pattern) |

---

## Implementation Order

| Phase | Task | Files | Effort |
|---|---|---|---|
| 1 | **Event Bus** | `engine/events.ts` | 1h |
| 2 | **Shared State** | `engine/state.ts` | 1h |
| 3 | **HAR Collector** | `engine/har-collector.ts` | 2h |
| 4 | **Chat Engine** | `engine/chat.ts` | 3h |
| 5 | **Background Orchestrator** | `engine/background.ts` | 4h |
| 6 | **Runtime (wires all)** | `engine/runtime.ts` | 2h |
| 7 | **Refactor CLI** | `cli/index.ts` | 1h |
| 8 | **Product: Narrative formatter** | `utils/narrative.ts` | 2h |
| 9 | **Persistence** | `engine/persistence.ts` | 2h |
| 10 | **Test + polish** | `tests/e2e/runtime.test.ts` | 4h |

**Total: ~22 hours** (3-4 days focused work)

---

## Open Questions

1. **Should the supervisor drive the orchestrator, or the orchestrator drive the supervisor?**
   - Option A: Supervisor decides when to spawn workers (via tools). Orchestrator just executes.
   - Option B: Orchestrator decides phases, supervisor is just one agent in the chat.
   - **Recommendation**: Option A — the supervisor is the "brain", the orchestrator is the "nervous system".

2. **How does the user know when work is "done"?**
   - Option A: Auto-detect when all workers complete and no new chains found.
   - Option B: Explicitly ask user: "I've completed the initial scan. Continue deeper testing or review findings?"
   - **Recommendation**: Option B — keeps user in control, matches Claude Code pattern.

3. **Should findings be auto-saved to a report file?**
   - Yes. Always write to `./ultimatrix-report-<timestamp>.md` in the background.
   - User can say "show report" or "save to file" at any time.

4. **Multi-target?**
   - Not for v1. One runtime = one target. User starts new shell for new target.
