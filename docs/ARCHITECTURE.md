# Architecture

## Ultimatrix — Multi-Agent Security Research Swarm

A 3-level nested agent architecture for autonomous web application security
testing. Every decision is LLM-driven. The agents read raw HTTP responses
like a human pentester and quote verbatim evidence for every finding.

```
                          ┌─────────────────────────┐
                          │      User / CLI         │
                          │  $ ultimatrix assess    │
                          │    -t https://target    │
                          └──────────┬──────────────┘
                                     │
                          ┌──────────▼──────────────┐
                          │   Explorer (spider)     │
                          │  • crawl routes         │
                          │  • extract forms/       │
                          │    cookies/scripts      │
                          │  • fill+submit forms    │
                          │  • capture auth flow    │
                          └──────────┬──────────────┘
                                     │ app-model.json
                          ┌──────────▼──────────────┐
                          │   Strategist (Level 1)  │
                          │   4-phase loop:         │
                          │   Recon → Initial Fire  │
                          │   → Triage&Pivot → Done │
                          │                         │
                          │   • reads app model     │
                          │   • LLM picks per-scan  │
                          │     specialists         │
                          │   • dispatches workers  │
                          └──────────┬──────────────┘
                                     │ spawn_agent(tool)
                          ┌──────────▼──────────────┐
                          │   Worker (Level 2)      │
                          │   in-process,           │
                          │   deepagents-based      │
                          │                         │
                          │   tools: 5 (no attack)  │
                          │   + 6 specialists       │
                          │   bound as sub-agents   │
                          └──────────┬──────────────┘
                                     │ task(specialist)
                ┌──────────┬─────────┼─────────┬──────────┐
                ▼          ▼         ▼         ▼          ▼
            ┌──────┐  ┌──────┐  ┌────────┐ ┌────────┐ ┌────────────┐
            │ XSS  │  │ IDOR │  │  JWT   │ │ GraphQL│ │  WAF-      │
            │spec. │  │spec. │  │spec.   │ │spec.   │ │  mutator   │
            └──────┘  └──────┘  └────────┘ └────────┘ └────────────┘
                                                         │
                                                    ┌────▼────┐
                                                    │ Triage  │
                                                    │reviewer │
                                                    │(L4)     │
                                                    └─────────┘
```

## Three-level design

### Level 1: Strategist (autonomous loop)

A single LLM agent running a 4-phase loop:

1. **Recon** — read the app model, summarize target, identify auth flows
2. **Initial Fire** — pick top-3 specialists and dispatch them
3. **Triage & Pivot** — read findings, dispatch follow-up specialists based
   on what was found
4. **Done** — write final report

The strategist is intentionally lean: it does NOT have attack tools (no
`xss_inject`, no `sql_inject`). It only has:
- `read_app_model` / `update_app_model` — persistent memory
- `spawn_agent` — dispatch a worker
- `finalize_report` — write the report
- `list_specialists` / `pick_specialists` — LLM-driven subset selection

This is the same delegation pattern as Claude Code / OpenCode: parent has
no execution tools, only orchestration tools.

### Level 2: Worker (5 tools, no attack primitives)

A worker is a deepagents-based LLM loop. It receives a `target_context`
(structured JSON: endpoint, params, hypotheses) and decides what to do.

The worker has only 5 tools:
- `read_app_model` / `update_app_model` — sync state with parent
- `task` — call a specialist (sub-agent)
- `request_finding` — submit a finding to the parent
- `synthesize` — combine multiple specialist results

The worker does NOT have `xss_inject`, `sql_inject`, or any raw attack
primitives. Those live in the specialists.

This means: if a worker is subverted, it can only do reconnaissance and
delegate. It cannot directly fire a test input.

### Level 3: Specialists (6 factories, picked per scan)

A specialist is a focused LLM agent with a single technique and a
tightly-scoped system prompt. It has just the attack primitives it needs:

| Specialist | Attack tool(s) | When picked |
|------------|---------------|-------------|
| `xss-specialist` | `xss_inject` | Endpoint has search/text/form param OR `bodyFormat=html` |
| `idor-specialist` | `request_pair` | Numeric id param OR `/users/:id` shape |
| `jwt-specialist` | `jwt_decode` + `jwt_replay` | `auth.type=JWT` in app model |
| `graphql-specialist` | `gql_query` | `bodyFormat=graphql` OR `/graphql` endpoint |
| `waf-mutator` | `mutate_request` | 403/406/429 response OR explicit WAF detected |
| `triage-reviewer` | `read_finding` | Every cycle: re-judge prior findings |

Specialists are LLM-driven factories (`SpecialistFactory` interface) — each
one has a `build()` method that takes the parent's tools and returns a
`SubAgent` for deepagents. The `selectSpecialistsForScan()` function uses
heuristics + LLM to pick a subset of 2-4 specialists per scan rather than
running all 6.

## Tool topology

```
USER
  │
  ▼
EXPLORER (crawl, extract, model)
  │
  ▼
STRATEGIST [read_app_model, update_app_model, spawn_agent, list_specialists, pick_specialists, finalize_report]
  │
  ▼ spawn_agent (worker)
WORKER [read_app_model, update_app_model, task, request_finding, synthesize]
  │
  ▼ task (specialist)
SPECIALIST [xss_inject | idor_pair | jwt_replay | gql_query | mutate_request | read_finding]
  │
  ▼
TARGET (HTTP request)
```

