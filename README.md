# Ultimatrix

**An AI security researcher in your terminal.** An LLM-driven agent composes attack plans from a plugin-based primitive catalog, executes them via a single HuntCore event stream, and drives four front-ends (TUI, headless CI, chat, HTML report) from the same continuous loop.

Real attacks, not theoretical. Real chains across 10 vulnerability classes. No mocks.

> ⚠️ **Under active development. Not yet published.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![1168 Tests](https://img.shields.io/badge/Tests-1168%20passing-success.svg)](#testing)
[![Node 20+](https://img.shields.io/badge/Node-%3E%3D20-green.svg)]()

---

## What it does

A hunt is one continuous event stream (HuntCore). Four front-ends render it differently:

1. **Spider** the target (Playwright-driven, depth 2 default) — discovers routes, forms, cookies, storage
2. **Recon** in parallel — OAuth / GraphQL / JWT / cloud / framework fingerprints
3. **Compose plans** — the LLM reads the app model and proposes 1–3 attack plans per endpoint
4. **Execute primitives** — each plan is a sequence of primitives (HTTP request, payload craft, response compare, timing, WAF check, etc.)
5. **Spawn specialists on signal** — if a primitive returns a 403, the WAF-bypass specialist is spawned; if storage + reflection pattern is detected, the second-order specialist; if you `/chain`, the chain-reasoning specialist
6. **Triage** — heuristics + 1 LLM call ("is this finding real?") + 1 adversarial LLM call ("try to falsify it"); 2/3 votes = confirmed
7. **Report** — self-contained HTML dashboard (no CDN, no JS framework), SARIF for CI, plain text, diff vs last hunt, zip export

### Four front-ends, one loop

| Front-end | When to use | Output |
|---|---|---|
| **TUI** (`ink@5`) | Interactive hunt on your laptop | Live activity, findings, screenshots, chat |
| **Headless CI** | GitHub Actions / GitLab / any CI | SARIF 2.1.0, JSON, plain; exit 0/1/2/3 |
| **Chat REPL** | Step-by-step hunt with prompt | Free-form commands, `/auto`, `/guided` |
| **HTML Report** | Post-hunt review, share with team | Self-contained, diff vs prior, zip export |

---

## Architecture

### v4 "Menace" — one core, four front-ends

```
                  ┌─────────────────────────────────────────┐
                  │              HuntCore                    │
                  │  single event stream (15 event types)    │
                  │  findings, behavior, llm-tokens, etc.    │
                  └──────────────────┬──────────────────────┘
                                     │
       ┌─────────────┬──────────────┬┴──────────────┬─────────────┐
       ▼             ▼              ▼               ▼             ▼
    TUI ink       Headless CI     Chat REPL      Report HTML   Web UI
   (4-pane)     (SARIF/JSON/    (interactive)   (self-contained
                 plain; exit                     no CDN, no JS
                 0/1/2/3)                       framework)
```

The HuntCore is the system of record. Each front-end is a pure projection of the same event stream. The agent loop, the recorder, the OOB server, the multi-session pool, the specialists — all talk to HuntCore, not to each other.

### Plugin architecture + 23 primitives

Primitives are **plugins**, not hardcoded switch cases. The `PrimitivePluginRegistry` singleton manages lifecycle hooks (`beforePrimitive`, `afterPrimitive`) and auto-recording via `toPlaywrightStep` metadata. Built-in primitives register themselves on startup; future MCP plugins can add primitives from any language.

`httpRequest` · `multipartUpload` · `followRedirects` · `craftPayload` · `craftBypass` · `craftXmlEntity` · `craftMultipart` · `injectInContext` · `omitHeader` · `parseResponse` · `evaluateRendered` · `measureTiming` · `compareResponses` · `checkWaf` · `findEndpointsInResponse` · `extractSessionCookie` · `extractCsrfToken` · `useSession` · `spawnSubtask` · `recordEvidence` · `writeFinding` · `spiderCrawl` · `recordTestStep`

The **meta-orchestrator** has only 7 `MANAGER_PRIMITIVES` + `spawnAgent`. HTTP, crafting, and injection work must be delegated to sub-agents — forcing natural decomposition.

### 9 specialists (v2, pluggable factories)

`jwt` · `oauth` · `race` · `graphql` · `idor` · `cloud` · `waf-mutator` · `xss` · `second-order`

Each is a factory with `shouldInclude(plan)` and `build(plan, ctx)`. Specialists are only spawned when the agent's primitives hit a signal (403, storage + reflection, /chain command, etc.).

### 5 OOB categories

`SSRF` · `blind XSS` · `blind SQLi` · `XXE` · `deserialization`

Each template contains `{host}` and `{uuid}` placeholders, so `withOobCallback(uuid, mutate, send)` can substitute the local OAST server's URL.

---

## Why not just use a fuzzer / scanner?

Because the bug surface is the **chain**. A scanner finds 5 things. A human finds 5 things, sees that the SSRF + the JWT + the parameter-pollution bug combine to a critical. An LLM-driven agent does the same, in the time a human takes, with reproducible evidence and a regression test.

Concretely: a hunt writes `output/live.spec.ts` (always valid) during the run, then auto-finalises it to `output/live.finalised.spec.ts` at the end. A recording plugin hooks every primitive call that declares `toPlaywrightStep` metadata — so the spec captures navigations, injections, and verifications without the LLM remembering. Run it with `npx playwright test output/live.finalised.spec.ts`. When the bug gets fixed, the test fails. When it regresses, the test fails. That's free CI.

---

## Quick start

```bash
# Install
npm install
npx playwright install chromium

# Set an LLM API key
export GROQ_API_KEY=gsk_...

# Hunt a target
npx ultimatrix hunt -t https://your-app.com --auto

# Or run the canned demo (90s, no target needed)
npm run demo
```

See [USAGE.md](USAGE.md) for the full command reference, configuration, interactive REPL, web UI, CI integration, and extension guide.

---

## Configuration

### LLM provider

Ultimatrix auto-detects in this order: `groq → together → openai → anthropic → gemini → openrouter → azure-openai → mistral → nvidia → bedrock → mock`.

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

`npx ultimatrix setup` walks through this interactively.

### Project yaml

```yaml
provider:
  name: groq
  model: llama-3.3-70b-versatile
scan:
  target: https://your-app.com
output:
  dir: ./output
  format: html
hunt:
  maxRuntimeSeconds: 1800
  spiderDepth: 2
  skip:
    - spider
```

### Env vars

| Var | Effect |
|---|---|
| `ULTIMATRIX_LLM_DEBUG=1` | Log LLM call sites, tokens, duration |
| `ULTIMATRIX_LLM_STREAM=1` | Stream tokens to TUI / web |
| `HUNT_DEBUG=1` | Verbose hunt logging |
| `PORT` / `HOST` | Web UI bind (default 3000 / 0.0.0.0) |

---

## Testing

```bash
npx vitest run          # 1168 tests, 8 skipped
npx tsc --noEmit        # 0 type errors
npx tsup                # clean build (ESM + CJS + .d.ts)
```

### Test layers

- **Unit** — primitives, helpers, parsers, formatters
- **Behavioral** — `makeStep`, `BehavioralAnalyzer`, `LiveTestWriter` always-valid output
- **Multi-session** — `MultiSessionPool` BOLA detection, cookie isolation
- **OOB** — 5 categories, `withOobCallback`, OAST singleton
- **CI** — `toJson` / `toPlain` / `toSarif`, exit code 0/1/2/3
- **Report** — diff fingerprint, HTML self-containment, ZIP store-mode
- **CLI** — `runDoctor`, `runDemo`, `finalizeLiveSpec`

---

## Roadmap

- **v4 "Menace"** — Blocks 0-21 shipped. HuntCore + 4 front-ends + plugin-based primitives + 9 specialists + 5 OOB + SARIF + HTML + doctor + demo + auto-codegen. Plugin registry replaces hardcoded PRIMITIVE_CATALOG; delegation-first meta-orchestrator.
- **v5** — Triage that surfaces *why* a finding is a finding (not just that it is); browser-side exploit proof (e.g. headless XSS proof of execution); multi-target runs; LLM-side remediation.

---

## License

MIT.

> "Real attacks, not theoretical." — every primitive here is something we've seen in the wild, named as the attacker would name it.
