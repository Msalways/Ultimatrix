# Ultimatrix v8

**AI-powered autonomous security researcher with dual engine architecture.** Captures traffic, reasons over it with LLM intelligence, tests for vulnerabilities directly, and generates replayable security tests. Zero hardcoded patterns. All intelligence from LLM reasoning.

Real attacks, not theoretical.

---

## Quick Start

```bash
git clone <repository-url> && cd project-sentinal
npm install
npx playwright install chromium

# Configure your LLM provider
npx ultimatrix init

# Interactive session (recommended)
npx ultimatrix interact -t https://httpbin.org

# Direct solve — single goal, autonomous testing
npx ultimatrix solve -t https://httpbin.org

# Full scan: capture → analyze → generate tests → report
npx ultimatrix scan -t https://httpbin.org
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `ultimatrix init` | Interactive provider + config setup wizard |
| `ultimatrix solve -t <url>` | OODA solver engine — autonomous goal-driven testing |
| `ultimatrix interact -t <url>` | REPL chat with security agent (solver or legacy engine) |
| `ultimatrix scan -t <url>` | Full scan: learn + generate + report |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR, analyze patterns |
| `ultimatrix generate -t <url>` | Learn → generate Playwright test cases |
| `ultimatrix replay` | Re-run previously generated tests |
| `ultimatrix report` | Generate JSON/HTML/Markdown report |
| `ultimatrix web` | Next.js web UI at localhost:3000 |
| `ultimatrix assess -t <url>` | Full assessment (legacy engine) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings against new deployment |

---

## Architecture

### Dual Engine

```
                    ┌──────────────────────┐
                    │   Engine Selector    │ ← config.engine: 'legacy' | 'solver'
                    │   (dual engine)      │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │  Legacy      │  │  Solver      │  │  Shared Layer    │
    │  Supervisor  │  │  Engine      │  │  (used by both)  │
    │  (Phase 1-5) │  │  (OODA)      │  │                  │
    │              │  │              │  │  • Evidence Gate  │
    │  observe →   │  │  REASON →    │  │  • Reflexion      │
    │  learn →     │  │  EXPLORE →   │  │  • Anti-Loop      │
    │  attack →    │  │  CONCLUDE →  │  │  • Finding Life   │
    │  loop        │  │  loop        │  │  • Failed Paths   │
    └──────────────┘  └──────────────┘  └──────────────────┘
              │                │                 │
              └────────────────┼────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │  Skill-Tool Filter   │ ← resolveToolsForSkills(skillIds)
                    │  (tool-filter.ts)    │   core tools always included
                    └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    ▼                      ▼
           ┌──────────────┐      ┌──────────────────┐
           │  Skills Lib  │      │  Agent (filtered) │
           │  (21 skills) │      │  tools + skills   │
           │  YAML meta   │      │  instructions     │
           └──────────────┘      └──────────────────┘
```

### Intelligence Layer (v8)

| Module | Location | Purpose |
|--------|----------|---------|
| **Evidence Gate** | `src/intelligence/evidence-gate.ts` | Anti-hallucination: cross-check LLM claims against real tool output |
| **Reflexion Engine** | `src/intelligence/reflexion.ts` | Failure classification, L0-L4 escalation, experience extraction |
| **Anti-Loop** | `src/intelligence/anti-loop.ts` | Stale detection, dead-end detection, structured attack path extraction |
| **Blackboard** | `src/solver/blackboard.ts` | Fact/Intent state-space for OODA solver |
| **Solver** | `src/solver/solver.ts` | OODA loop: REASON → EXPLORE → CONCLUDE |
| **Core Contract** | `src/prompts/core-contract.ts` | Anti-hallucination, workflow rules, PATH declarations |
| **Skill Dispatcher** | `src/skills/dispatcher.ts` | Keyword routing + searchSkills fallback |
| **Reflexion Store** | `src/intelligence/reflexion-store.ts` | Persist/load reflexion state to graph (target-scoped) |

### Skills Library (21 total)

**Core (7):** Recon, Vuln Discovery, Exploitation, Post-Exploitation, Reporting, WAF Bypass, Pentest Flow

**Specialized (14):** Web Pentest, Web Security Advanced, Crypto Toolkit, CTF Web, CTF Crypto, CTF Misc, OSINT Recon, AI/MCP Security, Intranet Pentest, Pentest Tools, Authorization, Business Logic, Info Disclosure, Race Conditions

All skills are **knowledge-based** — concepts and reasoning, not payload checklists.

### Graph Schema (11 node types, 12 edge types)

**Nodes:** Endpoint, Finding, Action, Input, AuthFlow, RBACMatrix, AttackPath, AttackStep, Test, Session, Fact, Intent, Reflexion

**Edges:** REQUESTS, USES_AUTH, REQUIRES_ROLE, PRODUCES, CHAINS_TO, EXPLOITS, ALTERNATIVE, BUILT_ON, PRODUCED_BY

---

## Configuration

### `ultimatrix.yaml`

```yaml
provider: groq
model: llama3-8b-8192
target: https://your-app.com
engine: solver              # 'legacy' | 'solver'

