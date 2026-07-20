# Ultimatrix v8.4 — Combined Audit + Remediation Plan

> **Generated:** 2026-07-20
> **Status:** AWAITING APPROVAL
> **Baseline:** 1527 tests, 140+ test files, 228 source files
> **Hard Rule:** No bandaids. Fix root causes. No hardcoded patterns/regex/substring detection.

---

## COMBINED STRATEGY

### What This Document Is

This is the single source of truth for everything wrong with Ultimatrix v8.4 and how to fix it. It combines:

1. **Deep Audit Findings** (Sections 1-5): What's broken, unwired, or missing — the "what"
2. **Remediation Tasks** (Sections 6-10): Exactly how to fix each issue, with files, code, and anti-bandaid criteria — the "how"
3. **Cross-Reference Map** (Section 11): Which findings map to which tasks — the "traceability"
4. **Execution Strategy** (Section 12): How to sequence the work for maximum impact with minimum risk — the "when"

### Execution Principles

1. **Security first, always.** Credential leakage and scope guard bypass are fixed before anything else. No exceptions.
2. **One source of truth per concept.** TechniqueRegistry owns all technique mappings. GraphStore owns all session state. EvidenceGate is a singleton. No duplicates.
3. **Wire before polish.** Every system that exists but isn't connected gets wired before any new features are added.
4. **Test every fix.** Every task has anti-bandaid criteria AND test verification. Both must pass.
5. **No regex.** Every hardcoded regex pattern is replaced with structured detection (DOM inspection, Set membership, URL parsing). The codebase principle is: typed fields + relation-native reasoning, never substring scanning.

### Risk Mitigation

- **Phase 0 (Security)** has zero dependencies and can start immediately. All 6 tasks are independent.
- **Phase 1 (Core Wiring)** touches the most files but each task is isolated (session store, campaign, evidence gate, intel layers, council).
- **Phase 2 (Intelligence)** depends on Phase 1 completion for P2-05 (exploitation in all engines needs P1-04 intel layers).
- **Phase 3 (Operational)** is additive — background polling, chain detection, session expiry are all new behavior, not rewiring.
- **Phase 4 (Hygiene)** is lowest risk — input validation, masking, documentation. No behavior changes.

### Success Criteria

After all phases:
- Zero plaintext credentials in any LLM prompt
- Zero hardcoded regex for auth/technique detection
- Scope guard on ALL outbound HTTP/browser actions (including spider)
- Single session store (graph-backed), single EvidenceGate instance
- Campaign + exploitation loop available in ALL engines (not just solver)
- Council debate memory persists across restarts
- Cross-engagement memory saved on shutdown
- All intelligence layers (anti-loop, evidence-gate, reflexion) in ALL engine prompts
- OAST polling, chain detection, budget events all wired

---

## AUDIT SCORECARD

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Lethality** | 7.5/10 | Strong reasoning + evidence-gated findings; WAF gap, single-threaded browser, scope guard leaks, broken CDP capture |
| **Architecture** | 6/10 | Sound core design; dead code, dual implementations, filesystem skill loading, hardcoded enums, legacy pollution |
| **OWASP/ASVS** | 55% | Good on Injection/XSS/IDOR/AuthBypass/SSRF/Race/BusinessLogic; missing XXE/Deserialization/PrototypePollution/HTTPSmuggling/CachePoisoning/OAuth-SAML/WebSocket/gRPC/Mobile/Cloud/K8s |

---

## FINDINGS REFERENCE (Audit Categories)

### Category 1: Sanitization Gaps (S-01 to S-08)

| # | Location | Gap | Risk |
|---|----------|-----|------|
| **S-01** | `src/analysis/instructions.ts:142-151` | Plaintext credentials injected into LLM prompt via `buildCredentialsSection()` | Credential leakage |
| **S-02** | `src/analysis/instructions.ts:123-137` | Secrets from HAR injected verbatim into prompt | API keys/tokens leaked to model |
| **S-03** | `src/solver/brain-instructions.ts:25-27` | `extraContext` (HAR data) directly interpolated without sanitization | Context window overflow |
| **S-04** | `src/council/factory.ts:143-147` | JSON parsing fallback uses regex | Potential structured output bypass |
| **S-05** | `src/intelligence/anti-loop.ts:25` | `PATH_TAG_RE` extracts from LLM output without validation | False stale detection |
| **S-06** | `src/tools/flow-tools.ts:49` | CSRF token regex scans raw HTML | ReDoS risk |
| **S-07** | `src/tools/session-tools.ts:20-25` | Cookie parsing regex without validation | Malformed cookies break session |
| **S-08** | `src/capture/human-observer.ts:194-206` | `maskValue()` only masks password/hidden | Sensitive data in action logs |

