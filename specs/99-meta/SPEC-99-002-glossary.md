# SPEC-99-002: Glossary & Conventions

**Status:** ✅ Draft  
**Phase:** Meta  
**Date:** 2026-07-09

---

## Terminology

| Term | Definition |
|------|------------|
| **Agent** | Mastra `Agent` instance with tools, instructions, memory. Brain = strategist; Worker = slice executor. |
| **Attack Path** | Multi-step chain from unauthenticated entry → sensitive asset, using `CHAINS_TO` / `REQUIRES_ROLE` / `PRODUCES` edges. |
| **Blackboard** | Shared fact/intent state-space for OODA solver (REASON phase). Persists across solver turns. |
| **Campaign** | Structured plan: set of **Slices** covering endpoint×param×role×state×technique matrix. |
| **CampaignExecutor** | Runs slices in parallel with budget, scope, rate-limit guards. Emits `SliceOutcome`. |
| **CampaignPlanner** | Reads GraphStore → builds coverage matrix → prioritizes via analyser invariants + hypotheses → emits `CampaignPlan`. |
| **CandidateFinding** | Unverified signal (anomaly, diff, error) awaiting oracle verification. |
| **EdgeType** | Directed relationship between graph nodes (12 types: `HAS_ACTION`, `VALUE_ORIGIN`, `CHAINS_TO`, etc.) |
| **EvidenceGate** | Proof layer: `recordToolOutput()` + `verifyClaim(claim) → {verified, evidence}`. Anti-hallucination. |
| **Finding** | Verified vulnerability with evidence, severity, PoC, remediation. Entered via `writeFinding` (maker/checker). |
| **Hypothesis** | Human or LLM conjecture: "`cartId` from `/cart` flows to `/checkout` — test IDOR". Stored as `HypothesisNode`. |
| **Invariant** | Derived behavioral rule: "balance never increases without deposit". Has oracle spec for primitive verification. |
| **ModelSelector** | Routes `WorkerTask` → `ModelSelection` (tier, provider, modelId) by capability/quota/history/budget. |
| **NodeType** | Graph entity type (11 base + 4 new: `HeaderSemantic`, `AuthScheme`, `Hypothesis`, `OutcomeFeedback`). |
| **OAST** | Out-of-band Application Security Testing server (callbacks for SSRF, XXE, blind XSS, etc.). |
| **OODA Loop** | Observe → Orient → Decide → Act. Solver implements: REASON → EXPLORE → CONCLUDE. |
| **Primitive** | Self-contained technique: `generate(ctx) → AttackStep[]`, `executor(step) → Result`, `oracle(results, gate) → PrimitiveResult`. |
| **ProviderAwareLimiter** | Per-provider rate limiting (RPM, concurrency) with header sync + mismatch detection. |
| **QuotaTracker** | Cumulative token/request tracking per provider; exhaustion detection + cooldown. |
| **ReflexionEngine** | Failure classification (L0-L4), escalation hints, experience extraction for cross-session learning. |
| **SessionLifecycle** | Centralized resource orchestration: config → browser → memory → engine → REPL → cleanup. |
| **Slice** | Unit of campaign work: `{endpoint, params, role, state, techniqueIds, priority}`. Executed independently. |
| **Solver** | OODA engine: single `agent.stream()` per turn; intelligence layers observe passively. |
| **Skill** | Markdown + YAML frontmatter: methodology, triggers, toolRefs, tier hint. 21 skills loaded at startup. |
| **Strategist** | LLM role that emits `CampaignPlan` (not single tool calls) based on graph + blackboard + analyser output. |
| **Technique** | Category of attack: `sqli`, `xss`, `idor`, `race_condition`, `workflow_bypass`, `invariant`, `authz`, `config_trust`. |
| **Tier** | Model capability bucket: `fast` (≤8K ctx), `balanced` (≤32K), `powerful` (>32K). Configured in `modelTiers`. |
| **ValueOrigin** | Graph edge: request parameter/header → prior response field or UI input. Proves data flow. |
| **VerifiedFinding** | Finding that passed EvidenceGate verification + primitive oracle confirmation. |
| **Worker** | Specialized agent spawned per slice with tier-appropriate model + skill-filtered tools. |
| **WorkerTask** | Input to ModelSelector: `{skillId, taskDescription, complexity, requiredCapabilities, graphState}`. |

