# Ultimatrix — Usage Guide

How to install, run, configure, and extend Ultimatrix.

---

## Prerequisites

```bash
node >= 20
npm install
# Playwright browser (only needed if you enable the spider)
npx playwright install chromium
```

---

## 1. Quick start (3 commands)

```bash
# 1. Install
npm install

# 2. (Optional) Set an LLM key — only needed for LLM chain reasoning
#    The default hunt is fully hand-rolled and works WITHOUT a key.
export OPENAI_API_KEY=sk-...

# 3. Run
npx tsx src/cli/index.ts hunt -t https://your-app.com -o ./output
```

The hunt command will:
1. Spider the target (Playwright BFS)
2. Run recon (OAuth / GraphQL / JWT / cloud / framework)
3. Test every reachable URL with hand-rolled probes
4. Run the attack chain engine
5. Generate Playwright regression tests
6. Write `output/report.html` (chain-first with Mermaid) and `output/report.md`

---

## 2. The `hunt` command

`hunt` is the canonical command. It collapses `assess` + `interact` + `test` into one integrated flow.

### 2.1 Modes

```bash
# Autonomous mode (no prompts, default for CI):
npx tsx src/cli/index.ts hunt -t https://target.com --auto

# Guided mode (prompts per workflow node, slash commands inside):
npx tsx src/cli/index.ts hunt -t https://target.com --guided
```

### 2.2 Flags

| Flag | What it does | Default |
|------|--------------|---------|
| `-t, --target <url>` | Target URL (**required**) | — |
| `-o, --output <dir>` | Output directory | `./output` |
| `--guided` | Prompt per node (default) | on |
| `--auto` | No prompts | off |
| `--depth <n>` | Spider BFS depth | `2` |
| `--max-runtime <seconds>` | Hard time limit | `1800` |
| `--max-nodes <n>` | Cap orchestrator at N nodes | `50` |
| `--no-tests` | Skip Playwright test generation | off |
| `--tests-dir <dir>` | Where to write Playwright tests | `./playwright-tests` |
| `--no-chains` | Skip attack chain engine | off |
| `--no-recon` | Skip recon layer | off |
| `--no-spider` | Skip spider, load existing model | off |
| `--existing-model <path>` | Resume from a previous `app-model.json` | — |
| `--seed-urls <a> <b> ...` | Seed the workflow graph with known URLs | — |
| `HUNT_DEBUG=1` | Log every probe attempt to stderr | off |

### 2.3 Slash commands (guided mode only)

Type any of these at a prompt:

| Command | What it does |
|---------|--------------|
| `/auto` | Switch to autonomous mode |
| `/guided` | Switch to step-by-step mode |
| `/findings` | List current findings |
| `/test` | Generate Playwright tests from findings |
| `/report` | Render the HTML report now |
| `/add <url>` | Add a URL to the workflow graph |
| `/help` | List all slash commands |
| `/quit` | Exit the hunt |

### 2.4 Per-node prompt (guided mode)

When the orchestrator reaches a workflow node, you see:

```
── Node 7a3f ─────────────────
  url:      https://target.com/api/users/1
  method:   GET
  technique: idor
  severity: high
```

Press:
- **Y** (Enter) to test it
- **s** to skip this node
- **i** to investigate (show details)
- **d** to dismiss
- **a** to add a different URL

### 2.5 Practical examples

```bash
# Full scan with a 5-minute time budget
npx tsx src/cli/index.ts hunt -t https://target.com --auto --max-runtime 300

# Resume from a previous model (skip spider entirely)
npx tsx src/cli/index.ts hunt -t https://target.com --no-spider \
    --existing-model ./output/app-model.json

# Known API surface — skip spider, feed URLs directly
npx tsx src/cli/index.ts hunt -t https://target.com --no-spider \
    --seed-urls / /api/users /api/users/1 /api/posts /graphql /oauth/authorize

# Skip test generation (faster)
npx tsx src/cli/index.ts hunt -t https://target.com --auto --no-tests

# Deep recon, no chains
npx tsx src/cli/index.ts hunt -t https://target.com --auto --no-chains

# Debug: log every probe attempt
HUNT_DEBUG=1 npx tsx src/cli/index.ts hunt -t https://target.com --auto --no-tests \
    --no-spider --no-recon --seed-urls / /api/users/1
```

