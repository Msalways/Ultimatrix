# Ultimatrix v8 — Fix Plan (15 Issues, 8 Tasks, ~40 Files)

> Generated 2026-07-05. Root-cause fixes only — no bandaids, no hardcoded scenarios.
> 
> ✅ **COMPLETED** — All 8 tasks completed successfully (2026-07-06)

---

## Architecture Decision: Tool Return Convention

**The codebase has two return conventions:**
- Convention A `{ ok: true, value: {...} }` — graph tools (17), HTTP tools (4), skill tools, reaction tools, flow tools, control tools, encode/decode
- Convention B (flat) — spawn-worker, spawn-swarm, execute-direct, skill-load, plan-tools

**Decision: Standardize on Convention A.** All tools return `{ ok, value }` internally. `toModelOutput` strips the wrapper for LLM consumption. This eliminates LLM confusion, schema mismatches, and TOOL_METADATA drift.

---

## Architecture Decision: Skill Matching

**Current state:** Three independent scoring systems. `dispatcher.ts` is dead code. `toolRefs` declared but never used for brain tool filtering. Keyword substring matching fails for synonyms and context.

**Decision:**
1. Delete `dispatcher.ts` (dead code)
2. Add `triggers` natural-language field to skill YAML frontmatter
3. Rewrite `tool-filter.ts:resolveSkillsForInput()` to score by semantic description match
4. Brain instructions rewritten for intent understanding, not keyword association

---

## Task Status Summary

| Task | Status | Completed | Files Changed | Notes |
|------|--------|-----------|---------------|-------|
| **Task 1**: Standardize Tool Return Convention | ✅ **COMPLETED** | 2026-07-06 | 12 files | All tools now return `{ ok, value }` pattern |
| **Task 2**: Fix queryNodes Filter Interface | ✅ **COMPLETED** | 2026-07-06 | 2 files | Filter interface now handles undefined/null values |
| **Task 3**: Fix Dialog Watcher CDP API | ✅ **COMPLETED** | 2026-07-06 | 1 file | CDP API calls corrected to use `session.send()` |
| **Task 4**: Rewrite Skill Matching System | ✅ **COMPLETED** | 2026-07-06 | 24 files | Natural language triggers replace keyword matching |
| **Task 5**: Rewrite Brain Instructions | ✅ **COMPLETED** | 2026-07-06 | 4 files | Intent understanding replaces keyword pattern matching |
| **Task 6**: Fix Spider Capture + Verification | ✅ **COMPLETED** | 2026-07-06 | 4 files | Auto-page recording, progress tracking, verification |
| **Task 7**: Fix Test Generation Pipeline | ✅ **COMPLETED** | 2026-07-06 | 3 files | Category-specific assertions, proper data flow |
| **Task 8**: Config Completeness + Model Logging | ✅ **COMPLETED** | 2026-07-06 | 5 files | Enhanced config, model logging, backoff config |

---

## Task 1: Standardize Tool Return Convention

**Root cause:** Inconsistent `{ ok, value }` vs flat returns cause LLM confusion, schema validation failures, and metadata drift.

### 1.1 — Add `toModelOutput` to all `{ ok, value }` tools

Strips the wrapper so the LLM sees flat output. The AI SDK calls `toModelOutput(output)` automatically when present.

| File | Tool(s) | Change |
|------|---------|--------|
| `src/graph/tools.ts` | All 17 tools | Add `toModelOutput: (output: any) => output?.value ?? output` |
| `src/tools/http-tools.ts` | httpRequest, multipartUpload, followRedirects, omitHeader | Add `toModelOutput` |
| `src/tools/har-tools.ts` | getCapturedHeaders, storeSession | Fix outputSchema to match `{ ok, value }` + add `toModelOutput` |
| `src/tools/skill-tools.ts` | loadSkillReference, searchSkillTool | Add `toModelOutput` |
| `src/tools/control-tools.ts` | writeFinding, recordEvidence | Add `toModelOutput` |
| `src/tools/reaction-tools.ts` | detectReactions, getDialogEvidence, getRecentChanges | Add `toModelOutput` |
| `src/tools/flow-tools.ts` | saveSession, restoreSession, observeHumanActions, saveLearnedFlow, reproduceFlow | Add `toModelOutput` |
| `src/tools/encode-decode.ts` | encodeDecode | Add `toModelOutput` |
| `src/tools/report-tools.ts` | readReport | Add `toModelOutput` |
| `src/tools/session-tools.ts` | extractSessionCookie, extractCsrfToken, useSession | Add `toModelOutput` |
| `src/tools/observation-tools.ts` | parseResponse, evaluateRendered, measureTiming, compareResponses, checkWaf, findEndpointsInResponse | Add `toModelOutput` |
| `src/tools/detect-chains-tool.ts` | detectChains | Add `toModelOutput` |