### Category 2: Unwired Logic (U-01 to U-10)

| # | Component | What's Built | What's Missing |
|---|-----------|--------------|----------------|
| **U-01** | Campaign Auto-Run | `executeCampaign()` exists | Never called in multi-model engine |
| **U-02** | Exploitation Loop | `runExploitationLoop()` exists | Only runs in solver, not legacy/council |
| **U-03** | Council Debate Memory | `DebateMemory` exists | Never persisted to graph |
| **U-04** | Attack Path Detection | `findAttackPaths()` exists | Only runs in solver, not legacy/campaign |
| **U-05** | Cross-Engagement Memory | `CrossEngagementMemory` exists | Loaded but never saved |
| **U-06** | OAST Callback Detection | `checkOastCallbacks` tool exists | Never auto-polled |
| **U-07** | Human Observer -> Graph | `saveLearnedFlow` tool exists | Never auto-called |
| **U-08** | Skill Composition Rules | `CompositionRule` parsed from YAML | Never enforced |
| **U-09** | Primitive ToolChains | `ToolChain` parsed from YAML | Never auto-executed |
| **U-10** | Reflexion Store Persistence | `saveReflexionState()` exists | Only called in solver |

### Category 3: Triggering Failures (T-01 to T-10)

| # | System | Expected Trigger | Actual State |
|---|--------|------------------|--------------|
| **T-01** | Anti-Loop Stale Detection | Inject into all engine prompts | Only solver |
| **T-02** | Evidence Gate Hallucination | Inject into all engine prompts | Only solver |
| **T-03** | Reflexion Escalation | Inject into all engine prompts | Only solver |
| **T-04** | Campaign Re-plan | Trigger on new endpoints | Only solver tool-result handler |
| **T-05** | Chain Detection | After each REPL turn | Never called |
| **T-06** | Pending Finding Verification | After campaign/exploitation | Never auto-called |
| **T-07** | Session Expiry Detection | On useSession | Brain never checks |
| **T-08** | Auth State Change | On DOM auth state change | Callback registered, never fires |
| **T-09** | Council Debate Completion | When debateOnce() returns complete | REPL ignores flag |
| **T-10** | Budget Exhaustion | When BudgetGuard.exceeded | No notification to brain |

### Category 4: Logical Scope Gaps (L-01 to L-10)

| # | Area | Design Intent | Actual Behavior |
|---|------|---------------|-----------------|
| **L-01** | Scope Guard | isUrlInScope() on all tools | Spider bypasses it |
| **L-02** | Session Persistence | Graph-backed sessions | Two stores: SessionManager (memory) + graph |
| **L-03** | Primitive -> Finding | runPrimitive returns exploitProof | Campaign calls writeFinding with different shape |
| **L-04** | Council -> Graph | SharedBlackboard wraps Blackboard | Debate memory not persisted |
| **L-05** | Model Selection | selectModel available to brain+council | Workers use fixed model |
| **L-06** | Evidence Gate Scope | Singleton coreEvidenceLedger | Solver creates new instance per turn |
| **L-07** | HAR Capture | CDP capture preferred | Spider uses separate browser context |
| **L-08** | Tool Discovery | listTools/loadTool for MCP | Workers don't get MCP tools |
| **L-09** | Budget Allocation | budgetPolicy.allocation | Campaign has separate BudgetGuard |
| **L-10** | Credential Storage | config.credentials: plaintext | Injected into LLM prompt |

### Category 5: Prompt Engineering Gaps (P-01 to P-10)

| # | Prompt Source | Claims | Actually Available |
|---|---------------|--------|---------------------|
| **P-01** | brain-instructions.ts:129-137 | "Search your skill library" | Works |
| **P-02** | brain-instructions.ts:183-190 | "Honor declared ordering contract" | No enforcement |
| **P-03** | brain-instructions.ts:209-225 | "Exploitation-First" | Only solver engine |
| **P-04** | brain-instructions.ts:227-243 | "Relational Reasoning" | Tool exists |
| **P-05** | brain-instructions.ts:245-251 | "Mutual Consensus" | Council on-demand only |
| **P-06** | supervisorInstructions.ts:50-55 | "Search methodology" | searchSkills works |
| **P-07** | spiderInstructions.ts:48-50 | "Endpoint Extraction" | Graph tools available |
| **P-08** | injectionInstructions.ts:70-73 | "[PATH: type]" output | LoopDetector parses this |
| **P-09** | council/strategist.md:48-53 | "Propose experiment" | Structured output enforces |
| **P-10** | core-contract.ts:59-63 | "Path Diversity" | Anti-loop tracks this |

