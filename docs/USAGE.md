# Ultimatrix — Usage Guide

How to install, run, configure, and extend the AI security researcher.

---

## Prerequisites

```bash
node >= 20
npm install
# Playwright (only needed if you enable the spider)
npx playwright install chromium
```

---

## Command reference

| Command | Description |
|---|---|
| `npx ultimatrix hunt -t <url>` | Canonical hunt (spider → recon → attack → tests). Default mode: guided (step-by-step prompts). |
| `npx ultimatrix hunt -t <url> --auto` | Autonomous mode (no prompts). For CI and unattended runs. |
| `npx ultimatrix hunt -t <url> --guided` | Step-by-step REPL mode with slash commands. |
| `npx ultimatrix demo` | Canned xss-game screencast (90s, no target needed). Writes plain report to `./demo/`. |
| `npx ultimatrix doctor` | 7-check environment report. Network failures are warnings, not blockers. |
| `npx ultimatrix web` | Local web UI at http://localhost:3000 |
| `npx ultimatrix setup` | Configure LLM providers interactively (writes `~/.config/ultimatrix/providers.yaml`) |
| `npx ultimatrix tools` | List 23 primitives + 9 specialists + 5 OOB categories |
| `npx ultimatrix mcp serve` | Expose the hunt pipeline over MCP (stdio) for other AI tools |

All flags: `ultimatrix <subcommand> --help`.

Deprecated v1 commands (hidden from --help, backward compat only): `assess`, `interact`, `test`, `verify`. Use `hunt` instead.

### Common flags

| Flag | Applies to | Effect |
|---|---|---|
| `-t, --target <url>` | hunt | Target URL |
| `-o, --output <dir>` | hunt | Output directory (default `./output`) |
| `--max-runtime <s>` | hunt | Max runtime in seconds (default 1800) |
| `--depth <n>` | hunt | Spider crawl depth (default 2) |
| `--auto` | hunt | Autonomous mode |
| `--guided` | hunt | Interactive REPL mode |
| `--skip <phase>` | hunt | Skip phase: spider, recon, tests, interactive |
| `--existing-model <path>` | hunt | Reuse existing app-model.json |
| `--format <fmt>` | hunt | Report format: html, md, sarif, json, plain |
| `--fail-on <level>` | hunt | Exit code threshold: info, low, medium, high, critical |
| `--force-spider` | hunt | Re-spider even for same target |
| `--dashboard` | hunt | Open HTML report in browser after hunt |
| `-p, --port <n>` | web | Web UI port (default 3000) |
| `-H, --host <addr>` | web | Web UI host (default 0.0.0.0) |

---

## 1. Quick start

```bash
# 1. Install
npm install

# 2. Set an LLM key
export GROQ_API_KEY=gsk-...    # or OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.

# 3. Run
npx ultimatrix hunt -t https://your-app.com -o ./output
```

### Outputs

Artifacts land in `./output/`:

| Artifact | Description |
|---|---|
| `app-model.json` | Full 18-section knowledge base (routes, params, cookies, scripts, findings) |
| `report.html` | Self-contained HTML dashboard (no CDN, no JS framework) |
| `report.md` | Plain-text version for PR comments, Slack, email |
| `report.json` | Machine-readable findings for CI ingestion |
| `report.sarif` | SARIF 2.1.0 for GitHub Advanced Security / GitLab SAST |
| `diff.json` | Difference vs previous hunt (same output dir) |
| `live.spec.ts` | Playwright test capturing every confirmed finding |
| `playwright-tests/` | One finalised regression test per finding + per chain |

---

## 2. Hunt modes

### Autonomous (--auto)

No interaction. Good for CI and for letting the LLM drive end-to-end.

```bash
npx ultimatrix hunt -t https://your-app.com --auto
```

### Guided (--guided)

Step-by-step REPL with slash commands. You see every node the orchestrator queues and decide whether to proceed.

```bash
npx ultimatrix hunt -t https://your-app.com --guided
```

