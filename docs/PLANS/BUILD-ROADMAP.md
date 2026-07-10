# Build Roadmap — Phases & Tasks (start building)

Companion to `ARCHITECTURE-DIAGRAMS.md` (A-W) and `RND-MARKET-AND-ARCHITECTURE.md`.
This is the actionable plan: phases, tasks, files to touch, and acceptance. Built on the collaborative-colleague + business-logic-analyser architecture we designed.

---

## Architecture principles (what we are building toward)

1. **Collaborative, not one-shot.** Human (observer/learner, maybe beginner) + LLM colleague. Graph = shared notebook both write to.
2. **Analyser is upstream.** Business-Logic Analyser correlates UI->API->DOM + custom headers + value provenance + auth decode/reuse into use-case + invariant model. It feeds everything.
3. **Oracles prove, LLM hypothesizes.** Deterministic invariant oracles + Evidence Gate = verified findings; LLM strategizes and writes oracles.
4. **Governance first.** Scope, rate-limit, sandbox, audit enforced for any autonomous run.

---

## Architecture changes (schema + modules)

**Graph schema additions** (`src/graph/schema.ts`):
- `HeaderSemantic` node (header -> role: identity/required/static/anti-bot/correlation).
- `ValueOrigin` EDGE (request param/header -> prior response field or UI input).
- `AuthScheme` node (scheme: basic/base64/jwt/custom; decoded?; reusedAcross: [endpoints]).
- `EndpointNode.useCase` (inferred purpose), `EndpointNode.preconditions`.
- `Hypothesis` node (origin: human|llm; status: open/verified/disproven).
- `FactNode` enriched as derived **invariant** (with oracle spec).

**New modules:**
- `src/analysis/analyser.ts` (correlate UI/API/DOM/headers/auth -> use-case + invariants).
- `src/campaign/planner.ts`, `src/campaign/executor.ts` (matrix + parallel run).
- `src/primitives/*` (technique primitives with generator + oracle).
- `src/solver/attack-path.ts` (graph traversal unauth->sensitive).
- `src/report/case-file.ts` (verified finding artifact).

**Touched modules:** `src/session/lifecycle.ts`, `src/solver/brain-tools.ts`, `src/solver/solver.ts`, `src/tools/control-tools.ts` (Evidence Gate), `src/analysis/har-bridge.ts`, `src/capture/human-observer.ts`, `src/browser/reaction-observer.ts`, `src/tools/encode-decode.ts`, `src/models/selector.ts`, `src/config.ts`.

---

## Phase 0 — Foundations (make the base correct + capable)

*Necessary plumbing, NOT the differentiator. Keep minimal; do not over-invest here.*

| Task | Files | Acceptance |
|------|-------|-------------|
| T0.1 Multi-model correctness: pass `modelSelector` from lifecycle into `createSolverBrain`; hard-error if `engine: multi-model` but `modelTiers` empty; default `interact` to solver/multi-model | `src/session/lifecycle.ts:476`, `src/solver/brain-tools.ts`, `src/config.ts` | `interact` uses maintained engine; clear error when tiers missing. |
| T0.2 Transparency: REPL banner shows tier->model map + per-turn token cost + quota status | `src/session/lifecycle.ts:512`, `src/solver/solver.ts` (selectModel/spawnWorker logs), `src/models/quota-tracker.ts` | Banner + per-turn cost visible. |
| T0.3 Flat full toolset on brain (drop skill gate): append observation + scanners + recon + jwt/graphql + browser tools | `src/solver/brain-tools.ts`, `src/solver/skills/tool-filter.ts` (keep as advisory only), `src/workers/pool.ts` | Brain + workers have all real tools; skills no longer restrict availability. |
| T0.4 Strengthen Evidence Gate as proof layer | `src/tools/control-tools.ts`, `src/intelligence/evidence-gate.ts` | Findings require receipt (request/response/state), not opinion. |

---

## Phase 1 — Business-Logic Analyser (THE differentiator, upstream)

*Highest leverage. Builds on existing seams; improves the LLM colleague even before autonomy.*

| Task | Files | Acceptance |
|------|-------|-------------|
| T1.1 Value-provenance graph: extend `getDataFlows` to full param/header -> prior response field / UI input; emit `ValueOrigin` edges | `src/capture/har-parser.ts`, `src/analysis/har-bridge.ts`, `src/graph/schema.ts` | Each request param traced to its origin; provenance queryable. |
| T1.2 Custom-header classifier: from HAR, classify headers (identity/required/static/anti-bot/correlation); emit `HeaderSemantic` nodes | `src/analysis/analyser.ts`, `src/analysis/har-bridge.ts` | Required identity headers flagged; bypass candidates surfaced. |
| T1.3 Auth decode + reuse: reuse `encodeDecode` (base64/jwt); detect scheme; flag same cred across endpoints (`AuthScheme.reusedAcross`); mask creds | `src/tools/encode-decode.ts`, `src/analysis/analyser.ts` | Decoded auth correlated across APIs; reuse surface flagged, creds masked. |
| T1.4 Use-case + invariant derivation: correlate human-observer action -> HAR API -> reaction-observer DOM effect -> infer `EndpointNode.useCase` + `FactNode` invariants; hook into `bridgeHARToGraph` | `src/capture/human-observer.ts`, `src/browser/reaction-observer.ts`, `src/analysis/har-bridge.ts`, `src/analysis/analyser.ts` | Endpoints get use-case + derived invariants in graph. |
| T1.5 Human Observation Ingest + verify-path: spoken lead -> `Hypothesis`(origin human) -> verify-path; observed `FlowGroup` -> Endpoint/AuthFlow/Fact nodes (fix wiring gap, Diagrams M/N) | `src/session.ts` (REPL), `src/tools/flow-tools.ts`, `src/analysis/analyser.ts` | Human lead becomes a verify task; observed actions seed graph as first-class facts. |

