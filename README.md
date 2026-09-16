<p align="center">
  <img src="public/favicon.svg" width="104" height="104" alt="Ultimatrix logo">
</p>

<h1 align="center">Ultimatrix</h1>

<p align="center">
  <strong>Security research that remembers what happened.</strong><br>
  Observe applications, test hypotheses, verify evidence, and resume the same case from Web, CLI, or SDK.
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
  <a href="#modern-web-application-coverage"><strong>Modern Apps</strong></a> |
  <a href="#two-workspaces-one-case"><strong>Web + CLI</strong></a> |
  <a href="#inside-the-engine"><strong>Architecture</strong></a> |
  <a href="#sdk"><strong>SDK</strong></a>
</p>

---

> **A scan gives you output. A case gives you continuity.**
>
> Ultimatrix is built around the case: observed behavior, target state, tool evidence, failed paths, findings, and the next unanswered question.

<table>
  <tr>
    <td width="33%" valign="top">
      <h3>Remember the target</h3>
      Sessions, chat, graph state, findings, and research context survive a reload.
    </td>
    <td width="33%" valign="top">
      <h3>Show the work</h3>
      Reasoning, tool activity, evidence, outcomes, exhaustion, and errors have distinct states.
    </td>
    <td width="33%" valign="top">
      <h3>Keep humans involved</h3>
      Watch the browser, demonstrate a flow, preserve auth state, and approve critical actions.
    </td>
  </tr>
</table>

## The Case Lifecycle

```text
 OBSERVE             ORIENT              TEST                VERIFY              REMEMBER
 pages + traffic  -> graph + skills  -> browser + HTTP  -> evidence gate    -> resume later
 human actions       hypotheses          campaigns           findings             same case
```

The result is not another chat wrapper around a scanner. It is a workspace where model reasoning, deterministic tools, browser activity, and persisted evidence meet.

## Engineering Evidence

<table>
  <tr>
    <td align="center" width="25%"><strong>74</strong><br>security skill documents</td>
    <td align="center" width="25%"><strong>9</strong><br>external-tool adapters</td>
    <td align="center" width="25%"><strong>24 + 20</strong><br>graph node + edge types</td>
    <td align="center" width="25%"><strong>250</strong><br>test files</td>
  </tr>
</table>

These are repository facts from the current checkout, not benchmark claims. The release workflow runs lint, the full build, and the test suite before publishing. Detection rate, false-positive rate, and time-to-finding are not advertised until there is a reproducible benchmark corpus behind them.

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
# Visual workspace
npx ultimatrix web

# Guided terminal research
npx ultimatrix interact -t https://app.example.com

