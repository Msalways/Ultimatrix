<p align="center">
  <img src="public/favicon.svg" width="100" height="100" alt="Ultimatrix Logo">
</p>

<h1 align="center">Ultimatrix</h1>

<p align="center">
  <strong>Autonomous AI security researcher that reasons, learns, and adapts.</strong><br>
  <em>Not another pattern-matching scanner. A thinking attacker.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/ultimatrix"><img src="https://img.shields.io/npm/v/ultimatrix?style=flat-square&color=10b981" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="license"></a>
  <img src="https://img.shields.io/badge/tests-1767%20passing-brightgreen?style=flat-square" alt="tests">
  <img src="https://img.shields.io/badge/node-20%2B-10b981?style=flat-square" alt="node">
  <img src="https://img.shields.io/badge/engine-multi--model-8b5cf6?style=flat-square" alt="engine">
</p>

<p align="center">
  <a href="#quick-start">Quick Start</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#features">Features</a> ·
  <a href="#cli-reference">CLI</a> ·
  <a href="#configuration">Config</a>
</p>

---

> *"Most security tools ask: 'Does this input match a known attack pattern?'*
> *Ultimatrix asks: 'What does this application believe about trust, and can I prove it wrong?'"*

---

## What Is This?

Ultimatrix is an AI-driven security testing platform that combines LLM reasoning with real browser automation, a structured knowledge graph, and a self-correcting feedback loop. It doesn't just scan — it **observes** your application, builds a **mental model** of how it works, **reasons** about attack surfaces, and **tests** those hypotheses with real HTTP requests and real browser interactions.

It finds vulnerabilities that pattern-based scanners miss, because it understands *context* — not just syntax.

---

## Quick Start

```bash
# Install
git clone <repo-url> && cd project-sentinal
npm install && npx playwright install chromium

# Configure your LLM (Groq free tier works)
npx ultimatrix init

# Go — autonomous attack
npx ultimatrix solve -t https://your-target.com
```

```bash
# Or interactive REPL — guide it turn by turn
npx ultimatrix interact -t https://your-target.com
```

That's it. Three commands from zero to autonomous pentest.

---

## How It Works

```
You: "Test https://your-app.com"

Phase 1: OBSERVE
  Spider crawls -> HAR capture -> endpoint extraction -> auth flow detection
  Result: 47 endpoints, 3 auth flows, 5 role transitions, 12 input params

Phase 2: ORIENT
  Knowledge graph constructed. Evidence gate validates every claim.
  Anti-loop detects stale paths. Reflexion classifies past failures.
  Result: "Admin panel at /admin uses session cookies but /api/users
           doesn't validate roles. Password reset token is predictable."

Phase 3: ACT
  Real HTTP requests. Real browser interactions. Tests IDOR, privilege
  escalation, info disclosure, race conditions, business logic flaws.
  Result: IDOR confirmed on /api/users/123. Admin panel accessible
           with regular user token. .env.bak contains DATABASE_URL.

Phase 4: REPORT
  Structured findings with evidence, reproduction steps, risk scoring.
  Graph persists across sessions for cross-session learning.
```

That's not a toy. That's a security consultant that works 24/7.

---

## Features

- **Reasoning, not regex** — LLM-driven attack hypothesis generation, not pattern matching
- **Knowledge graph** — 24 node types, 19 edge types. The agent *queries* its own understanding to decide what to test next
- **Evidence gate** — Every claim must be backed by actual tool output. No proof = no finding. Zero hallucination tolerance
- **Reflexion engine** — L0-L4 failure classification with automatic escalation. Gets smarter about *your* target every turn
- **57 knowledge-based skills** — Not payload lists. Security expertise the LLM reasons over, not pattern-matches against
- **9 external tool adapters** — Nuclei, sqlmap, ffuf, nmap, and more. Evidence-gated before becoming Findings
- **Dynamic model selection** — Cheap models for recon, powerful models for exploitation. Automatic per-task routing
- **Council debate** — 4 LLM specialists (Strategist, Operator, Skeptic, Analyst) debate complex decisions on demand
- **Human-in-the-loop** — Watch the browser, steer the research, approve critical actions
- **Cross-session learning** — Anonymized patterns saved and injected into future engagements
- **Campaign autonomy** — Systematic test planning across your entire attack surface
- **Scope guard** — URL/domain enforcement on every request. Never test out of scope