---

## 3. Verifying against a new deployment

```bash
npx tsx src/cli/index.ts verify \
  -a ./output/app-model.json \
  -t https://new-deployment.com \
  -o ./verify-output
```

Each finding is classified as `fixed` / `regressed` / `unchanged` / `unknown`. Exit code is 1 if any regressions are found.

---

## 4. Init — provider config

```bash
npx tsx src/cli/index.ts init
```

Interactive wizard for choosing LLM provider, API key, and default model. Writes `ultimatrix.yaml` and `~/.config/ultimatrix/providers.yaml`.

### Environment variables

```bash
export OPENAI_API_KEY=sk-...        # any OpenAI-compatible key
export ANTHROPIC_API_KEY=...
export AZURE_OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
export GROQ_API_KEY=...
export GEMINI_API_KEY=...
export AWS_ACCESS_KEY_ID=...        # Bedrock
```

Auto-detection order: `OPENAI_API_KEY` → `OPENROUTER_API_KEY` → `ANTHROPIC_API_KEY` → `AZURE_OPENAI_API_KEY` → `GROQ_API_KEY` → `GEMINI_API_KEY` → `AWS_ACCESS_KEY_ID`.

### Provider config file

`~/.config/ultimatrix/providers.yaml`:
```yaml
provider: openai
apiKey: sk-...
model: gpt-4o
```

---

## 5. Output

```
output/
├── app-model.json                — 18-section knowledge graph
├── report.html                   — chain-first HTML with Mermaid
├── report.md                     — text report
├── session-trace.har             — browser trace
└── oast-callbacks.json           — blind-SSRF callbacks

playwright-tests/                 — auto-generated regression tests
├── playwright.config.ts
├── fixtures/
│   ├── findings.ts               — findings as data
│   └── auth.ts                   — auth helpers
├── attack-<id>.spec.ts           — one spec per finding
└── chain-<id>.spec.ts            — one spec per chain
```

---

## 6. Attack probes — what's actually firing

Every node in the workflow graph is mapped to a real, deterministic probe. The probe crafts payloads, sends HTTP requests, and inspects responses. **No LLM in the critical path.**

| Technique | Probe | What it does |
|-----------|-------|--------------|
| `ssrf` | `cloud-probes.probeCloudMetadata` | Tries AWS IMDSv1/v2, GCP, Azure, DigitalOcean, Oracle |
| `open-redirect` | `oauth-probes.runAllOAuthProbes` (5 sub-probes) | Tests redirect_uri prefix bypass, state missing, scope escalation, response_type confusion, PKCE downgrade |
| `race` | `race-probes.probeRaceCondition` | Fires 8 parallel requests, `successCount > 1` = exploitable |
| `sqli` | hand-rolled signature check | Real engine signatures + boolean-based length delta |
| `xss` | hand-rolled reflection check | `<script>ultimatrixXss{ts}</script>` reflected unescaped |
| `ssti` | 3 template payloads | `{{7*7}}`, `${7*7}`, `<%= 7*7 %>` |
| `idor` | sequential ID enumeration | Compares `/api/users/1` vs `/api/users/2` etc. |
| `xxe` | XML with external entity | `<!ENTITY xxe SYSTEM "file:///etc/passwd">` |
| `path` | 3 traversal encodings | `../../../etc/passwd` + variants |
| `cmd` | 4 shell metachars | `; ls`, `| cat`, `$( )`, backticks |

If the orchestrator infers a technique that doesn't have a hand-rolled probe, the worker returns a stub result (`vulnerable: false`). The LLM-driven worker (`runReasoningWorker`) is still available — wire it in by replacing `huntWorkerRunner` in `src/cli/hunt.ts:248`.