---

## Spec Conventions

### Spec ID Format
```
SPEC-<PHASE>-<SEQ>
```
- Phase: `00` (Foundation), `01` (Analyser), `02` (Campaign), `03` (Attack Path), `04` (Fleet), `05` (Product), `99` (Meta)
- Sequence: 3-digit zero-padded

### Status Values
- 📋 **Planned** — Not started
- 🔄 **In Progress** — Implementation underway
- ✅ **Implemented** — Code complete, tests passing
- 🧪 **Verified** — Integration tested, documented
- ⚠️ **Blocked** — Dependency not met
- 🔄 **Needs Revision** — Spec changed during implementation

### Dependency Notation
```
Depends On: SPEC-XX-XXX, SPEC-YY-YYY
```
Means: This spec cannot be implemented until listed specs are **✅ Implemented** or **🧪 Verified**.

### File References
- Use relative paths from repo root: `src/models/selector.ts:150`
- Line numbers approximate; search for context

### Acceptance Criteria Format
```
AC-<SPEC>-<N>: <Testable condition>
```
Each spec must have ≥3 acceptance criteria.

### Test Requirements
- Unit tests: `test/<module>/*.test.ts`
- Integration tests: `test/integration/*.test.ts`
- E2E: `test/e2e/*.test.ts` (requires live target)

---

## Phase Definitions

| Phase | Theme | Key Deliverable |
|-------|-------|-----------------|
| **00 - Foundation** | Multi-model correctness, transparency, safety | `interact` works reliably with tiered models |
| **01 - Analyser** | Business-logic understanding (upstream differentiator) | `Analyser` emits `ValueOrigin`, `AuthScheme`, `Invariant` |
| **02 - Campaign** | Autonomous campaign execution | `solve()` rewired to campaign loop |
| **03 - Attack Path** | Multi-step chain planning + verified artifacts | Attack-Path Solver + Case File export |
| **04 - Fleet** | Parallel specialized agents + self-improvement | Agent fleet, continuity, outcome feedback |
| **05 - Product** | Market-ready UX, SDK, remote execution | Web UI parity, SDK, cloud deployment |

---

## Configuration Keys Reference

```yaml
# ultimatrix.yaml (non-secret)
provider: groq
model: llama3-8b-8192
target: https://example.com
engine: multi-model          # legacy | solver | multi-model
modelTiers:                  # REQUIRED for multi-model
  fast:
    provider: groq
    model: llama3-8b-8192
  balanced:
    provider: openai
    model: gpt-4o-mini
  powerful:
    provider: anthropic
    model: claude-3-5-sonnet
solver:
  maxToolCalls: 50
  maxDurationMs: 300000
  maxRounds: 10
  maxParallel: 1
antiLoop:
  staleThreshold: 3
reflexion:
  enabled: true
  maxSameVulnFails: 3
  maxTotalNoProgress: 10
  escalationMaxLevel: 4
campaign:
  auto: true
  maxSlices: 50
  maxConcurrency: 3
scope:
  inScope: ["*.example.com"]
  outOfScope: ["api.payment.com"]
providerRateLimits:
  groq:
    requestsPerMinute: 30
    maxConcurrent: 2
  openai:
    requestsPerMinute: 60
    maxConcurrent: 3
modelCapabilities:
  "groq/llama3-8b-8192":
    contextWindow: 8192
    maxOutputTokens: 8192
    strengths: ["speed", "cost"]
    supportsStreaming: true
    supportsStructuredOutput: true
```

Secrets in `providers.yaml` (gitignored):
```yaml
creds:
  groq:
    apiKey: gsk_xxx
  openai:
    apiKey: sk_xxx
```

---

*Update this glossary when new terms are introduced in specs.*