---

## Engines

| I want to... | Engine | Command |
|---|---|---|
| Autonomous attack | `multi-model` (default) | `npx ultimatrix solve -t <url>` |
| Guided pentest | `multi-model` + `/council` | `npx ultimatrix interact -t <url>` |
| Budget optimization | `multi-model` | Dynamic model selection per task |
| Structured scan | `legacy` | `npx ultimatrix scan -t <url>` |

<details>
<summary><strong>Multi-Model Engine (Default)</strong></summary>

OODA loop (Reason -> Explore -> Conclude) with dynamic model selection. Uses cheap models for recon, powerful models for exploitation. The brain can invoke the council via `/council <goal>` when it hits a complex decision.

| Feature | Multi-Model | Legacy |
|---|---|---|
| Autonomy | Full (agent-driven) | Reactive (user-steered) |
| Model routing | Dynamic per-task | Single model |
| Council debate | On-demand via `/council` | N/A |
| Memory across turns | Blackboard (facts + intents) | Thread memory |
| Best for | Deep autonomous research | Predictable scans |

</details>

<details>
<summary><strong>Council (On-Demand Debate)</strong></summary>

Four LLM specialists debate what to test. Bring in the council with `/council <goal>` during any multi-model session.

- **Strategist** — Attack direction and planning
- **Operator** — Execution and tool use
- **Skeptic** — Challenges unsupported claims, gates findings
- **Analyst** — Pattern chains and cross-referencing

Debate memory tracks member positions, prevents contradictions, and enables chain-building across turns.

</details>

<details>
<summary><strong>Legacy Supervisor</strong></summary>

Observe -> Learn -> Attack -> Report in a structured 5-phase loop with 4 specialist workers (injection, auth control, advanced, recon).

Best for structured scans with clear phases and environments where you want predictable, linear progression.

</details>

---

## Intelligence Layer

What makes Ultimatrix different from "LLM in a loop":

<details>
<summary><strong>Evidence Gate</strong> — No proof = no finding</summary>

Every claim must be backed by actual tool output. Body signatures (`contains`, `regex`, `timing`, `status-differs`) independently verify content. Truncated evidence is auto-rejected — an unverifiable claim is treated the same as a hallucination.

</details>

<details>
<summary><strong>Reflexion Engine</strong> — Learns from failures</summary>

| Level | Classification | Action |
|---|---|---|
| L0 | Bad luck / transient | Retry with variation |
| L1 | Wrong tool | Switch tool |
| L2 | Wrong strategy | Change approach |
| L3 | Wrong model | Force model upgrade + strategy switch |
| L4 | Fundamental gap | Extract lesson for future |

</details>

<details>
<summary><strong>Anti-Loop Detector</strong> — Never gets stuck</summary>

Detects when the agent is repeating itself and forces unexplored paths. HTTP target blocking prevents wasted retries on dead endpoints.

</details>

<details>
<summary><strong>Blackboard</strong> — Shared state-space</summary>

The solver tracks Facts (what it knows) and Intents (what it plans to do). Every observation updates the blackboard. Every decision reads from it. Prevents redundant work and enables compound reasoning.

</details>

<details>
<summary><strong>Payload Store</strong> — 22 JSON files, 18 categories</summary>

All attack payloads stored as JSON, not hardcoded in source. Lazy-loaded singleton. Brain discovers available variants via `listPrimitiveCapabilities` tool. Categories: sqli, xss, ssrf, ssti, xxe, jwt, nosql, cmd-injection, graphql, ldap, deserialization, auth, authz, header-injection, proto-pollution, race-conditions, smuggling, wordlists.

</details>

<details>
<summary><strong>Response Compression (Headroom)</strong> — Intelligent, not blind</summary>

Large HTTP responses are compressed content-aware before being sent to the LLM. Structured `CompressionResult` type tracks `wasCompressed`/`wasTruncated` — no string scanning.

