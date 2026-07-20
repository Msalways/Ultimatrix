# Ultimatrix v8.4 — Deep Audit Report

> **Generated:** 2026-07-20
> **Scope:** Sanitization gaps, unwired logic, triggering failures, logical scope gaps
> **Severity:** Critical / High / Medium / Low — each with anti-bandaid acceptance criteria

---

## EXECUTIVE SUMMARY

The codebase has strong architectural foundations but critical operational gaps where systems are partially implemented, not properly triggered, or lack sanitization boundaries. These are not "bandaids" — they're structural disconnects that prevent the system from working as designed.

**Scorecard:**
- Lethality: 7.5/10 (strong reasoning + evidence-gated findings, but WAF gap, single-threaded browser, scope guard leaks, broken CDP capture)
- Architecture: 6/10 (sound core design, but dead code, dual implementations, filesystem skill loading, hardcoded enums, legacy pollution)
- OWASP/ASVS coverage: 55% (good on Injection/XSS/IDOR/AuthBypass/SSRF/Race/BusinessLogic; missing XXE/Deserialization/PrototypePollution/HTTPSmuggling/CachePoisoning/OAuth-SAML/WebSocket/gRPC/Mobile/Cloud/K8s)

---

## 1. SANITIZATION GAPS (Prompt Injection & Data Leakage Risks)

| # | Location | Gap | Risk |
|---|----------|-----|------|
| **S-01** | `src/analysis/instructions.ts:142-151` | **Plaintext credentials injected into LLM prompt** via `buildCredentialsSection()` — emails + passwords in clear text | Credential leakage to model/logs; contradicts "passwords never captured from browser" principle |
| **S-02** | `src/analysis/instructions.ts:123-137` | **Secrets from HAR injected verbatim** into prompt (`getSecrets()` -> `lines.push("- ${s.type}... ${s.value}")`) | API keys, tokens, JWTs leaked to model context |
| **S-03** | `src/solver/brain-instructions.ts:25-27` | `extraContext` (HAR data) directly interpolated into system prompt without sanitization | Unbounded data injection; context window overflow |
| **S-04** | `src/council/factory.ts:143-147` | JSON parsing fallback uses regex `/\{[\s\S]*"intent"[\s\S]*\}/` — could extract malicious JSON from LLM output | Parsing confusion; potential structured output bypass |
| **S-05** | `src/intelligence/anti-loop.ts:25` | `PATH_TAG_RE = /\[PATH:\s*([a-z_]+)\]/i` extracts from LLM output — no validation of tag content | Malformed/oversized tags could trigger false stale detection |
| **S-06** | `src/tools/flow-tools.ts:49` | CSRF token regex `/csrf|token|xsrf|authenticity/i` scans raw HTML — no output encoding | ReDoS risk on pathological HTML; token values returned unvalidated |
| **S-07** | `src/tools/session-tools.ts:20-25` | Cookie parsing regex `/^([^=]+)=([^;]*)/` — no validation of cookie names/values | Malformed cookies could break session logic |
| **S-08** | `src/capture/human-observer.ts:194-206` | `maskValue()` only masks `password|hidden` input types — **does not mask `credit-card|ssn|api-key`** | Sensitive data captured in human action logs |

### Anti-Bandaid Criteria for S-01..S-02 (Credential/Secret Injection)
- [ ] No plaintext credential string appears in any LLM prompt builder
- [ ] `grep -r "password" src/analysis/instructions.ts` returns 0 matches in prompt output
- [ ] Secrets are hashed/truncated before injection (max 4 chars visible)
- [ ] Test: inject fake credential, verify it never appears in `buildInstructions()` output

### Anti-Bandaid Criteria for S-06..S-07 (Regex Sanitization)
- [ ] Regex outputs are validated against expected shape (CSRF = 32+ hex chars, cookie = RFC 6265)
- [ ] Pathological input (10MB HTML, deeply nested tokens) does not cause ReDoS (timeout test)
- [ ] Cookie parser handles edge cases: empty values, encoded chars, `; ` separators

---

## 2. UNWIRED / DISCONNECTED LOGIC (Built but Not Connected)

