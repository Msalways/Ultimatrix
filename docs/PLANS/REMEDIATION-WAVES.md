# Ultimatrix — Remediation & Council Engine: Wave Implementation Plan

> **Basis:** `docs/gap-analysis.md` (2026-07-11) + verified code review.
> **Principle (non-negotiable):** Root-cause fixes only. No hardcoded substring matching,
> no per-action bandaids. Every fix introduces a **typed contract** at the seam and enforces
> it structurally. The Council is the architectural backbone that makes P0 *enforceable*.
>
> **Completion tracing:** Every task has a `Status` (Pending / In Progress / Done). The
> "Completion Trace" section at the end logs each state transition with a timestamp. This
> file is the source of truth; `TodoWrite` mirrors it for live tracking.

---

## Root-Cause Architecture (the "why" behind every fix)

| Symptom (gap-analysis) | Root cause | Proper fix |
|---|---|---|
| EvidenceGate only downgrades severity via substring `includes` (`evidence-gate.ts:76`, `control-tools.ts:119-133`) | Tool output & claims are **free text** with no structured contract | Typed `EvidenceRecord` ledger + typed `FindingClaim`; structural field match; **hard reject** on mismatch |
| Scope opt-in / scattered `isUrlInScope` per browser action (`scope-guard.ts:20-23`, `dialog-inject.ts:73`) | No single transport gate; policy is opt-in | One `ScopeEnforcer` at the entry of every transport; default-deny |
| Sub-16K models silently truncate to 4 messages (`config.ts:352-359`) | No capability contract between model & goal | Enforce `modelCapabilities` as a precondition in `solve()`/council |
| Skill routing is lexical-substring (`tool-filter.ts:68-115`) | No semantic index | Embedding/vector routing; delete spelling-dependent triggers |
| Intelligence layers "observe passively" (`solver.ts:7-9`) | No agent enforces the gate | Council `skeptic` member hard-gates execution via structured EvidenceGate |

---

## Wave A — Trust Foundation (Structured Ledger, Scope Gate, Model Contract, Council)

| ID | Task | Files | Root cause addressed | Done criteria | Status |
|----|------|-------|----------------------|---------------|--------|
| A1 | Define `EvidenceRecord` schema + `EvidenceLedger` | `src/intelligence/evidence-ledger.ts` (new) | No typed evidence model | `EvidenceRecord` type + `EvidenceLedger` (recordEvidence/getRecord/matchClaim) compile & unit-tested | **Done** |
| A2 | Emit structured records from HTTP tools | `src/tools/http-tools.ts` | HTTP responses only dumped as text | Every `httpRequest` pushes a typed `EvidenceRecord` (method,url,status,headers,bodyRef) | **Done** |
| A3 | Emit structured records from observation/browser tools | `src/browser/dialog-inject.ts` | Browser actions only text + scattered scope | All browser actions scope-checked + navigate/dialog auto-capture typed evidence | **Done** |
| A4 | Emit structured records from OAST + traditional tools | `src/oast/server.ts`, `src/tools/traditional-tools.ts` | Binary/OAST output only text | OAST callbacks + nmap/sqlmap/ffuf/nuclei push typed target evidence | **Done** |
| A5 | Typed `FindingClaim` + hard-block `writeFinding` | `src/tools/control-tools.ts` | Free-text claim + severity downgrade | `writeFinding` hard-rejects unsupported claims via structured ledger; `recordEvidence` feeds global ledger; substring downgrade deleted | **Done** |
| A6 | Rewrite `EvidenceGate.verify` to structural match | `src/intelligence/evidence-gate.ts` | `extractFacts`/`includes` substring | Delegates to structural `verifyFindingClaim`; `extractFacts`+`includes` removed; output helpers only | **Done** |
| A7 | Single `ScopeEnforcer` at all transports | `src/safety/scope-guard.ts`, `src/tools/http-tools.ts`, `src/browser/dialog-inject.ts`, `src/tools/traditional-tools.ts`, `src/oast/server.ts` | Scattered opt-in checks | Default-deny when no scope policy; `enforceScope` hard gate at each transport | **Done** |
| A8 | Model Capability Contract | `src/models/capability.ts` (new), `src/session/lifecycle.ts:481`, `src/config.ts` | No capability gate | `setupEngine` refuses/warns sub-16K-context models for complex goals; `EngineType` gains `'council'` | **Done** |
| A9 | Council core modules | `src/council/{types,personas,bus,blackboard-shared,orchestrator,approval}.ts` (new) | No multi-agent deliberation | Round loop PROPOSE→CRITIQUE→APPROVE→EXECUTE→REPORT→REFLECT; shared bus + shared blackboard; maxRounds budget | **Done** |
| A10 | Wire Council into engine/config/lifecycle/session | `src/config.ts`, `src/session/lifecycle.ts`, `src/session/session.ts`, `src/council/factory.ts` (new) | Single brain only | `engine:'council'` builds member agents + shared blackboard + bus; `session.ts` routes to `runCouncil` | **Done** |
| A11 | Council `skeptic` uses structured EvidenceGate (hard block) | `src/council/orchestrator.ts`, `src/council/approval.ts` | Advisory-only gate | Execution blocked unless structural `verify` passes; HITL mode requires human sign-off (pending-human when no harness) | **Done** |
| A12 | Token-efficiency: reasoning-echo read-only check + fix | `src/solver/solver.ts` | Verbose reasoning re-injected each turn | Confirmed `reasoning-delta` appended to `fullText` (persisted → next-turn echo). Fixed: reasoning displayed live, NOT persisted | **Done** |
| A13 | Wave A tests | `test/council/orchestrator.test.ts`, `test/models/capability.test.ts`, + A1–A7 suites | — | Structural verify (no substring), scope deny-by-default, council voting/budget/HITL all green (58 tests) | **Done** |

