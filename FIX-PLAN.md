# v8 Regression Fixes — Detailed Build Plan

## Executive Summary

v8 built sophisticated intelligence layers (EvidenceGate, Reflexion, Anti-Loop, Blackboard) on top of a broken foundation. Three regressions from v7 must be fixed before any of the v8 theory can reflect in output:

1. **Workers lost browser access** — zero Stagehand tools, can't navigate/fill/click
2. **Brain instructions lost richness** — rigid spec vs v7's mentor-like conversational guidance
3. **Solver loop is rigid** — PLAN→EXECUTE→CONCLUDE state machine vs organic conversation

---

## Phase 1: Workers Get Browser (Fix 1 — restores 60% testing capability)

### Problem
`spawn-worker.ts` line 75: `workerPool.spawn({ skillId, task, tier })` — no `browser` field.
`WorkerConfig.browser` exists in `factory.ts` but is never populated.
Legacy v7 workers had full Stagehand access (navigate, act, observe, extract, screenshot).

### Files to Change

#### 1.1 `src/manager/tools/spawn-worker.ts`
- Import `getActiveBrowser` from `../../browser/manager`
- Add `browser: getActiveBrowser() || undefined` to the `workerPool.spawn()` call at line 75

#### 1.2 `src/manager/tools/spawn-swarm.ts`
- Import `getActiveBrowser` from `../../browser/manager`
- Add `browser: getActiveBrowser() || undefined` to each `workerPool.spawn()` call in `executeSingle()`

#### 1.3 `src/workers/pool.ts`
- Update `spawn()` method signature to pass `browser` through to factory
- Update `execute()` method to pass `browser` through

#### 1.4 `src/workers/factory.ts`
- `WorkerConfig` already has `browser?: StagehandBrowser` — no change needed
- `create()` already passes `browser: workerConfig.browser` to `createAgent()` — no change needed
- Just need the spawn chain to actually populate it

### Verification
- `npm run lint` — no type errors
- `npm test` — existing tests pass
- Manual: solver brain calls `spawn-worker` → worker has `stagehand_navigate`, `stagehand_observe`, etc.

---

## Phase 2: Brain Instructions Rewrite (Fix 2 — restores conversational richness)

### Problem
`brain-instructions.ts` is 131 lines of rigid spec. v7's `instructions.ts` was 205 lines of mentor-like guidance with:
- Detailed tool call examples (JSON code blocks)
- Human-in-the-Loop protocol (28 lines)
- Auth context guidance for workers
- Stale awareness with specific strategies
- Rate limit awareness
- Cross-technique chaining examples
- Post-spawn refresh rules

### File to Change

#### 2.1 `src/solver/brain-instructions.ts`
Complete rewrite. Structure:

```
Core Contract (import from prompts/core-contract.ts)

Conversational Style
- You are a security researcher having a conversation
- Respond naturally to greetings, questions, directions
- When given a goal, analyze context and act

Current State Awareness
- Read the graph state injected into each prompt
- Know what endpoints exist, what's been tested, what findings exist
- Use this context — don't ask the user for info you already have

Tool Usage (Organic, Not Phased)
- skill-search: find methodology for attack types
- spawn-worker: delegate to specialized worker (ALWAYS pass endpointId)
- spawn-swarm: multiple workers (use sequential by default for chaining)
- execute-direct: quick inline tests
- createPlan / updatePlan / getPlan: structured task tracking
- writeFinding / recordEvidence: persist findings
- queryGraph / updateGraph: read/write state
- askUser: ask human for help (with waitForBrowserAction for browser tasks)
- getFullContext: complete target picture

Worker Spawning (Detailed)
- ALWAYS pass endpointId so worker gets informed context
- Workers have browser access — they can navigate, fill forms, click
- After spawning, check graphDiff for new findings
- ALWAYS call getTargetSummary() after worker completes
- Sequential (parallel: false) enables attack chaining
- Parallel (parallel: true) only for independent endpoints

Human-in-the-Loop (Full Protocol)
- When stuck on auth: askUser with waitForBrowserAction
- Human demonstrates in browser → capture actions
- saveSession() after authentication
- restoreSession() for subsequent runs
- observeHumanActions() to see what human did
- saveLearnedFlow() for multi-step processes
- reproduceFlow() to replay learned flows

Auth Context for Workers
- Workers should call getCapturedHeaders(url) before HTTP requests
- Use captured headers in httpRequest headers parameter
- Store new sessions with storeSession

Stale Detection
- After 3 failures on same attack path → STOP
- List 3 fundamentally different alternatives
- Switch attack type, not just payload encoding
- Target different endpoint or auth role

Rate Limit Awareness
- All agents share the same API budget
- Each worker makes 5-15 API calls
- Sequential is more reliable when limits are tight
- If workers are slow, rate limiter is doing its job

Attack Path Tracking
- Declare [PATH: type] when switching attack types
- Valid types: sqli, xss, ssrf, rce, ssti, idor, auth_bypass, etc.

Cross-Technique Chaining
- XSS + session → session hijack
- SQLi → data extraction → IDOR on extracted IDs
- IDOR + mass assignment → privilege escalation
- Race conditions on financial endpoints → double-spend

Output Format
- Concise, technical, evidence-based
- [+] confirmed, [!] warnings, [-] failures, [->] next steps
- Reference findings with endpoint + technique
```

