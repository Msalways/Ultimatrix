# Ultimatrix v8

**An AI security researcher that thinks before it attacks.**

Ultimatrix isn't another vulnerability scanner with hardcoded CVE patterns. It's an autonomous security researcher that observes your application, builds a mental model of how it works, reasons about attack surfaces, and then tests for real vulnerabilities — the way a human pentester would, but at machine speed.

It talks to you like a consultant. It learns from its mistakes. And it never stops watching.

---

## Why Ultimatrix?

Security tools typically fall into two camps: **signature-based scanners** that match known patterns (and miss everything novel), and **manual testing frameworks** that require a human operator to drive them. Ultimatrix is neither.

It uses LLM reasoning to **understand** your application — not just its endpoints, but its behavior, its logic, its assumptions about trust. Then it tests those assumptions with real HTTP requests, real browser interactions, and real exploitation attempts.

**The key insight:** Observation is the foundation of security testing. Before Ultimatrix attacks anything, it maps your entire attack surface — endpoints, authentication flows, role-based access, technology stack, exposed secrets, JavaScript bundles. It builds a knowledge graph. Then it reasons over that graph to decide what's worth testing and how.

This is why it finds things scanners miss. A scanner checks for SQL injection patterns. Ultimatrix understands that your user profile endpoint takes an ID parameter, that the ID is sequential, that there's no authorization check, and that the response leaks database error messages — then it crafts a payload specific to *your* application's context.

---

## What It Actually Does

```
You: "Test https://your-app.com for security issues"

Ultimatrix: [observes] Mapping attack surface... found 47 endpoints,
  3 auth flows, 5 role transitions, 12 input parameters.

Ultimatrix: [reasons] Your admin panel at /admin uses session cookies
  but the API at /api/users doesn't validate roles. The password reset
  token is predictable. There's a .env backup at /.env.bak.

Ultimatrix: [tests] Sending crafted requests to each vector...
  - IDOR on /api/users/123 → swapped to /api/users/456 → got full profile
  - Admin panel access with regular user token → 200 OK (privilege escalation)
  - .env.bak → contains DATABASE_URL, JWT_SECRET, SMTP credentials

Ultimatrix: [reports] Found 3 critical, 2 high, 4 medium issues.
  Here's the full report with reproduction steps.
```

That's not a toy. That's a security consultant that works 24/7.

---

## Quick Start

```bash
git clone <repository-url> && cd project-sentinal
npm install
npx playwright install chromium

# Configure your LLM provider
npx ultimatrix init

# Interactive session — talk to the agent like a colleague
npx ultimatrix interact -t https://httpbin.org

# Autonomous solve — give it a goal, let it work
npx ultimatrix solve -t https://httpbin.org

# Full scan pipeline: capture → analyze → generate tests → report
npx ultimatrix scan -t https://httpbin.org
```

### Configure your LLM

```bash
# Works with any provider — Groq is free and fast for testing
export GROQ_API_KEY=gsk_your_key_here

# Or use OpenAI, Anthropic, Google, NVIDIA, and 10+ others
export OPENAI_API_KEY=sk_your_key_here
```

---

## The Intelligence Layer

What makes Ultimatrix different from "LLM in a loop" is its intelligence layer — four interconnected systems that make it actually *smart*:

### Evidence Gate
The agent can't hallucinate findings. Every claim it makes must be backed by actual tool output. If it says "SQL injection found," it must show you the HTTP response that proves it. No proof = no finding. This is enforced at the architecture level, not as a prompt suggestion.

### Reflexion Engine
When an attack fails, Ultimatrix doesn't just move on. It classifies the failure (L0: bad luck, L1: wrong tool, L2: wrong strategy, L3: wrong model, L4: fundamental gap), extracts lessons, and applies them to future attempts. Over a session, it gets progressively smarter about *your* specific target.

### Anti-Loop Detector
LLMs love to repeat themselves. The anti-loop system detects when the agent is stuck — trying the same approach with slight variations — and forces it down unexplored paths. It also extracts structured attack paths from the conversation, tracking what was tried, what worked, and what failed.

### Knowledge Graph
Every interaction builds a persistent knowledge graph: endpoints, findings, authentication flows, RBAC matrices, attack paths, facts, and intents. The agent queries this graph before acting, preventing redundant work and enabling compound reasoning. "I already tested /api/users for IDOR — but I haven't tested /api/admin yet, and they share the same middleware."

---

## Dual Engine Architecture

Ultimatrix has two engines, because different situations call for different approaches:

### Solver Engine (OODA Loop)
The primary engine. Observes → Orients → Decides → Acts, in a tight loop. Best for:
- Autonomous goal-driven testing ("find all privilege escalation vectors")
- Interactive sessions where you guide the research
- Targets where you need deep, iterative reasoning

### Legacy Supervisor
The battle-tested engine. Observe → Learn → Attack → Report. Best for:
- Structured scans with clear phases
- Environments where you want predictable, linear progression
- Compatibility with older configurations

Both engines share the same intelligence layer, the same 21 skills, and the same tool set. The engine selector just changes *how* they're orchestrated.

---

