<p align="center">
  <img src="public/favicon.svg" width="104" height="104" alt="Ultimatrix logo">
</p>

<h1 align="center">Ultimatrix</h1>

<p align="center">
  <strong>A security research platform that builds a case, not just a report.</strong><br>
  Observe, hypothesize, test, verify, learn — and pick up exactly where you left off.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ultimatrix"><img src="https://img.shields.io/npm/v/ultimatrix?style=flat-square&color=10b981" alt="npm version"></a>
  <img src="https://img.shields.io/badge/Node.js-22.13%2B-10b981?style=flat-square" alt="Node.js 22.13 or newer">
  <img src="https://img.shields.io/badge/workspaces-Web%20%2B%20CLI-18181b?style=flat-square" alt="Web and CLI workspaces">
  <img src="https://img.shields.io/badge/findings-evidence%20gated-2563eb?style=flat-square" alt="Evidence-gated findings">
  <img src="https://img.shields.io/badge/license-MIT-64748b?style=flat-square" alt="MIT license">
</p>

<p align="center">
  <a href="#quick-start"><strong>Quick Start</strong></a> |
  <a href="docs/USER-GUIDE.md"><strong>User Guide</strong></a> |
  <a href="#the-case-lifecycle"><strong>How It Works</strong></a> |
  <a href="#inside-the-engine"><strong>Architecture</strong></a> |
  <a href="#sdk"><strong>SDK</strong></a>
</p>

---

## Why Ultimatrix Exists

A scanner gives you output. Ultimatrix gives you a **case** — a living record of observed behavior, tested hypotheses, confirmed evidence, dead ends, and the next unanswered question. Every session resumes from the same graph, the same findings, and the same context.

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>🧠 It remembers</h3>
      Target state, chat history, graph nodes, findings, and research context survive reloads, restarts, and new sessions.
    </td>
    <td width="33%" valign="top">
      <h3>🔍 It shows its work</h3>
      Every reasoning step, tool call, HTTP exchange, evidence claim, and outcome has a typed state — not just a log line.
    </td>
    <td width="33%" valign="top">
      <h3>🤝 It keeps humans in</h3>
      Watch the browser, demonstrate flows, approve critical actions, and steer the investigation with human judgment.
    </td>
  </tr>
</table>

---

## The Case Lifecycle

```text
  OBSERVE              ORIENT               TEST                VERIFY               REMEMBER
  ─────────          ─────────            ─────────           ─────────            ─────────
  crawl traffic   →  build graph     →   fire tools       →  evidence gate    →  persist case
  watch user          extract skills      browser + HTTP       cross-check          resume later
  capture HAR         form hypotheses     campaigns            findings             same context
```

Each phase feeds the next. Observations inform hypotheses. Hypotheses drive tests. Tests produce evidence. Evidence confirms or rejects findings. The case grows — and nothing is lost between sessions.

### What this means in practice

| Instead of... | Ultimatrix does... |
|---|---|
| Scanning and dumping results | Building a knowledge graph that grows with every interaction |
| Losing context between runs | Resuming from persisted graph state, auth sessions, and findings |
| Black-box tool execution | Showing every HTTP exchange, reasoning step, and decision in a timeline |
| Manual IDOR/BOLA testing | Automatically swapping actors, comparing responses, and flagging differences |
| Generic "find XSS" prompts | Loading domain-specific skills with methodology and tool prescriptions |

---

## Quick Start

```bash
git clone https://github.com/Msalways/Ultimatrix.git
cd Ultimatrix
npm install
npx playwright install chromium
npx ultimatrix init
```

Choose how you want to work:

```bash
# Visual workspace — see everything, steer the investigation
npx ultimatrix web

# Guided terminal — interactive prompts, focused commands
npx ultimatrix interact -t https://app.example.com

# Autonomous OODA — reason, explore, conclude, repeat
npx ultimatrix solve -t https://app.example.com
```

> [!IMPORTANT]
> Use Ultimatrix only on systems you own or are explicitly authorized to test. Define scope before starting any execution run.

---

