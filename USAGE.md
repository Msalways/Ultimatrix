# Ultimatrix â€” Usage Guide

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

## 1. Quick start (3 commands)

```bash
# 1. Install
npm install

# 2. Set an LLM key (required for the Composer)
export GROQ_API_KEY=gsk-...    # or OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.

# 3. Run
npx tsx src/cli/index.ts hunt -t https://your-app.com -o ./output
```

Outputs land in `./output/`:
- `app-model.json` â€” full 18-section knowledge base
- `report.html` â€” chain-first report with Mermaid diagrams
- `report.md` â€” text version
- `playwright-tests/` â€” one regression test per finding + per chain

---

## 2. Local demo target

A vulnerable Node/Express app is shipped in `demo-target/`. It has 13 seeded vulnerabilities across all 10 attack classes. Run it with:

```bash
npx tsx src/cli/index.ts demo
# â†’ http://127.0.0.1:4567
```

Then in another shell:

```bash
npx tsx src/cli/index.ts hunt -t http://127.0.0.1:4567 --auto
```

You should see ~10 findings in 5-15 seconds with a real LLM key.

---

## 3. Web UI

```bash
npx tsx src/cli/index.ts web
# â†’ http://localhost:3000
```

The UI:
- Form to enter target URL
- Live agent tree (Composer â†’ specialists)
- Streaming event log (plans, primitives, findings, chains)
- No build step â€” the HTML is served directly from `dist/web/static/`

For a quick smoke test:

```bash
curl http://localhost:3000/healthz
# {"ok":true}
```

---

## 4. Interactive REPL (hunt --guided)

Run the hunt in step-by-step mode and use slash commands to drive it:

```bash
npx tsx src/cli/index.ts hunt -t https://your-app.com --guided
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

### Example session

```
$ npx tsx src/cli/index.ts hunt -t http://127.0.0.1:4567 --guided
â–¸ Ultimatrix hunt â†’ http://127.0.0.1:4567
  mode: guided, output: ./output, max runtime: 1800s

[1/5] Spidering http://127.0.0.1:4567 (depth 2)â€¦
  â†³ discovered 10 URLs, 10 routes
[2/5] Running recon (OAuth / GraphQL / JWT / cloud / framework)â€¦
  â†³ 0 discoveries in 24ms (errors: 0)
[3/5] Launching v3 orchestratorâ€¦

â”€â”€ Node 7c8d9e â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  url:      http://127.0.0.1:4567/api/users/1
  method:   GET
  technique: idor
  severity: high
  Proceed? [Y/s/i/d/a]: y

> /plan
  [1] idor on GET http://127.0.0.1:4567/api/users/1
      reason: parameter "id" suggests object reference
      primitives: useSession â†’ compareResponses

> /attack 1
Executed plan #1: idor
  + [HIGH] idor @ http://127.0.0.1:4567/api/users/1 (conf=0.82)

> /chain
  [1] account-takeover-via-stolen-session (critical)
      3 steps, confidence=0.74
```

---

## 5. Configuration

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
| `PORT` | Web UI port (default 3000) |
| `HOST` | Web UI host (default 0.0.0.0) |

### Provider auto-detection

The LLM client walks the priority list in order and uses the first matching env var. Groq is the default because it's fast and has a free tier.

To force a specific provider, set all the earlier ones to empty strings (or just use only the one you want).

---

## 6. Programmatic API

```typescript
import { Composer, getDefaultLLMClient, PRIMITIVE_CATALOG } from 'ultimatrix';

const composer = new Composer({
  llm: getDefaultLLMClient(),
  maxDepth: 2,
  onFinding: (f) => console.log('Found:', f.type, f.endpoint),
  onPrimitive: (name, args, result) => console.log(`  ${name} â†’`, result.outcome),
});

const result = await composer.run(
  { path: 'https://target/api/users/1', method: 'GET', params: [], requiresAuth: false, responseStatus: 200, contentType: 'application/json', bodyPreview: '' },
  { baseUrl: 'https://target/api/users/1', cookies: {}, evidenceLog: [], depth: 0, budget: { startedAt: Date.now(), maxMs: 30000 } },
);

console.log(result.findings);
```

All 21 primitives are individually importable:

```typescript
import { craftPayload, injectInContext, compareResponses } from 'ultimatrix';

const payload = craftPayload({ kind: 'sqli', wafHint: 'mysql' });
const req = injectInContext({ request: { method: 'GET', url: 'http://target/api/users', headers: {} }, param: 'id', value: payload, location: 'query' });
```

---

## 7. Extending

### Add a new primitive

1. Create `src/primitives/my-thing.ts` with the function signature
2. Add it to `PRIMITIVE_CATALOG` in `src/primitives/index.ts`
3. Write tests in `tests/primitives/`

The Composer will pick it up automatically â€” the planner prompt includes the full catalog.

### Add a new specialist composer

1. Create `src/agents/specialists-composers/my-specialist.ts` exporting a `runMySpecialist(input)` function
2. Add the spawn trigger in the main Composer (e.g. when a primitive returns a specific signal)
3. Wire it into `src/agents/specialists-composers/index.ts`

### Add a new LLM provider

1. Add the case in `src/llm/client.ts`'s `tryProvider()` switch
2. Add the env-var name to `PROVIDER_PRIORITY` if it should be tried early
3. No other changes needed

---

## 8. Troubleshooting

**"Cannot find module 'playwright'"** â€” run `npm install` to install deps. If you don't need the spider, use `--no-spider --existing-model ./output/app-model.json`.

**"LLM mock fallback"** â€” set one of the env vars above. Without a key, the Composer returns canned (non-useful) responses.

**"request timeout"** â€” increase the budget: `--max-runtime 3600000` for 1 hour.

**Web UI shows blank page** â€” make sure `npx tsup` was run (or you're using `tsx` which serves the dev HTML directly).

**Spider finds nothing** â€” try `--depth 4`. Default is 2 (conservative for time).

---

## 9. Debug & observability env vars

These are optional and safe to leave unset. Set them to inspect what's happening under the hood.

| Env var | What it does |
| --- | --- |
| `ULTIMATRIX_LLM_DEBUG=1` | Logs the detected LLM provider, yaml config, and env-var fallback chain to stderr. Useful for verifying `ultimatrix.yaml` is being picked up. |
| `ULTIMATRIX_LLM_STREAM=1` | Streams every LLM token to **stderr** in dim gray while the hunt runs. Each LLM call is labeled (e.g. `plan/GET /level1/frame`, `triage/xss`, `propose-plans/...`) so you can tell calls apart. The web UI also picks up these tokens via WebSocket (`llm-token` events) and shows them in a dedicated **LLM stream** panel. |
| `HUNT_DEBUG=1` | Logs every worker dispatch (`[worker] composer run technique=X url=Y method=Z`) as workers spin up. |

Example streaming session:

```bash
# Terminal: see tokens stream live as the LLM thinks
ULTIMATRIX_LLM_STREAM=1 npx ultimatrix hunt -t https://xss-game.appspot.com/ -o ./output --mode auto --skip tests

# Output:
#   â–¸ Ultimatrix hunt â†’ https://xss-game.appspot.com/
#   ...
#   â–¸ LLM [plan/GET /level1/frame] streamingâ€¦ { "plans": [ { "id": 1, ...
#   â–¸ LLM [triage/xss] streamingâ€¦ { "vulnerable": false, "confidence": 0, ...
```

For the web UI:

```bash
ULTIMATRIX_LLM_STREAM=1 npx ultimatrix web
# â†’ open http://localhost:3000
# â†’ click "Start hunt" â€” the middle panel shows tokens streaming live
```