</details>

---

## 57 Knowledge-Based Skills

Not payload lists. Not regex patterns. **Knowledge.** Each skill is a markdown file containing security expertise — reasoning patterns, testing methodologies, what to look for and why.

| Domain | Count | Highlights |
|---|---|---|
| Web Attacks | 19 | Modern XSS, HTTP smuggling, cache poisoning, business logic |
| Injection | 8 | SSTI, NoSQL, XXE, command injection, email injection |
| Recon | 9 | OSINT, subdomain takeover, HSTS bypass, CTF misc |
| API Security | 6 | GraphQL attacks, WebSocket hijacking, AI/MCP security |
| Cloud Security | 6 | Kubernetes, Docker escape, AWS/Azure/GCP exploitation |
| Auth Security | 3 | Multi-role testing, JWT attacks, OAuth bypass |
| Crypto | 2 | Padding oracle, timing attacks, cryptanalysis |

<details>
<summary><strong>Full skill list</strong></summary>

| Skill | Tier | Description |
|---|---|---|
| recon | fast | Deep page analysis, JS bundle secrets, technology fingerprinting |
| vuln-discovery | balanced | Dynamic payload crafting, input type analysis, WAF adaptation |
| exploitation | powerful | Proof-of-concept development, impact assessment, chaining |
| ssti | powerful | Jinja2, Twig, Freemarker, Velocity, Handlebars RCE chains |
| modern-xss | powerful | Polyglot payloads, CSP bypass, DOM clobbering, mutation XSS |
| http-smuggling | powerful | CL.TE, TE.CL, TE.TE, H2.CL, 20+ TE obfuscation techniques |
| authorization | powerful | Multi-role testing, IDOR, JWT attacks, OAuth bypass |
| api-security | balanced | BOLA, mass assignment, rate limit bypass, API versioning |
| graphql-attacks | powerful | Introspection abuse, batching, alias brute force |
| ai-mcp-security | balanced | Prompt injection, model manipulation, tool poisoning |
| kubernetes-security | powerful | K8s API exploitation, RBAC bypass, container escape |
| business-logic | powerful | Workflow bypass, price manipulation, race conditions |
| race-conditions-advanced | powerful | Turbowlence, single-packet, TOCTOU chains |
| jwt-advanced | powerful | Alg:none, key confusion, jku/x5u injection |
| crypto-toolkit | balanced | Hash analysis, padding oracle, timing attacks |
| post-exploitation | balanced | Lateral movement, privilege escalation, persistence |
| reporting | fast | Finding documentation, risk quantification (CVSS) |
| ... and 40 more | | |

</details>

---

## 9 External Tool Adapters

Orchestrates real best-of-breed security binaries. Every finding is re-verified through the Evidence Gate.

| Adapter | Tool | Purpose |
|---|---|---|
| `nuclei` | ProjectDiscovery Nuclei | Template-based vuln scanner |
| `sqlmap` | sqlmap | SQL injection detection & exploitation |
| `ffuf` | ffuf | Web fuzzer |
| `nmap` | Nmap | Port scanning & service detection |
| `jwttool` | jwt_tool | JWT analysis & manipulation |
| `arjun` | Arjun | HTTP parameter discovery |
| `corsy` | Corsy | CORS misconfiguration scanner |
| `subfinder` | Subfinder | Subdomain enumeration |
| `gitleaks` | Gitleaks | Git secret scanner |

Binary-gated: if not installed, gracefully returns `skip`. No hallucinated output. No special config needed.

---

## Human-in-the-Loop

> [!TIP]
> Watch the agent work in a visible Chromium window. See exactly what it clicks, types, and finds.

- **Browser visibility** — Real-time observation of all agent actions
- **Action capture** — Record your manual sessions; the agent learns from them
- **Session management** — Cookies saved to graph; auto-detects expiry and asks for re-login
- **Interactive REPL** — Chat with the agent, ask questions, redirect its approach

```bash
> What auth mechanism does this app use?
> Test the password reset flow for token prediction
> Try SQL injection on the search endpoint
> Show me what you've found so far
```

---