Notice the strictly downward tool access: specialists cannot spawn workers,
workers cannot spawn strategists, strategists cannot fire raw tests.

## LLM-driven selection (per-scan)

```ts
// On every cycle:
const tech = await selectTechniquesForEndpoint(llm, endpoint);
// → { techniques: ['xss', 'idor'], rationale: '...', source: 'llm' | 'fallback' }

const selected = await selectSpecialistsForScan(llm, appModel);
// → { specialists: ['xss-specialist', 'idor-specialist'], reasoning: '...' }
```

The LLM is asked: "Given this target's tech stack, auth type, endpoints,
and prior findings, which specialists are most likely to find new issues?"

## Persistent memory: app-model.json

The strategist and workers share state via `app-model.json`, an 18-section
structured JSON:

```json
{
  "target": { "url": "...", "scope": [...] },
  "techStack": ["react", "node", "postgresql"],
  "auth": { "type": "JWT", "header": "Authorization: Bearer ..." },
  "workflow": { "nodes": [...], "edges": [...] },
  "endpoints": [...],
  "forms": [...],
  "scripts": [...],
  "cookies": [...],
  "localStorage": {...},
  "findings": [...],
  "verifications": [...],
  "parameterClassifications": [...],
  "authBoundaries": [...],
  "recordedSessions": [...],
  "hypotheses": [...],
  "nextSteps": [...],
  "visitedUrls": [...],
  "oastCallbacks": [...],
  "coverage": [...]
}
```

`read_app_model(section)` and `update_app_model(section, patch)` allow
section-based access. Arrays merge deduplicated, objects merge top-level
keys. This is what lets the strategist check 12 endpoints' state in a
single LLM call instead of re-reading the whole model.

## Live-streaming Playwright documentation

As the swarm runs, every macro step (browser action) and worker action
(HTTP request) is appended to `output/replay.spec.ts` — a valid Playwright
test file that can be run with `npx playwright test --list` at any point
during the scan.

Three tiers of output:

1. **Tier 1: User Flow** — recorded browser actions as a navigable script
2. **Tier 2: Swarm Action Replay** — every HTTP request the workers made
3. **Tier 3: Decision Comments** — LLM-generated 1-sentence reasoning for
   each action ("tested IDOR by varying numeric id parameter")

Sensitive values (passwords, tokens) are masked with `••••••`.

## Live dashboard (WebSocket)

The dashboard server emits typed events over WebSocket:

- `navigate | finding | screenshot | model_update | tool_call | risk_change | session | status | error | agent_decision`

The `agent_decision` event (Tier 3) is what shows the agent's reasoning
in real time. The dashboard's "Agent Decision Timeline" panel shows:
- Agent name (worker-1, jwt-specialist, etc.)
- Tool called
- 1-sentence decision comment (from LLM)
- Current risk score

So a judge can watch the scan and see in real time what the swarm is
thinking.

## Safety properties

1. **No trigger words in prompts**: "exploit", "attack", "payload",
   "injection" → "test input", "test string", "security test". Workers
   were returning "I'm sorry" refusals before this fix.
2. **Strict tool hierarchy**: parent can't fire raw tests, child can't
   spawn parent.
3. **Sensitive value redaction**: passwords/tokens masked in all logs.
4. **Findings require evidence**: every finding must include a verbatim
   quote from the HTTP response, with a confidence score 0-1.
5. **Triage-reviewer as LLM judge**: re-reads each finding + the response
   to confirm true-positive vs false-positive before publishing.

## File layout

```
src/
├── cli/                    # CLI commands (assess, scan, interact, verify)
├── core/                   # App model, attack plan, trace utils, fix-todos
├── agents/                 # LLM-driven agents
│   ├── worker.ts           # DRAFTED deepagents worker (~556 LOC)
│   ├── specialist-builder.ts   # LLM-driven technique selection
│   ├── inference.ts        # 4 LLM-driven inference functions
│   ├── middleware/         # Agent decision emitter
│   └── specialists/        # 6 specialist factories
├── dashboard/              # Live WebSocket dashboard
├── explorer/               # Spider, form exploration, decision commenter
│   ├── playwright-stream-writer.ts  # Tier 1+2+3 live spec writer
│   ├── decision-commenter.ts        # Tier 3 LLM call
│   └── workflow-builder.ts          # Auth boundary graph
├── oast/                   # Out-of-band callback server
├── pipeline/               # Autonomous loop, report generator
├── prompts/                # Threat model prompt
├── triage/                 # Fast-path triage rubric
└── tools/                  # Tool registry
docs/
├── ARCHITECTURE.md         # this file
├── HARDCODE_AUDIT.md       # all 5 hardcode removals
└── deepagents-architecture.md  # research notes
tests/
├── agents/                 # 56 tests
├── core/                   # 35 tests
├── explorer/               # 39 tests
├── pipeline/               # ...
├── oast/                   # ...
└── helpers/fake-llm.ts     # shared LLM test double
```
