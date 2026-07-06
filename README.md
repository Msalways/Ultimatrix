# Ultimatrix v8.2

**An autonomous security researcher that reasons, learns, and adapts — not another pattern-matching scanner.**

---

> *"Most security tools ask: 'Does this input match a known attack pattern?'*
> *Ultimatrix asks: 'What does this application believe about trust, and can I prove it wrong?'"*

---

Ultimatrix is an AI-driven security testing platform that combines large language model reasoning with real browser automation, structured knowledge management, and a self-correcting feedback loop. It doesn't just scan — it **observes** your application, builds a **mental model** of how it works, **reasons** about attack surfaces, and **tests** those hypotheses with real HTTP requests and real browser interactions.

It finds vulnerabilities that pattern-based scanners miss, because it understands *context* — not just syntax.

---

## Table of Contents

- [Why Ultimatrix?](#why-ultimatrix)
- [How It Works](#how-it-works)
- [Architecture Overview](#architecture-overview)
- [The Intelligence Layer](#the-intelligence-layer)
- [Dual Engine Architecture](#dual-engine-architecture)
- [21 Knowledge-Based Skills](#21-knowledge-based-skills)
- [Human-in-the-Loop](#human-in-the-loop)
- [Graph-Powered Reasoning](#graph-powered-reasoning)
- [Response Compression (Headroom)](#response-compression-headroom)
- [Session & Cookie Management](#session--cookie-management)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Configuration](#configuration)
- [Supported Providers](#supported-providers)
- [Testing](#testing)
- [Requirements](#requirements)
- [License](#license)

---

## Why Ultimatrix?

Security tools fall into two camps: **signature scanners** that match known patterns and miss everything novel, and **manual frameworks** that require a human operator to drive them. Ultimatrix is neither.

| Capability | Signature Scanner | Manual Framework | **Ultimatrix** |
|-----------|------------------|-----------------|----------------|
| Novel vuln detection | None | Human intuition | LLM reasoning |
| Attack surface mapping | Endpoint list | Manual | Graph-based |
| Context understanding | None | Human | Knowledge graph |
| Self-correction | None | Human | Reflexion engine |
| Browser interaction | No | Yes | Yes (Stagehand) |
| Session persistence | No | Manual | Automatic |
| Multi-model support | No | N/A | 15 providers |
| Response compression | No | N/A | Headroom AI |

**The key insight:** Observation is the foundation of security testing. Before Ultimatrix attacks anything, it maps your entire attack surface — endpoints, authentication flows, role-based access, technology stack, exposed secrets, JavaScript bundles. It builds a **knowledge graph**. Then it reasons over that graph to decide what's worth testing and how.

A scanner checks for SQL injection patterns. Ultimatrix understands that your user profile endpoint takes an ID parameter, that the ID is sequential, that there's no authorization check, and that the response leaks database error messages — then it crafts a payload specific to *your* application's context.

---

## How It Works

```
You: "Test https://your-app.com for security issues"

┌─────────────────────────────────────────────────────────────┐
│  PHASE 1: OBSERVE                                          │
│  ─────────────────                                         │
│  Spider crawls the application, captures traffic via HAR,  │
│  parses endpoints, detects auth flows, maps RBAC roles.    │
│  Result: 47 endpoints, 3 auth flows, 5 role transitions,   │
│          12 input parameters, technology fingerprint.       │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 2: ORIENT                                           │
│  ───────────────                                           │
│  Knowledge graph constructed. Anti-loop detects stale       │
│  paths. Evidence gate validates every claim. Reflexion      │
│  engine classifies past failures. Blackboard tracks         │
│  facts and intents.                                        │
│  Result: "Admin panel at /admin uses session cookies but    │
│          /api/users doesn't validate roles. Password reset  │
│          token is predictable. .env.bak exposed."          │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 3: ACT                                              │
│  ────────────                                              │
│  Crafts real HTTP requests, automates browser interactions, │
│  tests for IDOR, privilege escalation, info disclosure,     │
│  race conditions, and business logic flaws.                │
│  Result: IDOR on /api/users/123 → 200 OK with full         │
│          profile. Admin panel accessible with regular       │
│          user token. .env.bak contains DATABASE_URL and     │
│          JWT_SECRET.                                       │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│  PHASE 4: REPORT                                           │
│  ───────────────                                           │
│  Structured findings with evidence, reproduction steps,     │
│  risk scoring, and remediation guidance. Graph persistence  │
│  enables cross-session learning.                           │
│  Result: 3 critical, 2 high, 4 medium issues. Full report  │
│          with reproduction steps.                          │
└─────────────────────────────────────────────────────────────┘
```

That's not a toy. That's a security consultant that works 24/7.

---

## Architecture Overview

```
                              ┌──────────────────────────┐
                              │     CLI / Web Interface   │
                              │  init | solve | interact  │
                              │  scan | learn | replay    │
                              └────────────┬─────────────┘
                                           │
                              ┌────────────▼─────────────┐
                              │    Engine Selector        │
                              │  config.engine:           │
                              │  'legacy' | 'solver'      │
                              └─────┬──────────────┬─────┘
                                    │              │
               ┌────────────────────▼──┐    ┌──────▼──────────────────┐
               │  Legacy Supervisor    │    │  Solver Engine (OODA)   │
               │  ─────────────────    │    │  ────────────────────   │
               │  Observe → Learn →    │    │  REASON → EXPLORE →     │
               │  Attack → Loop        │    │  CONCLUDE → loop        │
               │                       │    │                         │
               │  4 Specialist Workers │    │  Blackboard state-space │
               │  • injection          │    │  (Fact/Intent tracking) │
               │  • authControl        │    │                         │
               │  • advanced           │    │                         │
               │  • recon              │    │                         │
               └───────────┬───────────┘    └────────────┬───────────┘
                           │                             │
               ┌───────────▼─────────────────────────────▼───────────┐
               │              Shared Intelligence Layer              │
               │  ─────────────────────────────────────────          │
               │  • Evidence Gate (anti-hallucination)               │
               │  • Reflexion Engine (failure classification)        │
               │  • Anti-Loop Detector (stale/dead-end detection)    │
               │  • Knowledge Graph (11 node types, 12 edge types)  │
               │  • Skill Library (21 knowledge-based skills)        │
               │  • Headroom Compression (response headroom)         │
               │  • Session Manager (cookie expiry validation)       │
               └───────────────────────┬─────────────────────────────┘
                                       │
               ┌───────────────────────▼─────────────────────────────┐
               │                    Tool Layer                       │
               │  ──────────────────────────────────                 │
               │  24 specialized tools:                              │
               │  httpRequest, browser automation, graph queries,    │
               │  session restore, skill loading, encode/decode,    │
               │  finding generation, delegation, OAST callbacks...  │
               │                                                     │
               │  Response Flow:                                      │
               │  HTTP Response → Headroom Compression → LLM         │
               │  (structured CompressionResult with                 │
               │   wasCompressed/wasTruncated booleans)              │
               └───────────────────────┬─────────────────────────────┘
                                       │
               ┌───────────────────────▼─────────────────────────────┐
               │                  Browser Layer                      │
               │  ─────────────────────────────────                  │
               │  • Playwright + Stagehand hybrid                    │
               │  • Dialog watcher (auto-dismiss JS alerts)          │
               │  • Human observer (action capture)                  │
               │  • State bridge (CDP session persistence)           │
               │  • Reaction observer (DOM mutation tracking)        │
               └─────────────────────────────────────────────────────┘
```

### Source Layout (166 TypeScript files)

```
src/
├── analysis/          # Skill loader, HAR analyzer, instruction builder
├── browser/           # Playwright/Stagehand, dialog watcher, state bridge
├── capture/           # Human observer, HAR parser, network capture
├── cli/               # CLI entry point, command handlers
├── compression/       # Headroom compression service
├── config/            # Config loader, schema, validation
├── events/            # Typed event emitter
├── generation/        # Test generator, parameterizer, storage
├── graph/             # Knowledge graph (TypeGraph), store, tools
├── http/              # HTTP client with compression, rate limiting
├── intelligence/      # Evidence gate, reflexion, anti-loop, RBAC, chaining
├── logging/           # Forensic event logger, system metrics
├── manager/           # Agent manager (legacy)
├── mastra/            # Mastra agent wiring, tool registry
├── memory/            # Memory schemas, store
├── models/            # Model factory, selector, rate limiter, quota tracker
├── oast/              # Out-of-band attack server (blind callback detection)
├── prompts/           # Core contract, system prompts
├── recorder/          # Action recorder, code generator
├── replay/            # Test case replayer
├── report/            # JSON/HTML/Markdown report generator
├── session/           # Session lifecycle, engine routing
├── solver/            # OODA solver engine, brain, blackboard
├── spider/            # Stagehand-based hybrid crawler
├── supervisor/        # Legacy supervisor agent
├── tools/             # 24 specialized tools
├── types/             # Shared TypeScript types
├── usage/             # Token/usage tracker
├── utils/             # Logger, helpers
└── workers/           # 4 specialist worker agents
```

---

## The Intelligence Layer

What makes Ultimatrix different from "LLM in a loop" is its intelligence layer — interconnected systems that make it actually *smart*:

### Evidence Gate
The agent can't hallucinate findings. Every claim it makes must be backed by actual tool output. If it says "SQL injection found," it must show you the HTTP response that proves it. No proof = no finding. This is enforced at the architecture level, not as a prompt suggestion.

**Zero tolerance policy:** Truncated evidence is automatically rejected — an unverifiable claim is treated the same as a hallucination. The gate uses structured `CompressionResult` types (never string scanning) to determine if evidence was truncated.

### Reflexion Engine
When an attack fails, Ultimatrix doesn't just move on. It classifies the failure and escalates:

| Level | Classification | Action |
|-------|---------------|--------|
| L0 | Bad luck / transient | Retry with variation |
| L1 | Wrong tool | Switch tool |
| L2 | Wrong strategy | Change approach |
| L3 | Wrong model | Escalate to stronger model |
| L4 | Fundamental gap | Extract lesson for future |

Over a session, it gets progressively smarter about *your* specific target.

### Anti-Loop Detector
LLMs love to repeat themselves. The anti-loop system detects when the agent is stuck — trying the same approach with slight variations — and forces it down unexplored paths. It also extracts structured attack paths from the conversation, tracking what was tried, what worked, and what failed.

### Blackboard (OODA Solver)
A shared state-space where the solver tracks **Facts** (what it knows) and **Intents** (what it plans to do). Every observation updates the blackboard. Every decision reads from it. This prevents redundant work and enables compound reasoning:

```
Fact: /api/users takes ID parameter (sequential)
Fact: /api/users/123 returns full profile (no auth check)
Intent: Test IDOR on /api/users/{id} with role escalation
Result: IDOR confirmed — swapped to /api/users/456, got different profile
```

---

## Dual Engine Architecture

Ultimatrix has two engines, because different situations call for different approaches:

### Solver Engine (OODA Loop)
The primary engine. **R**eason → **E**xplore → **C**onclude, in a tight loop.

```
    ┌────────────────────────────────────┐
    │           REASON                    │
    │  Analyze blackboard state.          │
    │  Select next hypothesis to test.    │
    │  Choose tools and approach.         │
    └──────────────┬─────────────────────┘
                   ▼
    ┌────────────────────────────────────┐
    │           EXPLORE                   │
    │  Execute tool calls.                │
    │  Make HTTP requests.                │
    │  Automate browser interactions.     │
    │  Capture evidence.                  │
    └──────────────┬─────────────────────┘
                   ▼
    ┌────────────────────────────────────┐
    │           CONCLUDE                  │
    │  Validate evidence (Evidence Gate). │
    │  Classify failures (Reflexion).     │
    │  Update blackboard.                 │
    │  Check termination conditions.      │
    └──────────────┬─────────────────────┘
                   │
                   └──────── loop ────────
```

Best for:
- Autonomous goal-driven testing ("find all privilege escalation vectors")
- Interactive sessions where you guide the research
- Targets where you need deep, iterative reasoning

### Legacy Supervisor
The battle-tested engine. Observe → Learn → Attack → Report. Uses 4 specialist workers for parallel exploration:

- **injection** — SQL/NoSQL/XPath injection, command injection
- **authControl** — Authentication bypass, session management
- **advanced** — SSRF, deserialization, prototype pollution
- **recon** — Technology fingerprinting, exposed files, info disclosure

Best for:
- Structured scans with clear phases
- Environments where you want predictable, linear progression
- Compatibility with older configurations

Both engines share the same intelligence layer, the same 21 skills, and the same tool set. The engine selector just changes *how* they're orchestrated.

---

## 21 Knowledge-Based Skills

Not payload lists. Not regex patterns. **Knowledge.**

Each skill is a markdown file containing security expertise — reasoning patterns, testing methodologies, what to look for and why. The LLM reads these skills and applies the knowledge using its own reasoning capabilities.

### Core Skills (7)

| Skill | What It Knows |
|-------|---------------|
| **Recon** | Deep page analysis, JavaScript bundle secrets, exposed files, technology fingerprinting, subdomain enumeration |
| **Vuln Discovery** | Dynamic payload crafting, input type analysis, WAF adaptation, context-aware encoding, parameter pollution |
| **Exploitation** | Proof-of-concept development, impact assessment, chaining vectors, severity scoring |
| **Post-Exploitation** | Lateral movement, privilege escalation, persistence mechanisms, data exfiltration |
| **Reporting** | Finding documentation, risk quantification (CVSS), remediation guidance, executive summaries |
| **WAF Bypass** | Encoding tricks, fragmentation, timing attacks, case variation, chunked transfer |
| **Pentest Flow** | Structured methodology, scope management, documentation standards, reporting cadence |

### Specialized Skills (14)

| Skill | What It Knows |
|-------|---------------|
| **Web Pentest** | OWASP Top 10, API testing, authentication bypass, session fixation |
| **Web Security Advanced** | CSP bypass, CORS misconfiguration, cache poisoning, request smuggling |
| **Authorization** | Multi-role testing, IDOR, JWT attacks (alg confusion, key confusion), OAuth bypass, session hijacking |
| **Business Logic** | Workflow bypass, price manipulation, race conditions, coupon abuse, quantity tampering |
| **Info Disclosure** | JS bundle analysis, .env exposure, error message leakage, stack traces, version disclosure |
| **Race Conditions** | Concurrent request testing, TOCTOU, mass assignment, double-spend |
| **Crypto Toolkit** | Hash analysis, key extraction, algorithm weaknesses, padding oracle, timing attacks |
| **AI/MCP Security** | Prompt injection, model manipulation, tool poisoning, data exfiltration via AI |
| **OSINT Recon** | Subdomain enumeration, certificate transparency, DNS records, technology detection |
| **Intranet Pentest** | Internal network testing, SMB shares, LDAP injection, Kerberoasting |
| **Pentest Tools** | Nmap, Burp Suite, SQLMap, Nikto integration and interpretation |
| **CTF Web** | Web challenge methodologies, exploitation chains, flag extraction |
| **CTF Crypto** | Cryptanalysis, frequency analysis, known-plaintext attacks |
| **CTF Misc** | Steganography, encoding challenges, forensics, reverse engineering |

### Skill Matching

Skills are matched to tasks using natural-language **triggers** — not keyword/substring matching. The `resolveSkillsForInput()` function scores skills based on semantic relevance to the current context:

```
Input: "Testing JWT token validity and expiration"
  → Authorization skill (trigger: "jwt, token validation, expiry")
  → Web Pentest skill (trigger: "authentication, session")
  → Recon skill (trigger: "token analysis, header inspection")
```

---

## Human-in-the-Loop

Ultimatrix isn't a black box. It works *with* you:

### Browser Visibility
Watch the agent navigate in real time in a visible Chromium window. See exactly what it's clicking, what it's typing, what it's finding.

### Action Capture
Record your manual testing sessions — logins, form submissions, navigation flows — and the agent learns from them:

```
You: [manually logs in as admin, navigates to /admin/users]
Agent: "I observed your admin login flow. Session cookies captured.
        I'll use these for authenticated testing. Want me to test
        role-based access on /admin/users?"
```

### Session Management with Cookie Expiry Handling
Sessions are saved to the knowledge graph with full cookie and localStorage state. When cookies expire, the agent detects it automatically:

```
Agent: [restores session]
       [navigates to protected page]
       [detects login form on page]

Agent: "Session cookies have expired. I need you to re-login.
        Please authenticate in the browser, then tell me when ready."
```

The system:
- Filters expired cookies before restoring them
- Validates authentication state after navigation (URL patterns + DOM inspection)
- Returns clear `sessionExpired: true` signals to the agent
- Never exposes passwords — only session cookies are captured

### Interactive REPL
Chat with the agent, ask questions, redirect its approach:

```
$ npx ultimatrix interact -t https://your-app.com
> What auth mechanism does this app use?
> Test the password reset flow for token prediction
> Try SQL injection on the search endpoint
> Show me what you've found so far
```

### Screenshot Evidence
Every finding includes visual proof — screenshots of the vulnerable page, response bodies, and reproduction steps.

---

## Graph-Powered Reasoning

Under the hood, Ultimatrix maintains a knowledge graph with 11 node types and 12 edge types:

```
                    ┌──────────┐
        ┌───────── │ Endpoint │ ─────────┐
        │          └──────────┘          │
        │ REQUESTS                  PRODUCES
        ▼                                ▼
┌──────────┐                      ┌──────────┐
│ Finding  │                      │  Input   │
└──────────┘                      └──────────┘
     │ EXPLOITS                         │
     ▼                                  │ CHAINS_TO
┌──────────┐                      ┌──────────┐
│AttackPath│ ───── BUILT_ON ──── │AttackStep│
└──────────┘                      └──────────┘

┌──────────┐  USES_AUTH  ┌──────────┐  REQUIRES_ROLE  ┌───────────┐
│ Endpoint │ ──────────► │ AuthFlow │ ─────────────── │ RBACMatrix│
└──────────┘             └──────────┘                 └───────────┘

┌──────────┐  PRODUCED_BY  ┌──────────┐
│   Test   │ ◄──────────── │ Finding  │
└──────────┘               └──────────┘

┌──────────┐         ┌──────────┐         ┌──────────┐
│  Fact    │────────▶│ Intent   │────────▶│Reflexion │
└──────────┘         └──────────┘         └──────────┘
  (what we know)     (what we plan)        (what we learned)
```

This isn't just data storage. The agent *queries* the graph to make decisions:
- "What endpoints haven't I tested yet?"
- "Which findings chain together for a critical attack?"
- "What authentication flows protect this admin endpoint?"
- "Have I seen this pattern before in a different context?"
- "What facts have I established about this target?"

---

## Response Compression (Headroom)

Ultimatrix uses **Headroom** for intelligent response compression instead of blind truncation. Large HTTP responses are compressed content-aware before being sent to the LLM:

| Content Type | Compression | Strategy |
|-------------|-------------|----------|
| JSON arrays | 70-90% | Structure-preserving |
| HTML pages | 60-80% | Tag-aware |
| JavaScript | 40-70% | Comment/whitespace removal |
| Plain text | 30-50% | Sentence-level |

Every compression result is tracked with a structured `CompressionResult` type:

```typescript
interface CompressionResult {
  wasCompressed: boolean    // Whether compression was applied
  wasTruncated: boolean     // Whether content was cut off
  originalSize: number      // Original response size
  compressedSize: number    // Size after compression
}
```

This state flows through the entire pipeline — the Evidence Gate uses it to reject claims based on truncated evidence, and the agent sees compression metrics in tool responses. **No string scanning** (`includes('[truncated')`) — only structured types for state detection.

---

## Session & Cookie Management

### Session Lifecycle

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│  saveSession │────▶│ Graph Store  │────▶│  Cookies +     │
│  (capture)   │     │ (AuthFlow)   │     │  localStorage  │
└─────────────┘     └──────────────┘     └────────────────┘
                                               │
                    ┌──────────────────────────┐│
                    │                          ▼│
             ┌──────▼──────┐     ┌──────────────────┐
             │ restoreSession│────▶│ Browser Context  │
             │ (set cookies) │    │ (Playwright)     │
             └──────┬──────┘     └──────────────────┘
                    │                          │
                    ▼                          ▼
             ┌──────────────────┐     ┌──────────────────┐
             │ Expiry Check     │     │ Post-Nav Verify  │
             │ • Filter expired │     │ • Login redirect? │
             │ • Signal if all  │     │ • Password field? │
             │   expired        │     │ • Auth state?     │
             └──────────────────┘     └──────────────────┘
```

### Cookie Expiry Validation

When restoring a session, Ultimatrix:

1. **Filters expired cookies** — cookies with `expires < now` are skipped
2. **Signals if all cookies expired** — returns `sessionExpired: true` with clear error
3. **Validates post-navigation** — after setting cookies and navigating, checks for:
   - Login page redirects (URL pattern matching)
   - Login forms on the page (`<input type="password">`)
4. **Reports status** — `expiredSkipped`, `sessionValid`, `sessionWarning` in response

```
Agent: restoreSession("admin")
Response: {
  ok: false,
  error: "Session \"admin\" has 5 expired cookies and no valid ones.
          The user must re-login.",
  sessionExpired: true
}
Agent: "I need you to re-login. Please authenticate in the browser."
```

### Credential Handling

| Path | What's Stored | What LLM Uses |
|------|--------------|---------------|
| **Browser capture** | Session cookies after manual login | Cookies via `restoreSession()` |
| **Config YAML** | User-provided email/password in `ultimatrix.yaml` | Passed directly into LLM prompt |

Passwords are **never captured from the browser** — they're masked to `***` by `maskValue()` before storage. The LLM authenticates via session cookies, not credentials.

---

## Quick Start

### Prerequisites

```bash
# Clone and install
git clone <repository-url> && cd project-sentinal
npm install
npx playwright install chromium
```

### Configure Your LLM

```bash
# Interactive setup wizard
npx ultimatrix init

# Or set environment variable directly
export GROQ_API_KEY=gsk_your_key_here    # Free tier available
```

### Start Testing

```bash
# Interactive session — talk to the agent like a colleague
npx ultimatrix interact -t https://httpbin.org

# Autonomous solve — give it a goal, let it work
npx ultimatrix solve -t https://httpbin.org

# Full scan pipeline: capture → analyze → generate tests → report
npx ultimatrix scan -t https://httpbin.org

# Full assessment (legacy engine)
npx ultimatrix assess -t https://your-app.com -o ./results
```

---

## CLI Reference

| Command | Description | Example |
|---------|-------------|---------|
| `ultimatrix init` | Interactive setup wizard — provider, model, credentials | `npx ultimatrix init` |
| `ultimatrix solve -t <url>` | Autonomous OODA solver — give it a goal, it works | `npx ultimatrix solve -t https://target.com` |
| `ultimatrix interact -t <url>` | REPL chat — talk to the agent like a colleague | `npx ultimatrix interact -t https://target.com` |
| `ultimatrix scan -t <url>` | Full pipeline: capture → analyze → generate → report | `npx ultimatrix scan -t https://target.com` |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR, analyze patterns | `npx ultimatrix learn -t https://target.com` |
| `ultimatrix generate -t <url>` | Generate Playwright test cases from captured traffic | `npx ultimatrix generate -t https://target.com` |
| `ultimatrix replay` | Re-run previously generated tests | `npx ultimatrix replay` |
| `ultimatrix report` | Generate JSON/HTML/Markdown report | `npx ultimatrix report` |
| `ultimatrix web` | Next.js web UI at localhost:3000 | `npx ultimatrix web` |
| `ultimatrix assess -t <url>` | Full assessment (legacy engine) | `npx ultimatrix assess -t https://target.com` |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against new deployment | `npx ultimatrix verify -a ./model.json -t https://new.com` |

### CLI Flags

```bash
--provider <name>      # Override config provider
--model <name>         # Override config model
--key <api-key>        # Override config API key
--non-interactive      # Skip prompts, use defaults
--engine <legacy|solver>  # Override engine selection
```

---

## Configuration

```yaml
# ultimatrix.yaml
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: solver                # 'legacy' | 'solver'

solver:
  maxToolCalls: 50            # Max tool-call rounds per turn
  maxTokens: 100000           # Max tokens per turn
  maxDurationMs: 300000       # 5 minute timeout per turn
  maxParallel: 1

rateLimit:
  requestsPerMinute: 15       # Conservative default
  maxConcurrent: 2
  maxRetries: 3

antiLoop:
  staleThreshold: 3           # Force direction change after N repeats

reflexion:
  persistToGraph: true        # Learn across sessions

compression:
  headroom:
    enabled: true
    budgetTokens: 100000      # Max tokens for compressed content
  truncation:
    enabled: true
    maxResponseChars: 50000   # Fallback truncation limit

browser:
  headless: false             # Watch the agent work

credentials:
  your-app:
    email: user@example.com
    password: secure123       # Used by agent, never captured from browser
```

### Environment Variables

```bash
# Provider API keys (set one)
export GROQ_API_KEY=gsk_...
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GOOGLE_GENERATIVE_AI_API_KEY=...
export NVIDIA_API_KEY=nvapi-...

# Debug
export ULTIMATRIX_LLM_DEBUG=1    # Verbose LLM logging
export ULTIMATRIX_LLM_STREAM=1   # Stream LLM responses
```

---

## Supported Providers

| Provider | Models | Free Tier |
|----------|--------|-----------|
| `groq` | llama3-8b-8192, mixtral-8x7b-32768 | Yes |
| `openai` | gpt-4o, gpt-4o-mini, gpt-4-turbo | No |
| `anthropic` | claude-3.5-sonnet, claude-3-opus | No |
| `google` | gemini-1.5-pro, gemini-1.5-flash | Yes |
| `nvidia` | nemotron-3-super-120b, nemotron-3-ultra-550b | Yes |
| `together` | llama3-70b, mixtral-8x22b | Yes |
| `deepseek` | deepseek-chat, deepseek-coder | Yes |
| `mistral` | mistral-large, mistral-medium | No |
| `xai` | grok-2, grok-beta | No |
| `perplexity` | llama-3.1-sonar-large | Yes |
| `cerebras` | llama3-70b | Yes |
| `deepinfra` | Various open-source models | Yes |
| `openrouter` | 100+ models | Varies |
| `azure` | Azure OpenAI deployments | No |
| `bedrock` | AWS Bedrock models | No |

### Multi-Provider Support

```yaml
# Use different models for different tasks
modelTiers:
  fast: groq/llama3-8b-8192          # Quick recon, simple checks
  powerful: nvidia/nemotron-3-ultra   # Deep reasoning, exploitation

# Same provider, different API keys
creds:
  groq:
    apiKey: gsk_key1                  # For fast model
  nvidia:
    apiKey: nvapi_key2                # For powerful model
```

---

## Testing

```bash
# Run all tests (983 passing)
npm test

# Run specific test suite
npx vitest run test/intelligence/evidence-gate.test.ts
npx vitest run test/tools/flow-tools.test.ts
npx vitest run test/solver/solver.test.ts

# Watch mode
npm run test:watch

# Build
npm run build:cli    # ESM + CJS + DTS
```

### Test Coverage

| Module | Tests | Coverage |
|--------|-------|----------|
| Intelligence (evidence-gate, reflexion, anti-loop) | 110 | Core logic |
| Graph (store, tools, schema) | 96 | Full CRUD |
| Tools (24 tools) | 120+ | All tool interfaces |
| Browser (dialog-watcher, state-bridge, reactions) | 55 | CDP integration |
| Config (validation, multi-provider) | 42 | All scenarios |
| Solver (OODA, blackboard, plan) | 60 | Full loop |
| Models (rate-limiter, quota, selector) | 80 | All providers |
| Session (lifecycle, engine routing) | 15 | Both engines |
| Recorder (code gen, interaction) | 57 | Full pipeline |

---

## Requirements

- **Node.js** 20+
- **Playwright** with Chromium (auto-installed)
- **An LLM API key** (Groq free tier works for testing)
- **8GB+ RAM** recommended for large scans
- **Python 3.10+** (optional, for Headroom proxy: `pip install headroom-ai[proxy]`)

---

## Project Status

| Metric | Value |
|--------|-------|
| Source files | 166 TypeScript files |
| Test files | 77 files |
| Tests passing | 983 |
| Skills | 21 (7 core + 14 specialized) |
| Tools | 24 specialized tools |
| Node types | 11 (graph schema) |
| Edge types | 12 (graph schema) |
| Providers | 15 supported |
| Engine modes | 2 (legacy + OODA solver) |

---

## License

MIT