### Verification
- `npm run lint` — no type errors
- Brain responds conversationally to "hi"
- Brain creates plan and tests when given security goal
- Brain asks for help when stuck

---

## Phase 3: Organic Solver (Fix 3 — unlocks v8 intelligence layers)

### Problem
`solver.ts` is a 593-line rigid state machine with 4 hardcoded phase functions.
Every REPL input forces through PLAN→EXECUTE→CONCLUDE regardless of intent.
The brain correctly identified "hi" as a greeting but the code structure overrode it.

### File to Change

#### 3.1 `src/solver/solver.ts`
Gut the rigid loop. Replace with thin context-injection wrapper.

**Remove (~400 lines):**
- `runPlanPhase()` (lines 259-348)
- `runReasonPhase()` (lines 358-406)
- `runExplorePhase()` (lines 415-516)
- `runConcludePhase()` (lines 524-593)
- The `while (totalSteps < cfg.maxSteps)` loop (lines 129-217)
- Text-based plan fallback parsing (lines 316-346)
- `emptyReasonStreak` counter

**Replace with (~120 lines):**

```typescript
export async function solve(agent, params): Promise<SolveResult> {
  const board = new Blackboard({ origin, goal })
  const evidence = new EvidenceGate()
  const reflexion = new ReflexionEngine()

  // Seed facts
  board.addFact(`Target origin=${params.origin}; goal=${params.goal}`, 'origin')

  // Build context prompt — user input + full graph state
  const contextPrompt = buildContextPrompt(board, params.goal)

  // Stream brain — it decides everything (greet, plan, test, ask, conclude)
  let fullText = ''
  let toolCallCount = 0

  const stream = await agent.stream(contextPrompt, {
    maxSteps: params.config?.maxToolRounds ?? 10,
  })

  for await (const chunk of stream.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        fullText += chunk.payload.text
        params.onText?.(chunk.payload.text)
        break
      case 'tool-call':
        toolCallCount++
        board.recordToolCall(chunk.payload.toolName, ...)
        break
      case 'tool-result':
        evidence.recordToolOutput(JSON.stringify(chunk.payload.result))
        break
    }
  }

  // Bookkeeping
  workspace.getGraphStore()?.save()

  return {
    completed: false,  // Brain decides when to stop, not the solver
    reason: 'turn_complete',
    steps: 1,
    facts: board.facts.length,
    intents: board.intents.length,
    toolCalls: toolCallCount,
    text: fullText,
  }
}
```

**Key behavioral changes:**
- No more hardcoded phases — brain decides flow
- One call per REPL input = one conversational turn
- Brain can do multiple tool calls within a turn (plan + test + conclude)
- User redirects by typing next message
- `maxSteps` prevents runaway (default 10 tool calls per turn)