## Graph-Powered Reasoning

24 node types, 19 edge types. The agent queries the graph to make decisions:

- "What endpoints haven't I tested yet?"
- "Which findings chain together for a critical attack?"
- "What authentication flows protect this admin endpoint?"
- "Have I seen this pattern before in a different context?"

Key node types: Endpoint, Finding, AuthFlow, RBACRole, Attack, Fact, Intent, Reflexion, Hypothesis, AttackPath, CandidateFinding, OutcomeFeedback

---

## Campaign Autonomy

Systematic test coverage across your entire attack surface:

```
Knowledge Graph -> planCampaign() -> CampaignSlices
  (endpoints x params x roles x techniques)
    -> runCampaign() -> parallel execution -> EvidenceGate verification
```

Auto-replans when new endpoints are discovered. Confirmed findings feed back to technique effectiveness scoring.

---

## Attack-Path Solver

BFS traversal of the knowledge graph to find multi-step exploit chains — from unauthenticated entry points to sensitive data. Privilege escalation paths, IDOR chains, auth bypass sequences.

---

## Cross-Engagement Memory

Learns across sessions. Anonymized vulnerability patterns are saved and automatically injected into future sessions. No raw URLs, no credentials, no individualized data.

---

## CLI Reference

| Command | Description |
|---|---|
| `ultimatrix init` | Interactive setup wizard |
| `ultimatrix solve -t <url>` | Autonomous OODA solver |
| `ultimatrix interact -t <url>` | REPL chat with agent |
| `ultimatrix scan -t <url>` | Full pipeline: capture -> analyze -> generate -> report |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR |
| `ultimatrix generate -t <url>` | Generate Playwright tests from traffic |
| `ultimatrix replay` | Re-run generated tests |
| `ultimatrix report` | Generate JSON/HTML/Markdown report |
| `ultimatrix web` | Web UI at localhost:3000 |
| `ultimatrix assess -t <url>` | Full assessment (legacy) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against new deployment |

<details>
<summary><strong>CLI Flags</strong></summary>

```bash
--provider <name>              # Override config provider
--model <name>                 # Override config model
--key <api-key>                # Override config API key
--non-interactive              # Skip prompts, use defaults
--engine <legacy|multi-model>  # Override engine selection
```

</details>

---

## Configuration

<details>
<summary><strong>Full configuration example</strong></summary>

```yaml
# ultimatrix.yaml
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: multi-model

modelTiers:
  fast: groq/llama3-8b-8192
  balanced: openai/gpt-4o-mini
  powerful: anthropic/claude-3.5-sonnet

council:
  approvalMode: hitl
  maxRounds: 8

solver:
  maxToolCalls: 50
  maxTokens: 100000
  maxDurationMs: 300000

scope:
  allowedDomains: [your-app.com, *.your-app.com]
  enforcement: hard

campaign:
  auto: true
  maxSlices: 20
  maxConcurrency: 3

browser:
  headless: false
```

</details>

### Supported Providers

| Provider | Free | Provider | Free | Provider | Free |
|---|---|---|---|---|---|
| Groq | Yes | DeepSeek | Yes | Cerebras | Yes |
| OpenAI | No | Mistral | No | DeepInfra | Yes |
| Anthropic | No | xAI | No | OpenRouter | Varies |
| Google | Yes | Perplexity | Yes | Azure | No |
| NVIDIA | Yes | Together | Yes | Bedrock | No |

---

## Project Status

| Metric | Value |
|---|---|
| Source files | 304+ TypeScript |
| Tests | 1767 passing, 170 files |
| Skills | 57 across 10 domains |
| Payload files | 22 JSON across 18 categories |
| Tools | 37+ (28 internal + 9 external adapters) |
| Providers | 16 supported |
| Graph schema | 24 node types, 19 edge types |
| Intelligence modules | 12 |
| tsc errors | 0 |
| ESLint errors | 0 |

---

## Requirements

- **Node.js** 20+
- **Playwright** with Chromium (auto-installed)
- **An LLM API key** (Groq free tier works for testing)
- **8GB+ RAM** recommended for large scans

---

## License

MIT