| Command | Effect |
|---|---|
| `/plan` | Show 1-3 LLM-proposed plans for the next endpoint |
| `/attack <n>` | Manually execute plan #n |
| `/findings` | List current findings |
| `/agents` | Show the spawned agent tree |
| `/chain` | Run LLM chain analysis on accumulated findings |
| `/auto` | Switch to autonomous mode |
| `/guided` | Switch back to step-by-step |
| `/budget 15m` | Adjust the time budget mid-run |
| `/report` | Render the HTML report now |
| `/add <url>` | Add a URL to the workflow graph |
| `/test` | Generate Playwright regression tests |
| `/help` | List commands |
| `/quit` | Exit |

#### Example session

```
$ npx ultimatrix hunt -t http://127.0.0.1:4567 --guided
▸ Ultimatrix hunt → http://127.0.0.1:4567
  mode: guided, output: ./output, max runtime: 1800s

[1/5] Spidering http://127.0.0.1:4567 (depth 2)…
  ↳ discovered 10 URLs, 10 routes
[2/5] Running recon (OAuth / GraphQL / JWT / cloud / framework)…
  ↳ 0 discoveries in 24ms (errors: 0)
[3/5] Launching v3 orchestrator…

── Node 7c8d9e ─────────────────
  url:      http://127.0.0.1:4567/api/users/1
  method:   GET
  technique: idor
  severity: high
  Proceed? [Y/s/i/d/a]: y

> /plan
  [1] idor on GET http://127.0.0.1:4567/api/users/1
      reason: parameter "id" suggests object reference
      primitives: useSession → compareResponses

> /attack 1
  + [HIGH] idor @ http://127.0.0.1:4567/api/users/1 (conf=0.82)

> /chain
  [1] account-takeover-via-stolen-session (critical)
      3 steps, confidence=0.74
```

### Interactive default

If you run `npx ultimatrix hunt -t <url>` without `--auto` or `--guided`, the default mode is guided (step-by-step prompts).

---

## 3. CI / SARIF integration

```bash
npx ultimatrix hunt -t https://your-app.com --auto --max-runtime 300 --format sarif --output ./report.sarif --fail-on high
```

Exit codes:

| Code | Meaning |
|---|---|
| 0 | No findings above threshold |
| 1 | Finding at or above `--fail-on` level |
| 2 | Critical finding |
| 3 | Internal error |

### GitHub Actions

```yaml
- name: Security hunt
  run: npx ultimatrix hunt -t ${{ secrets.TARGET_URL }} --auto --format sarif --output results.sarif --fail-on high
  continue-on-error: true

- name: Upload SARIF
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: results.sarif
```

### GitLab SAST

```yaml
security-hunt:
  script:
    - npx ultimatrix hunt -t $TARGET_URL --auto --format sarif --output gl-sast-report.sarif
  artifacts:
    reports:
      sast: gl-sast-report.sarif
```

---

## 4. Web UI

```bash
npx ultimatrix web -p 3000
# → http://localhost:3000
```

The UI:
- Form to enter target URL and hunt options
- Live agent tree (Composer → specialists)
- Streaming event log (plans, primitives, findings, chains)
- LLM token stream panel
- Findings panel with severity badges
- Re-spider button to refresh the app model
- No build step — the HTML is served directly from `dist/web/static/`

Smoke test:

```bash
curl http://localhost:3000/healthz
# {"ok":true}
```

---

## 5. Regression tests (auto-generated)

The hunt automatically writes a runnable Playwright test. No separate codegen command needed.

```bash
# Written automatically during the hunt:
output/
  live.spec.ts              ← always-valid, written AS the hunt runs
  live.finalised.spec.ts     ← auto-finalised at the end (has banner + README)

# Run it
npx playwright test output/live.finalised.spec.ts
```

Every primitive that declares `toPlaywrightStep` metadata gets auto-recorded by the recording plugin — no LLM prompt engineering needed to capture test steps.

---

## 6. Demo target

A vulnerable Node/Express app is shipped in `demo-target/`. It has 13 seeded vulnerabilities across all 10 attack classes.

```bash
# Terminal 1: start the target
npm run demo
# → http://127.0.0.1:4567

# Terminal 2: hunt it
npx ultimatrix hunt -t http://127.0.0.1:4567 --auto
```

