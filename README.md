# Ultimatrix v8.4

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
- [Choosing Your Engine](#choosing-your-engine)
- [Engine 1: Legacy Supervisor](#engine-1-legacy-supervisor)
- [Engine 2: Solver (OODA Loop)](#engine-2-solver-ooda-loop)
- [Engine 3: Multi-Model (Dynamic Routing)](#engine-3-multi-model-dynamic-routing)
- [Engine 4: Council (Debate Framework)](#engine-4-council-debate-framework)
- [The Intelligence Layer](#the-intelligence-layer)
- [Multi-Model Routing](#multi-model-routing)
- [21 Knowledge-Based Skills](#21-knowledge-based-skills)
- [Human-in-the-Loop](#human-in-the-loop)
- [Graph-Powered Reasoning](#graph-powered-reasoning)
- [Scope Guard](#scope-guard)
- [Campaign Autonomy](#campaign-autonomy)
- [Attack-Path Solver](#attack-path-solver)
- [Cross-Engagement Memory](#cross-engagement-memory)
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
| Multi-model support | No | N/A | 16 providers, 3 tiers |
| Response compression | No | N/A | Headroom AI |
| Model routing | No | N/A | Dynamic per-task |
| Scope enforcement | No | Manual | Automatic (scope guard) |
| Attack path discovery | No | Manual | BFS graph traversal |
| Cross-session learning | No | Manual | Anonymized pattern memory |
| Campaign coverage | N/A | Manual | Systematic test planning |

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
                    ┌──────────────────────▼──────────────────────┐
                    │            Engine Selector                  │
                    │     config.engine: 'multi-model' (default)  │
                    │              | 'legacy'                     │
                    └──────┬──────────────────────┬──────────────┘
                           │                      │
          ┌────────────────▼──────────────┐  ┌────▼──────────┐
          │  Multi-Model Engine           │  │ Legacy        │
          │  (default)                    │  │ Supervisor    │
          │  ────────────                 │  │ ────────────  │
          │  OODA solver +                │  │ Observe →     │
          │  Dynamic Model Selection      │  │ Learn →       │
          │  + /council on-demand         │  │ Attack → Loop │
          │  ─────────────                │  │               │
          │  Brain decides when to        │  │ 4 Specialist  │
          │  bring in council (4 LLMs)    │  │ Workers       │
          │  via requestCouncil tool      │  │               │
          └──────────────┬────────────────┘  └────┬──────────┘
                         │                       │
          ┌──────────────▼───────────────────────▼──────────┐
           │  Shared Intelligence Layer                      │
           │  ─────────────────────────────────────────────  │
           │  • Evidence Gate (anti-hallucination)           │
           │  • Reflexion Engine (L0-L4 failure class)       │
           │  • Anti-Loop Detector (stale/dead-end detect)   │
            │  • Knowledge Graph (20 node types, 15 edges)   │
            │  • Skill Library (57 knowledge-based skills)    │
           │  • Scope Guard (URL/domain enforcement)         │
           │  • Headroom Compression (response compress)     │
           │  • Session Manager (cookie expiry handling)     │
           │  • Cross-Engagement Memory (pattern learning)   │
           │  • Attack-Path Solver (BFS vulnerability chains) │
           │  • Campaign Autonomy (coverage planning)        │
           │  • Debate Memory (stance tracking for council)  │
          └──────────────────────────┬──────────────────────────┘
                                     │
          ┌──────────────────────────▼─────────────────────────────────────┐
           │  Tool Layer                                │
           │  ──────────────────────────────────                           │
           │  28+ specialized tools:                                        │
           │  httpRequest, browser automation, graph queries,              │
           │  session restore, skill loading, encode/decode,              │
           │  finding generation, delegation, OAST callbacks,             │
           │  scope enforcement, browser auth extraction,                 │
           │  attack-path analysis, case file export...                   │
          │                                                                │
          │  Response Flow:                                                │
          │  HTTP Response → Headroom Compression → LLM                   │
          │  (structured CompressionResult with                           │
          │   wasCompressed/wasTruncated booleans)                        │
          └──────────────────────────┬─────────────────────────────────────┘
                                     │
          ┌──────────────────────────▼─────────────────────────────────────┐
           │                    Browser Layer                              │
           │  ──────────────────────────────────                           │
           │  • Playwright + Stagehand hybrid                              │
           │  • Dialog watcher (auto-dismiss JS alerts)                    │
           │  • Human observer (action capture)                            │
           │  • State bridge (CDP session persistence)                     │
           │  • Reaction observer (DOM mutation tracking)                  │
           │  • Bot detection (Cloudflare/Akamai/DataDome/PerimeterX)     │
           └───────────────────────────────────────────────────────────────┘
```

### Source Layout (274+ TypeScript files, 30K+ LOC)

```
src/
├── analysis/          # HAR analyzer, instruction builder, skill loader
├── browser/           # Playwright/Stagehand, dialog watcher, state bridge, anti-bot
├── campaign/          # Campaign planning, execution, continuity
├── capture/           # Human observer, HAR parser, network capture, JS miner
├── cli/               # CLI entry point, command handlers
├── compression/       # Headroom compression service
├── config/            # Config loader, schema, validation
├── council/           # Council debate engine (4 LLM members, debate memory)
│   ├── personas/      # 8 persona .md files with YAML frontmatter
│   ├── factory.ts     # LLM member creation, per-role tool filtering
│   ├── orchestrator.ts # Parallel debate, stance extraction
│   ├── debate-memory.ts # Stance tracking, contradiction detection
│   ├── persona-loader.ts # YAML frontmatter parser
│   ├── bus.ts         # Conversation bus, sliding-window transcript
│   ├── types.ts       # MemberOutput, DebateMemory, Stance types
│   ├── approval.ts    # HITL approval gate
│   ├── evidence-bridge.ts # Worker results → evidence items
│   └── blackboard-shared.ts # SharedBlackboard adapter
├── core/              # Unified execution core (runner, strategies, blackboard)
├── events/            # Typed event emitter
├── generation/        # Test generator, parameterizer, storage
├── graph/             # Knowledge graph (TypeGraph), store, tools, relations
├── http/              # HTTP client with compression, rate limiting
├── intelligence/      # Evidence gate, reflexion, anti-loop, RBAC, chaining, hypotheses
├── logging/           # Forensic event logger, system metrics
├── manager/           # Agent manager (legacy supervisor)
├── mastra/            # Mastra agent wiring, tool registry
├── memory/            # Memory schemas, store
├── models/            # Model factory, selector, rate limiter, quota tracker
├── oast/              # Out-of-band attack server (blind callback detection)
├── primitives/        # Security primitives (9 oracles: IDOR, auth bypass, race, etc.)
├── prompts/           # Core contract, system prompts
├── recorder/          # Action recorder, code generator
├── replay/            # Test case replayer
├── report/            # JSON/HTML/Markdown report generator, case file export
├── safety/            # Scope guard, URL validation
├── session/           # Session lifecycle, engine routing, HAR capture
├── solver/            # OODA solver engine, brain, blackboard, attack-path, exploitation-loop, threat-model, skills
├── spider/            # Stagehand-based hybrid crawler
├── supervisor/        # Legacy supervisor agent
├── tools/             # 28+ specialized tools
├── types/             # Shared TypeScript types
├── usage/             # Token/usage tracker
├── utils/             # Logger, helpers, output guard
└── workers/           # 4 specialist worker agents
```

---

## Choosing Your Engine

Before diving into each engine, here's the decision matrix:

| I want to... | Engine | Why |
|-------------|--------|-----|
| **Autonomous attack** — give a goal, walk away | `multi-model` | OODA loop runs unattended, dynamic model selection |
| **Guided pentest** — I steer, agent executes | `multi-model` + `/council` | Brain runs autonomously, bring in council for complex decisions |
| **Budget optimization** — many tasks, different models | `multi-model` | Dynamic model selection per task (cheap for recon, powerful for exploitation) |
| **Structured scan** — predictable phases | `legacy` | Observe → Learn → Attack → Report loop |
| **Just chat** — ask questions about the target | `interact` + any engine | REPL accepts natural language in any engine mode |

### Quick comparison

| Feature | Multi-Model (Default) | Legacy | 
|---------|----------------------|--------|
| Autonomy | Full | Reactive |
| Decision making | Single LLM brain + model picker | Supervisor + 4 workers |
| Model routing | Dynamic per-task | Single model |
| Council debate | On-demand via `/council` | N/A |
| Memory across turns | Blackboard | Thread memory |
| Best for | Deep autonomous research, interactive red teaming | Predictable scans |

---

## Engine 1: Legacy Supervisor

The battle-tested engine. **Observe → Learn → Attack → Report** in a structured 5-phase loop.

```
┌─────────────────────────────────────────────────────────┐
│                  Legacy Supervisor                       │
│  ─────────────────────────────────                      │
│  Phase 1: OBSERVE — getTargetSummary, queryGraph,       │
│           getEndpointsWithParams, getAuthFlows           │
│  Phase 2: LEARN  — Analyze endpoints, plan strategy,    │
│           search skill library                           │
│  Phase 3: ATTACK — Delegate via spawn_worker,           │
│           spawn_swarm, or execute_direct                 │
│  Phase 4: RECORD — recordEvidence + writeFinding        │
│  Phase 5: LOOP   — Re-observe, check for chains         │
└───────────────────────┬─────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
  ┌──────────┐   ┌──────────┐   ┌──────────┐
  │injection │   │authCtrl  │   │advanced  │
  │ Worker   │   │ Worker   │   │ Worker   │
  └──────────┘   └──────────┘   └──────────┘
       +              +              +
  ┌──────────┐
  │  recon   │
  │  Worker  │
  └──────────┘
```

**Key characteristics:**
- **Reactive**: waits for user input each turn, executes, returns results
- **Stream-based**: uses `agent.stream()` with `maxSteps` for tool-call loops
- **Worker delegation**: includes graph diff snapshots (nodes/findings before/after)
- **Workers receive informed context**: endpoint details, captured headers/cookies, auth types
- **Sub-agent architecture**: supervisor + 4 specialist workers via Mastra `Agent`

**Best for:**
- Structured scans with clear phases
- Environments where you want predictable, linear progression
- Compatibility with older configurations

### Engine 2: Solver (OODA Loop) — Default

The primary engine. **R**eason → **E**xplore → **C**onclude, in a tight loop with passive intelligence layers.

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
    │  Intelligence layers observe:       │
    │  • EvidenceGate.recordToolOutput()  │
    │  • LoopDetector.recordRound()       │
    │  • ReflexionEngine.recordAttempt()  │
    └──────────────┬─────────────────────┘
                   ▼
    ┌────────────────────────────────────┐
    │           CONCLUDE                  │
    │  Validate evidence (Evidence Gate). │
    │  Classify failures (Reflexion).     │
    │  Update blackboard.                 │
    │  Check termination conditions.      │
    │  • goal_achieved                    │
    │  • frontier_exhausted               │
    │  • stale                            │
    └──────────────┬─────────────────────┘
                   │
                   └──────── loop ────────
```

**Key characteristics:**
- **Agent-driven**: the LLM decides what tools to call and when to stop
- **Blackboard persists** across REPL turns (accumulated knowledge)
- **Intelligence layers observe passively** — they do NOT gate or interrupt
- **No rigid phase ordering** — the LLM follows its own reasoning
- **Goal-enriched messages** give the agent full context each turn (graph state, blackboard knowledge, reflexion hints, skill methodology)
- **~30 focused tools** organized by domain (graph, HTTP, skills, session, orchestration, interaction)

**Best for:**
- Autonomous goal-driven testing ("find all privilege escalation vectors")
- Interactive sessions where you guide the research
- Targets where you need deep, iterative reasoning

### Engine 3: Multi-Model (Dynamic Routing)

**Solver engine + dynamic model selection per task.** Uses the same OODA loop, with one critical addition: the `selectModel` tool.

```
    ┌────────────────────────────────────┐
    │           REASON                    │
    │  analyzeTask()                      │
    │         │                           │
    │         ▼                           │
    │  ┌──────────────────────┐          │
    │  │    selectModel       │          │
    │  │  ──────────────      │          │
    │  │  Score each model:   │          │
    │  │  • Capability match  │          │
    │  │  • Context headroom  │          │
    │  │  • Rate limit state  │          │
    │  │  • Success history   │          │
    │  │  • Budget remaining  │          │
    │  └──────────┬───────────┘          │
    │             │                      │
    │             ▼                      │
    │  best_model = argmax(scores)       │
    └──────────────┬─────────────────────┘
                   ▼
    ┌────────────────────────────────────┐
    │           EXPLORE                   │
    │  Delegate to worker with optimal   │
    │  model for this specific task.     │
    └──────────────┬─────────────────────┘
                   ▼
    ┌────────────────────────────────────┐
    │           CONCLUDE                  │
    │  Record success/failure for model  │
    │  scoring feedback loop.            │
    └────────────────────────────────────┘
```

**How it differs from plain Solver:**

| Feature | Solver | Multi-Model |
|---------|--------|-------------|
| Model selection | Single model for all tasks | Dynamic per-task routing |
| `selectModel` tool | No | Yes — scores and selects optimal model |
| Budget allocation | Single model budget | Role-based: brain 30%, workers 60%, spider 10% |
| Rate limit handling | Per-provider | Per-provider + model switching on exhaustion |
| Success tracking | N/A | Empirical success rate per model feeds scoring |
| Provider diversity | N/A | Prefers different provider than brain for workers |

**Best for:**
- Large targets requiring many model calls (budget efficiency)
- Mixed-complexity tasks (quick recon + deep exploitation)
- Cost optimization (use cheap models for simple tasks, powerful for complex)
- Provider redundancy (switch on rate limit exhaustion)

### Engine Selection

```yaml
# ultimatrix.yaml
engine: multi-model     # 'legacy' | 'multi-model' (default)
                         # 'solver' → alias for multi-model (deprecated)
                         # 'council' → deprecated, coerced to multi-model
```

| CLI Command | Default Engine | Notes |
|-------------|---------------|-------|
| `ultimatrix solve` | `multi-model` (hardcoded) | Always uses OODA loop |
| `ultimatrix interact` | From config | Respects `config.engine`, `/council` available |
| `ultimatrix scan` | From config | Respects `config.engine` |
| `ultimatrix assess` | `legacy` (hardcoded) | Legacy supervisor |

---

## Council (On-Demand Debate)

**Four LLM specialists debate what to test. On-demand via `/council`.**

Council is not an engine — it's a REPL command. The brain runs as your default `multi-model` engine, and when you hit a complex decision, you bring in the council with `/council <goal>`. The brain can also suggest council via the `requestCouncil` tool.

```
> Test this app for IDOR
[Brain runs autonomously — OODA loop with model selection]

> /council What's the best approach for privilege escalation?
[Council debate] 4 LLM members respond in parallel:
  Strategist: "Chain IDOR on /api/users with session fix on /auth"
  Operator: "Need auth cookies first — suggest testing login flow"
  Skeptic: "No evidence /api/users accepts user input — verify first"
  Analyst: "Connect with info disclosure on /api/errors we found"
→ [Human decides] approves the strategy

> /council Verify our findings are reportable
[Council debate] Skeptic verifies evidence for each finding
```

```
    ┌────────────────────────────────────────────────────────────┐
    │                    COUNCIL DEBATE                         │
    │  ────────────────────────────────                         │
    │                                                          │
    │  Phase 1: PROPOSAL (Strategist)                          │
    │  "Test SQL injection on /api/users — endpoint takes      │
    │   user input, no visible sanitization, 200 OK response"  │
    │                                                          │
    │  Phase 2: CHALLENGE (all others, parallel)               │
    │  ┌────────────────────────────────────────────────────┐  │
    │  │ Skeptic:   "Where's the evidence? Show me the     │  │
    │  │             recorded observation."                  │  │
    │  │ Operator:  "I need auth cookies to reach /api/     │  │
    │  │             users. Can't test without them."        │  │
    │  │ Analyst:   "SQLi + IDOR is more impactful. Chain   │  │
    │  │             with /api/users/:id."                   │  │
    │  └────────────────────────────────────────────────────┘  │
    │                                                          │
    │  Phase 3: REVISION (Strategist revises based on feedback)│
    │  Phase 4: EXECUTION (Operator runs approved proposal)    │
    │  Phase 5: REFLECTION (All: what worked, what failed)     │
    │                                                          │
    └──────────────────────────────┬─────────────────────────────┘
                                   │
                                   ▼
    ┌────────────────────────────────────────────────────────────┐
    │                    DEBATE MEMORY                          │
    │  ────────────────────────────────                         │
    │  Tracks: stances, failed approaches, proven findings     │
    │  Members reference past positions for consistency        │
    │  Contradictions detected and surfaced                    │
    └────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
    ┌────────────────────────────────────────────────────────────┐
    │                    HITL APPROVAL                          │
    │  ────────────────────────────────                         │
    │  Critical actions → human approval required               │
    │  Low/medium impact → auto-approve                         │
    │  Skeptic veto → blocks without evidence                   │
    └────────────────────────────────────────────────────────────┘
```

### How Council Works

Council is invoked on-demand via `/council <goal>` during any multi-model REPL session:

| Aspect | Brain (default) | Council (on-demand) |
|--------|----------------|---------------------|
| Decision making | Single LLM brain decides | Four LLMs debate and challenge |
| Adversarial checking | None (self-correction via reflexion) | Skeptic actively rejects unsupported claims |
| Human control | Fully autonomous | HITL approval for critical actions |
| Persona depth | Brain instructions | 4 rich personas with backstories, expertise, debate behavior |
| Memory | Blackboard (facts + intents) | Blackboard + Debate Memory (stances, contradictions) |
| Flow | Brain proposes → executes | Strategist proposes → skeptic gates → human approves → operator executes |

### Persona System

Personas are loaded from markdown files with YAML frontmatter metadata:

```
src/council/personas/
├── charter.md          # Shared rules of engagement
├── strategist.md       # The Architect — attack direction
├── operator.md         # The Runner — execution
├── skeptic.md          # The Auditor — evidence gating
├── analyst.md          # The Cartographer — pattern chains
├── debate-protocol.md  # 5-phase debate structure
├── output-contract.md  # Structured JSON schemas
└── human.md            # Human seated member
```

Each persona file contains:
- **YAML frontmatter**: `id`, `name`, `role`, `tier`, `toolRestrictions`, `expertise[]`, `constraints[]`, `authority`
- **Markdown body**: Rich persona instructions (50+ lines each vs 3-6 lines before)

Tool restrictions from YAML frontmatter automatically filter which tools each member can use:
- **Strategist**: all tools (needs full visibility)
- **Operator**: HTTP, browser, worker delegation, finding recording
- **Skeptic**: HTTP read-only, browser observation (no write tools)
- **Analyst**: HTTP, browser, graph updates, chain detection

### Debate Memory

Debate memory tracks member positions across REPL turns:

```typescript
interface DebateMemory {
  stances: Stance[]              // who said what about which proposal
  failedApproaches: FailedApproach[]  // techniques that didn't work (don't retry)
  provenFindings: ProvenFinding[]      // confirmed vulnerabilities
}
```

**What debate memory prevents:**
- Members contradicting themselves ("I supported SQLi last turn, now I oppose it")
- Retrying failed approaches ("SQLi on /api/users failed with 403 — let's try SQLi on /api/users again")
- Forgetting proven findings ("We already confirmed XSS on /search")

**What debate memory enables:**
- Cross-reference: "As the skeptic noted, we lack evidence for that claim"
- Chain building: "The analyst's finding connects to our confirmed XSS"
- Consistency: members maintain coherent positions across turns

### Using Council

```bash
# Configure multi-model engine (council is available by default)
cat > ultimatrix.yaml << 'EOF'
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: multi-model

council:
  approvalMode: hitl      # 'autonomous' | 'hitl' | 'both'
  maxRounds: 8
  budgetPerRound: 20000

browser:
  headless: false         # Council works best with visible browser
EOF

# Start interactive session — brain is always running
npx ultimatrix interact -t https://your-app.com

# At the REPL, bring in council when needed:
> /council What's the best approach for privilege escalation?
> /council Verify our findings are reportable
```

**Example session:**
```
> Find authentication vulnerabilities

[Council debate] r1
[Council:debate] r1
[council:execute] SQL injection on /api/login
Council: 1 tasks proposed, 3 evidence items

> Test the admin panel for IDOR

[Council debate] r2
  Skeptic: "Need evidence that /admin panel exists first"
  Operator: "I can navigate there — but need auth cookies"
  Analyst: "Chain with the session hijack we found in R1"
[council:execute] IDOR on /admin/users/:id
Council: 1 tasks proposed, 2 evidence items

> What have we found so far?

Council signals completion:
  Worked: SQL injection on /api/login, IDOR on /admin/users/:id
  Failed: XSS on /search (input is escaped)
  Learned: Admin panel uses session cookies, user IDs are sequential
```

### Council Execution Flow

```
User input
    │
    ▼
debateOnce(goal, members, bus, blackboard, execute)
    │
    ├── Phase 1: All 4 LLM members respond in parallel
    │   Each gets role-specific prompt + debate memory + transcript
    │
    ├── Phase 2: Post to bus + extract stances → debate memory
    │
    ├── Phase 3: Check completion (intent === 'complete')
    │
    ├── Phase 4: Collect proposals (intent === 'propose')
    │
    ├── Phase 5: Skeptic verification (structured evidence check)
    │
    ├── Phase 6: HITL approval gate (critical → human, low → auto)
    │
    ├── Phase 7: Execute approved proposals via worker pool
    │   Results bridged to evidence ledger
    │
    └── Phase 8: Reflection — stances, failures, findings extracted
         Back to Phase 1 next turn (debate memory accumulates)
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

## Multi-Model Routing

Ultimatrix's multi-model layer is a complete model orchestration system — not just "pick a provider." It dynamically selects the optimal model for each task based on capabilities, budget, rate limits, and success history.

### Model Selection Flow

```
Task arrives (WorkerTask with complexity + requiredCapabilities)
          │
          ▼
  ModelSelector.selectForTask(task, role)
          │
          ├──► calculateBudget(task, role)
          │     Uses BudgetPolicy.allocation[role] fraction
          │     brain=30%, workers=60%, spider=10%
          │
          ├──► getAvailableModels()
          │     Scans ModelCapabilities, checks creds exist
          │
          ├──► scoreModel(candidate, task, budget)  [for each]
          │     ┌─────────────────────────────────────────┐
          │     │ Capability match      +20 per match     │
          │     │ Context headroom      +10 or +5         │
          │     │ Rate limit headroom   +10 or +5         │
          │     │ Exhaustion penalty    -30               │
          │     │ Complexity alignment  +15               │
          │     │ Provider diversity    +5                │
          │     │ Success history       +0 to +20         │
          │     └─────────────────────────────────────────┘
          │
          ├──► Sort by score, return best
          │
          ▼
  resolveModel(config, { selector, tier })
          │
          ▼
  buildModel(config, provider, modelId)
          │  - Alias resolution (groq-free → groq)
          │  - Credential lookup (config.creds → config.providerKeys)
          │  - Provider-specific client (Azure/Bedrock/standard)
          │  - Schema sanitization as transformRequestBody
          │
          ▼
  wrapModel(model, config)
          │  - Proxy wrapping doStream/doGenerate
          │  - Per-provider rate limiting (ProviderAwareLimiter)
          │  - Retry with backoff on 429/quota errors
          │  - Header sync from API responses
          │  - Quota tracking + Usage tracking
          │
          ▼
  LanguageModelV2 (ready for Mastra Agent)
```

### Three-Tier Model System

```typescript
interface ModelTiers {
  fast?: TierConfig       // Low-latency, small models (recon, simple checks)
  balanced?: TierConfig   // Mid-range (general testing)
  powerful?: TierConfig   // Large, capable models (deep reasoning, exploitation)
}
```

**Complexity-to-tier mapping:**

| Task Complexity | Tier | Token Estimates | Example Models |
|----------------|------|-----------------|----------------|
| `low` | fast | 500 in / 500 out | groq/llama3-8b-8192, cerebras/llama3-70b |
| `medium` | balanced | 2000 in / 1500 out | openai/gpt-4o-mini, groq/llama-3.3-70b |
| `high` | powerful | 5000 in / 3000 out | openai/gpt-4o, anthropic/claude-3.5-sonnet |
| `critical` | powerful | 8000 in / 5000 out | anthropic/claude-3-opus, google/gemini-2.5-pro |

### Budget Enforcement

```typescript
interface BudgetPolicy {
  enforcement: 'hard' | 'soft' | 'warn'
  scope: 'turn' | 'session'
  allocation: { brain: number; workers: number; spider: number }
  maxModelCallsPerTask: number
}
```

| Mode | Behavior |
|------|----------|
| `hard` | Throws error on budget overrun |
| `soft` | Returns `false` (graceful stop, caller decides) |
| `warn` | Logs warning only |

### Three-Layer Rate Limiting

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: SlidingWindowLimiter                          │
│  ─────────────────────────────                          │
│  Rolling window of API call timestamps.                 │
│  acquire() blocks until a window slot is available.     │
│  cooldown() triggers global pause on exhaustion.        │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│  Layer 2: Semaphore                                     │
│  ──────────────────                                     │
│  Limits concurrent in-flight operations.                │
│  Prevents resource waste when many callers compete.     │
└─────────────────────────┬───────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────┐
│  Layer 3: ProviderAwareLimiter                          │
│  ─────────────────────────────                          │
│  Per-provider instance combining window + semaphore.    │
│  • Header sync: reads x-ratelimit-remaining,           │
│    x-ratelimit-reset, retry-after from API responses   │
│  • Mismatch detection: tracks divergence between        │
│    local and server-side state                         │
│  • Exhaustion backoff: stepped / exponential / fixed    │
│  • Retry-After support: auto-cooldown from 429         │
└─────────────────────────────────────────────────────────┘
```

**Default configuration:**

```yaml
rateLimit:
  requestsPerMinute: 15
  maxConcurrent: 2
  maxRetries: 3
  backoffStrategy: stepped        # 'exponential' | 'stepped' | 'fixed'
  backoffSteps: [5000, 15000, 30000]
  baseBackoffMs: 2000
  maxBackoffMs: 30000
  useHeaders: true
```

### Context Budget Manager

Before sending a request, Ultimatrix validates that it fits within the model's context window:

```typescript
interface ContextValidation {
  fits: boolean
  totalInputTokens: number
  availableForOutput: number
  breakdown: { system: number; tools: number; history: number; goal: number }
  suggestions: string[]
  severity: 'ok' | 'warning' | 'critical'
}
```

- **Token estimation**: Words × 1.3 + code character overhead (no tokenizer dependency)
- **Thresholds**: Warning at 85% full, critical at 97% full
- **Auto-truncation**: Splits remaining budget 60% goal / 40% history
- **Suggestions engine**: Prioritized reduction recommendations (biggest contributor first)

### Provider-Aware Schema Sanitization

Different LLM providers have different JSON Schema compatibility. The `SchemaSanitizer` handles this automatically:

| Level | Providers | What's Stripped |
|-------|-----------|----------------|
| `strict` | NVIDIA | `propertyNames`, `patternProperties`, `$ref`, `$defs`, `minItems`, `maxItems`, `minLength`, `maxLength`, `pattern`, `exclusiveMinimum/Maximum`, `if/then/else`, `const`, `format`, object-form `additionalProperties: false` |
| `moderate` | Google, Bedrock | `propertyNames`, `patternProperties`, `$ref`, `$defs` |
| `none` | All others | Nothing stripped |

---

## 57 Knowledge-Based Skills

Not payload lists. Not regex patterns. **Knowledge.**

Each skill is a markdown file containing security expertise — reasoning patterns, testing methodologies, what to look for and why. The LLM reads these skills and applies the knowledge using its own reasoning capabilities. Skills are organized across **10 domain directories** with YAML frontmatter metadata and progressive disclosure.

### Skills by Domain

#### Injection (7 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **vuln-discovery** | balanced | Dynamic payload crafting, input type analysis, WAF adaptation, context-aware encoding |
| **exploitation** | powerful | Proof-of-concept development, impact assessment, chaining vectors, severity scoring |
| **ssti** | powerful | Server-Side Template Injection — Jinja2, Twig, Freemarker, Velocity, Handlebars RCE chains |
| **command-injection-advanced** | powerful | Filter bypass, encoding, blind exfil, polyglot payloads |
| **nosql-injection** | balanced | MongoDB operators, JS injection, ReDoS, CouchDB |
| **xxe** | powerful | Classic, blind, SVG, SOAP, filter bypass, billion laughs |
| **email-injection** | balanced | SMTP header injection, CRLF, spoofing |

#### Web Attacks (16 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **web-pentest** | balanced | OWASP Top 10, API testing, authentication bypass, session fixation |
| **web-security-advanced** | powerful | CSP bypass, CORS misconfiguration, cache poisoning, request smuggling |
| **modern-xss** | powerful | Polyglot payloads, CSP bypass, DOM clobbering, mutation XSS |
| **open-redirect** | balanced | Filter bypass, JavaScript URI, tabnabbing, OAuth token theft |
| **cache-poisoning** | powerful | Unkeyed headers, param cloaking, fat GET, CDN-specific |
| **http-smuggling** | powerful | CL.TE, TE.CL, TE.TE, H2.CL, 20+ TE obfuscation techniques |
| **cors-misconfig** | balanced | Null origin, subdomain matching, wildcard bypass |
| **host-header-injection** | balanced | Password reset poisoning, cache poisoning, SSRF via Host |
| **file-upload-attacks** | balanced | Double extension, null byte, polyglot files, SVG XSS, webshell upload |
| **deserialization** | powerful | Java, PHP, Python, .NET gadget chains, object injection |
| **prototype-pollution** | balanced | Deep merge exploits, Angular/Jinja2 sandbox escape |
| **type-juggling** | balanced | PHP loose comparison, magic hashes, strcmp bypass |
| **clickjacking** | fast | X-Frame-Options bypass, CSP frame-ancestors, cookie forcing |
| **css-injection** | balanced | Attribute selectors, data exfil, CSS keylogger |
| **business-logic** | powerful | Workflow bypass, price manipulation, race conditions, coupon abuse |
| **race-conditions-advanced** | powerful | Turbowlence, single-packet, TOCTOU chains |

#### API Security (4 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **api-security** | balanced | BOLA, mass assignment, rate limit bypass, API versioning attacks |
| **graphql-attacks** | powerful | Introspection abuse, batching, alias brute force, nested query DoS |
| **websocket-attacks** | balanced | Cross-site WebSocket hijacking, message injection, CSWSH |
| **ai-mcp-security** | balanced | Prompt injection, model manipulation, tool poisoning, data exfiltration via AI |

#### Auth Security (2 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **authorization** | powerful | Multi-role testing, IDOR, JWT attacks, OAuth bypass, session hijacking |
| **jwt-advanced** | powerful | Alg:none, key confusion, jku/x5u injection, token injection, null byte attacks |

#### Crypto (2 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **crypto-toolkit** | balanced | Hash analysis, key extraction, algorithm weaknesses, padding oracle, timing attacks |
| **ctf-crypto** | balanced | Cryptanalysis, frequency analysis, known-plaintext attacks |

#### Recon (9 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **recon** | fast | Deep page analysis, JavaScript bundle secrets, exposed files, technology fingerprinting |
| **post-exploitation** | balanced | Lateral movement, privilege escalation, persistence mechanisms, data exfiltration |
| **osint-recon** | fast | Subdomain enumeration, certificate transparency, DNS records, technology detection |
| **information-disclosure** | balanced | JS bundle analysis, .env exposure, error message leakage, stack traces |
| **intranet-pentest** | balanced | Internal network testing, SMB shares, LDAP injection, Kerberoasting |
| **ctf-misc** | fast | Steganography, encoding challenges, forensics, reverse engineering |
| **subdomain-takeover** | balanced | Dangling CNAME, S3/Azure/GitHub Pages takeover |
| **hsts-bypass** | fast | Subdomain stripping, preloading gaps, SSL stripping |
| **ssl-stripping** | balanced | HTTPS downgrade, HSTS bypass, cert pinning bypass |

#### Cloud Security (6 skills)

| Skill | Tier | Description |
|-------|------|-------------|
| **kubernetes-security** | powerful | K8s API exploitation, RBAC bypass, container escape, etcd access |
| **docker-escape** | powerful | Container breakout, privileged mode, namespace escape |
| **aws-iam-exploitation** | powerful | IAM privilege escalation, role assumption, S3 bucket enumeration |
| **azure-exploitation** | powerful | Azure AD attacks, managed identity abuse, Key Vault access |
| **gcp-exploitation** | powerful | GCP IAM bypass, metadata service attacks, service account impersonation |
| **serverless-attacks** | balanced | Lambda cold start exploitation, environment variable extraction, event injection |

#### Reports (1 skill)

| Skill | Tier | Description |
|-------|------|-------------|
| **reporting** | fast | Finding documentation, risk quantification (CVSS), remediation guidance |

### Skill Matching

Skills are matched to tasks using natural-language **triggers** — not keyword/substring matching. The `SkillMatcher` class scores skills based on semantic relevance to the current context, with `contextBoosts` that respond to graph state (e.g., detected auth flows boost authorization skills):

```
Input: "Testing JWT token validity and expiration"
  → Authorization skill (trigger: "jwt, token validation, expiry")
  → JWT Advanced skill (trigger: "alg:none, key confusion")
  → Web Pentest skill (trigger: "authentication, session")
```

### Progressive Disclosure

Skills use a two-phase loading system for efficiency:
1. **Index phase** — Only YAML frontmatter is loaded (fast init, ~80 lines of metadata)
2. **Body phase** — Full skill content loaded on demand when matched

This keeps init fast even with 47 skills and 15K+ lines of skill content.

---

## Human-in-the-Loop

Ultimatrix isn't a black box. It works *with* you:

### Council Debate (HITL Mode)

When using the council engine, four LLM specialists debate what to test. You sit as a member — approve or block critical actions, steer the research direction, ask questions.

```
┌─────────────────────────────────────────────────────────────────┐
│  Human-in-the-Loop Council                                     │
│  ─────────────────────────                                     │
│  You type a goal → 4 LLMs debate in parallel                   │
│  → Skeptic verifies evidence                                   │
│  → You approve/reject critical actions                         │
│  → Operator executes approved proposals                        │
│  → Results feed back into debate                               │
│  → Repeat with debate memory (stances carry across turns)      │
└─────────────────────────────────────────────────────────────────┘
```

**Approval modes:**

| Mode | Behavior |
|------|----------|
| `autonomous` | No human input needed — council decides everything |
| `hitl` | High-impact actions require your approval |
| `both` | Low/medium auto-approve, high/critical need approval |

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

Under the hood, Ultimatrix maintains a knowledge graph with 20 node types and 15 edge types:

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

┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐
│  Header   │  │   Auth    │  │ Hypothesis│  │ Invariant │
│ Semantic  │  │  Scheme   │  │           │  │           │
└───────────┘  └───────────┘  └───────────┘  └───────────┘

┌───────────────────┐  ┌───────────────────┐
│ OutcomeFeedback   │  │ CandidateFinding  │
│                   │  │                   │
└───────────────────┘  └───────────────────┘
```

This isn't just data storage. The agent *queries* the graph to make decisions:
- "What endpoints haven't I tested yet?"
- "Which findings chain together for a critical attack?"
- "What authentication flows protect this admin endpoint?"
- "Have I seen this pattern before in a different context?"
- "What facts have I established about this target?"

---

## Scope Guard

Every network request — HTTP tools, browser navigation, recon probes — passes through a scope guard before execution. This prevents the agent from accidentally testing out-of-scope targets.

```
URL → isUrlInScope(url) → { allowed: boolean, reason?: string }
         │
         ├── domain match (exact + wildcard *.example.com)
         ├── protocol check (https:// only?)
         └── path prefix (/app/ only?)
```

### Enforcement Modes

| Mode | Behavior |
|------|----------|
| `hard` | Blocks out-of-scope requests immediately, returns error to agent |
| `warn` | Logs warning but allows the request |

### Where Scope Guard Is Applied

- **HTTP tools**: `httpRequest`, `multipartUpload`, `followRedirects`, `omitHeader`
- **Browser navigation**: `stagehand_navigate` (Playwright-based)
- **Observation tools**: `evaluateRendered`, `measureTiming`
- **Recon tools**: `techStack`, `graphqlIntrospect`, `frameworkFingerprint`
- **Flow tools**: `reproduceFlow` (page.goto)
- **Control tools**: `verifyPendingFindings`

### Configuration

```yaml
scope:
  # allowedDomains is OPTIONAL. When omitted (or empty), Ultimatrix runs
  # free-for-all — every URL is permitted. Restriction only applies when you
  # explicitly list domains to test.
  allowedDomains:
    - target.com
    - *.target.com       # Wildcard support
  allowedPaths:
    - /app/               # Only test under /app/
  allowedProtocols:
    - https               # HTTP-only by default
  enforcement: hard       # 'hard' | 'warn'
```

When no `allowedDomains` is provided, all requests are allowed (permissive free-for-all default). `scope.allowedDomains` is *not* required during config validation — only its entries are type-checked (must be non-empty domain strings) when present.

---

## Campaign Autonomy

The campaign system plans and executes systematic test coverage across your entire attack surface. Instead of testing one endpoint at a time, it builds a comprehensive campaign plan and executes slices in parallel.

### How It Works

```
Knowledge Graph (endpoints, params, roles)
          │
          ▼
    planCampaign()
    ─────────────
    Generates CampaignSlices:
    • Each slice = one endpoint × one parameter × one role × one technique
    • Priority scoring: data-flow-aware (VALUE_ORIGIN edges get +2 boost)
    • Auth-aware: maps roles to endpoints via RBACMatrix
          │
          ▼
    runCampaign()
    ─────────────
    • Executes slices via PrimitiveRunner
    • Each primitive is a real HTTP request or browser action
    • Confirmed findings pass through EvidenceGate
    • Outcomes recorded for technique effectiveness feedback
```

### Campaign Features

- **Auto-replan**: When new endpoints are discovered mid-session, the campaign re-plans to cover them
- **Outcome feedback**: Confirmed findings feed back to technique effectiveness scoring
- **Parallel execution**: Multiple slices can run concurrently with configurable budget
- **Auth-aware**: Automatically tests each endpoint with all discovered roles

### Configuration

```yaml
campaign:
  auto: true               # Enable auto-campaign in solver
  maxSlices: 20            # Max slices per campaign
  maxConcurrency: 3        # Parallel slice execution
```

---

## Attack-Path Solver

After the solver completes, Ultimatrix traverses the knowledge graph to find attack paths — chains of endpoints that lead from unauthenticated entry points to sensitive data.

```
Unauthenticated Endpoint
    │
    ├── CHAINS_TO ──► Admin API
    │                    │
    │                    ├── EXPLOITS ──► Finding (IDOR)
    │                    │                    │
    │                    │                    └── PRODUCES ──► Sensitive Data
    │                    │
    └── PRODUCES ──► Finding (Info Disclosure)
                         │
                         └── BUILT_ON ──► AttackStep
```

### What It Finds

- **Privilege escalation paths**: Unauthenticated → admin → sensitive data
- **IDOR chains**: Entry point → parameter manipulation → data access
- **Auth bypass sequences**: Multiple bypass steps leading to full compromise

### Case File Export

After each solve session, a structured case file is generated containing:

- **Findings**: All discovered vulnerabilities with severity, evidence, CWE
- **Decision log**: What the agent tried, what worked, what failed
- **Endpoints**: Complete attack surface map

```json
{
  "target": "https://example.com",
  "findings": [...],
  "decisionLog": [...],
  "endpoints": [...],
  "attackPaths": [...]
}
```

---

## Cross-Engagement Memory

Ultimatrix learns across sessions. After each engagement, anonymized patterns are saved and automatically injected into future sessions.

### What's Captured

- **Vulnerability patterns**: Which vulnerability types were found (e.g., "IDOR on sequential IDs")
- **Technique effectiveness**: Which attack techniques worked vs. failed
- **Target characteristics**: What technology stacks are vulnerable to what

### Privacy by Design

- **No raw URLs stored**: Only anonymized patterns
- **No credentials**: Session data is never persisted in cross-engagement memory
- **Structural privacy**: Patterns are aggregated, not individualized

### How It Works

1. **Session end**: `finalizeEngagementMemory()` records anonymized patterns
2. **Next session start**: Priors automatically injected into solver context
3. **During session**: Agent can call `getPriorPatterns` tool for on-demand access

```
Session 1: Found IDOR on sequential user IDs → pattern recorded
Session 2: New target, similar tech stack → prior pattern injected
Agent: "Based on past experience, this target likely has sequential IDs.
        Testing IDOR on /api/users/{id}..."
Result: IDOR confirmed — pattern validated
```

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

### Choose Your Engine

Different engines for different workflows:

#### Multi-Model (Default) — "Give it a goal, bring in the team when needed"

Best for: **Autonomous research, interactive red teaming, budget-conscious scanning.**

```bash
# Configure
cat > ultimatrix.yaml << 'EOF'
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: multi-model
EOF

# Autonomous solve — give it a goal, let it work
npx ultimatrix solve -t https://your-app.com

# Interactive REPL — guide the solver turn by turn
npx ultimatrix interact -t https://your-app.com

# At the REPL, bring in council when needed:
> /council What's the best approach for privilege escalation?
```

**What happens:** The OODA solver runs autonomously with dynamic model selection. When you hit a complex decision, bring in the council with `/council <goal>` — 4 LLM members debate and you steer.

#### Council (Debate + HITL) — "On-demand adversarial checking"

Council is available in any multi-model session. The brain can also suggest council via the `requestCouncil` tool when it encounters complex decisions.

```
> Test the admin panel for IDOR

[Brain runs OODA loop autonomously]

> /council What's the best escalation path from our current findings?

[Council debate] r1
  Strategist proposes approach
  Skeptic challenges weak claims
  Operator flags prerequisites
  Analyst connects to prior findings
→ [Human decides] approves the strategy
```

#### Multi-Model with Tiers — "Optimize cost and performance"

Best for: **Large targets, budget-conscious, mixed-complexity tasks.**

```bash
# Configure with model tiers
cat > ultimatrix.yaml << 'EOF'
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: multi-model
modelTiers:
  fast: groq/llama3-8b-8192           # Recon, simple checks
  balanced: openai/gpt-4o-mini        # General testing
  powerful: anthropic/claude-3.5-sonnet # Deep reasoning
EOF

# Same commands — model selection happens automatically
npx ultimatrix solve -t https://your-app.com
npx ultimatrix interact -t https://your-app.com
```

**What happens:** Same OODA loop, but with dynamic model selection. Quick recon uses cheap/fast models. Deep exploitation uses powerful/expensive models. The `selectModel` tool scores candidates by capability, budget, rate limits, and success history.

#### Legacy (Structured) — "Predictable phases"

Best for: **Structured scans, compatibility with older configs.**

```bash
# Configure
cat > ultimatrix.yaml << 'EOF'
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: legacy
EOF

# Full scan pipeline
npx ultimatrix scan -t https://your-app.com

# Or interactive legacy REPL
npx ultimatrix interact -t https://your-app.com
```

### When to Use What

| Scenario | Recommended | Why |
|----------|-------------|-----|
| Bug bounty research | `multi-model` | Autonomous + on-demand council for complex decisions |
| Compliance audit with sign-off | `multi-model` + `/council` | HITL approval via council debate |
| Quick vulnerability check | `multi-model` | Fast, autonomous, minimal config |
| Deep penetration test | `multi-model` + `/council` | Adversarial debate catches blind spots |
| Cost-sensitive scanning | `multi-model` | Cheap models for recon, powerful for exploitation |
| Reproducible test suite | `legacy` | Predictable phase ordering |
| Learning/education | `multi-model` + `/council` | Watch LLM members debate and challenge each other |

### All Commands

```bash
# Autonomous testing
npx ultimatrix solve -t https://your-app.com

# Interactive session (uses config.engine)
npx ultimatrix interact -t https://your-app.com

# Full scan pipeline: capture → analyze → generate → report
npx ultimatrix scan -t https://your-app.com

# Traffic capture and analysis
npx ultimatrix learn -t https://your-app.com

# Generate test cases from captured traffic
npx ultimatrix generate -t https://your-app.com

# Re-run previously generated tests
npx ultimatrix replay

# Generate report
npx ultimatrix report

# Web UI
npx ultimatrix web

# Full assessment (legacy engine)
npx ultimatrix assess -t https://your-app.com -o ./results

# Re-run findings against new deployment
npx ultimatrix verify -a ./results/app-model.json -t https://new-site.com
```

---

## CLI Reference

| Command | Description | Example |
|---------|-------------|---------|
| `ultimatrix init` | Interactive setup wizard — provider, model, credentials, engine | `npx ultimatrix init` |
| `ultimatrix solve -t <url>` | Autonomous OODA solver — give it a goal, it works | `npx ultimatrix solve -t https://target.com` |
| `ultimatrix interact -t <url>` | REPL chat — talk to the agent like a colleague | `npx ultimatrix interact -t https://target.com` |
| `ultimatrix scan -t <url>` | Full pipeline: capture → analyze → generate → report | `npx ultimatrix scan -t https://target.com` |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR, analyze patterns | `npx ultimatrix learn -t https://target.com` |
| `ultimatrix generate -t <url>` | Generate Playwright test cases from captured traffic | `npx ultimatrix generate -t https://target.com` |
| `ultimatrix replay` | Re-run previously generated tests | `npx ultimatrix replay` |
| `ultimatrix report` | Generate JSON/HTML/Markdown report + case file | `npx ultimatrix report` |
| `ultimatrix web` | Next.js web UI at localhost:3000 | `npx ultimatrix web` |
| `ultimatrix assess -t <url>` | Full assessment (legacy engine) | `npx ultimatrix assess -t https://target.com` |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against new deployment | `npx ultimatrix verify -a ./model.json -t https://new.com` |

### CLI Flags

```bash
--provider <name>         # Override config provider
--model <name>            # Override config model
--key <api-key>           # Override config API key
--non-interactive         # Skip prompts, use defaults
--engine <legacy|multi-model>  # Override engine selection (solver/council deprecated)
```

---

## Configuration

```yaml
# ultimatrix.yaml
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: multi-model           # 'legacy' | 'multi-model' (default)
                               # 'solver' → alias for multi-model (deprecated)
                               # 'council' → deprecated, coerced to multi-model

# Multi-tier model configuration
modelTiers:
  fast: groq/llama3-8b-8192              # Recon, simple checks
  balanced: openai/gpt-4o-mini           # General testing
  powerful: anthropic/claude-3.5-sonnet  # Deep reasoning, exploitation

# Council configuration (on-demand via /council command)
council:
  approvalMode: hitl           # 'autonomous' | 'hitl' | 'both'
  maxRounds: 8                 # Max debate cycles per session
  budgetPerRound: 20000        # Token budget per round (advisory)

solver:
  maxToolCalls: 50            # Max tool-call rounds per turn
  maxTokens: 100000           # Max tokens per turn
  maxDurationMs: 300000       # 5 minute timeout per turn
  maxParallel: 1

rateLimit:
  requestsPerMinute: 15
  maxConcurrent: 2
  maxRetries: 3
  backoffStrategy: stepped
  backoffSteps: [5000, 15000, 30000]

budget:
  enforcement: soft           # 'hard' | 'soft' | 'warn'
  scope: session
  allocation:
    brain: 0.30
    workers: 0.60
    spider: 0.10
  maxModelCallsPerTask: 15

antiLoop:
  staleThreshold: 3

reflexion:
  persistToGraph: true

compression:
  headroom:
    enabled: true
    budgetTokens: 100000
  truncation:
    enabled: true
    maxResponseChars: 50000

scope:
  allowedDomains:
    - your-app.com
    - *.your-app.com
  allowedPaths:
    - /app/
  allowedProtocols:
    - https
  enforcement: hard

campaign:
  auto: true
  maxSlices: 20
  maxConcurrency: 3

browser:
  headless: false

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
export TOGETHER_API_KEY=...
export DEEPSEEK_API_KEY=...
export MISTRAL_API_KEY=...
export XAI_API_KEY=...
export PERPLEXITY_API_KEY=...
export CEREBRAS_API_KEY=...
export DEEPINFRA_API_KEY=...
export OPENROUTER_API_KEY=...
export AZURE_API_KEY=...
export AWS_ACCESS_KEY_ID=...

# Debug
export ULTIMATRIX_LLM_DEBUG=1
export ULTIMATRIX_LLM_STREAM=1
```

---

## Supported Providers

| Provider | Free Tier | Context Window | Notes |
|----------|-----------|----------------|-------|
| `groq` | Yes | 8K - 131K | Fastest inference |
| `openai` | No | 128K | GPT-4o, GPT-4o-mini |
| `anthropic` | No | 200K | Claude 3.5 Sonnet, Claude 3 Opus |
| `google` | Yes | 1M | Gemini 2.0 Flash, Gemini 2.5 Pro |
| `nvidia` | Yes | 131K | Nemotron 3 Super/Ultra |
| `together` | Yes | 131K | Open-source models |
| `deepseek` | Yes | 128K | DeepSeek Chat/Coder |
| `mistral` | No | 32K - 128K | Mistral Large/Medium |
| `xai` | No | 128K | Grok-2 |
| `perplexity` | Yes | 128K | Sonar models |
| `cerebras` | Yes | 131K | Fast inference |
| `deepinfra` | Yes | 128K | Open-source models |
| `openrouter` | Varies | Varies | 100+ models |
| `azure` | No | Varies | Azure OpenAI deployments |
| `bedrock` | No | Varies | AWS Bedrock (IAM or API key) |

### Multi-Provider Configuration

```yaml
# Same provider, different API keys (Scenario D)
creds:
  groq:
    apiKey: gsk_key1                    # For fast model
  nvidia:
    apiKey: nvapi_key2                  # For powerful model

# Provider alias resolution
# groq-free → groq, openai-preview → openai (automatic)
```

---

## Testing

```bash
# Run all tests (1604 passing)
npm test

# Run specific test suite
npx vitest run test/intelligence/evidence-gate.test.ts
npx vitest run test/tools/flow-tools.test.ts
npx vitest run test/solver/solver.test.ts
npx vitest run test/safety/scope-guard.test.ts
npx vitest run test/council/debate-memory.test.ts
npx vitest run test/council/persona-loader.test.ts

# Watch mode
npm run test:watch

# Build
npm run build:cli    # ESM + CJS + DTS
```

### Test Coverage

| Module | Tests | Coverage |
|--------|-------|----------|
| Intelligence (evidence-gate, reflexion, anti-loop) | 110+ | Core logic, L0-L4 escalation, zero leniency |
| Graph (store, tools, schema) | 96 | Full CRUD, 20 node types, 15 edge types |
| Tools (28+ tools) | 130+ | All tool interfaces, flow tools, skill tools, scope guard |
| Browser (dialog-watcher, state-bridge, reactions) | 55 | CDP integration, Stagehand hybrid, scope enforcement |
| Config (validation, multi-provider) | 42 | All scenarios, alias resolution |
| Solver (OODA, blackboard, plan, exploitation-loop) | 60+ | Full loop, tool chains, composition, attack-path, threat model |
| Models (rate-limiter, quota, selector, middleware) | 80+ | All providers, 3-layer rate limiting |
| Session (lifecycle, engine routing) | 15 | Both engines, 6-phase lifecycle |
| Council (orchestrator, approval, personas, debate-memory, persona-loader) | 60+ | Parallel debate, stance tracking, contradiction detection, file loader |
| Recorder (code gen, interaction) | 57 | Full pipeline, action capture |
| Skills (loader, matcher, registry, tool-filter) | 60+ | 57 skills, progressive disclosure, domain matching |
| Safety (scope guard) | 15 | Domain matching, wildcard, path prefix, protocol |
| Campaign (planner, executor, continuity) | 40+ | Coverage planning, auto-replan, outcome feedback |
| Primitives (weaponize, framework, all 9 oracles) | 40+ | Evidence-gated verification, exploit-proof generation |
| Components (UI, chat, streaming) | 30+ | Ink TUI, streaming text, markdown rendering |

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
| Source files | 274+ TypeScript files |
| Source lines | 30,000+ |
| Test files | 148 files |
| Tests passing | 1604 / 1605 (1 pre-existing context-manager truncation test) |
| Skills | 57 (across 10 domains) |
| Tools | 28+ specialized tools |
| Engines | 2 active (multi-model default, legacy) + council on-demand |
| Council personas | 8 markdown files (charter, 4 members, protocol, contract, human) |
| Node types | 20 (graph schema) |
| Edge types | 15 (graph schema) |
| Providers | 16 supported |
| Model tiers | 3 (fast, balanced, powerful) |
| Rate limit layers | 3 (sliding window, semaphore, provider-aware) |
| Intelligence modules | 9 (evidence-gate, reflexion, anti-loop, blackboard, cross-engagement, attack-path, campaign, scope-guard, debate-memory) |

### Audit & Remediation

A comprehensive audit of Ultimatrix v8.4 identified 40 issues across 5 categories (sanitization, unwired logic, triggering failures, logical scope gaps, prompt engineering). The combined audit + remediation plan tracks all findings with exact file locations, anti-bandaid acceptance criteria, and phased implementation:

| Phase | Focus | Tasks | Effort |
|-------|-------|-------|--------|
| P0: Security | Credential leakage, regex removal, scope guard | 6 | 16 hrs |
| P1: Core Wiring | Session store, campaign, evidence gate, intel layers | 5 | 16 hrs |
| P2: Intelligence | Debate persistence, human flows, skill composition | 5 | 20 hrs |
| P3: Operational | OAST polling, chain detection, session expiry | 5 | 10 hrs |
| P4: Hygiene | Input validation, masking, schema docs | 3 | 8 hrs |

See `COMBINED-AUDIT-AND-REMEDIATION-PLAN.md` for the full plan with dependency graph, cross-reference map, and per-task implementation details.

### Skill Domain Breakdown

| Domain | Skills |
|--------|--------|
| web-attacks | 19 |
| recon | 9 |
| injection | 8 |
| cloud-security | 6 |
| api-security | 6 |
| auth-security | 3 |
| crypto | 2 |
| supply-chain | 1 |
| llm-security | 1 |
| reports | 1 |
| **Total** | **57** |

---

## License

MIT