| # | Component | What's Built | What's Missing | Evidence |
|---|-----------|--------------|----------------|----------|
| **U-01** | **Campaign Auto-Run** | `executeCampaign()` in `src/campaign/executor.ts:205-233` | **Never called automatically** — only exposed as tool `runCampaign` | `src/solver/solver.ts:382-437` has auto-campaign but ONLY when `config.engine === 'solver'` AND `config.campaign.auto` — but default engine is `multi-model` |
| **U-02** | **Exploitation Loop** | `runExploitationLoop()` in `src/solver/exploitation-loop.ts:55-147` | **Only runs in solver.ts:969-1001** when `engine === 'solver' || engine === 'multi-model'` — **never runs in legacy** or council | `solver.ts` lines 969-1001 guarded by engine check |
| **U-03** | **Council Debate Memory** | `DebateMemory` in `src/council/debate-memory.ts` | **Never persisted to graph** — only in-memory | `orchestrator.ts` uses it but `runCouncil()` doesn't save it |
| **U-04** | **Attack Path Detection** | `findAttackPaths()` in `src/solver/attack-path.ts:33-156` | **Only runs in solver.ts:942-954** after each turn — **not in legacy supervisor** or campaign | `solver.ts` line 942-954 |
| **U-05** | **Cross-Engagement Memory** | `CrossEngagementMemory` in `src/intelligence/cross-engagement.ts` | **Auto-loaded in solver.ts:502-513** but **never saved** — `finalizeEngagementMemory()` not called anywhere | Search reveals no calls to `finalizeEngagementMemory()` |
| **U-06** | **OAST Callback Detection** | `checkOastCallbacks` tool in `src/oast/tools.ts` | **Never automatically polled** — only available as tool | No background polling; relies on LLM to call it |
| **U-07** | **Human Observer -> Graph Bridge** | `HumanObserver` captures actions, `saveLearnedFlow` tool exists | **No automatic persistence** of observed flows to graph — requires explicit `saveLearnedFlow` call | `flow-tools.ts:283-347` tool exists but never auto-called |
| **U-08** | **Skill Composition Rules** | `CompositionRule` in `src/solver/skills/loader.ts:22-29` (`requires`, `enhances`, `conflicts`) | **Never enforced** — `SkillRegistry` doesn't check them | `registry.ts:77` only has `list()` and `search()` |
| **U-09** | **Primitive ToolChains** | `ToolChain` in `src/solver/skills/loader.ts:14-19` (ordered steps) | **Never executed automatically** — brain must manually call each tool | `brain-instructions.ts:183-190` says "honor declared ordering" but no enforcement |
| **U-10** | **Reflexion Store Persistence** | `saveReflexionState()` in `src/intelligence/reflexion-store.ts:7-21` | **Only called in solver.ts:957-961** when `reflexion.getAttemptCount() > 0` — **never in legacy/council** | Single call site |

### Anti-Bandaid Criteria for U-01 (Campaign Auto-Run)
- [ ] `executeCampaign()` is called in `multi-model` engine path (default)
- [ ] `config.campaign.auto` respected (off by default, opt-in)
- [ ] Campaign execution emits events to brain via `emitEvent('campaign-progress', ...)`
- [ ] Test: set `campaign.auto: true`, verify campaign starts without manual `runCampaign` call

### Anti-Bandaid Criteria for U-05 (Cross-Engagement Persistence)
- [ ] `finalizeEngagementMemory()` called in session cleanup/shutdown
- [ ] On session restart, `CrossEngagementMemory.loadFromGraph()` restores prior stances
- [ ] Test: complete engagement, restart session, verify stances are restored

### Anti-Bandaid Criteria for U-08 (Skill Composition)
- [ ] `SkillRegistry.resolve()` checks `requires` — skill not loaded if dependency missing
- [ ] `SkillRegistry.resolve()` checks `conflicts` — warning emitted if conflict detected
- [ ] Test: load skill with missing dependency -> error; load conflicting pair -> warning

---

## 3. TRIGGERING FAILURES (Systems That Should Auto-Trigger But Don't)