# Autonomous OODA assessment
npx ultimatrix solve -t https://app.example.com
```

Open the **[User Guide](docs/USER-GUIDE.md)** for setup, provider management, Web and CLI workflows, persistence, reports, and troubleshooting.

> [!IMPORTANT]
> Use Ultimatrix only on systems you own or are explicitly authorized to test. Define scope before starting an execution run.

## Two Workspaces, One Case

| | Web | CLI |
|---|---|---|
| **Best at** | Inspecting and steering a live investigation | Fast operation, automation, and remote shells |
| **Intent** | Explicit **Ask** and **Run** modes | Interactive prompts and focused commands |
| **Progress** | Structured streaming timeline | Live Markdown and compact run summaries |
| **Continuity** | Reload target sessions and graph-backed results | Resume a persisted target workspace |
| **Browser** | Visible capture status, page count, and close control | Managed lifecycle with human-action observation |

### Ask without accidentally acting

**Ask** reads the active case and answers from persisted context. It does not silently turn a question into an assessment.

### Run with observable progress

**Run** starts an execution turn. Reasoning, tools, findings, completion, cancellation, budget exhaustion, and errors are rendered as different events.

### Reload without losing the target

Target sessions are stored under `output/<target>/`. Chat history and graph-backed findings return after a page reload, while browser and engine resources initialize only when needed.

## Modern Web Application Coverage

Modern applications hide their most important behavior behind client-side routing, authenticated APIs, transient UI state, and multi-step workflows. Ultimatrix observes the application while it is running instead of relying only on a static crawl.

| Application behavior | Coverage | What Ultimatrix does |
|---|---|---|
| SPAs and client-side routing | **Built in** | Uses a real browser, follows navigation, observes rendered state, and mines loaded JavaScript for endpoints |
| `fetch` and XHR APIs | **Built in** | Captures request and response bodies, headers, cookies, parameters, redirects, and timing into HAR-backed analysis |
| Dynamic UI feedback | **Built in** | Diffs the accessibility tree after actions to detect dialogs, modals, toasts, errors, success messages, overlays, and content changes |
| Form, OAuth, and SAML entry points | **Built in** | Detects auth surfaces, records flows, extracts browser auth, and restores cookies and local storage |
| Multi-role applications | **Context required** | Builds role and permission state from supplied identities, then tests BOLA, IDOR, tenant isolation, and authorization differences |
| Multi-step business workflows | **Built in** | Records ordered actions, models invariants, reproduces learned flows, and probes sequence or state-transition bypasses |
| GraphQL APIs | **Built in** | Discovers schemas and tests introspection, global-ID swapping, field authorization, and BOLA behavior |
| Race-sensitive operations | **Built in** | Runs bounded concurrent requests against authorized state-changing endpoints and compares divergent outcomes |
| CAPTCHA and anti-bot pages | **Human assisted** | Detects common challenge providers, pauses, and lets the researcher complete the permitted browser action |
| WebSocket applications | **Partial** | Includes discovery and security methodology, but does not yet provide first-class frame capture and replay |
| SSE and long-polling | **Partial** | Observes the underlying HTTP activity; protocol-specific stream testing is not yet a dedicated capability |

### What this changes in practice

- A button click can be connected to the API request, response, visible reaction, graph node, and later finding.
- A login demonstrated by a human can become reusable case context instead of a one-time manual detour.
- A role difference can be tested at the API layer even when the restricted control is hidden in the UI.
- A failed path remains recorded, helping later turns avoid repeating the same test without new evidence.

## Can It Find Bug Bounty Bugs?

**Yes: Ultimatrix is capable of discovering and evidencing bugs in the classes it supports. It is not a push-button guarantee of a valid bounty.**

Given an authorized target from a public or private bug bounty program, its best-aligned areas are:

| Research area | Concrete capabilities |
|---|---|
| Authorization | IDOR swapping, BOLA fuzzing, role matrices, tenant isolation, auth bypass, and account-takeover chains |
| Business logic | Workflow bypass, invariant probing, artifact lifetime, state abuse, and concurrent race testing |
| APIs | REST discovery, GraphQL introspection and BOLA, hidden parameters, JWT analysis, and header semantics |
| Injection | SQL/NoSQL, second-order SQLi, SSTI, LDAP/XPath, header injection, deserialization, and RCE-oriented probes |
| Server-side trust | SSRF with OAST evidence, cloud metadata checks, multi-cloud SSRF, webhook/import testing, and config trust |
| Exposure and recon | Subdomains, ports, known CVEs, hidden content, source secrets, internal-state disclosure, and security headers |
| AI features | Prompt and agent trust boundaries, tool manipulation, data exposure, and agentic workflow abuse |

### What determines whether it finds something

1. **Scope:** the relevant hosts, APIs, and actions must be permitted by the program.
2. **Access:** authorization and business-logic testing often needs two accounts, different roles, or a human-completed login.
3. **Observation:** the application flow must be exercised so hidden requests and state transitions enter the case graph.
4. **Tooling:** optional binaries expand coverage; `npx ultimatrix tools` shows what is available locally.
5. **Direction:** focused goals usually outperform “find anything” on large, unfamiliar applications.
6. **Verification:** every submission still needs researcher review, safe reproduction, impact analysis, and compliance with program rules.

> [!NOTE]
> The evidence gate reduces unsupported findings; it does not make false positives impossible. Ultimatrix should be treated as a research system that accelerates a skilled tester, not as an authority that decides whether a report is valid or bounty-eligible.

## What Is Under the Surface?

| Intelligence | Execution | Control | Continuity |
|---|---|---|---|
| OODA solver | Browser automation | Scope guard | Target workspaces |
| Typed blackboard | HTTP tooling | Evidence gate | Knowledge graph |
| Reflexion | Security-tool adapters | Budgets and quotas | Session resume |
| Anti-loop detection | Coverage campaigns | HITL approval | Cross-engagement patterns |
| Parallel council | Flow reproduction | Forensic events | Reports and case files |
| Streaming architecture | Chronological interleaving | Resumable event identity | Backpressure control |

**74 knowledge-based skills** across 18 domains: injection, web attacks, auth security, recon, crypto, API security, cloud security, LLM security, supply chain, reporting, offensive security, privilege escalation, post-exploitation, social engineering, network attacks, mobile security, IoT security, and methodology. Skills bring methodology and relevant tools into a turn instead of flooding every agent with every capability.

## Audit & Streaming Architecture

Ultimatrix has completed a comprehensive 42-finding security and architecture audit, addressing all critical and high-severity issues across 11 phases:

| Area | Key Fixes | Status |
|---|---|---|
| **Foundation** | Capability lifecycle, worker tool inheritance, skill system | ✅ Complete |
| **Context Pressure** | Adaptive context, prompt compression, model defaults | ✅ Complete |
| **Intelligence Layer** | Anti-loop, reflexion, session context, turn accounting | ✅ Complete |
| **Worker Quality** | Prompt filtering, context budgeting, acceptance criteria | ✅ Complete |
| **Streaming Core** | Reasoning separation, thinking persistence, stable message identity | ✅ Complete |
| **Streaming CLI** | Live reasoning, `/reasoning` toggle, non-TTY dedup, chunk-safe rows | ✅ Complete |
| **Streaming Web** | SSE write batching, backpressure, message identity preservation | ✅ Complete |
| **Event Identity** | `{runId, seq, timestamp}` envelope, ordered `StreamSegment[]` | ✅ Complete |

**Test suite:** 2,389 tests across 250 files, zero failures, clean TypeScript build.

## Tools and Runtime

### Core stack

| Layer | Technology | Role in Ultimatrix |
|---|---|---|
| Runtime | TypeScript, Node.js 22 | Shared CLI, SDK, engines, and tooling |
| Web | Next.js 15, React 19, Zustand | Target workspace, streaming timeline, settings, and persisted views |
| Agent runtime | Mastra | Agents, model execution, memory, and tool contracts |
| Browser | Playwright, Stagehand | Navigation, interaction, capture, auth state, and flow reproduction |
| Validation | Zod 4 | Typed configuration, tool input, graph, and council boundaries |
| Persistence | Graph store, libSQL, JSON, NDJSON | Target knowledge, sessions, callbacks, and forensic events |
| Visualization | D3 | Knowledge-graph views |
| Packaging | tsup | ESM, CommonJS, declarations, and CLI bundling |
| Testing | Vitest, Playwright Test | Unit, integration, and browser-facing validation |

### Security-tool adapters

| Tool | What Ultimatrix uses it for | Availability behavior |
|---|---|---|
| `nuclei` | Known CVEs, exposures, and security misconfigurations | Optional local binary |
| `sqlmap` | SQL-injection detection and controlled exploitation | Optional local binary |
| `ffuf` | Hidden endpoints, files, directories, and fuzzing | Optional local binary |
| `nmap` | Ports, services, and version discovery | Optional local binary |
| `jwt_tool` | JWT inspection and manipulation | Optional local binary |
| `arjun` | Hidden HTTP parameter discovery | Optional local binary |
| `corsy` | CORS misconfiguration checks | Optional local binary |
| `subfinder` | Passive subdomain enumeration | Optional local binary |
| `gitleaks` | Secret discovery in source and captured assets | Optional local binary |

Adapters are scope-checked and normalized behind one tool contract. If a binary is absent, the adapter returns an explicit `skip` with an installation hint; it does not manufacture scanner output.

```bash
# See what is available on this machine
npx ultimatrix tools
```

## Inside the Engine

```text
                         target + goal
                              |
                    +---------v---------+
                    |  session runner   |
                    | scope and budget  |
                    +---------+---------+
                              |
            +-----------------+-----------------+
            |                 |                 |
      +-----v-----+     +-----v-----+     +-----v-----+
      | OODA      |     | legacy    |     | council   |
      | solver    |     | workflow  |     | debate    |
      +-----+-----+     +-----------+     +-----------+
            |
   +--------v------------------------------------------+
   | skills | browser | HTTP | tools | campaigns      |
   +--------+------------------------------------------+
            |
   +--------v---------+       +------------------------+
   | evidence ledger  |------>| graph + findings      |
   +------------------+       +------------------------+