---

## 7. Recon layer (pre-attack discovery)

Finds endpoints the HTML spider misses. Pure HTTP, no browser. **Disabled by default for `hunt` — use `--no-recon` to be explicit or rely on the default `true` in the pipeline.**

```ts
import { runRecon } from 'ultimatrix/recon';
await runRecon({
  target: 'https://app.com',
  appModelPath: './app-model.json',  // mutates this file
  parallel: true,
});
```

Tools:
- `oauth-discovery` — `/.well-known/openid-configuration` + 10 common authorize paths
- `graphql-discovery` — 10 paths, introspection, field-level sensitivity
- `jwt-discovery` — cookie/localStorage decode, flags `alg=none` / `expired` / `kid`/`jku`/`x5u`
- `framework-fingerprint` — 15 framework signatures
- `cloud-metadata-probe` — 9 metadata targets with optional OAST callback

---

## 8. Chain engine

`src/core/attack-chain.ts` — 3 modes:

| Mode | What it does |
|------|--------------|
| `heuristic` | Pure pattern matching. No LLM. Looks for finding-type combos. |
| `llm` | Calls OpenAI-compatible API, asks the LLM to identify chains |
| `hybrid` | Heuristic first, LLM for novel combos |

7 chain templates covered:
- SSRF → cloud metadata → AWS S3 credential exfil
- OAuth redirect_uri bypass → admin role
- JWT signature bypass → admin
- Race condition → balance / coupon drain
- GraphQL introspection → mass data dump
- File upload Content-Type bypass → RCE
- SSTI → arbitrary code execution

```ts
import { runChainEngine } from 'ultimatrix';
const result = await runChainEngine({
  mode: 'heuristic',
  appModel: model,
  appModelPath: './app-model.json',
});
// result.chains: AttackChain[]
```

---

## 9. Adding your own probe

Each probe is a plain async function. Wire it into the dispatch in `src/cli/hunt.ts:248`:

```ts
case 'your-technique': {
  const r = await yourProbeFunction(input.url, input.param, method, cookies);
  if (r.vulnerable) return { ...r, technique: 'your-technique', url, durationMs: ... };
  break;
}
```

The probe should return `{ vulnerable: boolean; confidence: number; evidence: FindingEvidence[]; payloads: string[]; summary: string }`.

---

## 10. Development

```bash
# Run all tests
npx vitest run

# Type check
npx tsc --noEmit

# Build
npx tsup

# Run against the demo target
node demo-target/server.js &
npx tsx src/cli/index.ts hunt -t http://127.0.0.1:4567 --auto --no-spider \
    --seed-urls / /api/users /api/users/1 /api/posts /api/preview /api/render \
                /api/transfer /api/coupons/redeem /graphql /api/upload \
                /oauth/authorize /.well-known/openid-configuration /admin/dashboard
```

### Live integration tests

`tests/cli/hunt-worker.test.ts` spawns the demo target and asserts the worker detects real vulnerabilities (IDOR, SSTI, SSRF, OAuth redirect).

```bash
npx vitest run tests/cli/hunt-worker.test.ts
```

---

## 11. Deprecated commands (still work, emit warnings)

- `assess` — legacy spider + LLM strategist REPL. Use `hunt` instead.
- `interact` — legacy chat REPL. Use `hunt --guided` instead.

Both emit `⚠️ '<cmd>' is deprecated. Use 'ultimatrix hunt -t <url>' instead.`

---

## 12. Notes

- The default `hunt` flow is fully hand-rolled and runs **without an LLM**. Set `OPENAI_API_KEY` only if you want LLM-mode chain reasoning.
- Workers are **deterministic and crash-isolated** — a probe throwing an exception does not affect the orchestrator.
- The chain engine has 3 modes; heuristic is the default and works offline.
- The Playwright test generator creates one regression spec per finding. Re-run with `npx playwright test playwright-tests/`.