## Two Workspaces, One Case

| | Web | CLI |
|---|---|---|
| **Best at** | Inspecting and steering a live investigation | Fast operation, automation, remote shells |
| **Intent** | Explicit **Ask** and **Run** modes | Interactive prompts and focused commands |
| **Progress** | Structured streaming timeline | Live Markdown and compact run summaries |
| **Continuity** | Reload target sessions and graph-backed results | Resume a persisted target workspace |
| **Browser** | Visible capture status, page count, and close control | Managed lifecycle with human-action observation |

### Ask without acting

**Ask** reads the active case and answers from persisted context. It does not turn a question into an assessment.

### Run with observable progress

**Run** starts an execution turn. Reasoning, tools, findings, completion, cancellation, budget exhaustion, and errors render as distinct events.

### Reload without losing

Target sessions live under `output/<target>/`. Chat history and graph-backed findings return after a page reload. Browser and engine resources initialize only when needed.

---

## Modern Web Application Coverage

Modern apps hide behavior behind client-side routing, authenticated APIs, transient UI state, and multi-step workflows. Ultimatrix observes the application **while it runs** instead of relying on a static crawl.

| Behavior | Coverage | What Ultimatrix does |
|---|---|---|
| SPAs and client-side routing | **Built in** | Real browser, follows navigation, mines loaded JS for endpoints |
| `fetch` and XHR APIs | **Built in** | Captures request/response bodies, headers, cookies, parameters, timing |
| Dynamic UI feedback | **Built in** | Diffs accessibility tree after actions — dialogs, modals, toasts, errors |
| Form, OAuth, SAML | **Built in** | Detects auth surfaces, records flows, extracts browser auth |
| Multi-role apps | **Context required** | Builds role/permission state, tests BOLA, IDOR, tenant isolation |
| Business workflows | **Built in** | Records ordered actions, models invariants, probes sequence bypasses |
| GraphQL APIs | **Built in** | Schema discovery, introspection, global-ID swapping, field auth |
| Race conditions | **Built in** | Bounded concurrent requests against state-changing endpoints |
| CAPTCHA / anti-bot | **Human assisted** | Detects challenge providers, pauses for human completion |
| WebSockets | **Partial** | Methodology present; first-class frame capture is not yet dedicated |

---

## Capabilities at a Glance

<table>
  <tr>
    <td align="center" width="20%"><strong>74</strong><br>security skills</td>
    <td align="center" width="20%"><strong>9</strong><br>tool adapters</td>
    <td align="center" width="20%"><strong>60+</strong><br>registered tools</td>
    <td align="center" width="20%"><strong>24 + 20</strong><br>graph types</td>
    <td align="center" width="20%"><strong>2,577</strong><br>tests</td>
  </tr>
</table>

---

## Inside the Engine

```text
                          target + goal
                               │
                     ┌─────────▼─────────┐
                     │  session runner   │
                     │ scope + budget    │
                     └─────────┬─────────┘
                               │
             ┌─────────────────┼─────────────────┐
             │                 │                 │
       ┌─────▼─────┐     ┌────▼────┐     ┌─────▼─────┐
       │  OODA     │     │ legacy  │     │ council   │
       │  solver   │     │ super.  │     │  debate   │
       └─────┬─────┘     └────┬────┘     └─────┬─────┘
             │                │                 │
   ┌─────────▼─────────────────────────────────────────┐
   │         skills  browser  HTTP  tools  campaigns   │
   └─────────┬─────────────────────────────────────────┘
             │
   ┌─────────▼──────────┐       ┌─────────────────────┐
   │   evidence gate    │──────▶│  graph + findings   │
   └────────────────────┘       └─────────────────────┘
```

### Three engines, one runner

| Engine | How it works | When to use |
|---|---|---|
| **OODA Solver** | REASON → EXPLORE → CONCLUDE, with intelligence layers observing passively | `solve`, `interact` (default) |
| **Council** | 4 LLM members debate what to test, structured typed outputs | On-demand parallel analysis |
| **Legacy Supervisor** | Phased Observe → Learn → Attack loop | `scan`, `assess` |