**Pattern for every tool:**
```typescript
// BEFORE:
return { ok: true, value: { status, body, ... } }

// AFTER (add to createTool call):
toModelOutput: (output: any) => output?.value ?? output,
// Result for LLM: { status, body, ... }
```

### 1.2 — Wrap flat tools in `{ ok, value }`

| File | Tool(s) | Change |
|------|---------|--------|
| `src/manager/tools/spawn-worker.ts` | spawn-worker | Wrap return in `{ ok: true, value: { workerId, status, result, graphDiff } }` + add `toModelOutput` |
| `src/manager/tools/spawn-swarm.ts` | spawn-swarm | Wrap return in `{ ok: true, value: { swarmId, mode, workers } }` + add `toModelOutput` |
| `src/manager/tools/execute-direct.ts` | execute-direct | Wrap return in `{ ok: true, value: { result, error } }` + add `toModelOutput` |
| `src/manager/tools/skill-load.ts` | skill-load | Wrap return in `{ ok: true, value: { skill } }` + add `toModelOutput` |
| `src/manager/tools/skill-search.ts` | searchSkills | Wrap return in `{ ok: true, value: { skills } }` + add `toModelOutput` |
| `src/solver/plan-tools.ts` | createPlan, updatePlan, getPlan | Wrap returns in `{ ok: true, value: {...} }` + add `toModelOutput` |
| `src/tools/app-model-tools.ts` | readAppModelSection, writeAppModelSection | Wrap returns + add `toModelOutput` |
| `src/tools/record-test-case.ts` | recordTestCase | Wrap returns + add `toModelOutput` |
| `src/oast/tools.ts` | getOastUrlTool, checkOastCallbacks, clearOastCallbacks | Wrap returns + add `toModelOutput` |

### 1.3 — Delete or auto-generate TOOL_METADATA