solver:
  maxToolCalls: 50          # LLM rounds per turn (each round = multiple tool calls)
  maxDurationMs: 300000     # 5 minute timeout per turn
  maxParallel: 1

antiLoop:
  staleThreshold: 3         # Same attack path repeated N times → switch

reflexion:
  persistToGraph: true

browser:
  headless: false

credentials:
  your-app:
    email: user@example.com
    password: secure123
```

### Engine Routing

- `config.engine: 'legacy'` — Uses supervisor + 4 worker agents (v6 architecture)
- `config.engine: 'solver'` — Uses OODA solver loop (v8 architecture)
- `ultimatrix solve` always uses solver engine
- `ultimatrix interact` respects `config.engine`

### Environment Variables

| Var | Effect |
|-----|--------|
| `GROQ_API_KEY` | Groq API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Google API key |
| `TARGET` | Override target URL |
| `HEADLESS=false` | Force headed browser |
| `ULTIMATRIX_LLM_DEBUG=1` | Log LLM call details |

Supported providers: `openai`, `anthropic`, `google`, `nvidia`, `groq`, `together`, `deepseek`, `mistral`, `xai`, `perplexity`, `cerebras`, `deepinfra`, `openrouter`, `azure`, `bedrock`

---

## Testing

```bash
npm test                    # 809 tests (54 files)
npm run test:watch          # Watch mode
npx tsup                    # Build (ESM + CJS + DTS)
```

### Test structure

```
test/
├── analysis/           # Skill loader, HAR analyzer, instructions
├── browser/            # State bridge import/export
├── capture/            # HAR parser, network capture, browser launcher, human observer
├── config/             # Config loading, validation
├── events/             # Event emitter
├── generation/         # Test generator, parameterizer, storage
├── graph/              # Graph store, focused tools
├── http/               # HTTP client, session manager
├── intelligence/       # Evidence gate, anti-loop, reflexion, chaining, hypotheses
├── memory/             # Memory store, schemas
├── models/             # Config factory, schema sanitizer, rate limiter, middleware
├── oast/               # OAST server, store
├── prompts/            # Core contract tests
├── recorder/           # Codegen, interaction recording, test generation
├── replay/             # Test runner, result comparator
├── report/             # Report generation
├── sdk/                # Config validation tests
├── skills/             # Skill dispatcher tests
├── solver/             # Solver, blackboard, plan tools
└── tools/              # Tool registry, control tools, flow tools, skill tools
```

---

## Key Files

**v8 Intelligence:**
- `src/intelligence/evidence-gate.ts` — Anti-hallucination gate
- `src/intelligence/reflexion.ts` — Failure classification engine
- `src/intelligence/anti-loop.ts` — Stale detection + attack path extraction
- `src/solver/blackboard.ts` — Fact/Intent state-space
- `src/solver/solver.ts` — OODA solver loop with memory, timeout, truncation
- `src/solver/brain-instructions.ts` — Capability-based instructions (no hardcoded tool names)
- `src/solver/brain-tools.ts` — Brain agent creation with orchestration tools
- `src/prompts/core-contract.ts` — Anti-hallucination rules
- `src/skills/dispatcher.ts` — Skill routing
- `src/skills/tool-filter.ts` — Skill-driven tool filtering

**v8 Human-in-the-Loop:**
- `src/capture/human-observer.ts` — Browser action capture
- `src/tools/flow-tools.ts` — Session save/restore, flow reproduction
- `src/tools/interaction-tools.ts` — askUser with timeout + screenshot capture

**v8 Session:**
- `src/session.ts` — REPL loop with graceful shutdown, session summary
- `src/cli/solve.ts` — Solve command
- `src/config.ts` — Config with engine/solver/antiLoop/reflexion settings
- `src/workspace.ts` — Per-target workspace isolation

---

## Requirements

- Node.js 20+
- Playwright (Chromium)
- 8GB+ RAM recommended for large scans

## License

MIT.