### Intelligence layers (running in the background)

| Layer | What it does |
|---|---|
| **Evidence Gate** | Cross-checks LLM claims against typed ledger — hallucinations get rejected |
| **Reflexion Engine** | Classifies failures, escalates strategy, extracts experience |
| **Anti-Loop** | Detects stale/dead-end paths, blocks repeated work |
| **Coverage Campaigns** | Builds endpoint × param × role matrix, dedupes into bounded-execution slices |
| **Outcome Feedback** | Finding acceptance → technique weight adjustments → better future decisions |
| **Cross-Engagement Memory** | Privacy-preserving pattern memory across sessions |

### The knowledge graph

The graph is the case. It connects every observation to its source:

```text
  Page ──HAS_ACTION──▶ Action ──HAS_INPUT──▶ Input
   │                                          │
   │                                    FOUND_ON
   │                                          │
   │                                          ▼
   └──RENDERED_ON──▶ Endpoint ◀──TARGETS──── Finding
                          │                     │
                    REQUIRES_AUTH          CHAINED_FROM
                          │                     │
                          ▼                     ▼
                       AuthFlow            Attack Path
```

**24 node types** (Page, Endpoint, Finding, AuthFlow, Hypothesis, ExploitProof, ...) and **20 edge types** — every observation links back to evidence.

---

## Tool Surface

### What the brain can call

| Category | Tools | Risk |
|---|---|---|
| **Read** | `queryGraph`, `getGraphSchema`, `getTargetSummary`, `listSkills`, `searchSkills`, `getToolResult` | `read` — always available |
| **Network** | `httpRequest`, `followRedirects`, `crawlTarget`, `runRecon`, `requestAsActor` | `network` — auto-approved |
| **Mutate** | `writeFinding`, `runPrimitive`, `updateGraph`, `saveSession`, `manageSkills` | `mutate` — requires grant |
| **Delegate** | `spawnWorker`, `runCampaign`, `runAdvancedPlaybook`, `runTaskGraph` | `delegate` — requires grant |

### Session & auth tools

| Tool | What it does |
|---|---|
| `requestAsActor` | Replay a captured request under a different actor's auth context |
| `listActors` | List available session actors (stored auth credentials) |
| `storeSession` | Save session cookies/token for a role |
| `getCapturedHeaders` | Retrieve auth headers for a URL + role |
| `extractSessionCookie` | Parse Set-Cookie headers |

### Security-tool adapters

| Tool | Coverage | Binary required? |
|---|---|---|
| `nuclei` | Known CVEs, exposures, misconfigurations | Yes |
| `sqlmap` | SQL injection detection + exploitation | Yes |
| `ffuf` | Hidden endpoints, directories, fuzzing | Yes |
| `nmap` | Ports, services, versions | Yes |
| `jwt_tool` | JWT inspection + manipulation | Yes |
| `arjun` | Hidden HTTP parameters | Yes |
| `corsy` | CORS misconfigurations | Yes |
| `subfinder` | Passive subdomains | Yes |
| `gitleaks` | Secrets in source/assets | Yes |

Adapters are scope-checked. If a binary is absent, the adapter returns `skip` with an install hint — it never manufactures output.

```bash
npx ultimatrix tools    # See what's available locally
```

---

## Runtime Architecture

### Core stack

| Layer | Technology | Role |
|---|---|---|
| Runtime | TypeScript, Node.js 22 | CLI, SDK, engines, tooling |
| Web | Next.js 15, React 19, Zustand | Workspace UI, streaming timeline |
| Agent runtime | Mastra | Agents, model execution, tool contracts |
| Browser | Playwright, Stagehand | Navigation, interaction, capture, auth |
| Validation | Zod 4 | Config, tool input, graph boundaries |
| Persistence | Graph store, libSQL, JSON, NDJSON | Knowledge, sessions, forensic events |
| Visualization | D3 | Knowledge-graph views |
| Packaging | tsup | ESM, CommonJS, declarations, CLI |
| Testing | Vitest | 2,577 tests, zero failures |