| File | Change |
|------|--------|
| `src/mastra/tools.ts` | Option A: Delete `TOOL_METADATA` dictionary entirely (it's only used for documentation, not runtime). Option B: Generate from actual tool definitions. **Recommendation: A — delete it.** |

### 1.4 — Fix outputSchema mismatches

| File | Tool | Issue | Fix |
|------|------|-------|-----|
| `src/tools/har-tools.ts:15` | getCapturedHeaders | Schema says `{ headers }`, returns `{ ok, value: { headers } }` | Change schema to `{ ok, value: { headers, authType, source } }` |
| `src/tools/har-tools.ts:101` | storeSession | Schema says `{ stored }`, returns `{ ok, value: { stored } }` | Change schema to `{ ok, value: { stored, sessionName, headerCount } }` |

### 1.5 — Fix TOOL_METADATA field mismatches (if not deleted)

| File | Tool | Issue |
|------|------|-------|
| `src/mastra/tools.ts:315` | httpRequest | Schema says `duration`, actual is `durationMs`; schema says `redirected`, doesn't exist |
| `src/mastra/tools.ts:431` | parseResponse | Schema fields don't match actual return |

### Testing

- All existing tests should pass (no behavioral change — only output shape for LLM changes)
- Add test: verify `toModelOutput` strips `{ ok, value }` wrapper correctly
- Add test: verify outputSchema matches actual return for every tool with schema

---

## Task 2: Fix queryNodes Filter Interface

**Root cause:** `queryNodes(type?, filters?)` accepts `Record<string, unknown>`. Undefined values pass the `if (filters)` check and filter out all results.

### 2.1 — Skip undefined/null/empty filter values

| File:Line | Change |
|-----------|--------|
| `src/graph/store.ts:539-556` | Add at top of filter loop: `if (value === undefined \|\| value === null \|\| value === '') continue` |

### 2.2 — Only build filters from defined values (defense-in-depth)

| File:Line | Change |
|-----------|--------|
| `src/graph/tools.ts:20-24` | Replace `{ url, method, tags } as any` with conditional object construction |

**Pattern:**
```typescript
// BEFORE:
const result = store.queryNodes(type, { url, method, tags } as any)

// AFTER:
const filters: Record<string, unknown> = {}
if (url !== undefined) filters.url = url
if (method !== undefined) filters.method = method
if (tags !== undefined) filters.tags = tags
const result = store.queryNodes(type, Object.keys(filters).length > 0 ? filters : undefined)
```

### Testing

- Add test: `queryNodes('Endpoint', { url: undefined })` returns all endpoints
- Add test: `queryNodes('Endpoint', {})` returns all endpoints
- Add test: `queryNodes('Endpoint')` returns all endpoints
- Add test: `queryNodes('Endpoint', { method: 'GET' })` returns only GET endpoints

---

## Task 3: Fix Dialog Watcher CDP API

**Root cause:** Entire file uses `conn.send({ sessionId, method, params })` — wrong API. Should be `session.send(method, params)` where `session = conn.getSession(sessionId)`.

### 3.1 — Fix `wireDialogHandler` (lines 100-132)

| Line | Change |
|------|--------|
| 109 | `conn.send({sessionId, method: "Page.enable", params: {}})` → `session.send("Page.enable")` (move after session acquisition) |
| 112-114 | Keep session acquisition, but handle undefined |
| 119 | Store session ref in closure for dismiss |

### 3.2 — Fix `wireExistingPages` (lines 141-182)

| Line | Change |
|------|--------|
| 143 | `context.pages` → `context.pages()` (method call) |
| 155-159 | Simplify — `session.id` is always string per type declarations |
| 164 | Same as 3.1 — use `session.send("Page.enable")` |

### 3.3 — Fix `handleDialog` dismiss (lines 187-233)

| Line | Change |
|------|--------|
| 212-228 | Replace entire dismiss block with `session.send("Page.handleJavaScriptDialog", params)` |
| 119,169 | Store session ref in handler closure, not just sessionId string |

**Pattern for dismiss:**
```typescript
// BEFORE (broken):
const dismissPayload = { sessionId, method: "Page.handleJavaScriptDialog", params: ... }
conn.send(dismissPayload).catch(...)

// AFTER (correct):
session.send("Page.handleJavaScriptDialog", params.type === "prompt" ? { promptText: "" } : {})
  .catch(err => log.dim(`[dialog-watcher] Dismiss failed: ${err}`))
```

### Testing

- Manual: trigger XSS alert on xss-game → dialog auto-dismisses → page remains usable
- Manual: `stagehand_extract` works after dialog fires
- Existing dialog-watcher tests pass

---

## Task 4: Rewrite Skill Matching System

**Root cause:** Keyword substring matching fails for synonyms, context, false positives. Three independent scoring systems.

### 4.1 — Add `triggers` field to all skill YAML frontmatter

| File | Change |
|------|--------|
| `skills/core/recon.md` | Add `triggers:` natural-language description |
| `skills/core/vuln-discovery.md` | Same |
| `skills/core/exploitation.md` | Same |
| `skills/core/post-exploitation.md` | Same |
| `skills/core/reporting.md` | Same |
| `skills/core/waf-bypass.md` | Same |
| `skills/core/pentest-flow.md` | Same |
| `skills/specialized/web-pentest.md` | Same |
| `skills/specialized/web-security-advanced.md` | Same |
| `skills/specialized/crypto-toolkit.md` | Same |
| `skills/specialized/ctf-web.md` | Same |
| `skills/specialized/ctf-crypto.md` | Same |
| `skills/specialized/ctf-misc.md` | Same |
| `skills/specialized/osint-recon.md` | Same |
| `skills/specialized/ai-mcp-security.md` | Same |
| `skills/specialized/intranet-pentest.md` | Same |
| `skills/specialized/pentest-tools.md` | Same |
| `src/analysis/skills/authorization.md` | Same |
| `src/analysis/skills/business-logic.md` | Same |
| `src/analysis/skills/information-disclosure.md` | Same |
| `src/analysis/skills/race-conditions.md` | Same |

**Example `triggers` for pentest-flow.md:**
```yaml
triggers: |
  User wants to run a full penetration test or assessment.
  Mentions pentest, security assessment, audit, or end-to-end testing.
  User is starting a new engagement and wants a structured approach.
  Asks for workflow or methodology guidance.
  NOT for specific vulnerability classes — use vuln-discovery instead.
  NOT for reconnaissance only — use recon instead.
```

### 4.2 — Update skill loader

| File:Line | Change |
|-----------|--------|
| `src/skills/loader.ts` | Add `triggers` to `Skill` interface and `parseFrontmatter()` |

### 4.3 — Rewrite skill matching

| File | Change |
|------|--------|
| `src/skills/tool-filter.ts` | Rewrite `resolveSkillsForInput()`: score by description + triggers word overlap (not substring). Add penalty for keyword-only matches. Return max 3 by score. |

**Scoring algorithm:**
```
For each skill:
  score = 0
  // Description match (most important)
  for each word in userInput:
    if word appears in skill.description: score += 5
    if word appears in skill.triggers: score += 3
    if word appears in skill.name: score += 8
    if word appears in skill.id: score += 10
  // Negative signals (NOT matches)
  for each "NOT for" phrase in triggers:
    if all words in phrase match user input: score -= 20
  // Cap at top 3
```

### 4.4 — Delete dead code

| File | Change |
|------|--------|
| `src/skills/dispatcher.ts` | DELETE — dead code, never called at runtime |

### Testing

- "navigate to target" → matches pentest-flow (not web-pentest)
- "test for SQL injection" → matches vuln-discovery
- "what do you see?" → matches nothing (just conversational)
- "i will authenticate" → matches nothing (user is handling auth)
- "generate a report" → matches reporting
- "check for XSS" → matches vuln-discovery
- "bypass the WAF" → matches waf-bypass

---

## Task 5: Rewrite Brain Instructions for Intent Understanding

**Root cause:** LLM pattern-matches keywords ("authenticate" → askUser) instead of understanding intent ("I will handle auth" → navigate and wait).

### 5.1 — Rewrite Human-in-the-Loop section

| File:Line | Change |
|-----------|--------|
| `src/solver/brain-instructions.ts:133-140` | Rewrite entirely |

**New section:**
```markdown
## Human-in-the-Loop

### When the client says THEY will handle something:
- "I will authenticate" / "I'll log in" / "I'll handle the creds"
  → Navigate to the target URL. Tell them what you see. Let them act.
  → DO NOT call askUser. They told you they will do it themselves.
  → After they say "done" or you observe changes, continue testing.

### When YOU are stuck and cannot proceed:
- CAPTCHA or human verification you cannot solve
- You need information the client hasn't provided (specific credentials, role, etc.)
- You need a decision between multiple paths
  → THEN call askUser with a clear, specific question.

### Rule: askUser is the LAST RESORT, not the first option.
```

### 5.2 — Same rewrite for legacy paths

| File:Line | Change |
|-----------|--------|
| `src/mastra/index.ts:121-127` | Same Human-in-the-Loop rewrite |
| `src/manager/instructions.ts:159-163` | Same |

### 5.3 — Change askUser tool description

| File:Line | Change |
|-----------|--------|
| `src/tools/interaction-tools.ts:47` | Change from "Use when you need the user to log in" to "LAST RESORT — only when you are stuck and cannot proceed without human intervention" |

### 5.4 — Add conversational mode guidance

| File | Change |
|------|--------|
| `src/solver/brain-instructions.ts` | Add section: "You can respond with text only when the user asks a question or makes a statement that doesn't require tool calls. Not every message needs a tool response." |

### Testing

- "navigate to target, i will authenticate" → agent navigates, does NOT call askUser
- "what vulnerabilities did you find?" → agent queries graph, responds with text
- "help me understand this finding" → agent responds conversationally
- Only when genuinely stuck should askUser be called

---

## Task 6: Fix Spider Capture + Verification

**Root cause:** LLM-dependent recording means pages/endpoints can be missed silently. No verification that all observed elements were recorded.

### 6.1 — Auto-record page after navigation

| File:Line | Change |
|-----------|--------|
| `src/browser/dialog-inject.ts` | After `stagehand_navigate` executes: extract URL from result, call `getGlobalGraphStore().upsertPage(url)` if not already present. Append `pageRecorded: true` to result. |

### 6.2 — Fix stale detection enum

| File:Line | Change |
|-----------|--------|
| `src/session/lifecycle.ts:355` | `'endpoint' as any` → `NodeType.ENDPOINT` |
| `src/session/lifecycle.ts:358` | Same |

### 6.3 — Add spider stream rendering

| File:Line | Change |
|-----------|--------|
| `src/session/lifecycle.ts:356-368` | Extend chunk handler: `text-delta` → `process.stdout.write(chunk.payload.text)`, `tool-call` → `log.dim('  → ' + chunk.payload.toolName)`, `tool-result` → log success/error |

### 6.4 — Enhance getTargetSummary

| File:Line | Change |
|-----------|--------|
| `src/graph/store.ts:213-266` | Add `totalPages`, `totalActions`, `totalInputs` counts |

### 6.5 — Add post-crawl verification

| File | Change |
|------|--------|
| `src/session/lifecycle.ts` (after spider) | Count navigations from forensic log, compare to Page node count, warn on mismatch |

### 6.6 — Add missing tools to spider

| File | Change |
|------|--------|
| `src/spider/agent.ts` | Add `recordEvidence`, `findEndpointsInResponse`, `httpRequest` to spider tool set |

### Testing

- Run spider against 3-page site → verify 3 Page nodes
- `getTargetSummary()` shows correct page/action/input counts
- Stale detection triggers correctly with `NodeType.ENDPOINT`

---

## Task 7: Fix Test Generation Pipeline

**Root cause:** `autoGenerateTest` drops payload/param, hardcodes status 200, generates useless tests. `generateAssertionCode()` exists but is never called.

### 7.1 — Extend Finding interface

| File:Line | Change |
|-----------|--------|
| `src/generation/test-generator.ts:1-27` | Add fields: `payload?: string`, `param?: string`, `evidenceMarkers?: { reflectField?: string, sqlErrors?: string[], expectedStatus?: number, expectedContent?: string }` |

### 7.2 — Rewrite `generateTestCode()`

| File:Line | Change |
|-----------|--------|
| `src/generation/test-generator.ts:70-104` | Switch on `finding.category`: |

**Per-category proof logic:**
```
xss:
  - Inject payload via URL param or form
  - Assert payload reflected in response body (unescaped)
  - Optional: detect dialog event

sqli:
  - Inject payload, check for SQL error patterns
  - Or: compare row count vs baseline

idor:
  - Access resource with different auth context
  - Assert different user's data returned

authorization:
  - Request admin endpoint without auth
  - Assert 200 + admin content (should be 401/403)

information-disclosure:
  - Send malformed request
  - Assert sensitive data in response body

business-logic:
  - Send sequence of requests
  - Assert state violation

default (unknown):
  - Inject payload, assert status < 500 (at minimum)
```

### 7.3 — Wire `generateAssertionCode()` into `generateTestCode()`

| File:Line | Change |
|-----------|--------|
| `src/generation/test-generator.ts:98-99` | Replace `// TODO: Add assertion` with call to `generateAssertionCode(finding)` |

### 7.4 — Fix `autoGenerateTest()` data flow

| File:Line | Change |
|-----------|--------|
| `src/tools/control-tools.ts:197-241` | Pass `payload`, `param` through to Finding. Extract real status from evidence. Don't hardcode `status: 200`. |

**Pattern:**
```typescript
// BEFORE:
const testFinding: Finding = {
  // ... payload is DROPPED
  evidence: finding.evidence.map(e => ({
    response: { status: 200, body: e.data },  // HARDCODED
  })),
}

// AFTER:
const testFinding: Finding = {
  payload: finding.payload,      // PASSED THROUGH
  param: finding.param,          // PASSED THROUGH
  evidence: finding.evidence.map(e => ({
    response: { body: e.data },  // NO hardcoded status
  })),
}
```

### Testing

- Create mock XSS Finding with payload `<script>alert(1)</script>` → verify generated test injects payload and asserts reflection
- Create mock SQLi Finding → verify generated test checks for error patterns
- Create mock auth Finding → verify generated test checks 200 without auth
- All existing test-generator tests still pass

---

## Task 8: Config Completeness + Model Logging

**Root cause:** Rate limits hardcoded, no YAML sections generated, no model name visibility.

### 8.1 — Fix backoff config passthrough

| File:Line | Change |
|-----------|--------|
| `src/config.ts:694-698` | Add `backoffStrategy`, `backoffSteps`, `baseBackoffMs`, `maxBackoffMs` to `rateLimit` object in `validateConfig` return |
| `src/models/middleware.ts:37` | Include all backoff fields in `rl` construction |

### 8.2 — Generate advanced YAML sections in init wizard

| File | Change |
|------|--------|
| `src/cli/init.ts` | After writing browser/memory/agent sections, add: `rateLimit` (with defaults), `spider` (with defaults), `solver` (with defaults), `antiLoop` (with defaults), `providerRateLimits` (commented example) |

### 8.3 — Log model name at resolveModel chokepoint

| File:Line | Change |
|-----------|--------|
| `src/models/factory.ts:59` | Add `log.dim(`[model] Resolved: ${resolvedProvider}/${resolvedModelId}`)` before return |

### 8.4 — Fix REPL banner to show full model name

| File:Line | Change |
|-----------|--------|
| `src/session/lifecycle.ts:464` | Change `config.model` → `config.provider + '/' + config.model` |

### 8.5 — Add model to solve command startup

| File:Line | Change |
|-----------|--------|
| `src/cli/solve.ts:72` | Add model name to startup log |

### Testing

- Run `ultimatrix init` → verify YAML has rateLimit, spider, solver, antiLoop sections
- Run `ultimatrix solve` → verify model name appears in logs
- Verify rate limit retry uses backoffSteps (5000ms first, not 2000ms)

---

## Dependency Graph

```
Task 1 (tool convention)     ← NO DEPENDENCIES — START NOW
Task 2 (queryNodes)          ← NO DEPENDENCIES — START NOW
Task 3 (dialog watcher)      ← NO DEPENDENCIES — START NOW
Task 4 (skill matching)      ← NO DEPENDENCIES — START NOW
Task 5 (brain instructions)  ← NO DEPENDENCIES — START NOW
Task 6 (spider capture)      ← depends on Task 2 (queryNodes must work)
Task 7 (test generation)     ← NO DEPENDENCIES — START NOW
Task 8 (config + logging)    ← NO DEPENDENCIES — START NOW

ALL 7 TASKS PARALLEL: Tasks 1-5, 7-8
SEQUENTIAL: Task 6 starts after Task 2
```

## File Change Summary

| Task | Files Changed | Lines Changed (est.) |
|------|---------------|---------------------|
| 1: Tool convention | 12 | ~200 added |
| 2: queryNodes | 2 | ~10 |
| 3: Dialog watcher | 1 | ~40 rewritten |
| 4: Skill matching | 24 | ~100 TS + YAML |
| 5: Brain instructions | 4 | ~80 rewritten |
| 6: Spider capture | 4 | ~80 |
| 7: Test generation | 3 | ~120 |
| 8: Config + logging | 5 | ~50 |
| **Total** | **~45 unique** | **~680** |

## Post-Implementation

1. Run `npm test` — all existing tests should pass
2. Run `npm run build:cli` — clean build
3. Manual test: `npx ultimatrix interact -t https://xss-game.appspot.com` — verify:
   - Graph queries return results
   - Spider captures pages/endpoints
   - XSS alert detected and dismissed
   - Test generated proves the vulnerability
   - Agent responds conversationally
   - Model name appears in logs
