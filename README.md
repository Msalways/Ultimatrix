# Ultimatrix

**An AI security researcher in your terminal.** Composer reads the target, proposes 1–3 attack plans, picks primitives from a 21-tool catalog, and recursively spawns specialist agents (WAF bypass, second-order, chain reasoning) when it hits a wall.

Real attacks, not theoretical. Real chains across 10 vulnerability classes. No mocks.

> ⚠️ **Under active development. Not yet published.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4+-blue.svg)](https://www.typescriptlang.org/)
[![543 Tests](https://img.shields.io/badge/Tests-543%20passing-success.svg)](#testing)
[![Node 20+](https://img.shields.io/badge/Node-%3E%3D20-green.svg)]()

---

## What it does

1. **Spider** the target (Playwright-driven, depth 2 default) — discovers routes, forms, cookies, storage
2. **Recon** in parallel — OAuth / GraphQL / JWT / cloud / framework fingerprints
3. **Compose plans** — the LLM reads the app model and proposes 1–3 attack plans per endpoint
4. **Execute primitives** — each plan is a sequence of primitives (HTTP request, payload craft, response compare, timing, WAF check, etc.)
5. **Spawn specialists on signal** — if a primitive returns a 403, the WAF-bypass specialist is spawned; if storage + reflection pattern is detected, the second-order specialist; if you `/chain`, the chain-reasoning specialist
6. **Report** — chain-first HTML with Mermaid, text MD, and Playwright regression tests

---

## Quick start

### CLI

```bash
npm install
export GROQ_API_KEY=gsk_...   # or OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
npx tsx src/cli/index.ts hunt -t https://your-app.com --auto
```

Or run the local demo target (vulnerable Node app on port 4567):

```bash
npx tsx src/cli/index.ts demo
```

### Web UI

```bash
npx tsx src/cli/index.ts web    # → http://localhost:3000
```

The UI shows a live agent tree (Composer → WAF / second-order / chain specialists), a streaming event log, and a target form. Click **Start hunt** and watch the LLM propose plans, execute primitives, and find real bugs.

---

## 10 attack classes, one catalog

| Class | Primitive sequence |
|---|---|
| **IDOR** | `useSession` (two roles) → `compareResponses` |
| **XSS (reflected)** | `craftPayload(xss)` → `injectInContext` → `evaluateRendered` |
| **XSS (stored / 2nd-order)** | `craftPayload(xss)` → `injectInContext` → `useSession` (re-fetch as different role) → `evaluateRendered` |
| **Open redirect** | `craftPayload(redirect)` → `followRedirects` |
| **Security headers** | `parseResponse` → header-missing heuristics |
| **SSRF** | `craftPayload(ssrf)` → `injectInContext` (URL params) → OAST |
| **SQLi** | `craftPayload(sqli)` → `injectInContext` → `compareResponses` / error-pattern |
| **SSTI** | `craftPayload(ssti)` → `injectInContext` → `evaluateRendered` (browser) |
| **File upload** | `craftMultipart` → `multipartUpload` → `parseResponse` (content-type) |
| **CSRF** | `extractCsrfToken` → `omitHeader` → `parseResponse` (token rejected?) |
| **XXE** | `craftXmlEntity` → `injectInContext` → `parseResponse` (file disclosure) |

The Composer can mix-and-match primitives in any order. Specialist composers (WAF bypass, second-order, chain reasoning) handle the recursive cases.

---

## Why this is different

**Other AI pentest tools have static agents.** "Agent #1 does XSS, agent #2 does IDOR, agent #3 does SQLi." They can't combine techniques on the fly.

**Ultimatrix has one Composer + 21 primitives + 3 specialists.** The LLM is the planner, not the executor. Primitives are deterministic — the LLM's job is to *pick which primitive to run next, in what order, on what target*. This means:

- An unknown attack class can be probed by composing existing primitives (e.g. "use `compareResponses` to detect if this object reference leaks auth state")
- When a primitive returns a 403, the WAF-bypass specialist takes over and crafts bypasses
- When a finding emerges, the chain-reasoning specialist can reason about how to chain it with others

**The recursion is depth-capped at 2** to prevent infinite loops.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Spider → Recon → Composer (LLM planner)                 │
│                          │                               │
│                          ▼                               │
│                   21 Primitives                          │
│   http · payload · inject · observe · session · control  │
│                          │                               │
│              ┌───────────┼───────────┐                   │
│              ▼           ▼           ▼                   │
│         WAF bypass   2nd-order   chain-reasoning         │
│        (depth 1)    (depth 1)    (depth 1)               │
│              │           │           │                   │
│              └───────────┼───────────┘                   │
│                          ▼                               │
│                Findings + Chains + Report                │
└──────────────────────────────────────────────────────────┘
```

### Primitives (21)

`httpRequest`, `multipartUpload`, `followRedirects`, `craftPayload`, `craftBypass`, `craftXmlEntity`, `craftMultipart`, `injectInContext`, `omitHeader`, `parseResponse`, `evaluateRendered`, `measureTiming`, `compareResponses`, `checkWaf`, `findEndpointsInResponse`, `extractSessionCookie`, `extractCsrfToken`, `useSession`, `spawnSubtask`, `recordEvidence`, `writeFinding`

### LLM providers (auto-detected)

Priority: `groq` → `together` → `openai` → `anthropic` → `gemini` → `openrouter` → `azure-openai` → `mistral` → `nvidia` → `bedrock` → `mock`

Set any of `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc. The first matching key wins. With no key, you get the mock LLM (canned responses, not useful for real attacks).

---

## CLI

```
ultimatrix hunt -t <url> [flags]
  --auto / --guided
  --depth <n>             spider depth (default 2)
  --max-runtime <ms>      hard time limit
  --no-tests              skip Playwright regression test generation
  --existing-model <p>    resume from a previous app-model.json
  --no-recon, --no-spider, --no-chains

ultimatrix web -p 3000    start the local web UI
ultimatrix demo           run a vulnerable Node app on port 4567
ultimatrix assess         legacy combined map+scan
ultimatrix scan           legacy one-shot scan
ultimatrix verify         re-run findings against a fresh deployment
ultimatrix interact       REPL chat with the agent
```

### Interactive slash commands (in `hunt --guided`)

| Command | What it does |
|---|---|
| `/auto` / `/guided` | Toggle between LLM-driven and step-by-step |
| `/plan` | Show the LLM's currently proposed plans for the next endpoint |
| `/attack <n>` | Execute plan #n manually |
| `/findings` | Print current findings |
| `/agents` | Show the spawned agent tree |
| `/chain` | Run LLM-reasoned chain analysis on accumulated findings |
| `/budget <time>` | Adjust the time budget mid-run (`15m`, `60s`, `2h`) |
| `/report` | Render the HTML report now |
| `/add <url>` | Add a URL to the workflow graph |
| `/test` | Generate Playwright regression tests |
| `/help` | List commands |
| `/quit` | Exit the hunt |

---

## Testing

```bash
npx vitest run        # 543 tests, 0 failures
npx tsc --noEmit      # 0 type errors
npx tsup              # clean build
```

The 543 tests cover:
- All 21 primitives (payload crafting, injection contexts, response observation, WAF detection, timing, session)
- Composer plan parsing, mock fallback, plan execution
- 3 specialist composers (WAF bypass, second-order, chain reasoning)
- Web server (static, healthz, 404)
- LLM client (provider detection, mock fallback)

---

## Configuration

### Environment variables

| Var | Provider |
|---|---|
| `GROQ_API_KEY` | Groq (default, fast, free tier) |
| `OPENAI_API_KEY` | OpenAI |
| `ANTHROPIC_API_KEY` | Anthropic Claude |
| `GOOGLE_API_KEY` | Google Gemini |
| `MISTRAL_API_KEY` | Mistral |
| `TOGETHER_API_KEY` | Together AI |
| `OPENROUTER_API_KEY` | OpenRouter |
| `AZURE_OPENAI_API_KEY` + `AZURE_OPENAI_ENDPOINT` | Azure OpenAI |
| `NVIDIA_API_KEY` | NVIDIA NIM |
| `AWS_*` | AWS Bedrock |

### Other vars

| Var | Effect |
|---|---|
| `HUNT_DEBUG=1` | Log every composer / primitive call to stderr |
| `PORT` | Web UI port (default 3000) |
| `HOST` | Web UI host (default 0.0.0.0) |

---

## Why no Fly.io / Docker

The project is a local CLI + local web UI. No cloud deployment is required. The web UI runs on `localhost:3000`; judges can run it with `npx tsx src/cli/index.ts web`. The npm package will be published so it can be invoked via `npx ultimatrix`.

---

## Next steps to go further

The current build is the v3 primitives + Composer core. The following were
deliberately deferred from this iteration and are the next things on the
roadmap — listed in the order we'd tackle them.

### Interactive web UI
- **Chat panel** — type free-form questions like *"test the login page for sqli"* and the LLM parses them into tool calls (`start_hunt`, `attack`, `browser_click`, `get_findings`, `generate_user_flow_test`). Hard-capped at 5 tool calls per turn.
- **Slash commands** — `/attack <tech> <url>`, `/findings`, `/state`, `/flow`, `/help` for direct dispatch without going through the LLM.
- **Active browser session** — a separate `manual` Playwright session distinct from the spider's `default` session. Snapshot polling at 1 fps streamed over WebSocket as base64 PNGs. Click / fill / navigate commands issued from the UI.
- **Manual interaction → test generation** — wrap the existing `startManualRecording` shim, capture click / fill / navigate steps, and feed them into `generateUserFlowSpec` to produce a runnable Playwright `user-flow.spec.ts` that re-attacks the same endpoint in a regression suite.

### Real-time / observability
- **Wire `onLog` + `onPrimitive` callbacks** through `Composer → AutonomousV3Orchestrator → web server` so the UI gets live `plan`, `primitive`, `finding`, and `chain` events (the `index.html` mockup already has dead handlers for these).
- **LLM token streaming** — already opt-in via `ULTIMATRIX_LLM_STREAM=1`; will become default once the web UI's auto-scroll polish lands.

### Accuracy / coverage
- **Spider SPA-route discovery** — better link-following for client-side routes (XSS-game levels 2-6 are unreachable today because they're not inter-linked).
- **Plan-target disambiguation** — the LLM sometimes picks the static source-viewer endpoint instead of the live attack target; the planner prompt already names the rule, but a post-parse validator that rejects "static" / "source" paths is the next defense layer.
- **Sink inference from body preview** — currently text-grep based; a small classifier (regex + LLM tiebreak) would lift recall.
- **True positive verification** — `writeFinding` requires a prior signal primitive, but we still log the attack; a heuristic replay that re-fires the primitive and asserts the same result before calling `writeFinding` would give a "confirmed" badge.

### Infrastructure
- **CDP screencast (real video)** — replaces the 1 fps snapshot polling with `Page.startScreencast` for smooth 30 fps H.264 video in the web UI. Larger binary frame handling, more polish required.
- **Multi-user collaboration** — one WebSocket per operator, shared state, presence indicators.
- **Chat history persistence** — survives server restarts (SQLite or JSONL on disk).
- **Tool-call UI affordances** — suggestion chips, action cards, "accept/reject" for LLM-proposed attacks.
- **"Feedback loop"** — the chat agent proposes attacks as natural-language suggestions; the operator accepts or rewrites them before execution.

### Packaging
- `npm publish` — the package is `ultimatrix`, ready for `npx`. Just need to cut a release.
- **GitHub Action** — `uses: anomalyco/ultimatrix-action@v1` to run a hunt on PRs and post findings as a comment.
- **Per-target profiles** — small YAML files that pre-set `--skip`, `--depth`, `--seed-urls` for known target classes (e.g. `crapi.yaml`, `juiceshop.yaml`).

---

## License

MIT
