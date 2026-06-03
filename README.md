# Ultimatrix

**Autonomous web security testing** — one command: spider → recon → multi-session RBAC → attack chains → Playwright regression tests → chain-first report. Hand-rolled deterministic probes execute real attacks; LLM reasoning layers in chain logic and report narrative.

> ⚠️ **Under active development. Not yet published.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![505 Tests](https://img.shields.io/badge/Tests-505%20passing-success.svg)](#testing)

---

## What this is, honestly

**Today, `hunt` actually attacks webapps.** Every node in the workflow graph is tested by a hand-rolled probe that crafts real payloads, sends real HTTP requests, and inspects real responses. There is no LLM in the critical attack path.

**Why hand-rolled probes?** Because the LLM was too slow for the hackathon deadline (30s-4 minutes per call on NVIDIA NIM). The probes are fast (8-second scan of 19 endpoints in the demo target) and provable via 4 live integration tests against a real vulnerable app.

**What the LLM is still good for:** the heuristic chain engine has an optional LLM mode for novel chain reasoning, and the prompts are designed to slot back in when the LLM is fast enough.

---

## 30-second demo

```bash
npm install
npx tsx src/cli/index.ts hunt -t https://your-app.com --auto --no-spider \
  --seed-urls / /api/users /api/users/1 /api/posts
```

What you get:
- 18-section `app-model.json` (findings, endpoints, OAuth providers, JWT tokens, cloud probes, attack chains, …)
- `output/report.html` — chain-first report with Mermaid diagrams
- `output/report.md` — text version
- `playwright-tests/attack-*.spec.ts` — one regression test per finding
- `playwright-tests/chain-*.spec.ts` — one per attack chain

**Real proof from a live run:**
```
▸ Ultimatrix hunt → http://127.0.0.1:4567
  [1/5] Spidering...     ↳ discovered 10 URLs, 10 routes
  [3/5] v3 orchestrator  ↳ workflow graph: 19 reachable nodes
                          ↳ 3 new findings (3 total)
  [6/6] Compiling report...
✓ Hunt complete in 8s
  findings: 3  chains: 0
  report:   output\report.html
```

```
## Findings (3)
- HIGH — idor-v3 on http://127.0.0.1:4567/api/users/1
- HIGH — idor-v3 on http://127.0.0.1:4567/api/users/2
- HIGH — idor-v3 on http://127.0.0.1:4567/api/users/3
```

---

## Quick Start

```bash
npm install
npx tsx src/cli/index.ts hunt -t https://your-app.com -o ./output
```

For the demo target (vulnerable Node.js app on port 4567):
```bash
# start the demo target
node demo-target/server.js &

# run the hunt
npx tsx src/cli/index.ts hunt -t http://127.0.0.1:4567 --auto --no-spider \
  --seed-urls / /api/users /api/users/1 /api/posts /api/preview /api/render \
              /api/transfer /api/coupons/redeem /graphql /api/upload \
              /oauth/authorize /.well-known/openid-configuration /admin/dashboard
```

---

## CLI Commands

| Command | What it does | Status |
|---------|-------------|--------|
| **`hunt -t <url>`** | Canonical flow: spider + recon + multi-session RBAC + chains + Playwright tests | **Active** |
| `assess -t <url>` | Legacy spider + LLM strategist REPL | **Deprecated** (warns) |
| `interact -t <url>` | Legacy chat REPL | **Deprecated** (warns) |
| `verify -a <model> -t <url>` | Re-run findings against fresh deployment | Active |
| `init` | Interactive provider config wizard | Active |
| `tools` | List available security tools | Active |

---

## `hunt` flags

```
-t, --target <url>            Target URL (required)
-o, --output <dir>            Output directory (default ./output)
--guided                      Step-by-step mode with prompts (default)
--auto                        Autonomous mode (no prompts)
--depth <n>                   Spider depth (default 2)
--max-runtime <seconds>       Hard time limit (default 1800)
--max-nodes <n>               Cap orchestrator at N nodes (default 50)
--no-tests                    Skip Playwright test generation
--tests-dir <dir>             Where to write Playwright tests
                              (default ./playwright-tests)
--no-chains                   Skip attack chain engine
--no-recon                    Skip recon layer
                              (OAuth/GraphQL/JWT/cloud/framework)
--no-spider                   Skip spider, load existing model instead
--existing-model <path>       Resume from a previous app-model.json
--seed-urls <a> <b> ...       Seed the workflow graph with known URLs
                              (relative paths resolved against target origin)
HUNT_DEBUG=1                  Log every probe attempt to stderr
```

### Slash commands (guided mode)

Type any of these at a prompt:
```
/auto            switch to autonomous mode
/guided          switch to step-by-step
/findings        list current findings
/test            generate Playwright tests from findings
/report          render the HTML report now
/add <url>       add a URL to the workflow graph
/help            list all slash commands
/quit            exit
```

---

## How It Works (the real architecture)

```
hunt
  1. Spider       Playwright BFS → routes, forms, cookies, storage
                  Builds AppModel from discovered surface
  2. Recon        5 parallel probes:
                    OAuth discovery (.well-known/openid-configuration)
                    GraphQL discovery (introspection)
                    JWT discovery (decode, flag alg=none)
                    Cloud-metadata probe (9 targets with OAST)
                    Framework fingerprint (15 signatures)
  3. v3 Orchestrator
                  Workflow DAG = one node per reachable URL
                  For each node:
                    a. resolveStrategy() picks technique from URL shape
                    b. onBeforeNode hook prompts user (guided) or proceeds
                    c. workerFactory() dispatches to hand-rolled probe
                    d. finding (if any) is persisted to app-model.json
  4. Chain engine Heuristic + optional LLM
                  7 chain templates: SSRF→cloud, OAuth→admin, JWT→BFLA,
                  race→drain, GraphQL→dump, upload→RCE, SSTI→RCE
  5. Test gen     One Playwright spec per finding + per chain
  6. Report       chain-first HTML with Mermaid + markdown
```

### Hand-rolled attack probes (the core)

Every technique the orchestrator infers is mapped to a real, deterministic probe that **actually sends attack payloads**:

| Technique | Probe |
|-----------|-------|
| `ssrf` | Cloud-metadata probe — tries AWS IMDSv1/v2, GCP, Azure, DO, Oracle |
| `open-redirect` | OAuth prefix-bypass (5 sub-probes) + generic Location-header check |
| `race` | 8 parallel requests, reports `successCount > 1` |
| `sqli` | Real engine signatures (`mysql|postgres|sqlite|ora-N|sqlexception`) + boolean-based length delta > 50 bytes |
| `xss` | Sends `<script>ultimatrixXss{ts}</script>`, checks unescaped reflection |
| `ssti` | 3 template payloads (`{{7*7}}`, `${7*7}`, `<%= 7*7 %>`) |
| `idor` | Sequential ID enumeration, compares response bodies |
| `xxe` | Sends XML with `<!ENTITY xxe SYSTEM "file:///etc/passwd">` |
| `path` | 3 traversal encodings |
| `cmd` | 4 shell metachar payloads |

### Recon layer

Finds endpoints the HTML spider misses. Pure HTTP, no browser:
- `oauth-discovery` — fetches `/.well-known/openid-configuration`, probes 10 common authorize paths, extracts `client_id` from HTML
- `graphql-discovery` — probes 10 common paths, sends introspection query, classifies field sensitivity (public/user/admin) by name patterns
- `jwt-discovery` — decodes tokens from cookies/localStorage/auth.tokens; flags `alg=none`, expired, `kid`/`jku`/`x5u`
- `framework-fingerprint` — 15 signatures (Next.js, React, Vue, Angular, Django, Rails, Express, Spring, Laravel, Flask, FastAPI, ASP.NET, Phoenix, Gin)
- `cloud-metadata-probe` — 9 metadata targets with optional OAST callback

### Chain reasoning engine

`src/core/attack-chain.ts` — 7 templates, 3 modes:

| Mode | What it does |
|------|--------------|
| `heuristic` | Pure pattern-matching — no LLM. Looks for finding type combos. |
| `llm` | Calls OpenAI-compatible API, asks the LLM to identify chains |
| `hybrid` | Heuristic first, LLM only for novel combos |

Templates covered:
- SSRF → cloud metadata → AWS S3 credential exfil
- OAuth redirect_uri bypass → admin role
- JWT `alg=none` / signature bypass → admin
- Race condition → balance / coupon drain
- GraphQL introspection → mass data dump
- File upload with Content-Type bypass → RCE
- SSTI → arbitrary code execution

---

## Output Structure

```
output/
├── app-model.json              — 18-section knowledge graph
├── report.html                 — chain-first HTML with Mermaid
├── report.md                   — text report
├── session-trace.har           — browser trace
└── oast-callbacks.json         — blind-SSRF callbacks

playwright-tests/               — auto-generated regression tests
├── playwright.config.ts
├── fixtures/
│   ├── findings.ts             — all findings as data
│   └── auth.ts                 — auth helpers
├── attack-<id>.spec.ts         — one spec per finding
└── chain-<id>.spec.ts          — one spec per chain
```

### AppModel sections (18)

`target` · `techStack` · `auth` · `workflow` · `endpoints` · `forms` · `scripts` · `cookies` · `localStorage` · `findings` · `verifications` · `parameterClassifications` · `authBoundaries` · `recordedSessions` · `hypotheses` · `nextSteps` · `visitedUrls` · `oauthProviders` · `graphqlEndpoints` · `jwtTokens` · `frameworks` · `cloudProbes` · `reconLog` · `attackChains` · `coverage`

---

## Testing

```bash
npx vitest run         # 505 tests, 47 files, 1 skipped (CrAPI opt-in)
npx tsc --noEmit       # 0 type errors
npx tsup               # clean build
```

The test suite includes 4 **live integration tests** (`tests/cli/hunt-worker.test.ts`) that spawn the demo target and assert the worker detects IDOR, SSTI (`<%= 7*7 %>` → "49"), SSRF, and OAuth redirects.

---

## Project Structure

```
src/
├── cli/                        — CLI commands + REPL
│   ├── hunt.ts                 — main hunt command
│   ├── hunt-flags.ts           — pure option parser (unit-testable)
│   ├── prompt.ts               — readline REPL with slash commands
│   └── index.ts                — commander.js entry, subcommand routing
├── core/                       — AppModel, session, attack engine
│   ├── app-model.ts            — 18-section model, risk calculation
│   ├── attack-chain.ts         — chain engine (heuristic + LLM)
│   ├── chain-report.ts         — chain-first HTML report
│   ├── session-pool.ts         — multi-session RBAC
│   └── workflow-state.ts       — DAG with reachable/completed states
├── recon/                      — pre-attack discovery layer
│   ├── oauth-discovery.ts      — well-known + authorize paths
│   ├── graphql-discovery.ts    — introspection
│   ├── jwt-discovery.ts        — cookie/storage decode
│   ├── framework-fingerprint.ts — 15 framework signatures
│   └── cloud-metadata-probe.ts — 9 metadata targets
├── agents/specialists/         — hand-rolled attack probes
│   ├── oauth-probes.ts         — 5 OAuth bypass techniques
│   ├── cloud-probes.ts         — 4 metadata targets + S3 enumeration
│   ├── race-probes.ts          — N-parallel race condition
│   ├── waf-mutator-probes.ts   — 9 WAF bypass mutations
│   └── waf-mutator.ts          — LLM variant
├── pipeline/
│   ├── autonomous-v3.ts        — workflow-DAG orchestrator
│   └── assess-v3-runner.ts     — v1 compat wrapper
├── explorer/                   — Playwright BFS spider
├── tools/                      — tool registry
│   └── finding-test-generator.ts — Playwright codegen
├── providers/                  — 11 LLM provider factories
├── verification/               — re-run findings on new deployment
└── dashboard/                  — live WebSocket dashboard
```

---

## License

MIT