| # | System | Expected Trigger | Actual State | Fix Needed |
|---|--------|------------------|--------------|------------|
| **T-01** | **Anti-Loop Stale Detection** | `LoopDetector.isStale()` should inject warning into LLM prompt | **Only checked in solver.ts:549-558** — legacy/council don't check | Add to all engine prompts |
| **T-02** | **Evidence Gate Hallucination Check** | `evidence.getUnsupportedClaims()` should warn LLM | **Only in solver.ts:560-568** — legacy/council bypass | Wire into all engine prompts |
| **T-03** | **Reflexion Escalation Prompt** | `reflexion.toReflectionPrompt()` should inject when `shouldReflect()` | **Only in solver.ts:571-576** — legacy/council don't inject | Add to all engine prompts |
| **T-04** | **Campaign Re-plan on New Endpoints** | `replanCampaign()` in `src/campaign/planner.ts:259-286` | **Only triggered in solver.ts:788-808** inside tool-result handler — **not in legacy/council** | Add to all engine tool-result handlers |
| **T-05** | **Chain Detection Post-Turn** | `detectAndReportChains()` in `src/session/lifecycle.ts:803-819` | **Never called** — no hook in REPL loop | Call after each turn in all engines |
| **T-06** | **Pending Finding Verification** | `verifyPendingFindings()` in `src/tools/control-tools.ts:431-486` | **Exposed as tool `verifyPendingFindings` but never auto-called** | Schedule after campaign/exploitation |
| **T-07** | **Session Expiry Detection** | `restoreSession()` returns `sessionExpired: true` | **Brain never checks this** — `useSession` tool exists but no auto-refresh | Add session health check to brain prompt |
| **T-08** | **Auth State Change Callback** | `AuthStateDetector.onStateChange()` in `src/capture/human-observer.ts:160-165` | **Registered in human-observer.ts:303-307** but **never triggers graph update** | Callback should record `AuthFlowNode` |
| **T-09** | **Council Debate Completion** | `debateOnce()` returns `complete: true` | **REPL never checks this** — `session.ts` calls it but ignores `complete` flag | REPL should exit/notify on completion |
| **T-10** | **Budget Exhaustion Auto-Stop** | `BudgetGuard.exceeded` in `src/campaign/executor.ts:35-45` | **Campaign stops internally** but **no notification to brain/REPL** | Emit event/budget event to brain |

### Anti-Bandaid Criteria for T-01..T-03 (Intelligence Layer Triggers)
- [ ] All three (anti-loop, evidence-gate, reflexion) are injected into EVERY engine's system prompt builder
- [ ] Not hardcoded in `lifecycle.ts` — extracted to a shared `buildIntelligencePrompt()` helper
- [ ] Test: mock each layer, verify it appears in prompt output for legacy + solver + council

### Anti-Bandaid Criteria for T-05 (Chain Detection)
- [ ] `detectAndReportChains()` called in REPL after each turn (all engines)
- [ ] Chain detection results appended to `lastTurnResult` output
- [ ] Test: create 3 linked findings, verify chain detection fires and reports

---

## 4. LOGICAL SCOPE GAPS (Architectural Mismatches)

