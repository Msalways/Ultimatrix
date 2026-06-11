# Ultimatrix

**AI security researcher / autonomous penetration tester.** An LLM-driven supervisor orchestrates 4 specialist workers (injection, auth, advanced, recon) to discover vulnerabilities, chain findings, and generate replayable Playwright test suites. Every browser action is recorded as a TypeGraph node, annotated with happy/sad/edge/security test cases, and streamed to a `.spec.ts` file in parallel.

Real attacks, not theoretical. Real chains across 10+ vulnerability classes. No mocks.

> ⚠️ **Under active development. Not yet published.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-passing-success.svg)](#testing)
[![Node 20+](https://img.shields.io/badge/Node-%3E%3D20-green.svg)]()

---

## Quick Start

```bash
# Install
npm install
npx playwright install chromium

# Set an LLM API key (or use ultimatrix.yaml)
export GROQ_API_KEY=gsk_...

# Full autonomous pentest
npx ultimatrix assess -t https://your-app.com -o ./output

# Interactive REPL session
npx ultimatrix interact -t https://your-app.com

# Terminal UI
npx ultimatrix -t https://your-app.com --tui

# Web UI dashboard
npx ultimatrix web

# Re-run findings against a new deployment
npx ultimatrix verify -a output/app-model.json -t https://new-app.com
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `assess -t <url> -o <dir>` | Map → spider → extract → build model → test. Flags: `--depth`, `--skip-explore`, `--dashboard`, `--with-openapi/har/postman/src` |
| `scan -t <url> -o <dir>` | Autonomous pentest (reuses existing `app-model.json`) |
| `verify -a <model> -t <url>` | Re-run findings against fresh deployment |
| `interact -t <url>` | REPL chat loop with agent |
| `web` | Web UI dashboard at http://localhost:3000 |
| `--tui` | Terminal UI with 4-split-pane layout |
| `init` | Interactive provider setup wizard |

---

## Architecture (v5 — Action-as-Node)

```
┌──────────────────────────────────────────────────────────────────┐
│                      SUPERVISOR AGENT                             │
│   14 tools: queryGraph, updateGraph, delegateToWorker,            │
│   recordEvidence, writeFinding, askUser, getTestCoverage,         │
│   getUntestedActions, getAuthFlows, getOastUrl, checkOastCallbacks│
│   readAppModelSection, writeAppModelSection, delegateToWorker     │
└──────┬──────────────┬──────────────┬──────────────┬──────────────┘
       ▼              ▼              ▼              ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Injection│  │AuthControl│  │ Advanced │  │  Recon   │
  │ Worker   │  │  Worker   │  │  Worker  │  │  Worker  │
  │ SQLi,XSS │  │IDOR,JWT, │  │Race,Logic│  │Discovery │
  │WAF,2ndOrd│  │  OAuth   │  │ GraphQL  │  │FP,Crawl  │
  └──────────┘  └──────────┘  └──────────┘  └──────────┘
       │              │              │              │
       └──────────────┴──────────────┴──────────────┘
                      │
        ┌─────────────▼─────────────────────────┐
        │           ACTION RECORDER              │
        │  Every tool call → Interaction node    │
        │  → Test cases (happy/sad/edge/security)│
        │  → Playwright code streamed to file    │
        └─────────────┬─────────────────────────┘
                      │
        ┌─────────────▼─────────────────────────┐
        │           TYPEGRAPH                    │
        │  10 node types, 10 edge types          │
        │  SQLite-backed, queryable via Mastra    │
        │  tools                                 │
        └────────────────────────────────────────┘
```

### Components

- **Supervisor** (`src/manager/agent.ts`) — Mastra Agent with 14 tools. Runs the Observe-Learn-Attack loop. Spiders targets, delegates to workers, chains findings, records evidence.
- **4 Specialist Workers** (`src/workers/`) — Independent Mastra Agents with Stagehand + AgentBrowser:
  - **injection** — SQLi (error/boolean/time/UNION), XSS (reflected/stored/DOM), WAF bypass, second-order
  - **authControl** — IDOR (horizontal/vertical), JWT (alg confusion, weak secrets), OAuth (CSRF, redirect URI, scope)
  - **advanced** — Race conditions, business logic flaws, mass assignment, GraphQL introspection
  - **recon** — Route discovery, tech fingerprinting, API endpoint mapping, auth requirement detection
- **Spider Agent** (`src/spider/agent.ts`) — Hybrid crawler with Stagehand for natural language browsing + AgentBrowser for automation. Discovers pages, forms, hash routes, overlays, and auth flows.
- **Action Recorder** (`src/recorder/`) — Records every Interaction, generates test cases (happy/sad/edge/security), streams Playwright code in parallel. Session is resumable on crash.
- **Intelligence** (`src/intelligence/`) — Auth flow recording/replay, RBAC learning across roles, finding chaining (7 rules), dynamic hypothesis generation, session resume.
- **TypeGraph** (`src/graph/`) — Full CRUD graph store with 8 node types and 10 edge types. Wraps `@nicia-ai/typegraph`. Persisted to `output/graph.json`.
- **OAST Server** (`src/oast/`) — Local HTTP callback server for blind payload detection (XSS, SSRF, SQLi, XXE). Auto-starts before each session.
- **TUI** (`src/tui/`) — Ink-based 4-split-pane terminal UI (Chat, Activity, Code, Graph) + StatusBar. Launched with `--tui` flag.
- **Browser Bridge** (`src/browser/state-bridge.ts`) — State import/export between Stagehand and Playwright for shared auth sessions.

---

## TypeGraph Schema

### 8 Node Types

| Node | Properties |
|------|-----------|
| `Page` | url, method, contentType, status, tags, bodyPreview, requiresAuth |
| `Action` | actionType (goto/click/fill/act/extract), selector, url, value, naturalLanguage |
| `Input` | selector, inputType, name, placeholder, required, maxLength |
| `Test` | testType (happy/sad/edge/security), status, endpoint, technique, payload |
| `Finding` | severity (critical/high/medium/low/info), technique, endpoint, evidence[], remediation, cwe, confidence |
| `AuthFlow` | flowType (login/logout/refresh), steps[], reusable, credentialHash |
| `RBACRole` | roleName, accessibleEndpoints[], inaccessibleEndpoints[], visibleUIElements[] |
| `Attack` | technique, payload, vulnerable, confidence, timestamp |

### 10 Edge Types

`HAS_ACTION` · `HAS_INPUT` · `HAS_TEST` · `FOUND_ON` · `REQUIRES_AUTH` · `CHAINED_FROM` · `TARGETS` · `PRODUCED` · `HAS_ROLE` · `PERMISSION`

---

## Mastra Tools (22+)

### HTTP (4)
`httpRequest` · `multipartUpload` · `followRedirects` · `omitHeader`

### Injection (1)
`injectInContext`

### Observation (6)
`parseResponse` · `evaluateRendered` · `measureTiming` · `compareResponses` · `checkWaf` · `findEndpointsInResponse`

### Session (3)
`extractSessionCookie` · `extractCsrfToken` · `useSession`

### Control (2)
`recordEvidence` · `writeFinding`

### Graph (6)
`queryGraph` · `updateGraph` · `getTestCoverage` · `getAttackPath` · `getUntestedActions` · `getAuthFlows`

### App Model (2)
`readAppModelSection` · `writeAppModelSection`

### Recon (5)
`runRecon` · `graphqlIntrospect` · `jwtDecode` · `frameworkFingerprint` · `cloudMetadataProbe`

### Interactive (1)
`askUser`

### Stagehand (3)
`stagehandAct` · `stagehandExtract` · `stagehandAgent`

### OAST (3)
`getOastUrlTool` · `checkOastCallbacks` · `clearOastCallbacks`

---

## Observe-Learn-Attack Loop

The supervisor cycles through three phases:

1. **Observe** — Query the graph and app model to understand the target. If nothing is known, delegate to recon worker.
2. **Learn** — Analyze endpoints, parameters, auth requirements, technology stack. Identify untested actions.
3. **Attack** — Generate hypotheses per endpoint type, delegate to workers, chain findings, record evidence.

Chain rules (7 built-in):
- XSS + session cookies → session hijack
- Session hijack + admin panel → IDOR
- IDOR + user data → privilege escalation
- Open redirect + auth callback → token theft
- SQLi → data exfiltration
- SSRF → internal network scan
- IDOR → mass assignment

---

## Configuration

### LLM Provider

Auto-detection order: `groq → together → openai → anthropic → gemini → openrouter → azure-openai → mistral → nvidia → bedrock → mock`.

Three ways to configure:

1. **Env var**: `export GROQ_API_KEY=gsk_...`
2. **Project yaml** (`ultimatrix.yaml`):
   ```yaml
   provider:
     name: nvidia
     model: openai/gpt-oss-120b
   ```
3. **Global secrets** (`~/.config/ultimatrix/providers.yaml`):
   ```yaml
   nvidia:
     apiKey: nvapi-...
   ```

### Env Vars

| Var | Effect |
|---|---|
| `ULTIMATRIX_LLM_DEBUG=1` | Log LLM call sites, tokens, duration |
| `ULTIMATRIX_LLM_STREAM=1` | Stream tokens to TUI / web |
| `HUNT_DEBUG=1` | Verbose hunting logs |
| `PORT` / `HOST` | Web UI bind (default 3000 / 0.0.0.0) |

---

## Testing

```bash
npm test            # vitest run — all tests
npm run lint        # tsc --noEmit — 0 type errors
npm run build       # tsup — clean ESM + CJS + .d.ts
npm run test:watch  # vitest watch mode
npm run test:e2e    # E2E smoke test
```

### Test Layers

- **Unit** — Recorder, Graph, OAST, helpers, tools
- **Behavioral** — Interaction recording, code generation, test case generation
- **Chaining** — Finding chain detection and follow-up suggestion
- **OAST** — Callback recording, retrieval, storage
- **Browser Bridge** — State import/export
- **Worker** — Worker creation, tool counts, delegation

---

## Development

```bash
npm run dev         # tsx watch for hot reload
npm run cli         # run CLI with tsx
npm run demo        # canned demo (90s, no target needed)
npm run web         # start web UI
npm run clean       # remove dist/
```

## Requirements

- Node.js 20+
- TypeScript strict mode (enabled)
- Playwright (Chromium)

---

## License

MIT.

> "Real attacks, not theoretical." — every primitive here is something we've seen in the wild, named as the attacker would name it.