Expect ~10 findings in 5-15 seconds with a real LLM key.

---

## 7. Configuration

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
| `HUNT_DEBUG=1` | Log every composer / primitive call to stderr |
| `ULTIMATRIX_LLM_DEBUG=1` | Log LLM call sites, tokens, duration |
| `ULTIMATRIX_LLM_STREAM=1` | Stream tokens to TUI / web |
| `PORT` | Web UI port (default 3000) |
| `HOST` | Web UI host (default 0.0.0.0) |

### Provider auto-detection

The LLM client walks the priority list in order and uses the first matching env var. Groq is the default because it's fast and has a free tier.

To force a specific provider, set all the earlier ones to empty strings (or just use only the one you want).

### Project yaml (`ultimatrix.yaml`)

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
    - spider       # if you already have output/app-model.json
```

### Global secrets (`~/.config/ultimatrix/providers.yaml`)

```yaml
nvidia:
  apiKey: nvapi-...
groq:
  apiKey: gsk-...
```

---

## 8. Programmatic API

```typescript
import { Composer, getDefaultLLMClient, getGlobalRegistry } from 'ultimatrix';
import { registerBuiltins } from 'ultimatrix';

registerBuiltins();

const composer = new Composer({
  llm: getDefaultLLMClient(),
  maxDepth: 2,
  onFinding: (f) => console.log('Found:', f.type, f.endpoint),
  onPrimitive: (name, args, result) => console.log(`  ${name} →`, result.outcome),
});

const result = await composer.run(
  {
    path: 'https://target/api/users/1',
    method: 'GET',
    params: [],
    requiresAuth: false,
    responseStatus: 200,
    contentType: 'application/json',
    bodyPreview: '',
  },
  {
    baseUrl: 'https://target/api/users/1',
    cookies: {},
    evidenceLog: [],
    depth: 0,
    budget: { startedAt: Date.now(), maxMs: 30000 },
  },
);

console.log(result.findings);
```

All primitives are individually importable:

```typescript
import { craftPayload, injectInContext, compareResponses } from 'ultimatrix';

const payload = craftPayload({ kind: 'sqli', wafHint: 'mysql' });
const req = injectInContext({
  request: { method: 'GET', url: 'http://target/api/users', headers: {} },
  param: 'id',
  value: payload,
  location: 'query',
});
```

---

## 9. Extending

### Add a new primitive

1. Create `src/primitives/my-thing.ts` with the function signature
2. Register it in `src/primitives/index.ts` by adding it to the `registerBuiltins()` call
3. Optionally add `toPlaywrightStep` metadata for auto-recording
4. Write tests in `tests/primitives/`

Or register it as a plugin from anywhere:

```typescript
import { getGlobalRegistry } from 'ultimatrix';

const registry = getGlobalRegistry();
registry.registerPlugin({
  name: 'my-plugin',
  primitives: {
    myPrimitive: { name: 'myPrimitive', description: '...', execute(args, ctx) { ... } },
  },
});
```

### Add a new specialist composer

1. Create `src/agents/specialists-composers/my-specialist.ts` exporting a `runMySpecialist(input)` function
2. Add the spawn trigger in the main Composer (e.g. when a primitive returns a specific signal)
3. Wire it into `src/agents/specialists-composers/index.ts`

### Add a new LLM provider

1. Add the case in `src/llm/client.ts`'s `tryProvider()` switch
2. Add the env-var name to `PROVIDER_PRIORITY` if it should be tried early
3. No other changes needed

---

## 10. Troubleshooting

**"Cannot find module 'playwright'"** — run `npm install`. If you don't need the spider, use `--skip spider --existing-model ./output/app-model.json`.

**"LLM mock fallback"** — set one of the API key env vars above. Without a key, the Composer returns canned (non-useful) responses.

**"request timeout"** — increase the budget: `--max-runtime 3600` for 1 hour.

**Web UI shows blank page** — make sure `npx tsup` was run (or you're using dev mode).

**Spider finds nothing** — try `--depth 4`. Default is 2 (conservative for time).
