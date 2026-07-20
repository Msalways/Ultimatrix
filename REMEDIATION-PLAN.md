# Ultimatrix v8.4 — Remediation Plan (Task-Level Breakdown)

> **Generated:** 2026-07-20
> **Status:** AWAITING APPROVAL
> **Baseline:** 1527 tests, 140+ test files, 228 source files
> **Scope:** Security fixes, unwired logic, triggering failures, architectural gaps, sanitization
> **Hard Rule:** No bandaids. Fix root causes. No hardcoded patterns/regex/substring detection.

---

## EXECUTIVE SUMMARY

20 identified issues across 5 categories. Each task has:
- Exact files + line numbers
- Before/after code patterns
- Anti-bandaid acceptance criteria
- Test verification

**Total estimated effort: ~80 engineering hours across 5 phases (10 weeks)**

### Dependency Graph

```
P0-01 (credentials)    -- NO DEPS
P0-02 (human-observer) -- NO DEPS
P0-03 (flow-tools)     -- NO DEPS
P0-04 (exploit-loop)   -- NO DEPS
P0-05 (campaign tags)  -- NO DEPS
P0-06 (spider scope)   -- NO DEPS
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
```

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

**Tests:** `test/analysis/instructions.test.ts` — credentials mask passwords; secrets truncate values

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

---

### Task P0-03: Remove Hardcoded Regex from Flow Tools
**Severity:** HIGH | **Files:** `src/tools/flow-tools.ts` | **Effort:** 2 hrs

**Root cause:** `LOGIN_URL_PATTERNS` (line 16-19): 6 regex patterns for login URL detection.

**Implementation:** Replace with `Set` of path segments + `URL.pathname` split.

**Anti-bandaid criteria:**
- [ ] Zero `RegExp` in flow-tools.ts for login URL detection
- [ ] Uses `Set.has()` for O(1) membership check
- [ ] Tests: login URL detected; dashboard URL not detected

---

### Task P0-04: Remove Hardcoded TECHNIQUE_TO_PRIMITIVE Map
**Severity:** HIGH | **Files:** `src/solver/exploitation-loop.ts` | **Effort:** 2 hrs

**Root cause:** `TECHNIQUE_TO_PRIMITIVE` (line 32-42): hardcoded technique->primitive mapping duplicates TechniqueRegistry.

**Implementation:** Remove map; rewrite `resolvePrimitive()` to use `getTechniqueRegistry().getPrimitiveForTechnique()`.

**Anti-bandaid criteria:**
- [ ] Zero hardcoded technique->primitive pairs in `exploitation-loop.ts`
- [ ] TechniqueRegistry is single source of truth
- [ ] Tests: technique resolves via registry; unknown technique returns undefined

---

### Task P0-05: Remove Hardcoded Campaign Technique Tags
**Severity:** HIGH | **Files:** `src/campaign/planner.ts` | **Effort:** 2 hrs

**Root cause:** `GENERIC_TECHNIQUE_TAGS` (line 36) and `AUTH_TECHNIQUE_TAGS` (line 39): hardcoded string arrays.

**Implementation:** Move to TechniqueRegistry; planner reads from registry.

**Anti-bandaid criteria:**
- [ ] Zero hardcoded technique tag arrays in `planner.ts`
- [ ] TechniqueRegistry owns all technique classification
- [ ] Tests: new technique added to registry, planner uses it

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

---

### Task P1-02: Auto-Run Campaign in Multi-Model Engine
**Severity:** HIGH | **Files:** `src/solver/solver.ts` | **Effort:** 2 hrs

**Root cause:** `executeCampaign()` only runs when `config.engine === 'solver'` AND `config.campaign.auto`. Default engine is `multi-model`.

**Implementation:** Add campaign auto-run after exploitation loop when `config.campaign?.auto`.

**Anti-bandaid criteria:**
- [ ] `executeCampaign()` called in multi-model engine when `campaign.auto: true`
- [ ] `campaign.auto: false` (default) -> campaign NOT auto-run
- [ ] Test: auto=true, campaign starts without manual call

---

### Task P1-03: Unify EvidenceGate to Singleton
**Severity:** HIGH | **Files:** `src/solver/solver.ts`, `src/core/evidence.ts`, `src/tools/control-tools.ts` | **Effort:** 3 hrs

**Root cause:** Solver creates new `EvidenceGate()` per turn (solver.ts:357). Legacy/council use different instances.

**Implementation:** Create single `EvidenceGate` in `CoreServices`; pass to all engines.

**Anti-bandaid criteria:**
- [ ] Single instance created once at session start
- [ ] All engines share same instance
- [ ] Test: evidence in solver visible to council

---

### Task P1-04: Wire Intelligence Layers to All Engines
**Severity:** HIGH | **Files:** `src/session/lifecycle.ts` | **Effort:** 3 hrs

**Root cause:** Anti-loop, evidence-gate, and reflexion prompts only injected in solver engine. Legacy/council bypass all three.

**Implementation:** Extract `buildIntelligencePrompt()` helper; call in all engine prompt builders.

**Anti-bandaid criteria:**
- [ ] All three intelligence layers in prompt for legacy, solver, and council
- [ ] Shared helper, not duplicated logic
- [ ] Tests: stale detection in legacy prompt; hallucination warning in council prompt

---

### Task P1-05: Council Completion Handling
**Severity:** MEDIUM | **Files:** `src/session.ts` | **Effort:** 2 hrs

**Root cause:** `debateOnce()` returns `complete: true` but REPL never checks.

**Implementation:** Check `result.complete` in REPL turn handler; notify user.

**Anti-bandaid criteria:**
- [ ] `complete: true` triggers visible notification
- [ ] Test: mock complete=true, REPL emits message

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

