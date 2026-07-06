## Ultimatrix v8 — Intelligence-Augmented Security Researcher

### Status
- **1050 tests (77 files), clean tsup build (ESM 1.24MB + CJS 1.25MB + DTS)**
- **Dual engine**: Legacy supervisor (v6/v7) + OODA solver engine (v8)
- **21 skills** (7 core + 14 specialized), knowledge-based, not payload lists
- **Skill-driven tool filtering**: Skills declare toolRefs in YAML frontmatter, tools filtered per-agent
- **Human-in-the-Loop**: Browser visibility, action capture, session storage, flow reproduction
- **FIX-PLAN v8.1 COMPLETED**: All 8 root-cause fixes implemented and verified (2026-07-06)
- `@mastra/core` ^1.42.0, `playwright` ^1.52.0, `zod` ^4.0.0, `next` ^15.5.19

### Architecture — Dual Engine + Skill-Tool Wiring

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

| Module | Location | Purpose | Tests |
|--------|----------|---------|-------|
| **Evidence Gate** | `src/intelligence/evidence-gate.ts` | Anti-hallucination: cross-check LLM claims against real tool output | 13 |
| **Reflexion Engine** | `src/intelligence/reflexion.ts` | Failure classification, L0-L4 escalation, experience extraction | 25 |
| **Anti-Loop** | `src/intelligence/anti-loop.ts` | Stale detection, dead-end detection, structured [PATH:] extraction | 20 |
| **Blackboard** | `src/solver/blackboard.ts` | Fact/Intent state-space for OODA solver | 20 |
| **Solver** | `src/solver/solver.ts` | OODA loop: REASON → EXPLORE → CONCLUDE | 10 |
| **Core Contract** | `src/prompts/core-contract.ts` | Anti-hallucination, workflow rules, PATH declarations | 8 |
| **Skill Dispatcher** | `src/skills/dispatcher.ts` | Keyword routing + searchSkills fallback | 17 |
| **Skill Loader** | `src/skills/loader.ts` | Markdown skill loading with frontmatter parsing | 13 |
| **Reflexion Store** | `src/intelligence/reflexion-store.ts` | Persist/load reflexion state to graph | 8 |
| **Skill Tools** | `src/tools/skill-tools.ts` | loadSkillReference + searchSkillTool Mastra tools | 6 |
| **Encode/Decode** | `src/tools/encode-decode.ts` | Base64/URL/HTML encode/decode tool | 16 |
| **Constants** | `src/intelligence/constants.ts` | Centralized signal lists (no keyword duplication) | — |

### Skills Library (21 total)

**Core (7):**
| Skill | File |
|-------|------|
| Recon | `src/skills/core/recon.md` |
| Vuln Discovery | `src/skills/core/vuln-discovery.md` |
| Exploitation | `src/skills/core/exploitation.md` |
| Post-Exploitation | `src/skills/core/post-exploitation.md` |
| Reporting | `src/skills/core/reporting.md` |
| WAF Bypass | `src/skills/core/waf-bypass.md` |
| Pentest Flow | `src/skills/core/pentest-flow.md` |

**Specialized (14):**
| Skill | File |
|-------|------|
| Web Pentest | `src/skills/specialized/web-pentest.md` |
| Web Security Advanced | `src/skills/specialized/web-security-advanced.md` |
| Crypto Toolkit | `src/skills/specialized/crypto-toolkit.md` |
| CTF Web | `src/skills/specialized/ctf-web.md` |
| CTF Crypto | `src/skills/specialized/ctf-crypto.md` |
| CTF Misc | `src/skills/specialized/ctf-misc.md` |
| OSINT Recon | `src/skills/specialized/osint-recon.md` |
| AI/MCP Security | `src/skills/specialized/ai-mcp-security.md` |
| Intranet Pentest | `src/skills/specialized/intranet-pentest.md` |
| Pentest Tools | `src/skills/specialized/pentest-tools.md` |
| Authorization | `src/analysis/skills/authorization.md` |
| Business Logic | `src/analysis/skills/business-logic.md` |
| Info Disclosure | `src/analysis/skills/information-disclosure.md` |
| Race Conditions | `src/analysis/skills/race-conditions.md` |

### Architecture — Legacy (v6, still present)

- **Supervisor Agent** (`src/manager/agent.ts`): Mastra Agent — Observe-Learn-Attack loop
- **4 Specialist Workers** (`src/workers/`): `injection`, `authControl`, `advanced`, `recon`
- **Spider Agent** (`src/spider/agent.ts`): Stagehand-based hybrid crawler
- **Action Recorder** (`src/recorder/`): Browser actions → test cases → Playwright code
- **TypeGraph** (`src/graph/`): 11 node types, 12 edge types, JSON-backed
- **Intelligence** (`src/intelligence/`): Auth flows, RBAC, chain detection, hypotheses
- **OAST Server** (`src/oast/`): Blind callback detector
- **AgentManager** (`src/lib/agent-manager.ts`): Singleton — owns browser, workers, supervisor
- **Web UI** (`src/app/`, `src/components/`): Next.js 15 + shadcn/ui interface