---

## FINDING-TO-TASK CROSS-REFERENCE

This table maps every audit finding to the remediation task(s) that fix it. This is the traceability backbone — no finding should be "unmapped."

| Finding | Category | Task(s) | Phase |
|---------|----------|---------|-------|
| S-01 (credentials in prompt) | Sanitization | P0-01 | P0 |
| S-02 (secrets in prompt) | Sanitization | P0-01 | P0 |
| S-03 (extraContext injection) | Sanitization | P0-01 (maxSecrets limit) | P0 |
| S-04 (JSON regex in factory) | Sanitization | P0-04 (registry, not regex) | P0 |
| S-05 (PATH_TAG_RE) | Sanitization | P4-01 (input validation) | P4 |
| S-06 (CSRF regex) | Sanitization | P0-03 (structural detection) | P0 |
| S-07 (cookie regex) | Sanitization | P4-02 (RFC 6265 validation) | P4 |
| S-08 (maskValue gap) | Sanitization | P3-05 (expand masking) | P3 |
| U-01 (campaign auto-run) | Unwired | P1-02 | P1 |
| U-02 (exploitation loop) | Unwired | P2-05 | P2 |
| U-03 (debate memory) | Unwired | P2-01 | P2 |
| U-04 (attack path detection) | Unwired | P3-02 (chain detection hook) | P3 |
| U-05 (cross-engagement) | Unwired | P2-04 | P2 |
| U-06 (OAST polling) | Unwired | P3-01 | P3 |
| U-07 (human observer -> graph) | Unwired | P2-02 | P2 |
| U-08 (skill composition) | Unwired | P2-03 | P2 |
| U-09 (toolchains) | Unwired | P2-03 (skill composition) | P2 |
| U-10 (reflexion store) | Unwired | P1-04 (intel layers all engines) | P1 |
| T-01 (anti-loop trigger) | Triggering | P1-04 | P1 |
| T-02 (evidence-gate trigger) | Triggering | P1-04 | P1 |
| T-03 (reflexion trigger) | Triggering | P1-04 | P1 |
| T-04 (campaign re-plan) | Triggering | P1-02 (campaign auto) | P1 |
| T-05 (chain detection) | Triggering | P3-02 | P3 |
| T-06 (pending verification) | Triggering | P3-01 (OAST polling) | P3 |
| T-07 (session expiry) | Triggering | P3-03 | P3 |
| T-08 (auth state change) | Triggering | P2-02 | P2 |
| T-09 (council completion) | Triggering | P1-05 | P1 |
| T-10 (budget exhaustion) | Triggering | P3-04 | P3 |
| L-01 (scope guard spider) | Logical | P0-06 | P0 |
| L-02 (dual session store) | Logical | P1-01 | P1 |
| L-03 (primitive->finding shape) | Logical | P1-02 (campaign auto) | P1 |
| L-04 (council graph sync) | Logical | P2-01 | P2 |
| L-05 (worker model selection) | Logical | Not in scope (deferred) | -- |
| L-06 (evidence gate scope) | Logical | P1-03 | P1 |
| L-07 (HAR capture dual) | Logical | Not in scope (deferred) | -- |
| L-08 (tool discovery workers) | Logical | Not in scope (deferred) | -- |
| L-09 (budget double) | Logical | P1-03 (evidence+budget unify) | P1 |
| L-10 (credential injection) | Logical | P0-01 | P0 |

---

## DEPENDENCY GRAPH

