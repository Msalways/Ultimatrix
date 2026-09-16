# Ultimatrix v8 — How It Works

End-to-end architecture reference for contributors.

## Quick Start

```bash
# 1. Configure
npx ultimatrix init          # Interactive wizard → creates ultimatrix.yaml

# 2. Run
npx ultimatrix solve -t https://target.com   # OODA solver engine
npx ultimatrix interact -t https://target.com # Terminal REPL

# 3. Results
# Reports written to ./output/<target>/reports/
# Graph persisted to ./output/<target>/ultimatrix.db
```

## Architecture Overview

```
                    ┌──────────────────────┐
                    │   Engine Selector    │ ← config.engine: 'legacy' | 'solver' | 'multi-model'
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │  Legacy      │  │  Solver      │  │  Council         │
    │  Supervisor  │  │  Engine      │  │  Engine          │
    │  (v6/v7)     │  │  (OODA)      │  │  (parallel       │
    │              │  │              │  │   debate)        │
    └──────────────┘  └──────────────┘  └──────────────────┘
              │                │                 │
              └────────────────┼────────────────┘
                               ▼
                     ┌──────────────────────┐
                     │  Session Runner      │ ← src/session.ts
                     └──────────┬───────────┘
                               │
                    ┌──────────┴───────────┐
                    ▼                      ▼
           ┌──────────────┐      ┌──────────────────┐
           │  Skills Lib  │      │  Tool Filter     │
            │  (74 skills) │      │  (60+ tools)     │
           └──────────────┘      └──────────────────┘
```

### What Happens When You Run `solve -t <url>`

```
CLI (src/cli/index.ts)
  │
  ├─ Parse args → target, outputDir
  ├─ showDisclaimer(target)
  │
  └─ solveCommand(target, outputDir)  ← src/cli/solve.ts
      │
      ├─ loadConfig()                  ← reads ultimatrix.yaml + providers.yaml
      ├─ createEngagementRuntime()     ← GraphStore, WorkflowStore, EvidenceLedger, BrowserProvider
      ├─ runtime.run(async () => {
      │   ├─ setScopeConfig()          ← URL allowlist (deny-by-default)
      │   ├─ createMemory()            ← LibSQL-backed conversation memory
      │   │
      │   └─ createEngineServices()    ← src/session/engine-setup.ts
      │       ├─ Blackboard + EvidenceGate + LoopDetector + Reflexion
      │       ├─ ModelSelector         ← scores models by complexity/budget/rate-limit
      │       ├─ SkillRegistry         ← scans skills/ directory, parses YAML frontmatter
      │       ├─ LazySolverServices    ← cold — nothing starts until a tool needs it
      │       └─ createSolverBrain()   ← src/solver/brain-tools.ts
      │           ├─ buildToolPack()   ← 60+ tools assembled from 11 groups
      │           ├─ loadMethodologySkill()  ← web/api/cloud .md appended to system prompt
      │           ├─ getBrainInstructions()  ← instructions/brain.md + core-contract.md
      │           └─ new Agent({model, tools, instructions})
      │
      ├─ for round = 1..5:
      │   └─ solve(agent, params)      ← src/solver/solver.ts
      │       ├─ buildRuntimeEnvelope() ← JSON index of graph state
      │       ├─ agent.stream(goal + envelope, {maxSteps: 50})
      │       │   └─ LLM calls tools → Mastra executes → results fed back → repeat
      │       ├─ checkCompletion()     ← goal_achieved / frontier_exhausted / stale
      │       ├─ findAttackPaths()     ← multi-hop chain analysis
      │       └─ runExploitationLoop() ← weaponize confirmed findings
      │
      ├─ verifyPendingFindings()       ← replay top 5 findings
      └─ write reports to disk
```

## Core Modules

### Intelligence Layer (`src/intelligence/`)

| Module | Purpose |
|--------|---------|
| `evidence-gate.ts` | Anti-hallucination: cross-checks LLM claims against structured evidence |
| `evidence-ledger.ts` | Structured `ObservedFacts`, `FindingClaim`, `verifyFindingClaim` |
| `reflexion.ts` | Failure classification, L0-L4 escalation, experience extraction |
| `anti-loop.ts` | Stale/dead-end detection, mandatory strategy change |
| `chaining.ts` | Finding chain detection: links findings into multi-step attack chains |
| `hypotheses.ts` | Attack hypothesis generator from graph state |

### Tool System (`src/tools/`, `src/core/toolpack.ts`)

60+ tools assembled from 11 groups:

| Group | Tools | Purpose |
|-------|-------|---------|
| Core (19) | queryGraph, writeFinding, getSessionContext | Graph queries, evidence, context |
| HTTP (4) | httpRequest, followRedirects | Make requests, capture traffic |
| Skills (5) | listSkills, searchSkills, loadSkillBody | Discover and load methodology |
| Session (6) | storeSession, useSession, extractSessionCookie | Browser auth persistence |
| Research (7) | buildResearchMap, planResearchExperiments | Hypothesis-driven testing |
| Primitives (2) | runPrimitive, getPriorPatterns | Attack primitives (SQLi, IDOR, SSRF) |
| Campaign (1) | runCampaign | Autonomous coverage planning |
| Browser (6-7) | stagehand_navigate/act/extract/observe | Stagehand or Camoufox |
| Workers (5) | spawnWorker, spawnSwarm | Specialist sub-agents |
| External (9) | nuclei, sqlmap, ffuf | Real scanner binaries (opt-in) |
| Model (1) | selectModel | Multi-model tier routing |

