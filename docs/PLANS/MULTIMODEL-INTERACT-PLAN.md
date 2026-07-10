# Ultimatrix: Multi-Model Engine + `interact` Improvement Plan

**Audience:** Bug-bounty hunter using Ultimatrix as a co-pilot.
**Scope:** Make the `multi-model` engine functional and make the `interact` REPL a real hunting workflow.
**Status:** Plan (not yet implemented).

---

## 1. How `interact` + multi-model actually work today (verified by code read)

- `ultimatrix interact -t <url>` -> `src/cli/interact.ts` -> `session.main()` -> `SessionLifecycle` -> REPL loop (`src/session/lifecycle.ts`).
- In the REPL (`src/session.ts:44`), **both** `engine: 'solver'` and `engine: 'multi-model'` route through the same `solve()` on the `solverBrain`. The legacy supervisor is used only if `engine: 'legacy'`.
- **The ONLY difference between `solver` and `multi-model` is one tool:** `src/solver/brain-tools.ts:152` adds a `selectModel` tool when `engine === 'multi-model'`. The brain itself always runs on a single `config.model`.
- Multi-model value: brain calls `spawnWorker(tier: 'fast'|'balanced'|'powerful')`; `workerPool.spawn` -> `resolveModel(config, tier)` -> the `modelTiers` config picks the real model. So recon runs on a cheap model, deep exploitation on a powerful one.
- Local `ultimatrix.yaml` already sets `modelTiers` (nvidia), and `validateConfig` (`src/config.ts:557`) checks tier creds. So the plumbing *can* work.

---

## 2. Problems found (focused on `interact` + multi-model)

| # | Problem | Severity | Evidence |
|---|---------|----------|----------|
| 1 | Multi-model is a **silent no-op** without `modelTiers`. Every tier falls back to `config.model` with no warning. | High | `src/models/factory.ts:50` (`tierCfg` optional) |
| 2 | `lifecycle.ts:476` builds the brain **without a `modelSelector`**; a throwaway selector is created in `brain-tools.ts`, so `recordSuccess/recordFailure` never persist -> routing cannot learn across a session. | Medium | `src/session/lifecycle.ts:476`, `src/solver/brain-tools.ts:152` |
| 3 | **No cost/tier transparency** in the REPL. Banner shows one model, not the tier->model map or per-turn spend. | High (bounty) | `src/session/lifecycle.ts:512` |
| 4 | Brain has a **hardcoded ~30-tool set** that omits the scanners, real recon, jwt/graphql introspection, and browser tools. The agent cannot reach the tools it needs. | High | `src/solver/brain-tools.ts` `allTools` |
| 5 | `interact` **defaults to the legacy engine** (known type errors / tech-debt per AGENTS.md), not the maintained solver/multi-model path. | Medium | AGENTS.md, `src/session.ts:44` |

---

## 2b. Architecture decision: FLAT toolset on the brain (not skill-filtered)

**Decision: append the full real toolset directly to the brain. Do NOT gate tools behind the skill matcher.**

Why (verified by reading `src/solver/skills/tool-filter.ts`):
- `resolveToolsForSkills()` is a **keyword/trigger heuristic**: it matches skill `triggers`/description words against your input, takes the top 3 skills, and unions their `toolRefs` with a hardcoded `CORE_TOOLS` list. It can **miss** a needed tool (e.g. `measureTiming` for blind SQLi when no skill triggered) -> silent capability gap.
- `CORE_TOOLS` *already* contains the observation primitives (`measureTiming`, `evaluateRendered`, `compareResponses`, `findEndpointsInResponse`, ...). So the filter adds almost no value while adding a failure mode. (The brain does not even call it today; it uses a separate hardcoded set.)

Consequence for this plan:
- **Skills keep two jobs only:** (a) *methodology guidance* loaded on demand via `loadSkillReference`, and (b) *model-tier routing hints* (a skill marked `tier: powerful` hints the worker tier). They are **never** used to restrict which tools exist.
- The LLM’s native on-demand tool selection (the Mastra agent loop) is the correct mechanism; we just give it the **complete** set.
- Breadth matters for bounty: you routinely pivot SQLi -> IDOR -> SSRF mid-test; a filter that locked you to one skill’s tools would block that.