```
P0-01 (credentials)    -- NO DEPS -- START NOW
P0-02 (human-observer) -- NO DEPS -- START NOW
P0-03 (flow-tools)     -- NO DEPS -- START NOW
P0-04 (exploit-loop)   -- NO DEPS -- START NOW
P0-05 (campaign tags)  -- NO DEPS -- START NOW
P0-06 (spider scope)   -- NO DEPS -- START NOW

P1-01 (session store)  -- NO DEPS
P1-02 (campaign auto)  -- NO DEPS
P1-03 (evidence gate)  -- NO DEPS
P1-04 (intel layers)   -- NO DEPS
P1-05 (council done)   -- NO DEPS

P2-01 (debate persist) -- NO DEPS
P2-02 (human flows)    -- depends on P0-02
P2-03 (skill compose)  -- NO DEPS
P2-04 (cross-engage)   -- NO DEPS
P2-05 (exploit engines)-- depends on P1-04

P3-01 (OAST polling)   -- NO DEPS
P3-02 (chain detect)   -- NO DEPS
P3-03 (session expiry) -- depends on P1-01
P3-04 (budget event)   -- NO DEPS
P3-05 (maskValue)      -- depends on P0-02

P4-01 (input validation)-- NO DEPS
P4-02 (cookie parser)  -- NO DEPS
P4-03 (schema docs)    -- NO DEPS
```

**Parallel opportunity:** 15 of 23 tasks have zero dependencies. Phase 0 (all 6 tasks) can run fully in parallel.

---

## PHASE 0: SECURITY — CRITICAL (Week 1, ~16 hrs)

### Task P0-01: Remove Plaintext Credentials from LLM Prompts
**Severity:** CRITICAL | **Files:** `src/analysis/instructions.ts` | **Effort:** 2 hrs

**Root cause:** `buildCredentialsSection()` (line 142-151) injects plaintext email/password into LLM system prompt. `getSecrets()` (line 123-128) injects raw API keys, tokens, JWTs.

**Implementation:**
1. `buildCredentialsSection()` -> replace with role-only output (no email/password):
   ```
   lines.push(`- **${role}**: Credentials available via useSession tool. Do NOT ask for them.`)
   ```
2. `getSecrets()` -> truncate secret values to first 4 chars + `***`:
   ```
   const masked = s.value.length > 4 ? s.value.slice(0, 4) + '***' : '***'
   lines.push(`- ${s.type} in ${s.location}: ${s.name} = ${masked}`)
   ```
3. Add `maxSecrets` limit (default 10) to prevent context overflow

**Anti-bandaid criteria:**
- [ ] No plaintext credential string in any LLM prompt builder output
- [ ] No full API key/JWT token appears in `buildInstructions()` output
- [ ] Test: inject `{ admin: { email: "a@b.com", password: "secret" } }`, verify output contains neither

**Fixes:** S-01, S-02, S-03, L-10

---

### Task P0-02: Remove Hardcoded Regex from Human Observer
**Severity:** CRITICAL | **Files:** `src/capture/human-observer.ts` | **Effort:** 3 hrs

**Root cause:** Three hardcoded regex arrays:
- `OAUTH_PROVIDER_PATTERNS` (line 40-46): 5 regex patterns
- `SAML_PATTERNS` (line 48-51): 7 regex patterns
- `LOGIN_FORM_PATTERNS` (line 53-56): 6 regex patterns
Plus `detectAuthState()` uses inline regex (line 92-94).

**Implementation:**
1. Replace OAUTH regex with DOM href inspection (check `el.href` domain directly)
2. Replace SAML regex with URL path segment check (`path.includes('saml')`)
3. Replace LOGIN_FORM regex with structural DOM check (password field + submit button in same form)

**Anti-bandaid criteria:**
- [ ] Zero regex for auth detection in `human-observer.ts`
- [ ] Detection uses DOM structure (elements, attributes, href domains) not text content
- [ ] Tests: OAuth button detected; SAML path detected; login form detected

**Fixes:** S-04 (structural, not regex)

---

### Task P0-03: Remove Hardcoded Regex from Flow Tools
**Severity:** HIGH | **Files:** `src/tools/flow-tools.ts` | **Effort:** 2 hrs

**Root cause:** `LOGIN_URL_PATTERNS` (line 16-19): 6 regex patterns for login URL detection.

**Implementation:** Replace with `Set` of path segments + `URL.pathname` split.

**Anti-bandaid criteria:**
- [ ] Zero `RegExp` in flow-tools.ts for login URL detection
- [ ] Uses `Set.has()` for O(1) membership check
- [ ] Tests: login URL detected; dashboard URL not detected

**Fixes:** S-06

---

### Task P0-04: Remove Hardcoded TECHNIQUE_TO_PRIMITIVE Map
**Severity:** HIGH | **Files:** `src/solver/exploitation-loop.ts` | **Effort:** 2 hrs

**Root cause:** `TECHNIQUE_TO_PRIMITIVE` (line 32-42): hardcoded technique->primitive mapping duplicates TechniqueRegistry.