### Skill System (`skills/`, `src/solver/skills/`)

74 skills across 18 domains. Each skill is a `.md` file with YAML frontmatter:

```yaml
---
name: exploitation
domain: injection
tier: powerful
toolRefs: [runPrimitive, writeFinding, verifyChains]
primitives: [classicInjection, rceClass]
---
# Methodology instructions (markdown body)
```

**Flow:** Loader scans `skills/` → parses frontmatter → builds index → Registry provides read-through access → Tool filter resolves toolRefs per skill.

### Browser Pipeline (`src/browser/`)

```
Stagehand (CDP)  ─┐
                  ├→ dialog-inject.ts → wraps tools → auto-injects dialog evidence
Camoufox (PW)   ─┘              ↓
                    reaction-observer.ts → accessibility tree diffing
                    anti-bot.ts → Cloudflare/Akamai/DataDome detection
                    state-bridge.ts → cookie/storage import/export
```

**Key insight:** Stagehand v3 is CDP-native — no Playwright `Page` event emitter inside. `page.on('response')` never fires. CDP `Network.*` events are the platform-native capture surface.

### Graph Schema (24 node types, 20 edge types)

**Node types:** Page, Action, Input, Endpoint, Test, Finding, AuthFlow, RBACRole, Attack, Fact, Intent, Reflexion, Workflow, Entity, Hypothesis, Experiment, CandidateFinding, HeaderSemantic, AuthScheme, OutcomeFeedback, RenderedElement, CouncilDebate, ExploitProof, ThreatModel

**Edge types:** HAS_ACTION, HAS_INPUT, HAS_TEST, FOUND_ON, REQUIRES_AUTH, CHAINED_FROM, TARGETS, PRODUCED, HAS_ROLE, PERMISSION, BUILT_ON, PRODUCED_BY, VALUE_ORIGIN, REQUIRES_ROLE, CHAINS_TO, RENDERED_ON, REINGESTS, ORDERED_BEFORE, PROVES, SESSION_REACHES

## Config Reference

```yaml
# ultimatrix.yaml
provider: groq          # groq, openai, anthropic, google, nvidia, etc.
model: llama3-8b-8192
target: https://example.com
engine: solver          # 'legacy' | 'solver' | 'multi-model'

solver:
  maxToolCalls: 50      # Max tool-call rounds per turn
  maxTokens: 100000     # Max tokens per turn
  maxDurationMs: 300000 # Max wall-clock time per turn (5 min)
  maxRounds: 5          # Max solve() loops
  maxParallel: 1

antiLoop:
  staleThreshold: 3     # Rounds before forced strategy change

browser:
  provider: stagehand   # 'stagehand' | 'camoufox'
  headless: true

verifier:
  enabled: true
  maxPerRound: 5

spider:
  enabled: true

# Multi-model tier routing (optional)
modelTiers:
  fast: { provider: groq, model: llama3-8b-8192 }
  balanced: { provider: groq, model: llama3-70b-8192 }
  powerful: { provider: openai, model: gpt-4o }

# Per-role model override (optional)
modelRoles:
  brain: { tier: balanced }
  spider: { tier: fast }
  council: { tier: powerful }
```

### Default Config Values

| Setting | Default | Source |
|---------|---------|--------|
| `engine` | `'multi-model'` | `config.ts:DEFAULTS` |
| `solver.maxToolCalls` | `50` | `config.ts:DEFAULTS` |
| `solver.maxDurationMs` | `300,000` (5 min) | `config.ts:DEFAULTS` |
| `solver.maxRounds` | `5` | `config.ts:DEFAULTS` |
| `browser.provider` | `'stagehand'` | `config.ts:DEFAULTS` |
| `browser.headless` | `true` | `config.ts:DEFAULTS` |
| `antiLoop.staleThreshold` | `3` | `config.ts:DEFAULTS` |
| `verifier.enabled` | `true` | `config.ts:DEFAULTS` |
| `assistant.name` | `'Jarvis'` | `brain-instructions.ts:24` |
| Brain model tier | `'balanced'` | `routing.ts:16` |
| Spider model tier | `'fast'` | `routing.ts:17` |
| Context window fallback | `128,000` tokens | `solver.ts:395` |

## Testing

```bash
npm test                           # All 2234+ tests
npx vitest run test/solver         # Solver only
npx vitest run test/council        # Council only
npx vitest run test/browser        # Browser only
npx vitest run test/evals          # Architecture evals
npm run test:evals                 # Same as above
```

**Framework:** Vitest v4.1.7 with v8 coverage. 228 test files, 50 directories.

**Mocking:** `vi.mock()` at module level. Shared helpers in `test/utils/engagement-context.ts`.

## Key Commands

| Command | Description |
|---------|-------------|
| `npx ultimatrix init` | Interactive provider + config setup wizard |
| `npx ultimatrix solve -t <url>` | OODA solver engine against target |
| `npx ultimatrix interact -t <url>` | Terminal REPL |
| `npx ultimatrix scan -t <url>` | Full scan: learn + generate + report |
| `npx ultimatrix web` | Next.js web UI |
| `npm run build:cli` | Build CLI bundle |
| `npm run lint` | ESLint src/ |
| `npm run typecheck` | TypeScript type-check |
| `npm run format` | Prettier format |
