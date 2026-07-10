# Making Ultimatrix LETHAL — The Actual Fix (not bandaids)

**Honest preface:** The previous `MULTIMODEL-INTERACT-PLAN.md` (P0-P4) was bandaids - it kept the broken core and bolted on tools/config/commands. This document is the real re-architecture. **Correction (v2):** the first cut of this plan still centered on *autonomous basic attacks* (SQLi/XSS/IDOR). Modern apps are *not* mostly prone to those. The threat model below reframes the whole thing around what actually pays today.

---

## 1. The core flaw (why it is not lethal today)

Today `solve()` = a single LLM that, per turn, crafts a payload, sends one HTTP request, reads the response, and judges - including timing arithmetic and diffing - all inside the LLM loop. Worst division of labor: the LLM is slow/expensive/unreliable at precise payloads and timing math, and it tests one (endpoint, param, technique) at a time, serially, while thinking. Coverage is bounded by affordable turns; confirmation is soft ("I suspect").

---

## 2. Modern threat model — are apps prone to basic attacks?

**Honest answer: decreasingly.**
- Frameworks (React/Next, Django, Rails, Spring) escape output and parameterize queries by default.
- WAFs + every program’s own scanner catch classic payloads.
- The low-hanging SQLi/XSS is largely picked.

**Where bounty value actually is in 2024-2026:**
1. **Business logic flaws** - price/quantity tampering, workflow bypass, negative values, cart/balance manipulation, referral/invite abuse.
2. **Authorization at scale (BOLA/BFLA)** - not a single ID swap, but *systematic* object/function access across roles, tenants, and undocumented endpoints.
3. **Concurrency / TOCTOU (race conditions)** - the most under-tested, high-impact class; the "race" harness was the one non-basic thing and it was underweighted.
4. **State-machine / workflow violations** - skipping steps, replaying, reusing tokens, reopening completed orders.
5. **Config & trust-boundary leaks** - open storage, verbose errors leaking internals, CORS/CSP misconfig, exposed `.git`/env, JWT alg confusion, GraphQL introspection/batching/field-level authz.
6. **AI/agent trust boundaries (the 2025+ frontier)** - prompt injection that makes an agent call an unintended tool / exfiltrate via its own tools, RAG data leak, function-calling abuse. Ultimatrix already ships an `ai-mcp-security` skill + OAST + browser - this is a real differentiator.
7. **Chaining low-sev into critical** - the graph already has `detectChains`; composing N minors to break an invariant is where payouts live.

So the engine must target *logic, authz-at-scale, concurrency, config/trust-boundary, and AI-integration* - not re-run sqlmap.

---

## 3. Thesis: what "lethal" actually means

> **An LLM strategist that commands a deterministic engine which models the app’s state, trust boundaries, and invariants - then systematically probes transitions and concurrency to *break* those invariants, at scale, within budget and scope.**

The LLM hypothesizes (business logic, chains, creative pivots, reading JS/AI behavior). The engine *proves* by violating invariants deterministically. Classic injection becomes a minor, fallback primitive - not the centerpiece.

---

## 4. The actual fix: Invariant/State-Violation Campaign Engine

### 4.1 Primitives = invariant oracles, not payload matchers

Generalize from "send payload X, match string Y" to "**violate invariant I via transition T, observe state**." A primitive declares: the app state it reads, the invariant that must hold, and how to attempt a violation.

Flagship primitives (modern-first):
- `invariantProbe` (generic) - given an invariant (e.g. "balance never increases without a deposit"), drive transitions to break it.
- `workflowBypass` - reorder/skip/replay state-machine steps; detect illegal transitions.
- `concurrencyHarness` (FIRST CLASS) - fire N parallel requests; detect TOCTOU/race on state (cart, balance, OTP, coupon).
- `authzMatrix` - systematically test every endpoint/action across roles + tenants (BOLA/BFLA at scale), incl. undocumented endpoints from the graph.
- `aiTrustBoundary` - prompt-injection probes that check whether the agent calls an unintended tool / exfiltrates via its own tools / leaks RAG context (uses OAST + browser).
- `configTrust` - CORS/CSP/open-storage/verbose-error/`.git`/JWT-alg/GraphQL-introspection & batching.
- `chainProbe` - compose existing low-sev findings to break a higher invariant.
- *Classic (fallback, not centerpiece):* `blindSQLiExtractor`, `xssPolyglot` (DOM oracle), `idorSwapper`, `ssrfOast` - kept because legacy/internal/API endpoints still pay occasionally.

### 4.2 Campaign planner over state x transitions

Given `graph(endpoints x params x roles x states)`, the LLM emits campaigns of (transition, invariant, technique). Engine executes in parallel, rate-limited, scoped, deduped. Coverage = every meaningful transition probed, not a few endpoints remembered.

### 4.3 Oracle-verified findings

Each primitive returns `confirmed | unconfirmed` with evidence (state before/after, request/response, timing, rendered DOM). `EvidenceGate` lives *inside* the primitive. Kills false positives - the #1 time-waster.

### 4.4 Multi-model as fan-out

Route **campaign slices** across tiers in parallel: discovery -> fast; deep logic/extraction -> powerful; concurrency slices -> many fast parallel calls.

### 4.5 Closure loop

Confirmed invariant breaks -> LLM reasons about chains/business logic -> new campaigns. Graph compounds.

---

## 5. Why this is lethal (impact)

| Capability | Basic-attack bot | Invariant/state engine |
|-----------|-----------------|--------------------------|
| What it finds | SQLi/XSS (mostly picked) | Logic, authz-at-scale, race, AI-boundary, chains |
| Coverage | A few endpoints | Every transition x role x state |
| Reliability | LLM "I suspect" | Deterministic invariant oracle |
| Speed/cost | Serially think+send | Computers probe; LLM strategizes |
| Reproducibility | Loose note | Stored PoC per invariant break |

Net: it hunts where the money is, with proof, cheaply.

---

## 6. Honest limits

- Needs solid recon (endpoints, params, roles, states) - spider/HAR must be reliable.
- **Deepest logic flaws still need human intuition.** The LLM hypothesizes; the engine proves. Accelerates, does not replace, the hunter.
- Compute/time budget on huge targets - campaigns must be prioritized.
- Scope guards mandatory; concurrency testing can be disruptive - gate it.

---

## 7. Build order (modern-first)

1. **A. Invariant/state model + primitive framework** + `invariantProbe`, `workflowBypass`, `concurrencyHarness` (the under-tested, high-value core).
2. **B. `authzMatrix` + `configTrust`** (systematic, scales to every endpoint/role/tenant).
3. **C. Campaign planner/executor** (parallel, budgeted, scoped, deduped).
4. **D. Strategist LLM emits campaigns**; rewire `solve()` to dispatch them.
5. **E. `aiTrustBoundary`** (2025 frontier; uses existing OAST + browser + `ai-mcp-security` skill).
6. **F. `EvidenceGate` inside primitives; `chainProbe` for low-sev composition.**
7. **G. Multi-model fans out slices.**

Classic SQLi/XSS/IDOR primitives are added as *fallback* late, not as the headline.

---

## 8. What to stop doing

- Stop treating "wire tool X into the brain" as progress.
- Stop framing the differentiator as "autonomous sqlmap/ffuf." Those catch what is already picked.
- Stop validating config as if correctness lived in YAML. Correctness lives in the invariant oracle.
- Stop assuming more LLM reasoning = more findings. The lever is *systematic state/invariant probing at scale*, not smarter prose.