**Implementation:** Remove map; rewrite `resolvePrimitive()` to use `getTechniqueRegistry().getPrimitiveForTechnique()`.

**Anti-bandaid criteria:**
- [ ] Zero hardcoded technique->primitive pairs in `exploitation-loop.ts`
- [ ] TechniqueRegistry is single source of truth
- [ ] Tests: technique resolves via registry; unknown technique returns undefined

**Fixes:** S-04 (regex in factory fallback)

---

### Task P0-05: Remove Hardcoded Campaign Technique Tags
**Severity:** HIGH | **Files:** `src/campaign/planner.ts` | **Effort:** 2 hrs

**Root cause:** `GENERIC_TECHNIQUE_TAGS` (line 36) and `AUTH_TECHNIQUE_TAGS` (line 39): hardcoded string arrays.

**Implementation:** Move to TechniqueRegistry; planner reads from registry.

**Anti-bandaid criteria:**
- [ ] Zero hardcoded technique tag arrays in `planner.ts`
- [ ] TechniqueRegistry owns all technique classification
- [ ] Tests: new technique added to registry, planner uses it

**Fixes:** Hardcoded enum violation (architectural principle)

---

### Task P0-06: Wire Scope Guard into Spider Navigation
**Severity:** CRITICAL | **Files:** `src/spider/agent.ts`, `src/spider/instructions.ts` | **Effort:** 2 hrs

**Root cause:** Spider uses `stagehand_navigate` without `isUrlInScope()` check. Out-of-scope URLs can be crawled.

**Implementation:**
1. Add scope guard middleware wrapping `stagehand_navigate` in spider tool set
2. Add scope guard instruction to `spiderInstructions`
3. Add `isUrlInScope` to spider tool set for self-check

**Anti-bandaid criteria:**
- [ ] `isUrlInScope()` called before every spider navigation
- [ ] Out-of-scope URL returns error
- [ ] Tests: scope=example.com, spider refuses evil.com

**Fixes:** L-01

---

## PHASE 1: CORE WIRING (Weeks 2-3, ~16 hrs)

### Task P1-01: Unify Session Storage to Graph-Backed
**Severity:** HIGH | **Files:** `src/tools/session-tools.ts`, `src/tools/flow-tools.ts`, `src/http/session-manager.ts` | **Effort:** 6 hrs

**Root cause:** Two session stores: `SessionManager` (in-memory) and graph `AuthFlowNode`. `useSession` writes to SessionManager, `restoreSession` reads from graph.

**Implementation:**
1. Make `SessionManager` a thin wrapper over GraphStore
2. `useSession` writes via `addAuthFlow()`
3. `restoreSession` reads via `queryNodes('AuthFlow')`
4. Remove in-memory session map

**Anti-bandaid criteria:**
- [ ] SessionManager has zero in-memory state (delegates to graph)
- [ ] `useSession` -> `restoreSession` roundtrip via graph
- [ ] Tests: save->load roundtrip; session survives re-creation

**Fixes:** L-02

---

### Task P1-02: Auto-Run Campaign in Multi-Model Engine
**Severity:** HIGH | **Files:** `src/solver/solver.ts` | **Effort:** 2 hrs

**Root cause:** `executeCampaign()` only runs when `config.engine === 'solver'` AND `config.campaign.auto`. Default engine is `multi-model`.

**Implementation:** Add campaign auto-run after exploitation loop when `config.campaign?.auto`.

**Anti-bandaid criteria:**
- [ ] `executeCampaign()` called in multi-model engine when `campaign.auto: true`
- [ ] `campaign.auto: false` (default) -> campaign NOT auto-run
- [ ] Test: auto=true, campaign starts without manual call

**Fixes:** U-01, T-04, L-03

---

### Task P1-03: Unify EvidenceGate to Singleton
**Severity:** HIGH | **Files:** `src/solver/solver.ts`, `src/core/evidence.ts`, `src/tools/control-tools.ts` | **Effort:** 3 hrs

**Root cause:** Solver creates new `EvidenceGate()` per turn (solver.ts:357). Legacy/council use different instances.

**Implementation:** Create single `EvidenceGate` in `CoreServices`; pass to all engines.

**Anti-bandaid criteria:**
- [ ] Single instance created once at session start
- [ ] All engines share same instance
- [ ] Test: evidence in solver visible to council

**Fixes:** L-06, L-09

---