Honest counter-concern + mitigation:
- A small/fast model (e.g. groq 8b as `config.model`) with ~50 tool schemas may degrade (more tool-choice errors). Mitigations: (1) run the **brain** on balanced/powerful, reserve `fast` for *workers*; (2) keep tool schemas terse; (3) rely on existing Headroom compression + `ContextBudgetManager`; (4) scanners stay *visible* in the set but their *execution* is gated by `config.scanners.autoRun` (legal/scope safety), not their visibility.

---

## 3. Prioritized plan

### P0 - Make `interact` + multi-model correct and the recommended path

**Objective:** Multi-model must actually route models, and `interact` must default to the maintained engine.

| Change | File / Function | Effort | Impact on bounty hunting |
|--------|----------------|--------|---------------------------|
| Default `interact` to solver/multi-model (legacy = opt-in or warned) | `src/cli/interact.ts`, `src/session/lifecycle.ts` `setupEngine` | S | You stop using the type-error-ridden legacy engine by accident; you get the maintained, brain-driven flow immediately. |
| Pass a real `modelSelector` from lifecycle into `createSolverBrain` | `lifecycle.ts:476`, `brain-tools.ts` | S | Routing *learns* which model works for which task across the session (recon cheap, exploitation strong), improving results over time. |
| Hard error if `engine: 'multi-model'` but `modelTiers` empty/missing | `lifecycle.ts` `setupEngine` or `config.validateConfig` | S | Eliminates the silent no-op; you are told exactly why nothing is routing. |

**Total P0 effort: ~0.5 day. Biggest correctness win for the lowest cost.**

---

### P1 - Transparency & cost control (what a bounty hunter needs most)

**Objective:** See what you will pay for, and what you paid, in real time.

| Change | File / Function | Effort | Impact on bounty hunting |
|--------|----------------|--------|---------------------------|
| Print tier->model map in REPL banner (fast/balanced/powerful + provider) | `lifecycle.ts:512` | S | Before typing anything you know which model handles recon vs exploitation -> no surprise bills. |
| Log per-turn token cost + tiers used by spawned workers | `solver.ts` (existing `selectModel`/`spawnWorker` log lines) surfaced via `session.ts` `onPhase` | M | Token budget is the #1 practical limit on autonomous hunting; you can stop before blowing a free tier. |
| Surface `QuotaTracker` exhaustion per provider in REPL | `models/quota-tracker.ts` + `lifecycle.ts` | S | Avoids mid-session 429 surprises that abort a hunt. |

**Total P1 effort: ~1 day. Directly controls the main real-world cost of using the tool.**

---

### P2 - Append the FULL real toolset directly to the brain (no skill gate)

**Objective (revised):** Give the brain every real tool it could need, flat. Remove reliance on `resolveToolsForSkills` as a tool gate. (See section 2b.)

| Change | File / Function | Effort | Impact on bounty hunting |
|--------|----------------|--------|---------------------------|
| Append observation tools to brain `allTools`: `parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse` (note: already in `CORE_TOOLS`; ensure the brain actually includes them) | `src/solver/brain-tools.ts` | M | Unlocks blind SQLi timing, XSS render confirmation, differential analysis, WAF detection - the core exploit primitives. |
| Append scanners `runSqlMap, runFfuf, runNuclei, runNmap` (visible always; *execution* gated by `config.scanners.autoRun: false` for scope/legality) | `brain-tools.ts`; `src/config.ts` `scanners` block | M | Catches what the LLM alone misses (sqlmap/ffuf), but stays opt-in for safety. |
| Append real recon + jwt/graphql: `runRecon` (uncomment `whois`/`dns`), `cloudMetadataProbe`, `frameworkFingerprint`, `jwtDecode`, `graphqlIntrospect`; add passive URL/param collection (wayback/gau, subfinder, arjun) | `src/tools/recon-tools.ts`, new `passive-recon.ts` | M | Recon coverage is the #1 determinant of bounty success; you get endpoints you would never browse to. |
| Append browser/stagehand tools (navigate, act, extract, observe, screenshot) so the agent can test JS-heavy/auth flows directly | `brain-tools.ts` (`wrapStagehandTools`) | S | Modern SPAs + auth flows are where bounties live. |
| **Remove the skill-tool gate:** keep `resolveSkillsForInput`/`resolveToolsForSkills` only as *advisory* (log matched methodology, hint tier) - never to restrict `allTools`. | `brain-tools.ts`, `src/session.ts` | S | Eliminates silent capability gaps; agent can always pivot between vuln classes. |
| Workers also receive the full/generous toolset (not a filtered subset) | `src/workers/pool.ts` `spawn` | S | Spawned tiered workers are not crippled. |

