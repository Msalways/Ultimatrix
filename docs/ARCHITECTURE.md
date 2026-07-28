# Ultimatrix Architecture — v8.6

> Intelligence-augmented security researcher. Dual engine + Council. 29 technique primitives, 57 skills, 60+ tools, 17 LLM providers.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CLI / Web UI                                │
│  ultimatrix init|solve|interact|scan|learn|generate|web|...        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │   Engine Selector       │  ← config.engine
              │   (multi-model default) │
              └────────────┬────────────┘
                           │
         ┌─────────────────┼─────────────────┐
         ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│   Legacy     │  │   Solver     │  │   Council        │
│   Supervisor │  │   Engine     │  │   Engine         │
│   (v6/v7)    │  │   (OODA)     │  │   (parallel      │
│              │  │              │  │    debate)        │
│  observe →   │  │  REASON →    │  │                   │
│  learn →     │  │  EXPLORE →   │  │  5 LLM members    │
│  attack →    │  │  CONCLUDE →  │  │  parallel speaks   │
│  loop        │  │  loop        │  │  HITL approval     │
└──────┬───────┘  └──────┬───────┘  └─────────┬─────────┘
       │                 │                     │
       └─────────────────┼─────────────────────┘
                         ▼
              ┌──────────────────────┐
              │   Session Runner     │  ← src/session.ts
              │   (CoreServices)     │    ExecutionStrategy interface
              └──────────┬───────────┘
                         │
              ┌──────────┴───────────┐
              ▼                      ▼
     ┌──────────────┐      ┌──────────────────┐
     │  Skills Lib  │      │  ToolPack        │
     │  57 skills   │      │  60+ tools       │
     │  10 domains  │      │  core + http +   │
     │  YAML meta   │      │  skill + research│
     └──────────────┘      └──────────────────┘