### Task P1-04: Wire Intelligence Layers to All Engines
**Severity:** HIGH | **Files:** `src/session/lifecycle.ts` | **Effort:** 3 hrs

**Root cause:** Anti-loop, evidence-gate, and reflexion prompts only injected in solver engine. Legacy/council bypass all three.

**Implementation:** Extract `buildIntelligencePrompt()` helper; call in all engine prompt builders.

**Anti-bandaid criteria:**
- [ ] All three intelligence layers in prompt for legacy, solver, and council
- [ ] Shared helper, not duplicated logic
- [ ] Tests: stale detection in legacy prompt; hallucination warning in council prompt

**Fixes:** T-01, T-02, T-03, U-10

---

### Task P1-05: Council Completion Handling
**Severity:** MEDIUM | **Files:** `src/session.ts` | **Effort:** 2 hrs

**Root cause:** `debateOnce()` returns `complete: true` but REPL never checks.

**Implementation:** Check `result.complete` in REPL turn handler; notify user.

**Anti-bandaid criteria:**
- [ ] `complete: true` triggers visible notification
- [ ] Test: mock complete=true, REPL emits message

**Fixes:** T-09

---

## PHASE 2: INTELLIGENCE (Weeks 4-6, ~20 hrs)

### Task P2-01: Persist Council Debate Memory to Graph
**Severity:** HIGH | **Files:** `src/council/orchestrator.ts`, `src/council/debate-memory.ts`, `src/graph/schema.ts` | **Effort:** 6 hrs

**Root cause:** `DebateMemory` (stances, failed approaches, proven findings) lives only in memory. Lost on restart.

**Implementation:**
1. Add `NodeType.COUNCIL_DEBATE` to graph schema
2. After each debate cycle, persist memory as graph node
3. On council startup, restore from graph

**Anti-bandaid criteria:**
- [ ] Debate stances persisted as graph nodes after each cycle
- [ ] Council restart restores prior debate state
- [ ] Test: debate -> restart -> verify stances restored

**Fixes:** U-03, L-04

---

### Task P2-02: Auto-Save Human-Observed Flows to Graph
**Severity:** HIGH | **Files:** `src/capture/human-observer.ts` | **Effort:** 3 hrs

**Root cause:** `AuthStateDetector.onStateChange()` callback registered but never triggers graph update.

**Implementation:** Wire `onStateChange` to record `AuthFlowNode` via `store.addAuthFlow()`.

**Anti-bandaid criteria:**
- [ ] Auth state change -> AuthFlowNode in graph
- [ ] Test: observe login page -> graph has AuthFlow node

**Fixes:** U-07, T-08

---

### Task P2-03: Enforce Skill Composition Rules
**Severity:** MEDIUM | **Files:** `src/solver/skills/registry.ts` | **Effort:** 4 hrs

**Root cause:** `CompositionRule` (requires, enhances, conflicts) parsed but never enforced.

**Implementation:** Add `resolve()` to SkillRegistry checking requires/conflicts.

**Anti-bandaid criteria:**
- [ ] resolve() throws on missing required dependency
- [ ] resolve() warns on conflict
- [ ] Tests: missing dep -> error; conflict -> warning

**Fixes:** U-08, U-09

---

### Task P2-04: Auto-Save Cross-Engagement Memory on Shutdown
**Severity:** MEDIUM | **Files:** `src/session/lifecycle.ts`, `src/intelligence/cross-engagement.ts` | **Effort:** 3 hrs

**Root cause:** `finalizeEngagementMemory()` (cross-engagement.ts:444) defined but never called.

**Implementation:** Call in lifecycle cleanup function.

**Anti-bandaid criteria:**
- [ ] Engagements saved before exit
- [ ] Test: mock shutdown, verify memory persisted

**Fixes:** U-05

---

### Task P2-05: Run Exploitation Loop in All Engines
**Severity:** HIGH | **Files:** `src/session/lifecycle.ts` | **Effort:** 3 hrs

**Root cause:** `runExploitationLoop()` only runs in solver.ts:977-986, guarded by engine check. Legacy/council never run it.

**Implementation:** Add exploitation loop call in lifecycle after each turn for all engines.

**Anti-bandaid criteria:**
- [ ] Exploitation loop available in legacy+council
- [ ] Test: legacy engine, exploitation fires after findings

**Fixes:** U-02, P-03

---

## PHASE 3: OPERATIONAL (Weeks 7-8, ~10 hrs)