| # | Area | Design Intent | Actual Behavior | Gap |
|---|------|---------------|-----------------|-----|
| **L-01** | **Scope Guard** | `isUrlInScope()` called in 7 tools (httpRequest, multipartUpload, followRedirects, omitHeader, stagehand_navigate, evaluateRendered, measureTiming, reproduceFlow) | **Spider (`src/spider/agent.ts`) uses `stagehand_navigate` directly** — bypasses scope guard | Spider must call `isUrlInScope()` before navigation |
| **L-02** | **Session Persistence** | Sessions saved as `AuthFlowNode` with cookies | **`useSession` tool stores in `SessionManager` (in-memory)** — **different store than graph** | Two session stores; `restoreSession` reads from graph but `useSession` writes to memory |
| **L-03** | **Primitive -> Finding Pipeline** | `runPrimitive()` returns `PrimitiveResult` with `exploitProof`, `sessionArtifact`, `dataArtifact` | **`writeFinding` expects these in args** but **campaign executor calls `writeFinding` with different shape** (`type`, `endpoint`, `param` vs `exploitProof`) | Campaign findings lack exploit proofs |
| **L-04** | **Council -> Graph Sync** | Council uses `SharedBlackboard` wrapping core `Blackboard` | **Council debate memory NOT persisted to graph** — only in-memory | Debate stances/findings lost on restart |
| **L-05** | **Model Selection** | `selectModel` tool available to brain + council strategist/operator | **Workers don't get model selection** — `WorkerPool.dispatchSlices()` doesn't use `ModelSelector` | Workers use fixed model |
| **L-06** | **Evidence Gate Scope** | `EvidenceGate` wraps `coreEvidenceLedger` (singleton) | **Solver creates NEW `EvidenceGate()` per turn** (solver.ts:357) — **legacy uses different instance** | Evidence not shared across engines |
| **L-07** | **HAR Capture Dual Path** | CDP capture (preferred) + headless fallback | **CDP capture only attaches if `stagehand.context.conn` exists** — but **spider uses separate browser context** | Spider's navigation not captured |
| **L-08** | **Tool Discovery** | `listTools` / `loadTool` for MCP/plugins | **Brain gets acquired tools via `getAcquiredToolMap()`** but **workers don't** | Workers can't use MCP tools |
| **L-09** | **Budget Allocation** | `budgetPolicy.allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }` | **Enforced in `ModelSelector`** but **campaign executor has separate `BudgetGuard`** — double accounting | Single budget tracker needed |
| **L-10** | **Credential Storage** | Config has `credentials:` map with plaintext passwords | **`analysis/instructions.ts` injects passwords into LLM prompt** — contradicts "passwords never captured from browser" | Use session cookies only; never inject creds |

### Anti-Bandaid Criteria for L-01 (Scope Guard Universality)
- [ ] `isUrlInScope()` called in spider BEFORE every `stagehand_navigate`
- [ ] Scope check result logged (in-scope / out-of-scope / denied)
- [ ] No other HTTP/navigation path bypasses scope check
- [ ] Test: set scope to `example.com`, verify spider refuses `evil.com`

### Anti-Bandaid Criteria for L-02 (Session Storage Unification)
- [ ] Only ONE session store exists (graph-backed)
- [ ] `SessionManager` class removed or reduced to thin wrapper over graph
- [ ] `useSession` writes to graph via `addAuthFlow()`
- [ ] `restoreSession` reads from graph via `getAuthFlows()`
- [ ] Test: `useSession` -> `restoreSession` roundtrip via graph

### Anti-Bandaid Criteria for L-06 (Evidence Gate Singleton)
- [ ] Single `EvidenceGate` instance shared across ALL engines
- [ ] Created once in `CoreServices` initialization
- [ ] Passed to solver, legacy supervisor, and council via `CoreServices`
- [ ] Test: evidence recorded in solver visible to council

---

## 5. PROMPT ENGINEERING GAPS (What LLM Sees vs What Exists)

| # | Prompt Source | Claims Capability | Actually Available |
|---|---------------|-------------------|---------------------|
| **P-01** | `brain-instructions.ts:129-137` | "Search your skill library" -> `listSkills`, `loadSkillReference` | Works |
| **P-02** | `brain-instructions.ts:183-190` | "Skills declare ordered tool sequences... honor its declared ordering contract" | **No enforcement** — `ToolChain` never executed automatically |
| **P-03** | `brain-instructions.ts:209-225` | "Exploitation-First... capture real request/response as proof argument" | **Only in solver engine** — legacy/council don't have exploitation loop |
| **P-04** | `brain-instructions.ts:227-243` | "Relational Reasoning... use `queryRelations` tool" | Tool exists (`relation-tools.ts`) |
| **P-05** | `brain-instructions.ts:245-251` | "Mutual Consensus... propose, discuss, reach agreement" | **Council is on-demand only** — brain can't force consensus |
| **P-06** | `supervisorInstructions.ts:50-55` | "Search for relevant methodology based on what you observed" | `searchSkills` tool works |
| **P-07** | `spiderInstructions.ts:48-50` | "Phase 5: Endpoint Extraction... store structured data" | Graph tools available |
| **P-08** | `injectionInstructions.ts:70-73` | "Include [PATH: <type>] in your output" | `LoopDetector.extractAttackPath()` parses this |
| **P-09** | `council/strategist.md:48-53` | "Propose one concrete experiment... set intent to 'propose'" | Structured output contract enforces this |
| **P-10** | `core-contract.ts:59-63` | "Path Diversity... declare [PATH: <type>]" | Anti-loop tracks this |