### Evidence pipeline

```
  Tool output
       │
       ▼
  ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
  │ EvidenceLedger│────▶│ EvidenceGate │────▶│  Findings   │
  │ (structured) │     │ (anti-halluc)│     │ (confirmed) │
  └──────────────┘     └──────────────┘     └─────────────┘
       │                                          │
       ▼                                          ▼
  ForensicLog                              KnowledgeGraph
  (NDJSON audit)                           (persisted case)
```

Every tool call flows through the evidence pipeline. Claims are cross-checked against observed facts. Unverified claims get rejected — not passed through as findings.

---

## One Configuration Model

| File | Contains | Rule |
|---|---|---|
| `ultimatrix.yaml` | Engine, model, browser, solver, memory, budgets | Behavior only |
| `providers.yaml` | API keys and provider authentication | **Never commit** |

```bash
npx ultimatrix providers list
npx ultimatrix providers set nvidia
npx ultimatrix config path
```

Provider updates use masked prompts. A blank key preserves the existing secret. Keys are never accepted as command arguments.

---

## SDK

```ts
import { Ultimatrix } from 'ultimatrix'

const researcher = new Ultimatrix({
  target: 'https://app.example.com',
  outputDir: './output',
})

try {
  const result = await researcher.scan()
  console.log(result.findings)
} finally {
  await researcher.close()
}
```

Use the SDK for CI and custom orchestration. Use the CLI for direct operation. Use the Web workspace when visibility and steering matter most.

---

## What Skills Bring

Skills are not just prompts — they're structured knowledge documents with declared tool dependencies, execution procedures, and coverage verification:

```yaml
name: authorization
category: specialized
toolRefs: [httpRequest, runPrimitive, requestAsActor, ...]
primitives: [authBypass, idorSwapper, authzMatrix, tenantIsolation]
contract:
  capabilities: [network.request, response.compare, session.actor-context]
  procedure:
    - id: baseline
      goal: Capture authorized owner behavior for each endpoint
    - id: alternate-actor
      goal: Replay under a different actor's auth context
    - id: compare
      goal: Compare status, body, headers, timing
    - id: reproduce
      goal: Confirm exploitability with a material difference
```

When the brain loads a skill, it gets:
1. **Methodology** — what to test and in what order
2. **Tool prescriptions** — only the tools relevant to this domain
3. **Contract** — which capabilities are required and what "done" looks like
4. **Coverage tracking** — which stages have been executed and which are still pending

**74 skills across 18 domains:** injection, web attacks, auth security, recon, crypto, API security, cloud security, LLM security, supply chain, reporting, offensive security, privilege escalation, post-exploitation, social engineering, network attacks, mobile security, IoT security, and methodology.

---

## Where This Can Go

The opportunity is not to make an AI scanner produce more text. It is to make security investigation:

- **continuous** — every run begins with what the last run learned
- **reviewable** — evidence and actions are visible beside conclusions
- **reproducible** — browser flows, tests, and findings can be revisited
- **controllable** — scope, budgets, approvals, and humans remain first-class

Ultimatrix has the core pieces: persistent cases, observable execution, typed evidence, multiple engines, browser capture, and one configuration model across every interface. The work ahead is making those pieces increasingly dependable as a research environment.

---

## Documentation

| Document | Use it for |
|---|---|
| **[User Guide](docs/USER-GUIDE.md)** | Installation, workflows, providers, persistence, reports |
| **[Architecture](docs/ARCHITECTURE.md)** | Components, data flow, engine design, implementation |
| `npx ultimatrix --help` | Current CLI reference |

---

## Development

```bash
npm test                    # 2,577 tests — zero failures
npm run typecheck           # TypeScript strict mode
npm run build:cli           # tsup: ESM + CJS + DTS
npm run build:web           # Next.js production build
npm run lint                # ESLint (src/)
npm run test:evals          # Architecture evaluation cases
```

---

<p align="center">
  <sub>Built for researchers who want their tools to remember, not just scan.</sub>
</p>