### CLI Commands

| Command | Description |
|---------|-------------|
| `ultimatrix init` | Interactive provider + config setup wizard |
| `ultimatrix solve -t <url>` | **NEW** — OODA solver engine against target |
| `ultimatrix interact -t <url>` | Terminal REPL (legacy supervisor or solver per config) |
| `ultimatrix scan -t <url>` | Full scan: learn + generate + report |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR, analyze patterns |
| `ultimatrix generate -t <url>` | Learn → generate Playwright test cases |
| `ultimatrix replay` | Re-run previously generated tests |
| `ultimatrix report` | Generate JSON/HTML/Markdown report |
| `ultimatrix web` | Next.js web UI (legacy v6) |
| `ultimatrix assess -t <url>` | Full assessment (legacy v6) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings (legacy v6) |

### Engine Routing

- `config.engine: 'legacy'` (default) — Uses supervisor + 4 worker agents
- `config.engine: 'solver'` — Uses OODA solver loop (REASON → EXPLORE → CONCLUDE)
- `ultimatrix solve` always uses solver engine
- `ultimatrix interact` respects `config.engine`

### Key Files

**v8 Intelligence:**
- `src/intelligence/evidence-gate.ts` — EvidenceGate (anti-hallucination)
- `src/intelligence/reflexion.ts` — ReflexionEngine (failure classification, escalation)
- `src/intelligence/anti-loop.ts` — LoopDetector + extractAttackPath (structured [PATH:] extraction)
- `src/intelligence/constants.ts` — Centralized signal lists (English)
- `src/intelligence/reflexion-store.ts` — Reflexion persistence to graph
- `src/solver/blackboard.ts` — Blackboard (Fact/Intent state-space)
- `src/solver/solver.ts` — OODA solver loop
- `src/prompts/core-contract.ts` — Core contract (English, ~300 words)
- `src/skills/dispatcher.ts` — Skill dispatch (keyword routing)
- `src/skills/loader.ts` — Skill loading with YAML frontmatter parsing
- `src/skills/tool-filter.ts` — Skill-driven tool filtering (resolveToolsForSkills, resolveSkillsForInput)

**v8 Tools:**
- `src/tools/encode-decode.ts` — Base64/URL/HTML encode/decode
- `src/tools/skill-tools.ts` — loadSkillReference + searchSkillTool
- `src/tools/flow-tools.ts` — **NEW**: saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow

**v8 Human-in-the-Loop:**
- `src/capture/human-observer.ts` — **NEW**: Playwright event hooks for capturing human actions
- `src/browser/manager.ts` — **UPDATED**: getActivePage(), setActiveBrowser(), captureScreenshot()
- `src/browser/state-bridge.ts` — **FIXED**: Uses stable stagehand.context.activePage() API
- `src/tools/interaction-tools.ts` — **REWRITTEN**: askUser with waitForBrowserAction + screenshot capture

**v8 Skills:**
- `src/skills/core/*.md` — 7 core skills
- `src/skills/specialized/*.md` — 14 specialized skills

**Existing SDK:**
- `src/sdk.ts` — Ultimatrix class: learn, generate, replay, scan, exportReport
- `src/cli/index.ts` — CLI entry with solve, interact, scan, assess, verify
- `src/cli/solve.ts` — Solve command implementation
- `src/session.ts` — Main session with engine routing
- `src/config.ts` — Config with engine/solver/antiLoop/reflexion settings
- `src/models/factory.ts` — resolveModel()
- `src/models/schema-sanitizer.ts` — Provider-compatible JSON Schema
- `src/models/middleware.ts` — wrapModel() rate limiting Proxy
- `src/logging/forensic-log.ts` — NDJSON forensic event logging
- `src/workspace.ts` — Per-target workspace isolation

### Graph Schema (11 node types, 12 edge types)

**Node types:** Endpoint, Finding, Action, Input, AuthFlow, RBACMatrix, AttackPath, AttackStep, Test, Session, Fact, Intent, Reflexion

**Edge types:** REQUESTS, USES_AUTH, REQUIRES_ROLE, PRODUCES, CHAINS_TO, EXPLOITS, ALTERNATIVE, BUILT_ON, PRODUCED_BY

### Config

```yaml
provider: groq          # or openai, anthropic, google, nvidia, etc.
model: llama3-8b-8192
target: https://example.com
engine: solver          # 'legacy' | 'solver'
solver:
  maxToolCalls: 50      # Max tool-call rounds per turn
  maxTokens: 100000     # Max tokens per turn
  maxDurationMs: 300000 # Max wall-clock time per turn
  maxParallel: 1
antiLoop:
  staleThreshold: 3
reflexion:
  persistToGraph: true
```

### Known Issues

- Legacy v6 modules (`src/context/`, `src/lib/agent-manager.ts`, `src/swarm/`) have type errors — pre-existing tech debt, not blocking v8
- Cloudflare challenges block Stagehand crawl — deferred
- ESLint not configured

### Skills (project)
- **customize-opencode** — Editing opencode's own configuration files only