**Phase 1 exit:** graph contains real business-logic understanding (use cases, invariants, provenance, auth reuse). The LLM colleague reasons dramatically better today.

---

## Phase 2 — Campaign Engine + Invariant Oracles (autonomy begins)

| Task | Files | Acceptance |
|------|-------|-------------|
| T2.1 Technique-primitive framework: interface (generator + oracle + tooling) | `src/primitives/framework.ts` | Primitives are code, not LLM prose. |
| T2.2 Flagship primitives: `invariantProbe`, `workflowBypass`, `concurrencyHarness` (FIRST CLASS), `authzMatrix`, `configTrust`, `idorSwapper`, `ssrfOast`; classic SQLi/XSS as fallback | `src/primitives/*`, `src/tools/observation-tools.ts` (oracles) | Each returns confirmed/unconfirmed + evidence. |
| T2.3 Campaign Planner: matrix from graph (endpoint x param x role x state x technique), prioritize via analyser invariants + human hypotheses, dedupe | `src/campaign/planner.ts` | Coverage matrix generated, not ad-hoc. |
| T2.4 Executor: parallel slices, rate-limit, scope guard, budget cap | `src/campaign/executor.ts`, `src/models/limiter-factory.ts`, `src/config.ts` (scope) | Runs to budget/scope; safe. |
| T2.5 Evidence Gate inside primitives -> confirmed/unconfirmed | `src/tools/control-tools.ts` | Only receipt-backed findings enter graph. |
| T2.6 Rewire `solve()` to dispatch campaigns (strategist emits campaigns, not single tool calls) | `src/solver/solver.ts` | Autonomous campaign execution. |

**Phase 2 exit (Tier1 parity):** autonomous finder of logic/authz/race flaws with proof.

---

## Phase 3 — Attack-Path Solver + Verified Case File (differentiate)

| Task | Files | Acceptance |
|------|-------|-------------|
| T3.1 Attack-Path Solver: graph traversal planning unauth->sensitive using REQUIRES_ROLE/PRODUCES/CHAINS_TO edges; propose multi-step chains | `src/solver/attack-path.ts`, `src/graph/schema.ts` | Chains planned, not just found post-hoc. |
| T3.2 Verified Case File: forensic log + Evidence Gate -> path + working exploit (curl/Playwright) + decision log + remediation | `src/logging/forensic-log.ts`, `src/report/case-file.ts` | Submission-ready artifact per finding. |
| T3.3 AI-agent red-team probes: prompt-injection -> tool/function abuse via browser + OAST + `ai-mcp-security` skill | `src/primitives/ai-trust.ts`, `src/oast/tools.ts`, `skills/ai-mcp-security.md` | Targets its own AI features (2026 blue ocean). |
| T3.4 Chain verification: confirm composed low-sev -> critical | `src/intelligence/chaining.ts` + Evidence Gate | Chains proven, not asserted. |

**Phase 3 exit (differentiate):** plans paths, proves chains, tests AI boundaries, emits case files.

---

## Phase 4 — Fleet + Self-Improvement (moat)

| Task | Files | Acceptance |
|------|-------|-------------|
| T4.1 Agent fleet in sandboxes: specialized agents per technique/role/tenant; slice-level multi-model fan-out | `src/workers/pool.ts`, `src/models/selector.ts` (slice routing) | Parallel fleets, right model per slice. |
| T4.2 Continuity: retest on change, backlog management | `src/campaign/*`, `src/graph/store.ts` | Re-tests on app change. |
| T4.3 Outcome-feedback loop: was report accepted? did fix hold on retest? -> Reflexion + technique library | `src/intelligence/reflexion.ts` | Agent improves across engagement. |
| T4.4 (optional) Cross-engagement pattern memory (privacy-preserving) | `src/intelligence/*` | Learns across targets. |

**Phase 4 exit (moat):** self-improving, scaled, continuous.

---

## Dependency order

```
Phase 0 (foundation)
   |
   v
Phase 1 (Analyser)  <-- highest leverage, feeds everything
   |
   v
Phase 2 (Campaign + Oracles)  <-- autonomy begins
   |
   v
Phase 3 (Attack-Path + Case File + AI red team)
   |
   v
Phase 4 (Fleet + Self-improvement)
```

Phase 1 can start after only T0.1-T0.3 (minimal foundation). Do NOT build Phase 2 autonomy on a graph that lacks business-logic understanding.

---

## Recommended first build (this week)

1. **T0.1 + T0.3** (engine correct + brain has all tools) - unblocks everything.
2. **T1.1 + T1.4 + T1.5** (value-provenance + use-case/invariant + human-ingest) - the analyser core; immediately makes the colleague smarter and fixes the wiring gap you felt.
3. Then **T2.1-T2.3** (primitive framework + planner) to turn understanding into autonomous campaigns.

This sequence delivers value at every step and never builds autonomy on a blind base.