```

---

## Engine Architecture

### Engine Types

| Engine | `config.engine` | Description |
|--------|----------------|-------------|
| **Legacy** | `'legacy'` | Supervisor + 4 specialist workers (v6/v7) |
| **Solver** | `'solver'` | OODA loop: REASON → EXPLORE → CONCLUDE |
| **Multi-model** | `'multi-model'` | Default. Solver + model-aware delegation |
| **Council** | `'council'` | On-demand parallel debate with HITL |

All engines implement the `ExecutionStrategy` interface (`src/core/types.ts`):

```typescript
interface ExecutionStrategy {
  run(ctx: StrategyContext): Promise<RunResult>
}
```

`StrategyContext` carries: goal, config, `CoreServices` (evidence ledger, blackboard, reflexion, anti-loop), toolPack, modelSelector, approval hooks.

### Session Runner (`src/session.ts`)

Owns the REPL loop. Builds `CoreServices` once, creates `StrategyContext`, dispatches to the active engine. Streams output via `ChatStream` / native terminal.

### Execution Core (`src/core/`)

| Module | File | Purpose |
|--------|------|---------|
| Types | `types.ts` | `ExecutionStrategy`, `StrategyContext`, `CoreServices`, `RunResult` |
| ToolPack | `toolpack.ts` | Shared tool-pack builder for brain + council |
| Evidence | `evidence.ts` | Shared singleton `EvidenceLedger` |
| Blackboard | `blackboard.ts` | Unified fact/intent state-space + Plan model |
| Approval | `approval.ts` | Re-exports council approval as shared gate |

---

## Solver Engine (`src/solver/`)

OODA loop: single `agent.stream()` per REPL turn. Intelligence layers observe passively — record state but do NOT gate or interrupt.

| Module | File | Purpose |
|--------|------|---------|
| Solver | `solver.ts` | Main OODA loop (~1200 LOC) |
| Brain Tools | `brain-tools.ts` | ~30 tool orchestrator set |
| Brain Instructions | `brain-instructions.ts` | Persona: role, safety, anti-hallucination |
| Attack Path | `attack-path.ts` | Chains endpoint+finding steps into exploit paths |
| Plan Tools | `plan-tools.ts` | Structured planning: createPlan, updatePlan, getPlan |
| Exploitation Loop | `exploitation-loop.ts` | Autonomous exploitation escalation |
| Threat Model | `threat-model.ts` | Attack surface analysis |
| Escalation State | `escalation-state.ts` | Tracks escalation level across turns |

### Skill Subsystem (`src/solver/skills/`)

| Module | File | Purpose |
|--------|------|---------|
| Tool Filter | `tool-filter.ts` | `resolveToolsForSkills()` + `CORE_TOOLS` negative scoring |
| Loader | `loader.ts` | YAML frontmatter parsing, skill body loading |
| Registry | `registry.ts` | Graph-aware skill selection by endpoint type, auth, technique history |

---

## Council Engine (`src/council/`)

Parallel debate: 5 LLM members (strategist, operator, skeptic, analyst, human) debate what to test, analyze results together. Human steers via HITL approval.

| Module | File | Purpose |
|--------|------|---------|
| Types | `types.ts` | `CouncilIntent`, `ImpactLevel`, `CouncilProposal`, `MemberOutput` |
| Personas | `personas.ts` | LLM persona strings + structured output contract |
| Factory | `factory.ts` | Builds LLM-backed agents, `parseStructuredOutput()` |
| Orchestrator | `orchestrator.ts` | `debateOnce()` parallel cycle, zero regex |
| Bus | `bus.ts` | Append-only log + sliding-window transcript |
| Blackboard | `blackboard-shared.ts` | SharedBlackboard adapter |
| Evidence Bridge | `evidence-bridge.ts` | Worker results → EvidenceItems |
| Approval | `approval.ts` | `classifyImpact()` reads typed fields, HITL gate |
| Debate Memory | `debate-memory.ts` | Cross-cycle stance/approach memory |

**Design principle:** No hardcoded substring detection. Structured typed fields at all seams.

---

## Intelligence Layer (`src/intelligence/`)

| Module | File | Purpose |
|--------|------|---------|
| Evidence Gate | `evidence-gate.ts` | Anti-hallucination: claims cross-checked against typed evidence |
| Evidence Ledger | `evidence-ledger.ts` | Structured `ObservedFacts`, `FindingClaim`, `verifyFindingClaim` |
| Reflexion | `reflexion.ts` | Failure classification, L0-L4 escalation, experience extraction |
| Anti-Loop | `anti-loop.ts` | Stale/dead-end detection, structured path extraction |
| Constants | `constants.ts` | Centralized signal lists |
| Reflexion Store | `reflexion-store.ts` | Persist/load reflexion state to graph |
| Cross-Engagement | `cross-engagement.ts` | Privacy-preserving cross-session pattern memory |
| Outcome Feedback | `outcome-feedback.ts` | Finding acceptance → technique weights |
| Chaining | `chaining.ts` | Finding chain detection: multi-step attack chains |
| Chain Planner | `chain-planner.ts` | Chain-based escalation planning |
| Hypotheses | `hypotheses.ts` | Attack hypothesis generator from graph state |
| Auth Recorder | `auth-recorder.ts` | Login, OAuth, SAML → AuthFlow nodes |
| RBAC Learner | `rbac-learner.ts` | Role-based access patterns → RBACMatrix nodes |
| Session Resume | `session-resume.ts` | Previous session detection + continuity |

---

## Technique Primitives (`src/primitives/`)

29 registered primitives, each a focused attack implementation with structured output.

| Primitive | Category | Description |
|-----------|----------|-------------|
| `classicInjection` | Injection | SQLi (union, boolean-blind, time-based, OOB) |
| `secondOrderSqli` | Injection | Second-order SQL injection |
| `nosqlInjection` | Injection | NoSQL injection (MongoDB, CouchDB) |
| `graphqlBola` | API | GraphQL BOLA / IDOR |
| `sstiBlind` | Injection | Server-side template injection (blind) |
| `headerInjection` | Injection | HTTP header injection |
| `ldapXpathInjection` | Injection | LDAP/XPath injection |
| `smuggling` | Web | HTTP request smuggling |
| `deserialization` | Web | Insecure deserialization |
| `idorSwapper` | Access Control | IDOR via object-id swapping |
| `bolaFuzzer` | Access Control | BOLA fuzzer (multi-role) |
| `authzMatrix` | Access Control | Authorization matrix testing |
| `authBypass` | Access Control | Authentication bypass |
| `workflowBypass` | Business Logic | Workflow step bypass |
| `businessLogicAbuse` | Business Logic | Business logic abuse |
| `atoChain` | Business Logic | Account takeover chain |
| `concurrencyHarness` | Race | Race condition testing |
| `configTrust` | Infrastructure | Configuration trust testing |
| `invariantProbe` | Detection | Response invariant probing |
| `ssrfOast` | SSRF | SSRF via out-of-band callback |
| `ssrfMetadata` | SSRF | SSRF via metadata endpoints |
| `ssrfMultiCloud` | SSRF | SSRF across cloud providers |
| `aiTrust` | AI/ML | AI trust boundary testing |
| `aiAgentAttack` | AI/ML | AI agent attack (prompt injection) |
| `rceClass` | Injection | Remote code execution classification |
| `boplaOracle` | Detection | BOPLA oracle detection |
| `artifactLifetime` | Lifecycle | Artifact lifetime analysis |
| `internalStateDisclosure` | Info Leak | Internal state disclosure |
| `tenantIsolation` | Multi-tenant | Tenant isolation testing |

All primitives flow through `framework.ts` → `EvidenceGate` → `writeFinding`. Confirmed primitives commit to the graph as `ExploitProof` nodes.

### Primitive Framework (`src/primitives/framework.ts`)

- `runPrimitive(primitive, ctx, executor, gate)` — orchestrates steps, records observed facts, verifies claims
- `constraint-mutators.ts` — shape-based payload mutation (no hardcoded patterns)
- `observers.ts` — post-execution observation hooks

---

## Skills Library (`skills/`)

57 skill files across 10 domains. YAML frontmatter declares metadata, toolRefs, and composition rules.

| Domain | Skills | Count |
|--------|--------|-------|
| **Injection** | exploitation, vuln-discovery, nosql-injection, second-order-sqli, ssti, xxe, command-injection-advanced, email-injection | 8 |
| **Web Attacks** | web-pentest, web-security-advanced, waf-bypass, blind-ssrf, business-logic, race-conditions-advanced, http-smuggling, deserialization, cors-misconfig, clickjacking, cache-poisoning, open-redirect, prototype-pollution, host-header-injection, css-injection, file-upload-attacks, type-juggling, modern-xss, security-headers-audit | 19 |
| **Auth Security** | authorization, jwt-advanced, jwt-algorithm-confusion | 3 |
| **Recon** | recon, osint-recon, information-disclosure, intranet-pentest, post-exploitation, subdomain-takeover, hsts-bypass, ssl-stripping, ctf-misc | 9 |
| **Crypto** | crypto-toolkit, ctf-crypto | 2 |
| **API Security** | api-security, api-fuzzing, ai-mcp-security, graphql-attacks, graphql-depth-introspection, websocket-attacks | 6 |
| **Cloud Security** | aws-iam-exploitation, azure-exploitation, gcp-exploitation, docker-escape, kubernetes-security, serverless-attacks | 6 |
| **LLM Security** | llm-agentic-security | 1 |
| **Supply Chain** | supply-chain | 1 |
| **Reports** | reporting | 1 |
| **Total** | | **57** |

Skills declare `toolRefs` in YAML frontmatter. The tool-filter (`src/solver/skills/tool-filter.ts`) resolves which Mastra tools each skill needs, applying negative scoring for core tools to prevent bloat.

---

## Knowledge Graph (`src/graph/`)

SQLite-backed property graph. 24 node types, 20 edge types.

### Node Types (24)

| Category | Types |
|----------|-------|
| **Target** | Page, Endpoint, Input, Action |
| **Testing** | Test, Finding, CandidateFinding, ExploitProof |
| **Auth** | AuthFlow, AuthScheme, RBACRole |
| **Intelligence** | Fact, Intent, Hypothesis, Experiment |
| **Reflexion** | Reflexion, OutcomeFeedback |
| **Research** | Workflow, Entity |
| **Visual** | RenderedElement, HeaderSemantic |
| **Debate** | CouncilDebate, ThreatModel |

### Edge Types (20)

| Category | Types |
|----------|-------|
| **Structure** | HAS_ACTION, HAS_INPUT, HAS_TEST, FOUND_ON |
| **Auth** | REQUIRES_AUTH, HAS_ROLE, PERMISSION, REQUIRES_ROLE |
| **Chain** | CHAINED_FROM, CHAINS_TO, TARGETS |
| **Provenance** | PRODUCED, PRODUCED_BY, VALUE_ORIGIN, BUILT_ON |
| **Relations** | REINGESTS, ORDERED_BEFORE, PROVES, SESSION_REACHES |
| **Visual** | RENDERED_ON |

### Graph Tools (`src/graph/tools.ts`)

`queryGraph`, `updateGraph`, `getTestCoverage`, `getAttackPath`, `getUntestedActions`, `getAuthFlows`, `getTargetSummary`, `getEndpointsWithParams`, `getGraphSchema`, `getCaptureOverview`, `queryRelations`

### Relation Tools (`src/graph/relation-tools.ts`)

`queryRelations` — edges + subgraph + reingestSeeds. Typed relational queries without hardcoded vocabulary.

---

## Tools (`src/tools/`)

60+ tools organized by category.

### Core Tools (always loaded)

| Tool | File | Purpose |
|------|------|---------|
| `httpRequest` | `http-tools.ts` | HTTP client with scope guard |
| `recordEvidence` | `control-tools.ts` | Record evidence to ledger |
| `writeFinding` | `control-tools.ts` | Write finding to graph + evidence gate |
| `askUser` | `interaction-tools.ts` | HITL: ask question, wait for browser action |
| `queryGraph` | `graph/tools.ts` | Query the knowledge graph |
| `updateGraph` | `graph/tools.ts` | Mutate the knowledge graph |
| `runPrimitive` | `primitives/index.ts` | Invoke a technique primitive |
| `listSkills` | `skill-tools.ts` | List available skills |
| `loadSkillReference` | `skill-tools.ts` | Load skill content |
| `searchSkillTool` | `skill-tools.ts` | Search skills by query |

### Research Tools

`buildResearchMap`, `planResearchExperiments`, `compareResearchResponses`, `recordFindingCandidate`, `assessCandidateReportability`, `getResearchStatus`

### Session / Flow Tools

`saveSession`, `restoreSession`, `observeHumanActions`, `saveLearnedFlow`, `reproduceFlow`, `useSession`, `extractSessionCookie`

### External Scanner Adapters (`src/tools/adapters/`)

9 adapters for best-of-breed binaries (gated by `isToolAvailable()`):

| Adapter | Binary | Purpose |
|---------|--------|---------|
| `nuclei` | nuclei | Template-based vulnerability scanner |
| `sqlmap` | sqlmap | SQL injection detection/exploitation |
| `ffuf` | ffuf | Web fuzzer |
| `nmap` | nmap | Network scanner |
| `jwttool` | jwt_tool | JWT attack toolkit |
| `arjun` | arjun | Parameter discovery |
| `corsy` | corsy | CORS misconfiguration |
| `subfinder` | subfinder | Subdomain enumeration |
| `gitleaks` | gitleaks | Secret scanning |

All external findings pass through `bridgeToolResult()` → `EvidenceGate` trust boundary before becoming Findings.

### Other Tools

`encodeDecode`, `reconTools` (WHOIS/DNS/subdomain brute/JWT decode), `harTools`, `budgetDashboard`, `budgetPruner`, `tokenProfiler`, `dualSessionOrchestrator`, `markerOracle`, `rawHttpClient`, `shadowApiDiscovery`, `credentialTools`, `detectChains`, `campaignTool`, `outcomeFeedbackTool`, `researchTools`

---

## Campaign Engine (`src/campaign/`)

Autonomous coverage planning: endpoint × param × role × state matrix → deduped slices → bounded-concurrency execution.

| Module | File | Purpose |
|--------|------|---------|
| Types | `types.ts` | `CampaignSlice`, `CoverageStats`, `CampaignPlan` |
| Planner | `planner.ts` | Builds coverage matrix, dedupes into slices |
| Executor | `executor.ts` | Rate limiting, budget guard, bounded concurrency |
| Runner | `runner.ts` | Resolves primitive by id, runs via HTTP tool |
| Continuity | `continuity.ts` | Change detection, incremental re-test |
| Campaign Tool | `campaign-tool.ts` | Mastra dispatch tool for whole campaigns |

---

## Analysis Pipeline (`src/analysis/`)

HAR-based business-logic analysis.

| Module | File | Purpose |
|--------|------|---------|
| Analyser | `analyser.ts` | Value-provenance graph, auth decode, invariants |
| HAR Bridge | `har-bridge.ts` | Wires HAR pipeline into graph + LLM context |
| HAR Analyzer | `har-analyzer.ts` | Extracts endpoints, secrets, data flows |
| Skill Loader | `skill-loader.ts` | Analysis skill loader |
| Instructions | `instructions.ts` | Builds LLM instructions from skills + HAR |

---

## Capture & Browser (`src/capture/`, `src/browser/`)

### Capture

| Module | File | Purpose |
|--------|------|---------|
| Human Observer | `human-observer.ts` | Playwright hooks: click/fill/navigate + AuthStateDetector |
| HAR Parser | `har-parser.ts` | HAR 1.2 parser with Zod schemas |
| Graph Bridge | `graph-bridge.ts` | Persists Stagehand results to graph |
| Browser Launcher | `browser-launcher.ts` | Playwright browser with managed lifecycle |
| Network Capture | `network-capture.ts` | Network interceptor: requests/responses → HAR |
| Passive Observer | `passive-observer.ts` | DOM observer: XHR/fetch patterns |
| Render Tracer | `render-tracer.ts` | HTML response analysis: forms, scripts, payloads |
| Render Bridge | `render-bridge.ts` | Persists render traces to graph |
| JS Miner | `js-miner.ts` | JavaScript analysis |

### Browser

| Module | File | Purpose |
|--------|------|---------|
| Manager | `manager.ts` | Singleton StagehandBrowser, `getActivePage()` |
| Anti-Bot | `anti-bot.ts` | Cloudflare/Akamai/DataDome/PerimeterX detection |
| State Bridge | `state-bridge.ts` | Imports/exports cookies+storage |
| Dialog Watcher | `dialog-watcher.ts` | JS interceptor: alert/confirm/prompt detection |
| Dialog Inject | `dialog-inject.ts` | Auto-injects dialog evidence into actions |
| Reaction Observer | `reaction-observer.ts` | Accessibility tree diffing: modals, toasts |

---

## Models & Providers (`src/models/`)

### 17 LLM Providers

| Provider | Env Var | Notes |
|----------|---------|-------|
| OpenAI | `OPENAI_API_KEY` | |
| Anthropic | `ANTHROPIC_API_KEY` | `x-api-key` header |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `?key=` query param |
| NVIDIA | `NVIDIA_API_KEY` | |
| Groq | `GROQ_API_KEY` | |
| Together | `TOGETHER_API_KEY` | |
| DeepSeek | `DEEPSEEK_API_KEY` | |
| Mistral | `MISTRAL_API_KEY` | |
| xAI | `XAI_API_KEY` | |
| Perplexity | `PERPLEXITY_API_KEY` | |
| Cerebras | `CEREBRAS_API_KEY` | |
| DeepInfra | `DEEPINFRA_API_KEY` | |
| OpenRouter | `OPENROUTER_API_KEY` | |
| Azure | `AZURE_API_KEY` | Endpoint + Deployment + API Version |
| Bedrock | `AWS_ACCESS_KEY_ID` | IAM env vars OR API key, env cleanup after build |
| Cohere | `COHERE_API_KEY` | |
| Ollama | `OLLAMA_API_KEY` | Local inference |

Plus `custom` provider with arbitrary baseUrl.

### Auth Error Handling

`isAuthError()` in `middleware.ts` — surfaces 401/403 with clear message mentioning provider + env var, no retry.

### Model Infrastructure

| Module | File | Purpose |
|--------|------|---------|
| Factory | `factory.ts` | Model construction per provider, Bedrock env cleanup |
| Middleware | `middleware.ts` | `wrapModel()` rate limiting Proxy, auth error classifier |
| Selector | `selector.ts` | `selectForTask()` scores by complexity/capabilities/rate-limit |
| Rate Limiter | `rate-limiter.ts` | Sliding window + cooldown |
| Quota Tracker | `quota-tracker.ts` | Provider quota exhaustion tracking |
| Context Manager | `context-manager.ts` | Context window overflow management |
| Token Budget | `token-budget-tracker.ts` | Session-level token budget |
| Schema Sanitizer | `schema-sanitizer.ts` | Provider-compatible JSON Schema |
| Capability | `capability.ts` | Model capability contracts |
| Overflow Handler | `overflow-handler.ts` | Graceful context overflow |
| Message Compactor | `message-compactor.ts` | Message history compaction |
| Context Window Registry | `context-window-registry.ts` | Per-model context window sizes |

---

## MCP & Extensions (`src/extensions/`)

| Module | File | Purpose |
|--------|------|---------|
| MCP Client | `mcp-client.ts` | MCP protocol client (stdio/http/sse) |
| Token Store | `token-store.ts` | OAuth 2.0 token persistence (AES-256-GCM) |
| Resolve Env | `resolve-env.ts` | Environment variable resolution |
| Tool Registry | `tool-registry.ts` | MCP tool discovery + registration |
| Tool Tools | `tool-tools.ts` | Meta-tools for MCP tool management |
| Types | `types.ts` | `McpServerConfig`, `PluginConfig`, `McpAuthConfig` |

MCP supports OAuth 2.0 (RFC 9728) with token refresh + encrypted persistence.

---

## Web UI (`src/app/`, `src/components/`)

Next.js 15 + shadcn/ui. Chat-first UX.

### Pages & Routes

| Route | Purpose |
|-------|---------|
| `/` | Home: chat + graph + status |
| `/api/solve` | SSE streaming solve endpoint |
| `/api/config` | YAML config read/write |
| `/api/config/providers` | Provider list |
| `/api/graph` | Graph query |
| `/api/findings` | Findings list |
| `/api/sessions` | Session management |
| `/api/skills` | Skill listing |
| `/api/workers` | Worker status |

### Components (49)

**Layout**: `chat-stream.tsx`, `chat-input.tsx`, `session-sidebar.tsx`, `status-bar.tsx`, `graph-panel.tsx`

**Activity**: `activity-panel.tsx`, `workers-panel.tsx`, `worker-card.tsx`, `worker-task-card.tsx`, `tool-call-card.tsx`

**Findings**: `finding-card.tsx`

**Settings**: `settings-modal.tsx` + 8 tabs (general, providers, model-tiers, browser, scope-safety, solver, budget, advanced)

**Visual**: `omnitrix-loader.tsx`, `dna-progress.tsx`, `phase-indicator.tsx`, `attack-animation-layer.tsx`, `glyphs.tsx`, `holo-table.tsx`

**UI primitives** (`components/ui/`): alert, badge, button, card, code, combobox, gauge, input, label, list, markdown, progress-bar, scroll-area, separator, skeleton, spinner, stack, table, tabs, theme-provider, tree, tool-approval, tool-call

### Stores (6)

`app-store.ts`, `budget-store.ts`, `chat-store.ts`, `config-store.ts`, `session-store.ts`, `ui-store.ts`

---

## Configuration (`src/config.ts`)

27-field `UltimatrixConfig` type. YAML is source of truth.

```yaml
provider: groq
model: llama3-8b-8192
target: https://example.com
engine: multi-model          # legacy | solver | multi-model | council
creds:
  groq:
    apiKey: gsk_...