---

## 6. PRIORITIZED FIX LIST

### CRITICAL (Do First — Security/Functionality)

| Fix | Description | Files | Effort | Anti-Bandaid |
|-----|-------------|-------|--------|--------------|
| **F-01** | Remove plaintext credentials from analysis prompt | `src/analysis/instructions.ts:142-151` | 1 hr | No plaintext credential string in any LLM prompt builder; `grep -r "password" src/analysis/instructions.ts` returns 0 matches |
| **F-02** | Remove secrets from HAR context injection | `src/analysis/instructions.ts:123-137` | 1 hr | Secrets hashed/truncated before injection (max 4 chars visible); test injects fake credential, verifies absent from output |
| **F-03** | Wire scope guard into spider navigation | `src/spider/agent.ts` + `src/safety/scope-guard.ts` | 2 hrs | `isUrlInScope()` called in spider BEFORE every `stagehand_navigate`; test: scope=example.com, spider refuses evil.com |
| **F-04** | Unify session storage (graph only) | `src/tools/session-tools.ts`, `src/tools/flow-tools.ts` | 4 hrs | Single session store (graph-backed); `SessionManager` removed or thin wrapper; `useSession` -> `restoreSession` roundtrip via graph |
| **F-05** | Auto-run campaign in multi-model engine | `src/solver/solver.ts:382-437` | 1 hr | `executeCampaign()` called in `multi-model` path; `config.campaign.auto` respected; test: auto=true, campaign starts without manual call |

### HIGH (Architectural Completeness)

| Fix | Description | Files | Effort | Anti-Bandaid |
|-----|-------------|-------|--------|--------------|
| **F-06** | Run exploitation loop in all engines | `src/session/lifecycle.ts` | 2 hrs | `runExploitationLoop()` available in legacy+council; test: legacy engine, exploitation fires |
| **F-07** | Persist council debate memory to graph | `src/council/orchestrator.ts` + `src/council/debate-memory.ts` | 3 hrs | Debate stances persisted as nodes/edges; restart restores debate state; test: debate -> restart -> verify stances |
| **F-08** | Auto-save human-observed flows to graph | `src/capture/human-observer.ts` callback | 2 hrs | `onStateChange` records `AuthFlowNode`; observed flows auto-saved; test: observe login -> verify graph has AuthFlow |
| **F-09** | Enforce skill composition rules | `src/solver/skills/registry.ts` | 3 hrs | `resolve()` checks `requires`/`conflicts`; test: missing dependency -> error; conflict -> warning |
| **F-10** | Execute skill tool chains automatically | `src/solver/brain-tools.ts` | 4 hrs | When skill loaded, queue its `toolChains` for sequential execution; test: load skill with chain -> verify ordered execution |

### MEDIUM (Operational Polish)

| Fix | Description | Files | Effort | Anti-Bandaid |
|-----|-------------|-------|--------|--------------|
| **F-11** | OAST callback polling background task | `src/session/lifecycle.ts` | 2 hrs | Background poller starts in `startInfrastructure()`; test: mock OAST server, verify poll within TTL window |
| **F-12** | Chain detection hook in REPL loop | `src/session/lifecycle.ts` | 1 hr | `detectAndReportChains()` called after each turn; test: 3 linked findings -> chain reported |
| **F-13** | Session expiry auto-refresh | `src/tools/session-tools.ts` | 2 hrs | `useSession` checks `sessionExpired` and prompts re-login; test: expired session -> prompt triggered |
| **F-14** | Budget exhaustion event to brain | `src/campaign/executor.ts` | 1 hr | Emit `budget-exhausted` event on `budgetExceeded`; test: exhaust budget -> event emitted |
| **F-15** | Council completion handling in REPL | `src/session.ts` | 1 hr | Check `debateOnce()` return `complete` flag; test: council completes -> REPL notifies |

