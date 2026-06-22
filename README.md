# Ultimatrix

**AI-powered autonomous security researcher.** An LLM-driven supervisor orchestrates 4 specialist workers via Mastra agents to discover vulnerabilities, chain findings across attack classes, and generate replayable Playwright test suites. Every browser action is recorded as a TypeGraph node, annotated with test cases, and streamed to `.spec.ts` files in parallel.

Real attacks, not theoretical. No mocks.

---

## Quick Start

```bash
git clone <repository-url> && cd project-sentinal
npm install
npx playwright install chromium

# Configure your LLM provider
npx ultimatrix init          # Interactive provider setup wizard

# Test with a simple target
npx ultimatrix interact -t https://httpbin.org

# Web UI
npx ultimatrix web           # http://localhost:3000
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `ultimatrix init` | Interactive provider + config setup wizard |
| `ultimatrix interact -t <url>` | REPL chat loop with the security agent |
| `ultimatrix web` | Start Next.js web UI at localhost:3000 |
| `ultimatrix assess -t <url> -o <dir>` | Full assessment: map, spider, extract, build model, test |
| `ultimatrix scan -t <url>` | Autonomous scan (reuses existing app model) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against a fresh deployment |

---

## Configuration

Config is split across two files:

### `ultimatrix.yaml` (project config)

```yaml
provider: nvidia
model: nvidia/nemotron-3-super-120b-a12b
browser:
  headless: false
  viewport:
    width: 1280
    height: 720
memory:
  lastMessages: 10
  semanticRecall: false
  workingMemory: true
agent:
  maxSteps: 50
  scansDir: ./scans
```

### `~/.config/ultimatrix/providers.yaml` (credentials)

```yaml
nvidia:
  apiKey: nvapi-...
groq:
  apiKey: gsk_...
```

Model IDs pass through **exactly** as provided — no parsing, no prefixing.

Supported providers: `openai`, `anthropic`, `google`, `nvidia`, `groq`, `together`, `deepseek`, `mistral`, `xai`, `perplexity`, `cerebras`, `deepinfra`, `openrouter`, `azure`, `bedrock`

### Environment Variables

| Var | Effect |
|-----|--------|
| `TARGET` | Override target URL |
| `LLM_PROVIDER` | Override provider |
| `LLM_MODEL` | Override model |
| `HEADLESS=false` | Force headed browser |
| `ULTIMATRIX_LLM_DEBUG=1` | Log LLM call details |
| `DEPLOYED=true` | HTTP-only mode (no browser) |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    SUPERVISOR AGENT                           │
│   Mastra Agent with 20+ tools (graph, control, OAST,        │
│   session, observation, HTTP, recon) + 7 Stagehand tools    │
└──────┬──────────────┬──────────────┬──────────────┬─────────┘
       ▼              ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │Injection │  │AuthCtrl  │  │Advanced  │  │  Recon   │
  │ Worker   │  │ Worker   │  │ Worker   │  │ Worker   │
  │SQLi,XSS  │  │IDOR,JWT  │  │Race,SSRF │  │Discovery │
  │WAF,Bypass│  │OAuth,Sess│  │Logic,XXE │  │Fingerprint│
  └──────────┘  └──────────┘  └──────────┘  └──────────┘
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                      │
         ┌────────────▼────────────────────────┐
         │          TYPEGRAPH                   │
         │  8 node types, 10 edge types        │
         │  JSON-backed, queryable via tools    │
         └────────────┬────────────────────────┘
                      │
         ┌────────────▼────────────────────────┐
         │        ACTION RECORDER              │
         │  Tool calls → Interaction nodes     │
         │  → Test cases (happy/sad/edge/sec)  │
         │  → Playwright .spec.ts files        │
         └─────────────────────────────────────┘
```

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Supervisor** | `src/manager/agent.ts` | Mastra Agent orchestrating the Observe-Learn-Attack loop |
| **4 Workers** | `src/workers/` | Specialist agents: injection, authControl, advanced, recon |
| **Mastra Factory** | `src/mastra/index.ts` | Centralized agent creation with schema sanitization |
| **Model Factory** | `src/models/factory.ts` | Resolves AI SDK LanguageModelV2 instances per provider |
| **Schema Sanitizer** | `src/models/schema-sanitizer.ts` | Strips provider-incompatible JSON Schema keywords |
| **Spider Agent** | `src/spider/agent.ts` | Stagehand-based hybrid crawler |
| **Action Recorder** | `src/recorder/` | Records browser actions → test cases → Playwright code |
| **TypeGraph** | `src/graph/` | 8 node types, 10 edge types, JSON-backed graph store |
| **Intelligence** | `src/intelligence/` | Auth flows, RBAC, chain detection, hypothesis generation |
| **OAST Server** | `src/oast/` | Blind callback detector for XSS/SSRF/SQLi/XXE |
| **Skill Registry** | `src/skills/` | Plugin system for extensible attack techniques |
| **Agent Manager** | `src/lib/agent-manager.ts` | Singleton: owns browser, workers, supervisor, OAST |
| **Web UI** | `src/app/`, `src/components/` | Next.js 15 + shadcn/ui interface |
| **Config** | `src/config.ts` | Provider registry, validation, YAML loading |