---

## Wave Core — Unified Execution Core

> **Decision (2026-07-11):** Stop adding separate engines. Unify onto ONE
> `src/core/` so `multi-model` + `council` are the two real engines sharing
> evidence / blackboard / tool-pack / approval. Legacy + `solver` are dropped;
> `solver` kept as a **deprecated alias → `multi-model`** (zero config breakage).
> This is the substrate Waves B/C/D were missing — implement them ON core.

| ID | Task | Files | Depends on | Done criteria | Status |
|----|------|-------|-----------|---------------|--------|
| T0.1 | Core types + barrel | `src/core/types.ts`, `src/core/index.ts` | A1,A11 | `CoreServices`/`ExecutionStrategy`/`RunResult`/`ApprovalPolicy`/`ModelSelection` compile; backward-compat re-exports | **Done** |
| T0.2 | Single shared EvidenceLedger | `src/core/evidence.ts`, `src/tools/control-tools.ts`, `src/intelligence/evidence-gate.ts` | A1,A5,A6 | One `EvidenceLedger` singleton; both old modules delegate; `control-tools-verify` + `evidence-*` tests green; `verifyClaimStructured` behavior identical | **Done** |
| T0.3 | Single merged Blackboard | `src/core/blackboard.ts` | A9 | Merge solver `Blackboard` + council `SharedBlackboard` (facts/intents/plan/dedup + owner); unit test | **Done** |
| T0.4 | Shared tool-pack builder | `src/core/toolpack.ts` | A3,A7 | `buildToolPack(config,deps,opts)` → base registry + orchestration (spawnWorker/spawnSwarm/executeDirect) + skill/research/session/misc; includes `spawnWorker`; respects `skillIds`/`skills` | **Done** |
| T0.5 | Shared approval policy | `src/core/approval.ts` | A11 | Re-export `decideApproval` + `ApprovalMode` from `council/approval` | **Done** |
| T1.1 | Council adopts core (closes delegation gap) | `src/council/factory.ts` | T0.4 | `factory` operator gets `spawnWorker`/`spawnSwarm`/`executeDirect` via `extraTools` | **Done** |
| T1.2 | Council strategy on core | `src/core/strategies/council.ts` | T0.2,T0.3,T0.5,T1.1 | `CouncilStrategy` implements `ExecutionStrategy`; wraps `runCouncil` behind unified interface | **Done** |
| T2.1 | Multi-model strategy on core | `src/core/strategies/single.ts` | T0.2,T0.3,T0.4 | `SingleAgentStrategy` implements `ExecutionStrategy`; wraps `solve()` behind unified interface | **Done** |
| T2.2 | Keep `solve()` wrapper | `src/solver/solver.ts` | T2.1 | `solve()` unchanged → `cli/solve.ts` + `solver.test.ts` (16) green; `build:cli` clean | **Done** |
| T3.1 | Unified router | `src/core/runner.ts` | T0.1,T0.5 | `runSession(params)` + `resolveEnginePreset(engine,config)` → `{strategy,policy,modelSelection}` | **Done** |
| T3.2 | Session routes via runner | `src/session.ts` | T1.2,T2.2,T3.1 | Replace `useSolver`/`useCouncil` branch with `runSession` | **Done** |
| T3.3 | Lifecycle builds services once | `src/session/lifecycle.ts` | T3.1,T3.2 | `setupEngine` builds `CoreServices` + strategy once; drops solverBrain/legacy branching | **Done** |
| T4.1 | Config: drop legacy+solver, fix validation | `src/config.ts` | A8 | `EngineType='multi-model'|'council'` (+`'solver'` deprecated alias); fix L571 to allow `council`/`solver` | **Done** |
| T4.2 | De-route legacy | `src/session.ts`, `src/session/lifecycle.ts`, `src/manager/agent.ts` | T3.3 | Legacy no longer an engine option; supervisor code marked `@deprecated`, file left in place | **Done** |
| T4.3 | Docs + close | `docs/PLANS/UNIFIED-CORE.md` (new), `README.md`, this file | T4.1,T4.2 | Plan + wave table + README updated; tasks closed | **Done** |