### Task P3-01: OAST Callback Background Polling
**Severity:** MEDIUM | **Files:** `src/session/lifecycle.ts`, `src/oast/server.ts` | **Effort:** 2 hrs

**Root cause:** `checkOastCallbacks` tool exists but never auto-polled.

**Implementation:** Start background interval in `startInfrastructure()` that polls every 30s.

**Anti-bandaid criteria:**
- [ ] Background poller starts on session init
- [ ] Polling stops on cleanup
- [ ] Test: mock OAST server, verify poll within window

**Fixes:** U-06, T-06

---

### Task P3-02: Chain Detection After Each Turn
**Severity:** MEDIUM | **Files:** `src/session/lifecycle.ts` | **Effort:** 1 hr

**Root cause:** `detectAndReportChains()` (lifecycle.ts:803) exists but only called from session.ts:626 (council path).

**Implementation:** Call after each REPL turn for all engines.

**Anti-bandaid criteria:**
- [ ] Chain detection fires after every turn
- [ ] Test: 3 linked findings -> chain reported

**Fixes:** U-04, T-05

---

### Task P3-03: Session Expiry Auto-Refresh
**Severity:** MEDIUM | **Files:** `src/tools/session-tools.ts` | **Effort:** 2 hrs

**Root cause:** `restoreSession()` returns `sessionExpired: true` but brain never checks.

**Implementation:** Add session health check to `useSession` tool; auto-prompt re-login on expiry.

**Anti-bandaid criteria:**
- [ ] Expired session triggers re-login prompt
- [ ] Test: expired session -> prompt triggered

**Fixes:** T-07

---

### Task P3-04: Budget Exhaustion Event to Brain
**Severity:** MEDIUM | **Files:** `src/campaign/executor.ts` | **Effort:** 1 hr

**Root cause:** `BudgetGuard.exceeded` stops campaign internally but no notification to brain/REPL.

**Implementation:** Emit forensic log event on budget exceeded.

**Anti-bandaid criteria:**
- [ ] Event emitted when budget exhausted
- [ ] Test: exhaust budget -> event visible

**Fixes:** T-10

---

### Task P3-05: Expand maskValue for Sensitive Types
**Severity:** LOW | **Files:** `src/capture/human-observer.ts` | **Effort:** 1 hr

**Root cause:** `maskValue()` (line 194-206) only masks `password|hidden` inputs. Misses `credit-card`, `ssn`, `api-key`.

**Implementation:** Extend mask check to include `autocomplete`, `data-type`, and `name` attributes.

**Anti-bandaid criteria:**
- [ ] credit-card, ssn, api-key inputs masked
- [ ] Test: fill api-key field -> masked in log

**Fixes:** S-08

---

## PHASE 4: HYGIENE (Weeks 9-10, ~8 hrs)

### Task P4-01: Input Validation for extractAttackPath
**Severity:** LOW | **Files:** `src/intelligence/anti-loop.ts` | **Effort:** 30 min

**Root cause:** `extractAttackPath` (line 39-44) uses regex `PATH_TAG_RE` without input length validation.

**Implementation:** Add max input length check; malformed input -> empty result.

**Anti-bandaid criteria:**
- [ ] Max input length enforced
- [ ] Malformed input returns empty result (no throw)

**Fixes:** S-05

---

### Task P4-02: Cookie Parser Validation
**Severity:** LOW | **Files:** `src/tools/session-tools.ts` | **Effort:** 1 hr

**Root cause:** Cookie parsing regex `/^([^=]+)=([^;]*)/` (line 21) has no validation.

**Implementation:** Validate cookie name per RFC 6265; handle empty values, encoded chars.

**Anti-bandaid criteria:**
- [ ] Handles edge cases: empty values, encoded chars, `; ` separators
- [ ] ReDoS test: 10MB input completes in <100ms

**Fixes:** S-07

---

### Task P4-03: Document Tool Output Schemas
**Severity:** LOW | **Files:** New `src/tools/schema-registry.ts` | **Effort:** 4 hrs

**Root cause:** Many tools lack JSON Schema output definitions.

**Implementation:** Create schema-registry with output schema for every tool.

**Anti-bandaid criteria:**
- [ ] Every tool registered in schema-registry
- [ ] All existing tests still pass

---

## VALIDATION CHECKLIST (Post-Implementation)