### Web UI

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chat` | POST | Agent streaming via `toAISdkV5Stream` SSE |
| `/api/status` | GET | Agent state (initialized, model, target, findings) |
| `/api/config` | GET/POST | Read/update LLM config + browser settings |
| `/api/findings` | GET | Finding nodes from graph, filterable by severity/type |
| `/api/code` | GET | Generated Playwright test code |
| `/api/activity` | GET | SSE event stream for live activity log |

---

## Tools (30+)

### HTTP (4)
`httpRequest` · `multipartUpload` · `followRedirects` · `omitHeader`

### Observation (6)
`parseResponse` · `evaluateRendered` · `measureTiming` · `compareResponses` · `checkWaf` · `findEndpointsInResponse`

### Session (3)
`extractSessionCookie` · `extractCsrfToken` · `useSession`

### Control (3)
`recordEvidence` · `writeFinding` · `recordTestCase`

### Graph (6)
`queryGraph` · `updateGraph` · `getTestCoverage` · `getAttackPath` · `getUntestedActions` · `getAuthFlows`

### Recon (5)
`runRecon` · `graphqlIntrospect` · `jwtDecode` · `frameworkFingerprint` · `cloudMetadataProbe`

### App Model (2)
`readAppModelSection` · `writeAppModelSection`

### OAST (3)
`getOastUrlTool` · `checkOastCallbacks` · `clearOastCallbacks`

### Interactive (1)
`askUser`

### Stagehand Browser (7)
`stagehand_act` · `stagehand_extract` · `stagehand_observe` · `stagehand_navigate` · `stagehand_tabs` · `stagehand_close` · `stagehand_screenshot`

### Supervisor-only (5)
`skillSearch` · `skillLoad` · `spawnWorker` · `spawnSwarm` · `executeDirect`

---

## Observe-Learn-Attack Loop

The supervisor cycles through three phases:

1. **Observe** — Query the graph and app model. If nothing is known, delegate to recon worker.
2. **Learn** — Analyze endpoints, parameters, auth requirements, tech stack. Identify untested actions.
3. **Attack** — Generate hypotheses, delegate to specialist workers, chain findings, record evidence.

**Chain rules** (7 built-in): XSS + session cookies → session hijack, hijack + admin panel → IDOR, IDOR + user data → privilege escalation, open redirect + auth callback → token theft, SQLi → data exfiltration, SSRF → internal network scan, IDOR → mass assignment.

---

## Testing

```bash
npm test                    # 333 tests (23 files) — should all pass
npm run test:watch          # Watch mode
npm run lint                # TypeScript type checking
npm run build               # tsup + next build
npm run validate            # Setup validation
```

### Test structure

Tests live in `test/` organized by module:

```
test/
├── browser/          # State bridge import/export
├── config/           # Config loading, validation
├── events/           # Event emitter
├── graph/            # TypeGraph store, tools
├── intelligence/     # Auth recorder, chaining, hypotheses
├── memory/           # Memory store, schemas
├── models/           # Config factory, schema sanitizer, provider integration
├── oast/             # OAST server, store
├── recorder/         # Codegen, interaction recording, test generation
├── tools/            # Tool registry, app model tools
└── workers/          # Worker creation, delegation
```

---

## Development

```bash
npm run dev         # next dev (hot reload)
npm run cli         # CLI with tsx
npm run web         # web UI
npm run build       # production build (tsup + next)
npm run clean       # remove dist/ + .next
```

## Requirements

- Node.js 20+
- Playwright (Chromium)
- 8GB+ RAM recommended for large scans

## License

MIT.

> "Real attacks, not theoretical." — every primitive here is something we've seen in the wild, named as the attacker would name it.