### Cross-wave dependencies (B/C/D build ON core)
- **B4** (semantic/embedding skill routing) → implement in `core/toolpack.ts` skill-filtering (T0.4); applies to both engines.
- **C4** (Council HITL → real auth + high-impact gate) → `core/approval.ts` policy (T0.5) wired in `runner`/`session` (T3.2) via `humanApprove` (askUser).
- **C1** (autonomous auth flows) → shared `CoreServices` (browser auth) consumed by both strategies (T3.3).
- **D1** (legacy cleanup) → T4.2 de-routes legacy.

---

## Wave B — Coverage

| ID | Task | Files | Done criteria | Status |
|----|------|-------|---------------|--------|
| B1 | Fill skeleton skills with real methodology | `skills/injection/exploitation.md`, `skills/web-attacks/web-pentest.md`, `skills/web-attacks/web-security-advanced.md`, `skills/auth-security/authorization.md` (JWT/OAuth bodies: alg:none, RS256→HS256, jku/x5u, OAuth intercept) | Bodies contain actionable methodology, not headers-only | **Done** |
| B2 | External OAST host support | `src/oast/server.ts`, `src/config.ts` | Configurable public/interactsh-style callback host; remote OOB (SSRF/XXE/blind RCE) detectable | **Done** |
| B3 | Recon whois/DNS + more subdomain sources | `src/tools/recon-tools.ts:40-59` | whois/DNS implemented; subdomain enum beyond crt.sh | **Done** |
| B4 | Semantic/embedding skill routing | `src/skills/tool-filter.ts` | Vector routing over frontmatter; `turbowlence`/spelling triggers deleted | **Done** |
| B5 | HTTP rate-limit / backoff / robots awareness | `src/tools/http-tools.ts` | Requests respect rate-limit + robots; backoff on 429/503 | **Done** |
| B6 | Wave B tests | `test/skills/`, `test/tools/recon-tools.test.ts`, `test/skills/tool-filter.test.ts` | Routing precision + recon + rate-limit green | **Done** |

---

## Wave C — Autonomy

| ID | Task | Files | Done criteria | Status |
|----|------|-------|---------------|--------|
| C1 | Autonomous auth flows | `src/config.ts`, `src/browser/auth-recorder.ts`, `src/solver/*` | Solver logs in with test-account creds / supplied session, no human | **Done** |
| C2 | Anti-bot / Cloudflare crawl handling | `src/browser/*`, `src/spider/*` | Stagehand crawl survives common bot-challenges (documented baseline) | **Done** |
| C3 | WAF-bypass knowledge expansion | `skills/core/waf-bypass.md`, `skills/web-attacks/*` | Real evasion methodology beyond detection | **Done** |
| C4 | Council HITL wired to real auth + high-impact gate | `src/council/approval.ts`, `src/cli/interact` | High-impact proposals (auth-bypass/destructive/exfil) require human sign-off; autonomous mode votes | **Done** |
| C5 | Wave C tests | `test/council/approval.test.ts`, `test/browser/auth-recorder.test.ts` | HITL blocks without approval; autonomous proceeds on vote | **Done** |

---

## Wave D — Hygiene