---

### Task P2-02: Auto-Save Human-Observed Flows to Graph
**Severity:** HIGH | **Files:** `src/capture/human-observer.ts` | **Effort:** 3 hrs

**Root cause:** `AuthStateDetector.onStateChange()` callback registered but never triggers graph update.

**Implementation:** Wire `onStateChange` to record `AuthFlowNode` via `store.addAuthFlow()`.

**Anti-bandaid criteria:**
- [ ] Auth state change -> AuthFlowNode in graph
- [ ] Test: observe login page -> graph has AuthFlow node

---

### Task P2-03: Enforce Skill Composition Rules
**Severity:** MEDIUM | **Files:** `src/solver/skills/registry.ts` | **Effort:** 4 hrs

**Root cause:** `CompositionRule` (requires, enhances, conflicts) parsed but never enforced.

**Implementation:** Add `resolve()` to SkillRegistry checking requires/conflicts.

**Anti-bandaid criteria:**
- [ ] resolve() throws on missing required dependency
- [ ] resolve() warns on conflict
- [ ] Tests: missing dep -> error; conflict -> warning

---

### Task P2-04: Auto-Save Cross-Engagement Memory on Shutdown
**Severity:** MEDIUM | **Files:** `src/session/lifecycle.ts`, `src/intelligence/cross-engagement.ts` | **Effort:** 3 hrs

**Root cause:** `finalizeEngagementMemory()` (cross-engagement.ts:444) defined but never called.

**Implementation:** Call in lifecycle cleanup function.

**Anti-bandaid criteria:**
- [ ] Engagements saved before exit
- [ ] Test: mock shutdown, verify memory persisted

---

### Task P2-05: Run Exploitation Loop in All Engines
**Severity:** HIGH | **Files:** `src/session/lifecycle.ts` | **Effort:** 3 hrs

**Root cause:** `runExploitationLoop()` only runs in solver.ts:977-986, guarded by engine check. Legacy/council never run it.

**Implementation:** Add exploitation loop call in lifecycle after each turn for all engines.

**Anti-bandaid criteria:**
- [ ] Exploitation loop available in legacy+council
- [ ] Test: legacy engine, exploitation fires after findings

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

---

### Task P3-02: Chain Detection After Each Turn
**Severity:** MEDIUM | **Files:** `src/session/lifecycle.ts` | **Effort:** 1 hr

**Root cause:** `detectAndReportChains()` (lifecycle.ts:803) exists but only called from session.ts:626 (council path).

**Implementation:** Call after each REPL turn for all engines.

**Anti-bandaid criteria:**
- [ ] Chain detection fires after every turn
- [ ] Test: 3 linked findings -> chain reported

---

### Task P3-03: Session Expiry Auto-Refresh
**Severity:** MEDIUM | **Files:** `src/tools/session-tools.ts` | **Effort:** 2 hrs

**Root cause:** `restoreSession()` returns `sessionExpired: true` but brain never checks.

**Implementation:** Add session health check to `useSession` tool; auto-prompt re-login on expiry.

**Anti-bandaid criteria:**
- [ ] Expired session triggers re-login prompt
- [ ] Test: expired session -> prompt triggered

---

### Task P3-04: Budget Exhaustion Event to Brain
**Severity:** MEDIUM | **Files:** `src/campaign/executor.ts` | **Effort:** 1 hr

**Root cause:** `BudgetGuard.exceeded` stops campaign internally but no notification to brain/REPL.

**Implementation:** Emit forensic log event on budget exceeded.

**Anti-bandaid criteria:**
- [ ] Event emitted when budget exhausted
- [ ] Test: exhaust budget -> event visible

---

### Task P3-05: Expand maskValue for Sensitive Types
**Severity:** LOW | **Files:** `src/capture/human-observer.ts` | **Effort:** 1 hr

**Root cause:** `maskValue()` (line 194-206) only masks `password|hidden` inputs. Misses `credit-card`, `ssn`, `api-key`.

**Implementation:** Extend mask check to include `autocomplete`, `data-type`, and `name` attributes.

**Anti-bandaid criteria:**
- [ ] credit-card, ssn, api-key inputs masked
- [ ] Test: fill api-key field -> masked in log

---

## PHASE 4: HYGIENE (Weeks 9-10, ~8 hrs)

### Task P4-01: Input Validation for extractAttackPath
**Severity:** LOW | **Files:** `src/intelligence/anti-loop.ts` | **Effort:** 30 min

**Root cause:** `extractAttackPath` (line 39-44) uses regex `PATH_TAG_RE` without input length validation.

**Implementation:** Add max input length check; malformed input -> empty result.

**Anti-bandaid criteria:**
- [ ] Max input length enforced
- [ ] Malformed input returns empty result (no throw)

---

### Task P4-02: Cookie Parser Validation
**Severity:** LOW | **Files:** `src/tools/session-tools.ts` | **Effort:** 1 hr

**Root cause:** Cookie parsing regex `/^([^=]+)=([^;]*)/` (line 21) has no validation.

**Implementation:** Validate cookie name per RFC 6265; handle empty values, encoded chars.

**Anti-bandaid criteria:**
- [ ] Handles edge cases: empty values, encoded chars, `; ` separators
- [ ] ReDoS test: 10MB input completes in <100ms

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
| D-01 | Session storage | A) Graph-only B) Dual with sync | A — simpler |
| D-02 | Campaign default | A) Auto-on B) Opt-in | A — autonomous vision |
| D-03 | Council mode | A) On-demand B) Always-on | A — current design |
| D-04 | Credential handling | A) Never inject B) Mask in logs | A — matches README |
| D-05 | Budget tracking | A) Single tracker B) Per-engine | A — prevents double-spend |
