# Ultimatrix

**AI-Powered Autonomous Web Security Operator** — Spider crawls targets, then a single LLM-driven strategist launches parallel worker threads that craft payloads and analyze raw HTTP responses for vulnerabilities. No canned payload lists, no regex detection modules, no sub-agents.

> ⚠️ **Under active development.** Not yet published.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![501 Tests](https://img.shields.io/badge/Tests-501%20passing-success.svg)](#testing)

---

## Quick Start

```bash
npm install
npx tsx src/cli/index.ts hunt -t https://your-app.com -o ./output
```

One command: spider → recon → multi-session RBAC testing → attack chains → Playwright regression tests → chain-first report.

```bash
# autonomous mode (no prompts)
npx tsx src/cli/index.ts hunt -t https://your-app.com --auto

# guided mode (default): prompts per node, slash commands inside
npx tsx src/cli/index.ts hunt -t https://your-app.com --guided
```

---

## CLI Commands

| Command | What it does |
|---------|-------------|
| **`hunt -t <url>`** | **Canonical flow:** spider + recon + multi-session RBAC + chains + Playwright tests |
| `assess -t <url>` | *Deprecated:* alias for hunt (v1 REPL fallback for `--v3` flag) |
| `interact -t <url>` | *Deprecated:* legacy chat REPL |
| `verify -a <model.json> -t <url>` | Re-run findings against a fresh deployment |

## `hunt` flags

```
-t, --target <url>            Target URL (required)
-o, --output <dir>            Output directory (default ./output)
--guided / --auto             Prompt vs autonomous (default guided)
--depth <n>                   Spider depth (default 2)
--max-runtime <seconds>       Hard time limit (default 1800)
--no-tests                    Skip Playwright test generation
--tests-dir <dir>             Where to write Playwright tests
--no-chains                   Skip attack chain engine
--no-recon                    Skip recon layer (OAuth/GraphQL/JWT/cloud/framework)
--no-spider                   Skip spider, load existing model
--existing-model <path>       Resume from a previous app-model.json
```

In guided mode, you can type slash commands at any prompt:
```
/auto /guided /findings /test /report /add <url> /help /quit
```
| `init` | Interactive config wizard |

### `assess` flags

```
--depth <n>      Crawl depth (default 2, use 1 for fast scans)
--skip-explore   Skip spider crawl, reuse existing app model
--dashboard      Live WebSocket dashboard on port 51828
--fresh          Delete previous output before starting
--max-calls <n>  Limit strategist tool calls per turn (default 50)
--keep-browser   Keep Playwright browser open after assessment
```

---

## How It Works

```
assess → [Spider crawl] → [Strategist fires workers] → [Report + Playwright test]
                │                     │
                ▼                     ▼
        app-model.json         worker 1 (sqli) ──→ LLM crafts payload → fetch → LLM analyzes
        endpoints + forms      worker 2 (xss)  ──→ ... parallel background workers
        auth, tech stack       worker 3 (ssrf) ──→ OAST callbacks for blind detection
                               worker N (...)  ──→ results auto-persist to app model
```

1. **Spider crawls** — Playwright BFS crawl. Extracts routes, forms, cookies, scripts, localStorage. Builds `app-model.json`.
2. **Strategist loop** — Single LLM with 45 tools. Fires fire-and-forget workers in parallel (3-5 per turn), checks findings periodically, stops when coverage is adequate.
3. **Workers** — Each worker receives a hypothesis (endpoint + param + technique). **Multi-signal detection**: the worker's LLM generates a payload, sends the HTTP request, then reads the raw response looking for SQL errors, stack traces, file contents, command output, template rendering, reflection, status anomalies, timing deltas, and redirect anomalies.
4. **OAST** — Built-in callback server for blind SSRF/XXE/open-redirect detection. Workers auto-embed UUIDs, check `/api/check` after their loop.
5. **Stored XSS** — Workers follow up POST requests with a GET to the action URL to detect stored payloads.
6. **Playwright test** — Auto-generated every 3 turns and at the end. Two parts: User Flow (narrative replay) + Assessment Flow (regression tests).
7. **Triage** — Rule-based evidence scoring and dedup runs after the strategist finishes.

### Key Design Decisions

- **Detection is entirely LLM-driven** — Workers read raw HTTP response bodies and quote verbatim evidence. No regex, no payload lists, no detection scripts.
- **Workers are LLM agents in `worker_threads`** — 6-attempt budget, 2 LLM calls per attempt (generate + analyze), 180s timeout. Crash isolation — a crashed worker doesn't affect others.
- **Fire-and-forget** — `spawn_worker` returns immediately. Workers run in background and write findings to `app-model.json` asynchronously. The strategist reads findings to see what was discovered.
- **Prompts avoid safety filter triggers** — No "exploit", "attack", "payload", "injection", "malicious". Uses "test input", "test string", "security test".
- **Body excerpts ≥5000 chars** — Reflected payloads often appear after large CSS blocks. Small windows miss them.

---

## Output Structure

```
output/
├── app-model.json                — 18-section knowledge graph (findings, hypotheses, endpoints, etc.)
├── final-security-report.{md}    — Assessment report with Mermaid graphs
├── playwright/
│   └── assess-flow.spec.ts       — Auto-generated Playwright test suite
└── oast-callbacks.json           — OAST callback records (persists across crashes)
```

### App Model Sections

| Section | Purpose |
|---------|---------|
| `findings` | Vulnerabilities found with verbatim quoted evidence |
| `hypotheses` | Things to test (endpoint + param + technique) |
| `workerActions` | Worker attempt log (payloads sent, responses, analysis) |
| `endpoints` | Known API routes with params and methods |
| `forms` | Form inputs found on each page |
| `workflow` | Nodes (pages/APIs) + Edges (transitions) |
| `oastCallbacks` | OAST callback records for blind detection |
| `coverage` | Endpoint/param/method coverage tracking |

---

## Testing

```bash
npx vitest run          # 223 tests, 15 files pass
npx tsc --noEmit        # 0 type errors (2 pre-existing: deleted workflow-builder)
```

---

## Architecture

```
src/
├── cli/               — CLI commands + REPL
├── core/              — AppModel, BrowserSession, worker-agent, attack-plan
├── providers/         — 11 LLM provider factories (OpenAI, Anthropic, Bedrock, etc.)
├── tools/             — 45 tools: browser, network, exploit, recon, knowledge, etc.
├── pipeline/          — AutonomousOrchestrator (strategist loop)
├── explorer/          — Spider crawler, form explorer, SPA route discovery
├── dashboard/         — WebSocket live dashboard
├── ingestion/         — OpenAPI/HAR/Postman/source-code parsers
├── prompts/           — STRATEGIST_PROMPT
├── triage/            — Rule-based finding scoring and dedup
├── oast/              — OAST callback server with file persistence
├── browser/           — Playwright browser management
├── engine/            — Report compilation, Mermaid graph rendering
└── verification/      — Re-run findings against new deployment
```

---

## License

MIT