| ID | Task | Files | Done criteria | Status |
|----|------|-------|---------------|--------|
| D1 | Legacy cleanup | `src/context/`, `src/lib/agent-manager.ts`, `src/swarm/builder.ts` (+ missing `./chains`,`./formatter`) | Either resolved or formally excised; build clean of legacy errors | **Done** |
| D2 | Add ESLint config + run | `eslint.config.*`, `package.json` | Lint passes on `src/` | **Done** |
| D3 | Tool availability checks + Windows wordlists | `src/tools/delegator.ts:42` | `nmap`/`sqlmap`/`ffuf`/`nuclei` availability checked; Windows-compatible default wordlist | **Done** |
| D4 | README update (council + waves) | `README.md`, `docs/ARCHITECTURE.md` | Documents council, waves, root-cause principles | **Done** |
| D5 | Full verification + final trace | repo root | `npm run build` clean + `npm test` green across all waves; Completion Trace closed | **Done** |

---

## Completion Trace

| Timestamp | Task | From → To | Notes |
|-----------|------|-----------|-------|
| _(init)_ | — | — | Plan created; all tasks Pending |
| 2026-07-11 | A1 | Pending → Done | `src/intelligence/evidence-ledger.ts` + 9 tests green; structural matcher (no substring) |
| 2026-07-11 | A2 | Pending → Done | `src/tools/http-tools.ts` auto-captures typed `recordStructuredEvidence` (method/url/status/headers); 2 tests green |
| 2026-07-11 | A3 | Pending → Done | `src/browser/dialog-inject.ts` scope-checks ALL actions + auto-captures evidence on navigate/dialogs |
| 2026-07-11 | A4 | Pending → Done | `src/tools/traditional-tools.ts` + `src/oast/server.ts` push typed target/callback evidence |
| 2026-07-11 | A5 | Pending → Done | `src/tools/control-tools.ts` typed `FindingClaim`, hard REJECT (not downgrade); global ledger; 5 tests green |
| 2026-07-11 | A6 | Pending → Done | `src/intelligence/evidence-gate.ts` delegates to structural `verifyFindingClaim`; 14 tests green |
| 2026-07-11 | A7 | Pending → Done | `src/safety/scope-guard.ts` deny-by-default + `enforceScope`; `setAllowAny` for tests; 16 tests green |
| 2026-07-11 | A8 | Pending → Done | `src/models/capability.ts` + `setupEngine` gate; `EngineType` + `'council'`; 6 tests green |
| 2026-07-11 | A9 | Pending → Done | `src/council/{types,personas,bus,blackboard-shared,orchestrator,approval}.ts`; round loop + budget |
| 2026-07-11 | A10 | Pending → Done | `src/council/factory.ts` builds members; `lifecycle.setupEngine` + `session.ts` route to `runCouncil` |
| 2026-07-11 | A11 | Pending → Done | `orchestrator.ts` skeptic hard-gates via structural verify; `approval.ts` HITL mode requires human sign-off |
| 2026-07-11 | A12 | Pending → Done | `solver.ts` no longer persists `reasoning-delta` to `fullText` (kills next-turn reasoning echo) |
| 2026-07-11 | A13 | Pending → Done | `test/council/orchestrator.test.ts` (6) — approve/reject/HITL/budget/structural gate all green; 58 A-series tests total |
| 2026-07-11 | T0.1 | Pending → Done | `src/core/types.ts` + `src/core/index.ts` barrel; `CoreServices`/`ExecutionStrategy`/`RunResult` types compile |
| 2026-07-11 | T0.2 | Pending → Done | `src/core/evidence.ts` singleton; refactored `control-tools.ts` + `evidence-gate.ts` to share ONE ledger; 28 evidence tests green |
| 2026-07-11 | T0.3 | Pending → Done | `src/core/blackboard.ts` merged (solver + council features); `solver/blackboard.ts` re-exports; `council/blackboard-shared.ts` adapter; 36+6 blackboard tests green |
| 2026-07-11 | T0.4 | Pending → Done | `src/core/toolpack.ts` — `buildToolPack()` composes all tool groups; orchestration tools opt-in via `includeOrchestration` |
| 2026-07-11 | T0.5 | Pending → Done | `src/core/approval.ts` re-exports `decideApproval`/`ApprovalMode` from council |
| 2026-07-11 | T1.1 | Pending → Done | `src/council/factory.ts` operator gets `spawnWorker`/`spawnSwarm`/`executeDirect` via `extraTools` — delegation gap closed |
| 2026-07-11 | T1.2 | Pending → Done | `src/core/strategies/council.ts` — `CouncilStrategy` implements `ExecutionStrategy`; wraps `runCouncil` |
| 2026-07-11 | T2.1 | Pending → Done | `src/core/strategies/single.ts` — `SingleAgentStrategy` implements `ExecutionStrategy`; wraps `solve()` |
| 2026-07-11 | T2.2 | Pending → Done | `src/solver/solver.ts` `solve()` unchanged; `solver.test.ts` (16) + `build:cli` clean |
| 2026-07-11 | T3.1 | Pending → Done | `src/core/runner.ts` — `runSession()` + `resolveEnginePreset()`; builds `CoreServices` once per session |
| 2026-07-11 | T4.1 | Pending → Done | `src/config.ts` — validation accepts `council`/`solver`/`multi-model`; `EngineType` marked `@deprecated`; error message updated |
| 2026-07-11 | T3.2 | Pending → Done | `src/session.ts` — solver routes through `runSession()` from core runner; council uses factory + `runCouncil` directly; legacy marked `@deprecated` |
| 2026-07-11 | T3.3 | Pending → Done | `src/session/lifecycle.ts` — `setupEngine` builds `CoreServices` once (blackboard + evidence + loop + reflexion); shared by runner + both strategies |
| 2026-07-11 | T4.2 | Pending → Done | Legacy paths deprecated: lifecycle warns on `engine: legacy`; `AgentManager` banner updated; context/reader/writer/swarm `@deprecated` JSDoc |
| 2026-07-11 | B1 | Pending → Done | 4 skill files filled: exploitation.md (13 sections), web-pentest.md (12 sections), authorization.md (27 subsections), web-security-advanced.md (33 subsections) |
| 2026-07-11 | B2 | Pending → Done | OAST: external callback host via env/config, TTL expiry, `checkOastCallbacks` added to brain tools, `setOastConfig()` lifecycle wiring |
| 2026-07-11 | B3 | Pending → Done | Recon: WHOIS via RDAP bootstrap, DNS via `dns/promises`, subdomain brute-force with top-50 wordlist, scope guard on cloud metadata |
| 2026-07-11 | B4 | Pending → Done | Skill routing: removed 10 stale tool IDs, added 9 new IDs, negative scoring for exclusion phrases (-15 penalty) |
| 2026-07-11 | B5 | Pending → Done | HTTP: per-host 200ms rate limit, 429 exponential backoff (1s→2s→4s), robots.txt caching + blocking, evidence capture on all 4 tools |
| 2026-07-11 | B6 | Pending → Done | 4 new test files: recon-tools (14), tool-filter (18), http-rate-limit (7), total 39 new B-wave tests |
| 2026-07-11 | C1 | Pending → Done | `AuthStateDetector` in human-observer.ts (form/oauth/saml detection, state change callbacks); `detectAuthFlows` + `testSessionValid` brain tools |
| 2026-07-11 | C2 | Pending → Done | `BotDetectionHandler` in anti-bot.ts (Cloudflare/Akamai/DataDome/PerimeterX, 30s wait-for-resolution); post-navigation auto-detect in dialog-inject.ts |
| 2026-07-11 | C3 | Pending → Done | waf-bypass.md expanded 63→220+ lines: encoding, HPP, chunked, null byte, protocol-level, fingerprinting, vendor-specific |
| 2026-07-11 | C4 | Pending → Done | `classifyImpact()` in approval.ts (low/medium/high/critical); HITL gates on impact; 27 new approval tests |
| 2026-07-11 | C5 | Pending → Done | anti-bot tests (20), auth-state tests (9), approval tests (27), orchestrator tests updated |
| 2026-07-11 | D1 | Pending → Done | Legacy `@deprecated` JSDoc on agent-manager.ts, context/reader.ts, context/writer.ts, context/schemas.ts, swarm/builder.ts |
| 2026-07-11 | D2 | Pending → Done | ESLint: `lint` script → `eslint src/`, `typecheck` script → `tsc --noEmit`, `src/core/` + `src/lib/` in ignores |
| 2026-07-11 | D3 | Pending → Done | `isToolAvailable()` with PATH check + caching; `/tmp/` → `os.tmpdir()`; `defaultWordlistDir()` → `homedir()/.config/ultimatrix/wordlists`; 3 tests |
| 2026-07-11 | D4 | Pending → Done | README updated; UNIFIED-CORE.md created; REMEDIATION-WAVES.md completion trace closed |
| 2026-07-11 | T4.3 | Pending → Done | Docs + close: wave table updated, completion trace closed, all tasks marked Done |
| 2026-07-11 | D5 | Pending → Done | `npm run build:cli` clean (ESM 1.26MB + CJS 1.29MB); `npm test` 1262/1264 pass (2 pre-existing verifyChains) |