#### 3.2 `src/session.ts`
- Remove verbose post-solve output (lines 459-468)
- Display brain's text response directly
- Show plan summary only if brain created a plan this turn
- Handle conversational results naturally

### Verification
- `npm run lint` — no type errors
- `npm test` — existing solver tests pass (may need updates for new API)
- Manual: "hi" → brain responds conversationally
- Manual: "test login for SQLi" → brain plans + tests organically
- Manual: "stop, try XSS instead" → brain redirects on next turn

---

## Phase 4: Rate Limiter Cooldown (Supporting fix)

### Problem
User configures `requestsPerMinute: 25`. Provider returns `ResourceExhausted`. Current behavior: retry with exponential backoff (1s, 2s, 4s). Not enough for provider-level worker limits.

### File to Change

#### 4.1 `src/models/rate-limiter.ts`
- Add `cooldownUntil: number` field to `TokenBucket`
- Add `cooldown(ms: number)` method
- In `acquire()`, check `cooldownUntil` and wait if in cooldown

#### 4.2 `src/models/middleware.ts`
- On `ResourceExhausted` error, call `bucket.cooldown(60_000)` and warn user
- This is a general mechanism — works for any provider

### Verification
- Simulate rate limit error → bucket enters 60s cooldown
- User sees warning message

---

## Phase 5: HumanObserver Headless Fix (Supporting fix)

### Problem
`STAGEHAND_INIT_SCRIPT` injected even in headless mode, interfering with Stagehand's DOM observation.

### File to Change

#### 5.1 `src/capture/human-observer.ts`
- Accept `headless` parameter in constructor or `attach()`
- Skip `STAGEHAND_INIT_SCRIPT` injection when headless=true
- Only inject when human is actually watching the browser

### Verification
- Headless mode: no init script injected
- Non-headless mode: init script injected as before

---

## Phase 6: Stagehand Model Logging (Diagnostic)

### Problem
User can't see which model Stagehand uses for observe/act/extract. Can't diagnose observe failures.

### File to Change

#### 6.1 `src/browser/manager.ts`
- After creating `StagehandBrowser`, log the model name
- `log.info('Stagehand model: ${stagehandModel.modelName}')`

### Verification
- On startup, user sees which model Stagehand is using

---

## Build Order

1. **Phase 1** (browser) — independent, can build first
2. **Phase 4** (rate limiter) — independent, can build in parallel
3. **Phase 5** (human observer) — independent, can build in parallel
4. **Phase 6** (logging) — independent, can build in parallel
5. **Phase 2** (brain instructions) — depends on nothing, but informs Phase 3
6. **Phase 3** (organic solver) — depends on Phase 2 (instructions define brain behavior)

Phases 1, 4, 5, 6 can be built in parallel. Phase 2 next. Phase 3 last.

---

## Test Plan

After all phases:
1. `npm run lint` — zero type errors
2. `npm test` — all existing tests pass
3. `npm run build` — clean build
4. Manual REPL test:
   - "hi" → conversational response, no auto-plan
   - "test the login page" → brain creates plan, tests, reports
   - "stop, try XSS instead" → brain redirects
   - Workers have browser tools (verify via tool call logs)
   - Rate limit error → cooldown + warning (not crash)

---

## Files Changed (Summary)

| File | Phase | Change |
|------|-------|--------|
| `src/manager/tools/spawn-worker.ts` | 1 | Pass browser to workerPool.spawn() |
| `src/manager/tools/spawn-swarm.ts` | 1 | Pass browser to workerPool.spawn() |
| `src/workers/pool.ts` | 1 | Pass browser through spawn/execute |
| `src/solver/brain-instructions.ts` | 2 | Complete rewrite — conversational mentor tone |
| `src/solver/solver.ts` | 3 | Gut rigid loop, replace with context wrapper |
| `src/session.ts` | 3 | Simplify post-solve output |
| `src/models/rate-limiter.ts` | 4 | Add cooldown() method |
| `src/models/middleware.ts` | 4 | Cooldown on ResourceExhausted |
| `src/capture/human-observer.ts` | 5 | Skip init script in headless |
| `src/browser/manager.ts` | 6 | Log Stagehand model |