### LOW (Hygiene)

| Fix | Description | Files | Effort | Anti-Bandaid |
|-----|-------------|-------|--------|--------------|
| **F-16** | Input validation for `extractAttackPath` | `src/intelligence/anti-loop.ts:39-44` | 30 min | Max input length enforced; malformed input -> empty result (no throw) |
| **F-17** | Expand `maskValue` for sensitive types | `src/capture/human-observer.ts:194-206` | 30 min | `credit-card`, `ssn`, `api-key` input types masked; test: fill api-key field -> masked in log |
| **F-18** | Call `finalizeEngagementMemory()` on shutdown | `src/session/lifecycle.ts:cleanup()` | 30 min | Engagements saved before exit; test: mock shutdown, verify memory persisted |
| **F-19** | Add `grantsOn2xx: false` to auth endpoints in primitives | `src/primitives/framework.ts:347-398` | 1 hr | 2xx after auth test -> NOT marked as "access granted"; test: login 200 -> `grantsAccess: false` |
| **F-20** | Document all tool output schemas | `src/tools/schema-registry.ts` (new) | 4 hrs | Every tool has a `JSONSchema` output spec; test: all tools registered in schema-registry |

---

## 7. DECISIONS REQUIRED (From User)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| **D-01** | Session storage | A) Graph-only (remove `SessionManager`) B) Dual with sync | **A** — simpler, matches "graph is source of truth" |
| **D-02** | Campaign default | A) Auto-on in multi-model B) Opt-in only | **A** — matches "autonomous researcher" vision |
| **D-03** | Council mode | A) Always available in multi-model B) Separate engine | **A** — current design (on-demand via `/council`) |
| **D-04** | Credential handling | A) Never inject; use session cookies only B) Inject but mask in logs | **A** — matches README claim |
| **D-05** | Budget tracking | A) Single `TokenBudgetTracker` for all B) Per-engine trackers | **A** — prevents double-spend |

---

## 8. VALIDATION CHECKLIST (Post-Fix)

After implementing fixes, verify:

- [ ] `npm test` passes (1527+ tests)
- [ ] `npm run build:cli` clean (0 errors)
- [ ] `npm run lint` passes (0 errors)
- [ ] No plaintext credentials in any LLM prompt (`grep -r "password" src/analysis/`)
- [ ] Scope guard called on ALL outbound HTTP/browser actions (7 tools + spider)
- [ ] Campaign runs in default `multi-model` engine
- [ ] Exploitation loop runs in all engines
- [ ] Council debate memory persists across restarts
- [ ] Human actions auto-save to graph
- [ ] Skill composition rules enforced
- [ ] Skill tool chains auto-execute
- [ ] OAST callbacks polled in background
- [ ] Chain detection runs after each turn
- [ ] Budget exhaustion communicated to brain
- [ ] Session expiry handled gracefully
- [ ] Cross-engagement memory saved on shutdown and loaded on restart
- [ ] Single EvidenceGate instance shared across all engines
- [ ] Single session store (graph-backed)
- [ ] Workers receive model selection via ModelSelector
- [ ] All tool outputs have JSON schema definitions

---

## 9. REMEDIATION TIMELINE

| Phase | Fixes | Duration | Milestone |
|-------|-------|----------|-----------|
| **Phase 0: Security** | F-01, F-02, F-03 | Week 1 | No credential leakage; scope guard universal |
| **Phase 1: Core Wiring** | F-04, F-05, F-06, F-15 | Weeks 2-3 | Single session store; campaign/exploitation in default engine |
| **Phase 2: Intelligence** | F-07, F-08, F-09, F-10 | Weeks 4-6 | Council persisted; human flows saved; skill composition enforced |
| **Phase 3: Operational** | F-11, F-12, F-13, F-14 | Weeks 7-8 | Background polling; chain detection; budget events |
| **Phase 4: Hygiene** | F-16, F-17, F-18, F-19, F-20 | Weeks 9-10 | Input validation; masking; schema documentation |

**Total estimated effort: ~40 engineering hours across 10 weeks**