After ALL phases complete:
- [ ] `npm test` passes (1527+ tests)
- [ ] `npm run build:cli` clean
- [ ] `npm run lint` 0 errors
- [ ] No plaintext credentials in any LLM prompt
- [ ] Zero hardcoded regex for auth/technique detection
- [ ] Scope guard on all outbound HTTP/browser actions
- [ ] Campaign runs in multi-model engine
- [ ] Exploitation loop runs in all engines
- [ ] Council debate memory persists across restarts
- [ ] Human actions auto-save to graph
- [ ] Skill composition rules enforced
- [ ] OAST callbacks polled in background
- [ ] Chain detection runs after each turn
- [ ] Budget exhaustion communicated to brain
- [ ] Session expiry handled gracefully
- [ ] Cross-engagement memory saved on shutdown
- [ ] Single EvidenceGate instance shared across engines
- [ ] Single session store (graph-backed)

---

## DECISIONS REQUIRED (From User)

| # | Decision | Options | Recommendation |
|---|----------|---------|----------------|
| D-01 | Session storage | A) Graph-only B) Dual with sync | A -- simpler |
| D-02 | Campaign default | A) Auto-on B) Opt-in | A -- autonomous vision |
| D-03 | Council mode | A) On-demand B) Always-on | A -- current design |
| D-04 | Credential handling | A) Never inject B) Mask in logs | A -- matches README |
| D-05 | Budget tracking | A) Single tracker B) Per-engine | A -- prevents double-spend |

---

## EFFORT SUMMARY

| Phase | Tasks | Hours | Dependencies |
|-------|-------|-------|--------------|
| P0: Security | 6 | 16 | None |
| P1: Core Wiring | 5 | 16 | None |
| P2: Intelligence | 5 | 20 | P0-02, P1-04 |
| P3: Operational | 5 | 10 | P0-02, P1-01 |
| P4: Hygiene | 3 | 8 | None |
| **Total** | **24** | **70** | |

**Critical path:** P0-02 -> P2-02 (3+3 hrs) and P1-04 -> P2-05 (3+3 hrs)
**Maximum parallelism:** 15 of 24 tasks have zero dependencies

---

## ARCHITECTURAL DECISIONS TO ENFORCE

1. **No regex anywhere** for auth detection, technique mapping, or data extraction. Structured types only.
2. **TechniqueRegistry** is single source of truth for ALL technique-related mappings.
3. **GraphStore** is single source of truth for ALL persistent state (sessions, findings, debates).
4. **EvidenceGate** is a singleton, created once, shared by all engines.
5. **CoreServices** is the dependency injection point — all shared instances go through here.
6. **SkillRegistry.resolve()** enforces composition rules before any skill is loaded.
7. **buildIntelligencePrompt()** is the single helper for anti-loop/evidence-gate/reflexion injection.

---

## FILES TO MODIFY (Complete List)

| File | Tasks | Phase |
|------|-------|-------|
| `src/analysis/instructions.ts` | P0-01 | P0 |
| `src/capture/human-observer.ts` | P0-02, P2-02, P3-05 | P0, P2, P3 |
| `src/tools/flow-tools.ts` | P0-03 | P0 |
| `src/solver/exploitation-loop.ts` | P0-04 | P0 |
| `src/campaign/planner.ts` | P0-05 | P0 |
| `src/spider/agent.ts` | P0-06 | P0 |
| `src/spider/instructions.ts` | P0-06 | P0 |
| `src/tools/session-tools.ts` | P1-01, P3-03, P4-02 | P1, P3, P4 |
| `src/http/session-manager.ts` | P1-01 | P1 |
| `src/solver/solver.ts` | P1-02, P1-03 | P1 |
| `src/core/evidence.ts` | P1-03 | P1 |
| `src/tools/control-tools.ts` | P1-03 | P1 |
| `src/session/lifecycle.ts` | P1-04, P2-04, P3-01, P3-02 | P1, P2, P3 |
| `src/session.ts` | P1-05 | P1 |
| `src/council/orchestrator.ts` | P2-01 | P2 |
| `src/council/debate-memory.ts` | P2-01 | P2 |
| `src/graph/schema.ts` | P2-01 | P2 |
| `src/solver/skills/registry.ts` | P2-03 | P2 |
| `src/intelligence/cross-engagement.ts` | P2-04 | P2 |
| `src/oast/server.ts` | P3-01 | P3 |
| `src/campaign/executor.ts` | P3-04 | P3 |
| `src/intelligence/anti-loop.ts` | P4-01 | P4 |
| `src/tools/schema-registry.ts` | P4-03 | P4 (NEW) |
| **Total: 23 files** | | |