```

<details>
<summary><strong>Execution engines</strong></summary>

| Engine | Purpose | Typical entry point |
|---|---|---|
| `multi-model` | Solver with model-aware delegation | `interact` |
| `solver` | Direct REASON -> EXPLORE -> CONCLUDE loop | `solve` |
| `council` | Strategist, operator, skeptic, and analyst debate | On demand |
| `legacy` | Predictable supervisor and worker phases | `scan` |

</details>

<details>
<summary><strong>Evidence and learning</strong></summary>

- Tool output enters a shared evidence ledger.
- Claims are checked against observed facts before becoming findings.
- Reflexion classifies failures and changes strategy when a path stalls.
- Anti-loop logic blocks repeated work on stale paths.
- Confirmed context is persisted into the target graph for later turns.

</details>

For the module-level design, read **[Architecture](docs/ARCHITECTURE.md)**.

## One Configuration Model

| File | Contains | Rule |
|---|---|---|
| `ultimatrix.yaml` | Engine, model, browser, solver, memory, and budgets | Behavior only |
| `providers.yaml` | API keys and provider authentication | Never commit |

Web Settings and CLI commands use the same project-root files.

```bash
npx ultimatrix providers list
npx ultimatrix providers set nvidia
npx ultimatrix config path
```

Provider updates use masked prompts. A blank key preserves the existing secret, and keys are never accepted as command arguments.

See **[Configuration and provider keys](docs/USER-GUIDE.md#configuration-and-provider-keys)** for the complete workflow.

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

Use the SDK for CI and custom orchestration, the CLI for direct operation, and the Web workspace when visibility and steering matter most.

## Where This Can Go

The opportunity is not to make an AI scanner produce more text. It is to make security investigation:

- **continuous**, so every run begins with what the last run learned;
- **reviewable**, so evidence and actions are visible beside conclusions;
- **reproducible**, so browser flows, tests, and findings can be revisited;
- **controllable**, so scope, budgets, approvals, and humans remain first-class.

Ultimatrix already has the core pieces: persistent cases, observable execution, typed evidence, multiple engines, browser capture, and one configuration model across every interface. The work ahead is to make those pieces increasingly dependable as one research environment.

## Documentation

| Document | Use it for |
|---|---|
| **[User Guide](docs/USER-GUIDE.md)** | Installation, daily workflows, providers, persistence, reports, and troubleshooting |
| **[Architecture](docs/ARCHITECTURE.md)** | Components, data flow, engine design, and implementation details |
| `npx ultimatrix --help` | Current CLI command reference |

## Development

```bash
npm test                    # 2,389 tests across 250 files
npm run typecheck           # TypeScript strict mode
npm run build:cli           # tsup: ESM + CJS + DTS
npm run build:web           # Next.js production build
npm run lint                # ESLint (src/)
npm run test:evals          # Architecture evaluation cases
```

Declared as MIT in `package.json`.