modelTiers:
  fast: { provider: groq, model: llama3-8b-8192 }
  balanced: { provider: openai, model: gpt-4o }
  powerful: { provider: anthropic, model: claude-sonnet-4 }
solver:
  maxToolCalls: 50
  maxTokens: 100000
  maxDurationMs: 300000
antiLoop:
  staleThreshold: 3
reflexion:
  persistToGraph: true
scope:
  allowed: ["https://example.com"]
browser:
  headless: true
mcp:
  - name: my-server
    command: node
    args: ["server.js"]
```

---

## CLI Commands

| Command | Description |
|---------|-------------|
| `ultimatrix init` | Interactive provider + config setup wizard |
| `ultimatrix solve -t <url>` | OODA solver engine (always solver) |
| `ultimatrix interact -t <url>` | Terminal REPL (per config.engine) |
| `ultimatrix scan -t <url>` | Full scan: learn + generate + report |
| `ultimatrix learn -t <url>` | Capture traffic, parse HAR |
| `ultimatrix generate -t <url>` | Generate Playwright test cases |
| `ultimatrix replay` | Re-run generated tests |
| `ultimatrix report` | Generate JSON/HTML/Markdown report |
| `ultimatrix web` | Next.js web UI |
| `ultimatrix assess -t <url>` | Full assessment (legacy v6) |
| `ultimatrix verify -a <model> -t <url>` | Re-run findings |
| `ultimatrix models` | List available models |
| `ultimatrix budget` | Token budget dashboard |
| `ultimatrix ratelimit` | Rate limit configuration |
| `ultimatrix tools` | List registered tools |
| `ultimatrix mcp` | MCP server management |

---

## Safety Architecture

### Scope Guard (`src/safety/scope-guard.ts`)

Deny-by-default URL scope enforcement. `isUrlInScope()` checked on every outbound HTTP request and browser navigation.

### Evidence Gate (`src/intelligence/evidence-gate.ts`)

Anti-hallucination: every LLM claim about a finding is cross-checked against the structured evidence ledger. Claims must be backed by recorded tool output with matching typed fields (method, URL, status). No substring scanning.

### Reflexion Engine (`src/intelligence/reflexion.ts`)

Adaptive retry with progressive escalation:
- Classifies failures (WAF, wrong path, bad payload, info needed)
- Tracks per-vuln-type fail count
- After threshold, triggers reflection (switch strategy)
- Escalates payload complexity L0 (raw) → L4 (multi-layer obfuscation)

### Anti-Loop (`src/intelligence/anti-loop.ts`)

Stale/dead-end detection. Tracks path visit counts, detects when the agent is cycling without progress.

### Auth Error Handling

`isAuthError()` classifier in `middleware.ts` — surfaces 401/403 with clear message, no retry. Bedrock env vars cleaned up after model build to prevent cross-provider leaks.

---

## File Layout

```
src/
├── analysis/              # HAR-based business-logic analysis (6 files)
├── app/                   # Next.js 15 pages + API routes (6 + 12 routes)
├── browser/               # Stagehand/Playwright browser management (6)
├── campaign/              # Autonomous coverage planning (7)
├── capture/               # HAR parsing, network capture, render tracing (10)
├── cli/                   # CLI commands (13)
├── components/            # React UI components (23 + 26 ui primitives)
├── compression/           # Headroom compression service (1)
├── config/                # Config schema (1)
├── context/               # Session context reader/writer (3)
├── core/                  # Execution core: types, toolpack, evidence (6)
├── council/               # Parallel debate engine (10 + 8 persona .md)
├── events/                # Event emitter (1)
├── extensions/            # MCP client, plugin system (7)
├── generation/            # Test case generation (4)
├── graph/                 # Knowledge graph: schema, store, tools (6)
├── hooks/                 # React hooks (4)
├── http/                  # HTTP client, session manager (3)
├── intelligence/          # Evidence gate, reflexion, anti-loop, chaining (14)
├── lib/                   # Agent manager, utilities (4)
├── logging/               # Forensic + system logging (2)
├── manager/               # Legacy supervisor agent (2 + tools/)
├── mastra/                # Mastra framework wiring (3)
├── memory/                # Mastra Memory + LibSQL (3)
├── models/                # Provider factory, rate limiting, context mgmt (14)
├── oast/                  # Out-of-band callback server (3)
├── output/                # Chat rendering, compaction (5)
├── patches/               # AI SDK patches (1)
├── payloads/              # Payload store (1)
├── primitives/            # 29 technique primitives + framework (36)
├── prompts/               # Core contract (1)
├── recorder/              # Browser action → Playwright codegen (4)
├── replay/                # Test replay + regression (4)
├── report/                # Report generation (4)
├── research/              # Hypothesis engine, experiments (10)
├── safety/                # Scope guard (1)
├── session/               # Session lifecycle, HAR/CDP capture (3)
├── skills/                # Technique registry (1)
├── solver/                # OODA solver engine (9 + skills/)
├── spider/                # Stagehand crawler (2)
├── stores/                # Zustand UI stores (6)
├── tools/                 # 60+ tools + 9 scanner adapters (31 + adapters/)
├── types/                 # TypeScript declarations (2)
├── ui/                    # UI types (1)
├── usage/                 # Token usage tracker (1)
├── utils/                 # Logger, output guard, stream consumer (3)
├── web/                   # Config bridge, web engine, target manager (3)
├── workers/               # Legacy specialist workers (8 + instructions/)
├── config.ts              # Main config + PROVIDER_INFO
├── config-shared.ts       # Shared config (browser-side)
├── session.ts             # Session runner
├── sdk.ts                 # Programmatic SDK
├── workspace.ts           # Workspace singleton
└── observability.ts       # Pino telemetry

test/                      # 168 test files across 38 directories
skills/                    # 57 skill .md files across 10 domains
```

---

## Test Suite

- **1761 tests** across **169 test files** in **38 directories**
- Zero failures, zero regressions
- Framework: Vitest
- Coverage: graph, primitives, tools, analysis, capture, skills, council, solver, intelligence, browser, CLI, web UI

---

## Build

- **CLI**: tsup → ESM (1.61MB) + CJS (1.63MB) + DTS
- **Web**: Next.js 15 → `.next/`
- **TypeScript**: tsc `--noEmit` — 0 errors
- **ESLint**: 0 errors, 148 warnings (all `no-unused-vars`)
- **Dependencies**: `@mastra/core` ^1.42.0, `playwright` ^1.52.0, `zod` ^4.0.0, `next` ^15.5.19