## 21 Knowledge-Based Skills

Not payload lists. Not regex patterns. **Knowledge.**

Each skill is a markdown file containing security expertise — reasoning patterns, testing methodologies, what to look for and why. The LLM reads these skills and applies the knowledge using its own reasoning capabilities.

### Core Skills
| Skill | What It Knows |
|-------|---------------|
| **Recon** | Deep page analysis, JavaScript bundle secrets, exposed files, technology fingerprinting |
| **Vuln Discovery** | Dynamic payload crafting, input type analysis, WAF adaptation, context-aware encoding |
| **Exploitation** | Proof-of-concept development, impact assessment, chaining vectors |
| **Post-Exploitation** | Lateral movement, privilege escalation, persistence |
| **Reporting** | Finding documentation, risk quantification, remediation guidance |
| **WAF Bypass** | Encoding tricks, fragmentation, timing attacks |
| **Pentest Flow** | Structured methodology, scope management, documentation |

### Specialized Skills
| Skill | What It Knows |
|-------|---------------|
| **Web Pentest** | OWASP Top 10, API testing, authentication bypass |
| **Authorization** | Multi-role testing, IDOR, JWT attacks, OAuth bypass |
| **Business Logic** | Workflow bypass, price manipulation, race conditions |
| **Info Disclosure** | JS bundle analysis, .env exposure, error message leakage |
| **Race Conditions** | Concurrent request testing, TOCTOU, mass assignment |
| **Crypto Toolkit** | Hash analysis, key extraction, algorithm weaknesses |
| **AI/MCP Security** | Prompt injection, model manipulation, tool poisoning |
| **CTF Skills** | Web, Crypto, Misc CTF challenge methodologies |

---

## Human-in-the-Loop

Ultimatrix isn't a black box. It works *with* you:

- **Browser visibility** — Watch it navigate in real time, or take the wheel yourself
- **Action capture** — Record your manual testing sessions and reproduce them
- **Session persistence** — Save and restore sessions across restarts
- **Interactive REPL** — Chat with the agent, ask questions, redirect its approach
- **Screenshot evidence** — Every finding includes visual proof

When it needs your help (CAPTCHA, MFA, complex login), it asks. When it can handle something autonomously, it does. The balance shifts as it learns your target.

---

## Graph-Powered Reasoning

Under the hood, Ultimatrix maintains a knowledge graph with 11 node types and 12 edge types:

```
Endpoint ──REQUESTS──> Finding
    │                      │
    ├──USES_AUTH──> AuthFlow    ├──EXPLOITS──> AttackPath
    │                      │                      │
    ├──PRODUCES──> Input        ├──CHAINS_TO──> AttackStep
    │                      │                      │
    └──REQUIRES_ROLE──> RBACMatrix    └──BUILT_ON──> Test
```

This isn't just data storage. The agent *queries* the graph to make decisions:
- "What endpoints haven't I tested yet?"
- "Which findings chain together for a critical attack?"
- "What authentication flows protect this admin endpoint?"
- "Have I seen this pattern before in a different context?"

---

## Configuration

```yaml
# ultimatrix.yaml
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: solver

solver:
  maxToolCalls: 25           # LLM rounds per turn
  maxDurationMs: 300000      # 5 minute timeout
  maxParallel: 1

rateLimit:
  requestsPerMinute: 25      # Conservative default
  maxConcurrent: 2

antiLoop:
  staleThreshold: 3          # Force direction change after N repeats

reflexion:
  persistToGraph: true       # Learn across sessions

browser:
  headless: false            # Watch the agent work

credentials:
  your-app:
    email: user@example.com
    password: secure123
```

### Supported Providers
`openai` · `anthropic` · `google` · `nvidia` · `groq` · `together` · `deepseek` · `mistral` · `xai` · `perplexity` · `cerebras` · `deepinfra` · `openrouter` · `azure` · `bedrock`

---

## CLI Reference

| Command | What It Does |
|---------|-------------|
| `ultimatrix init` | Interactive setup wizard — provider, model, credentials |
| `ultimatrix solve -t <url>` | Autonomous OODA solver — give it a goal, it works |
| `ultimatrix interact -t <url>` | REPL chat — talk to the agent like a colleague |
| `ultimatrix scan -t <url>` | Full pipeline: capture → analyze → generate → report |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR, analyze patterns |
| `ultimatrix generate -t <url>` | Generate Playwright test cases from captured traffic |
| `ultimatrix replay` | Re-run previously generated tests |
| `ultimatrix report` | Generate JSON/HTML/Markdown reports |
| `ultimatrix web` | Next.js web UI at localhost:3000 |
| `ultimatrix assess -t <url>` | Full assessment (legacy engine) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against new deployment |

---

## Testing

```bash
npm test                    # 809 tests, 54 files
npm run test:watch          # Watch mode
npx tsup                    # Build (ESM 1.19MB + CJS 1.21MB + DTS)
```

---

## Requirements

- Node.js 20+
- Playwright (Chromium)
- An LLM API key (Groq free tier works for testing)
- 8GB+ RAM recommended for large scans

---

## License

MIT