**Total P2 effort: ~2-3 days. Turns the tool from a blind chat into a real tester with full reach.**

---

### P3 - Turn `interact` into a hunting workflow (REPL commands)

**Objective:** Slash-commands that exploit the multi-model routing + full toolset.

| Command | Behavior | File | Effort | Impact |
|---------|----------|------|--------|--------|
| `/hunt <goal\|endpoint>` | Brain auto-observes, calls `selectModel`, spawns tiered workers per matched skill (cheap recon on `fast`, exploitation on `powerful`) | `lifecycle.ts` REPL parser | M | One command drives the whole multi-model payoff: cheap recon, strong exploitation. |
| `/model` | Show / override tier->model mapping for the session | `lifecycle.ts` | S | Adapt on the fly if a tier model is rate-limited or weak. |
| `/cost` | Token spend + provider quota status | `lifecycle.ts` | S | Instant budget check. |
| `/scope <hosts>` | Set in-scope hosts; solver refuses out-of-scope requests | `config.ts` + `solver.ts`/`http-tools.ts` | M | Legal safety - non-negotiable for bounty. |
| `/verify` | Re-run `verifyPendingFindings` with **real payload replay** (not just 2xx) | `src/tools/control-tools.ts` | M | Stops false "verified" findings; only real PoCs survive. |
| `/report` | Emit submission-ready Markdown (curl PoC + evidence + impact) | `src/tools/report-tools.ts` | M | The difference between "I think I found something" and a paid report. |

**Total P3 effort: ~2-3 days. Makes `interact` a purpose-built bounty console.**

---

### P4 - Scope & safety guardrails

| Change | File | Effort | Impact |
|--------|------|--------|--------|
| `config.scope = { inScope, outOfScope }` enforced before any external request | `solver.ts` / `http-tools.ts` | M | Prevents accidental testing of out-of-scope assets (program ban / legal risk). |
| Per-host rate limiting (reuse `rateLimit` config, enforce per-host) | `models/limiter-factory.ts` | M | Avoids IP ban mid-engagement. |

**Total P4 effort: ~1 day. Keeps you on the target and out of trouble.**

---

## 4. Suggested implementation order

1. **P0** (functional + recommended path) - ~0.5d
2. **P1** (transparency/cost) - ~1d
3. **P2** (flat full toolset on brain) - ~2-3d
4. **P3** (REPL hunting workflow) - ~2-3d
5. **P4** (scope/safety) - ~1d

Recommended first deliverable to prove value: **P0 + the banner part of P1 + the brain tool-append from P2**.

---

## 5. Acceptance criteria

1. `ultimatrix interact -t <url>` with `engine: multi-model` + `modelTiers` shows the tier->model map in the banner and **errors clearly** if tiers are missing.
2. The brain agent has direct access to observation, scanner, recon, jwt/graphql, browser, OAST, graph, and skill tools - no skill-based filtering restricts availability.
3. Typing a goal routes recon to `fast` and exploitation to `powerful`; the REPL prints per-turn token cost + tiers used.
4. `/hunt` reproduces SQLi (incl. blind via `measureTiming`), XSS (`evaluateRendered`), and IDOR using the full toolset + tiered workers.
5. `/scope` prevents any out-of-scope request; `/cost` reflects real spend; `/report` emits a curl-PoC report.

---

## 6. Honest caveats

- This remains **LLM-driven** - a co-pilot, not a replacement for your methodology. Multi-model mainly (a) saves money (cheap model for boring recon) and (b) improves exploitation quality (powerful model where it counts).
- The legacy engine has known type errors - that is exactly why prioritizing multi-model (solver-based) is the right call.
- Do not trust severity ratings blindly; you still grade impact yourself.
- Giving the brain ~50 tools assumes a capable (balanced/powerful) brain model; if you point `config.model` at a tiny 8B model, expect more tool-choice errors - keep the brain on a stronger model and use `fast` only for spawned workers.
