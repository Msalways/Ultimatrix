# Ultimatrix v8 — Complete Audit Flaws

> Generated: 2026-09-12
> Scope: Full architectural audit — CLI, Web UI, Engine, Tools, Graph, Browser, Build, Wiring, Swarm/Multi-Model

---

## Severity Legend

| Level | Meaning |
|-------|---------|
| **CRITICAL** | Causes crashes, data loss, or complete feature failure |
| **HIGH** | Significant behavioral bug, security gap, or broken capability |
| **MEDIUM** | Structural debt, type safety gap, or degraded functionality |
| **LOW** | Code quality, dead code, or minor inefficiency |

---

## CRITICAL (13 issues)

### C1. `resetAllProviderLimiters()` crashes before engagement context exists
- **File:** `src/session/lifecycle.ts:167`
- **Problem:** Called at line 167, but `createEngagementRuntime()` (which creates `EngagementServices`) runs at line 174. `getEngagementServices()` returns `undefined`, unconditional throw.
- **Impact:** Every `ultimatrix interact -t <url>` should crash before the session starts.
- **Fix:** Move inside `runtime.run()` after `createEngagementRuntime()`.

### C2. `ExecutionStrategy` interface is dead code — never implemented
- **File:** `src/core/types.ts:77-79`
- **Problem:** `ExecutionStrategy`, `StrategyContext`, `EnginePreset`, `StrategyId`, `RunResult`, `EngineType` types defined but never implemented. `src/core/strategies/` directory referenced in AGENTS.md does not exist on disk. Zero `implements ExecutionStrategy` matches.
- **Impact:** Documented "Unified Execution Core" is a phantom. Session runner uses ad-hoc `if/else` branches.
- **Fix:** Remove dead types, update AGENTS.md.

### C3. Council uses different tool surface than solver brain
- **File:** `src/council/factory.ts:243` vs `src/core/toolpack.ts:294`
- **Problem:** Council factory calls `createAgent()` which uses legacy `createToolRegistry()`, NOT `buildToolPack()`. Council members lack relation tools, primitives, campaigns, orchestration tools. Solver brain has them.
- **Impact:** Council operates with a degraded, inconsistent tool set.
- **Fix:** Council factory should use `buildToolPack()`.

### C4. Camoufox tool name mismatch — all safety wrapping bypassed
- **File:** `src/browser/dialog-inject.ts:40-48`
- **Problem:** `CAMOUFOX_TOOL_NAMES` expects `camofox_*` but `camoufox-tools.ts` creates tools with `stagehand_*` IDs. The `if (!toolNames.includes(name))` check always passes.
- **Impact:** Scope guard, dialog watcher, reaction observer, anti-bot, render tracing all silently bypassed for Camoufox provider.
- **Fix:** Update tool names to match actual IDs.

### C5. Contradictory Camoufox enablement — manager vs provider
- **File:** `src/browser/manager.ts:73-76` vs `src/browser/provider.ts:80-85`
- **Problem:** `manager.ts` throws `"not yet implemented"` for Camoufox. `provider.ts` creates a `CamoufoxProvider` with full implementation. Two code paths, two outcomes.
- **Impact:** Code through `resolveBrowserProvider` works; code through `getOrCreateBrowser` crashes.
- **Fix:** Remove the throw in `manager.ts` or gate it properly.

### C6. Wrong package import in state-bridge
- **File:** `src/browser/state-bridge.ts:1`
- **Problem:** `import type { Stagehand } from '@browserbasehq/stagehand'` — every other file uses `@mastra/stagehand`.
- **Impact:** Type mismatch if packages export different shapes.
- **Fix:** Change import to `@mastra/stagehand`.

### C7. `network-capture.ts` uses Playwright `page.on('response')` — broken for Stagehand v3
- **File:** `src/capture/network-capture.ts:41`
- **Problem:** Stagehand v3 is CDP-native with no Playwright `Page` event emitter. Response events silently never fire.
- **Impact:** Zero traffic captured when using `NetworkCapture` with Stagehand.
- **Fix:** Replace with CDP `Network.*` event subscription. Same issue in `src/capture/passive-observer.ts:66-67`.

### C8. Unawaited Promise in jwttool adapter — always appears available
- **File:** `src/tools/adapters/jwttool.ts:35`
- **Problem:** `isToolAvailable('jwttool')` not `await`ed — returns `Promise<boolean>` (always truthy).
- **Impact:** Scanner tries to run nonexistent binary, wastes time and produces errors.
- **Fix:** Add `await` before the second `isToolAvailable()`.

### C9. Dual tool registry divergence
- **File:** `src/tools/registry.ts` vs `src/mastra/tools.ts`
- **Problem:** `registerAllTools()` has 5 tools NOT in `createToolRegistry()`. `createToolRegistry()` has 11+ tools NOT in `registerAllTools()`. Tool resolution depends on which code path.
- **Impact:** Brain and resolver see different tool universes. Drift detection misses tools.
- **Fix:** Reconcile to single source of truth.

### C10. LibSQL store `getNode()` casts Promise as sync
- **File:** `src/graph/store-libsql.ts:726-744`
- **Problem:** `this.db.execute()` returns `Promise<ResultSet>` but code does `as unknown as { rows }` and accesses synchronously. Same in `queryEdges`, `queryNodes`, `addEdge`, `getAttackPath`, `exportToJson`.
- **Impact:** LibSQL store may be fundamentally broken for async backends.
- **Fix:** Make methods async or use synchronous LibSQL API correctly.

### C11. LibSQL store fire-and-forget DB writes
- **File:** `src/graph/store-libsql.ts:669-684`
- **Problem:** `insertNode`/`updateNode`/`deleteNode` return `void` but call async `executeWithTransaction`. Promises discarded.
- **Impact:** Insert failures invisible. Data loss on write failure.
- **Fix:** Make methods async, await transaction.

### C12. No per-tool-call timeout — hung tool blocks entire turn
- **File:** `src/solver/solver.ts:570-573,618`
- **Problem:** Only session-level 5-minute timeout. If a tool hangs, it blocks the entire solver turn until timeout or Ctrl+C.
- **Impact:** A single hung HTTP request or browser navigation stalls the engagement for up to 5 minutes.
- **Fix:** Wrap each tool execution in per-call `AbortSignal.timeout()`.

### C13. SIGINT does not abort in-flight tool calls
- **File:** `src/session/lifecycle.ts:904-915`
- **Problem:** `process.on('SIGINT', async () => { ... })` — Node.js does not await async callbacks. No `AbortController` signaled. Cleanup races with `process.exit(0)`. Double-registration on resume causes forced exit.
- **Impact:** Ctrl+C during tool call waits for tool to finish. Double Ctrl+C forces exit without cleanup.
- **Fix:** Store solver AbortController, signal it on SIGINT, use `process.off()` to prevent double-registration.

---

## HIGH (21 issues)

### H1. `skills` and `resume` commands unreachable
- **File:** `src/cli/index.ts:88-91`
- **Problem:** Not in `knownCommands` set — typed commands print "Unknown command" and exit.
- **Fix:** Add to `knownCommands`.

### H2. `assess` and `verify` are hollow wrappers
- **File:** `src/cli/assess.ts:27`, `verify.ts:23`
- **Problem:** Both set dead env vars (`OUTPUT_DIR`, `APP_MODEL_PATH`) then call `main()` — identical to `interact`.
- **Fix:** Implement real assessment/verification logic or remove the commands.

### H3. `config.engine: 'council'` has no routing effect
- **File:** `src/session.ts:565`
- **Problem:** Council is ONLY reachable via `/council <goal>` REPL command. `engine: council` config is cosmetic.
- **Fix:** Either route automatically or rename the config option.

### H4. `getActivePage()` always returns `null` in solver path
- **File:** `src/browser/manager.ts:234-246`
- **Problem:** `BrowserManagerState` created empty, never populated by `LazySolverServices`. Auth detection tools always fail.
- **Fix:** Populate `BrowserManagerState` from `LazySolverServices` or change accessor.

### H5. `visibleAssistantText()` suppresses valid answers
- **File:** `src/render-model.ts:127-141`, `src/components/chat-stream.tsx:209-210`
- **Problem:** Filters answers starting with `{` that look like JSON tool-intent. Valid JSON answers suppressed.
- **Fix:** Only suppress if the JSON has a `"tool"` key.

### H6. No fallback answer synthesis when LLM produces no text
- **File:** `src/solver/solver.ts:1035`, `src/app/api/solve/route.ts:113`
- **Problem:** If LLM only emits tool calls (no text-delta), `answerText` stays empty. Web shows "No assistant answer".
- **Fix:** Synthesize answer from tool results when `answerText` is empty.

### H7. Busy-wait spinloop blocks event loop
- **File:** `src/browser/manager.ts:81-86`
- **Problem:** Synchronous `while` loop with `Date.now()` check freezes Node.js for up to 30 seconds.
- **Fix:** Use promise-based lock.

### H8. Dialog-inject marks successful results as failure
- **File:** `src/browser/dialog-inject.ts:282-284`
- **Problem:** When dialog/reaction evidence exists but tool succeeded, code returns `{ success: false }`.
- **Fix:** Return `{ success: true, dialogEvidence, reactionEvidence }` — evidence is additive, not failure.

### H9. sessionStorage never exported — silent data loss
- **File:** `src/browser/state-bridge.ts:82`
- **Problem:** `exportStateFromStagehand` always returns `sessionStorage: {}`.
- **Fix:** Read `window.sessionStorage` during export.

### H10. Import navigates away, destroying page state
- **File:** `src/browser/state-bridge.ts:116-124`
- **Problem:** localStorage import calls `page.goto(origin)` per origin — destroys current page.
- **Fix:** Use `page.evaluate()` with storage API instead of navigation.

### H11. 11+ TOOL_METADATA schemas diverge from actual tools
- **File:** `src/mastra/tools.ts:430+`
- **Problem:** `parseResponse`, `evaluateRendered`, `measureTiming`, `compareResponses`, `checkWaf`, `cloudMetadataProbe`, `omitHeader`, `frameworkFingerprint`, `jwtDecode` — all have wrong input/output schemas.
- **Fix:** Update to match actual tool definitions or remove.

### H12. `writeFinding` screenshot capture not try/catch wrapped
- **File:** `src/tools/control-tools.ts:613`
- **Problem:** `captureScreenshot` failure crashes entire evidence-gated promotion logic.
- **Fix:** Wrap in `.catch(() => null)`.

### H13. 5 tools missing from TOOL_IDS
- **File:** `src/mastra/tools.ts:323-425`
- **Problem:** `useCredential`, `dualSessionOrchestrestrator`, `detectMarkerLeak`, `rawHttpClient`, `shadowApiDiscovery` — drift detection won't catch rot.
- **Fix:** Add to `TOOL_IDS` or remove from registry.

### H14. 5 phantom TOOL_IDS with no static registration
- **File:** `src/mastra/tools.ts:409-413`
- **Problem:** `spawnWorker`, `spawnSwarm`, `runTaskGraph`, `executeDirect` — created as anonymous factory tools.
- **Fix:** Document as dynamic-only or add static registration.

### H15. O(n) linear scan for every `addEndpoint`
- **File:** `src/graph/store.ts:288-292`
- **Problem:** No URL+method index. Performance degrades with graph size.
- **Fix:** Add Map-based index.

### H16. O(n) edge dedup on every `addEdge`
- **File:** `src/graph/store.ts:901`
- **Problem:** `edges.some()` over unbounded array.
- **Fix:** Use Set or Map for dedup.

### H17. `queryNodes` ignores `_filters` parameter in LibSQL
- **File:** `src/graph/store-libsql.ts:830`
- **Problem:** Callers expecting filtered results silently get all nodes.
- **Fix:** Implement filter logic.

### H18. `eslint.config.js` excludes `src/core/**` from linting
- **File:** `eslint.config.js:17`
- **Problem:** Unified execution core (toolpack, blackboard, evidence, types, approval) is unlinted.
- **Fix:** Remove from ignores.

### H19. `no-explicit-any` globally disabled
- **File:** `eslint.config.js:24`
- **Problem:** Root cause of 225+ `as any` casts.
- **Fix:** Enable rule, fix violations incrementally.

### H20. Empty JSX expression — skill name not rendered
- **File:** `src/components/graph-panel.tsx:376`
- **Problem:** `{}` renders nothing. Should be `{skill.name}`.
- **Fix:** Change to `{skill.name}`.

### H21. 5 tools lack structured evidence recording
- **File:** `src/tools/observation-tools.ts` (multiple)
- **Problem:** `measureTiming`, `evaluateRendered`, `cloudMetadataProbe`, `frameworkFingerprint`, `graphqlIntrospect` — make HTTP requests but don't record evidence. Evidence gate rejects their findings.
- **Fix:** Add `recordObserved()` calls.

---

## MEDIUM (34 issues)

### M1. Version string is `"Ultimatrix 2.0.0"` — should be v8
- **File:** `src/cli/index.ts:84`

### M2. Stale version banners — "v5" in verify.ts, "v6" in assess.ts/scan.ts
- **Files:** `src/cli/assess.ts:23`, `src/cli/verify.ts:20`

### M3. `scan.ts` exports `scanCommand` but never imported — dead code
- **File:** `src/cli/scan.ts`

### M4. 20 modules eagerly imported at CLI startup
- **File:** `src/cli/index.ts:101-111`

### M5. `config.context` defined but appears to have no reader
- **File:** `src/config.ts:543`

### M6. Auth middleware implemented but never wired to API routes
- **File:** `src/web/auth.ts`

### M7. 12 orphaned React components (~900 lines dead code)
- **Files:** `src/components/activity-panel.tsx`, `attack-animation-layer.tsx`, `BuddyMessage.tsx`, `dna-progress.tsx`, `holo-table.tsx`, `omnitrix-loader.tsx`, `phase-indicator.tsx`, `use-render-model.ts`, `worker-task-card.tsx`, `workers-panel.tsx`, `voice-command-palette.tsx`, `error-boundary.tsx`

### M8. `ModelSelection.selector` typed as `any`
- **File:** `src/core/types.ts:23`

### M9. `SessionResources.supervisor` typed as `any`
- **File:** `src/session/lifecycle.ts:116`

### M10. `camofoxSession` module-level singleton not engagement-scoped
- **File:** `src/browser/manager.ts:141`

### M11. `CapturedRequestStore` singleton not engagement-scoped
- **File:** `src/capture/captured-request-store.ts:135-139`

### M12. `human-observer.ts` typed as Playwright `Page` but used with Stagehand
- **File:** `src/capture/human-observer.ts:1,286`

### M13. `browser-launcher.ts` creates separate Chromium — legacy dead code
- **File:** `src/capture/browser-launcher.ts:34`

### M14. `camoufox-provider.ts` patches `HTMLElement.prototype.click` globally
- **File:** `src/browser/camoufox-provider.ts:74-80`

### M15. `passive-observer.ts` request Map grows unboundedly (memory leak)
- **File:** `src/capture/passive-observer.ts:35,52`

### M16. `graph-bridge.ts` wrong result shape assumption for extract
- **File:** `src/capture/graph-bridge.ts:23`

### M17. `camoufox-tools.ts` tab selection doesn't propagate to provider handle
- **File:** `src/browser/camoufox-tools.ts:179,184`

### M18. In-memory vs LibSQL endpoint ID format incompatible
- **Files:** `src/graph/store.ts:299` vs `src/graph/store-libsql.ts:197`

### M19. Technique-to-primitive mapping duplicated in 3 files
- **Files:** `src/intelligence/chaining.ts:27-45`, `chain-planner.ts:41-61`, `draft-skills.ts:34-43`

### M20. `buildNeighborhood` loads ALL edges into memory per query
- **File:** `src/graph/relation-tools.ts:50`

### M21. `evidence-gate.ts` `clear()` clears global singleton — affects all gates
- **File:** `src/intelligence/evidence-gate.ts:125-129`

### M22. Reflexion reflections array never cleared (unbounded growth)
- **File:** `src/intelligence/reflexion.ts`

### M23. `replay-tools.ts` type safety bypass
- **File:** `src/tools/replay-tools.ts:149`

### M24. `flow-tools.ts` `LOGIN_URL_PATTERNS` uses regex — violates no-regex rule
- **File:** `src/tools/flow-tools.ts:18-21`

### M25. `recon-tools.ts` duplicates framework detection logic
- **File:** `src/tools/recon-tools.ts`

### M26. `recon-tools.ts` tech-stack detection uses regex
- **File:** `src/tools/recon-tools.ts:201-211`

### M27. `scanner-tools.ts` has unused `_findingShape()` function
- **File:** `src/tools/scanner-tools.ts:22-29`

### M28. `control-tools.ts` has unused `_sanitizeForFilename()` function
- **File:** `src/tools/control-tools.ts:156`

### M29. `@types/better-sqlite3` and `@types/d3` in dependencies instead of devDependencies
- **File:** `package.json:98-99`

### M30. `src/config-shared.ts` — entire file is dead code (100% duplicate, never imported)
- **File:** `src/config-shared.ts`

### M31. Campaign, OAST, assistant, interaction, context configs have zero validation
- **File:** `src/config.ts`

### M32. `config.ts:1220` variable shadowing in browser validation
- **File:** `src/config.ts:1220`

### M33. `clean` script uses Unix `rm -rf` — fails on Windows
- **File:** `package.json:47`

### M34. `har-parser.ts` CDP timestamp ignored, uses `Date.now()` wall-clock
- **File:** `src/capture/har-parser.ts:789-793`

---

## WIRING ISSUES (12 issues)

### W1. Skill content not structurally injected into brain prompt
- **File:** `src/tools/skill-tools.ts:104-128`
- **Problem:** `loadSkillBody` returns JSON as tool output, not injected into system prompt. LLM-mediated only — brain can ignore.
- **Fix:** Inject methodology skill content into agent instructions at creation time.

### W2. Anti-loop is observe-only, not a gate
- **File:** `src/intelligence/anti-loop.ts`, `src/solver/solver.ts:413`
- **Problem:** Reports stale state but does NOT block tool calls. Brain must voluntarily change.
- **Fix:** Hard gate: when stale, modify tool set or inject mandatory strategy change.

### W3. Council blackboard is a snapshot, not a live reference
- **File:** `src/council/blackboard-shared.ts:38-47`
- **Problem:** `SharedBlackboard` copies facts at creation. Future facts invisible to council.
- **Fix:** Pass by reference or add sync mechanism.

### W4. `BrowserManagerState` never populated in solver path
- **Files:** `src/runtime/engagement-runtime.ts:206`, `src/runtime/lazy-services.ts:71-84`
- **Problem:** `LazySolverServices` stores browser in private field, not in `services.browserManager`. `getActivePage()`, `getActiveBrowser()`, `getBrowserState()` all return null.
- **Fix:** Bridge `LazySolverServices` → `services.browserManager`.

### W5. Cross-engagement finalization registered TWICE for legacy
- **File:** `src/session/lifecycle.ts:291-300`, `423-447`
- **Problem:** Two cleanup handlers call `finalizeEngagementMemory` with different keys. `synthesizeDraftSkills` only registered for legacy.
- **Fix:** Remove duplicate handler, add draft synthesis to solver path.

### W6. `getGlobalQuotaTracker()` has no fallback singleton
- **File:** `src/models/quota-tracker.ts:141-144`
- **Problem:** Throws outside engagement context. `ultimatrix ratelimit` CLI command crashes.
- **Fix:** Add fallback singleton like graph store.

### W7. `createProviderLimiter()` throws outside engagement context
- **File:** `src/models/limiter-factory.ts:12-16`
- **Problem:** No fallback. If called during cleanup after engagement dispose, crashes.
- **Fix:** Add graceful fallback.

### W8. `WorkerPool` can be created with `undefined` browser
- **File:** `src/runtime/lazy-services.ts:234-256`
- **Problem:** `ensureWorkers()` does not depend on `ensureBrowser()`. Workers spawned before browser lack browser access.
- **Fix:** Document as by-design or add dependency.

### W9. `registerAllTools()` is dead code for solver engine
- **File:** `src/tools/registry.ts:64-105`
- **Problem:** Solver uses `buildToolPack()` instead. `registerAllTools()` only used by legacy path.
- **Fix:** Remove or consolidate.

### W10. `SkillRegistry.loadFromDirectory('skills')` hardcoded relative path
- **File:** `src/session/engine-setup.ts:147`
- **Problem:** Resolves against CWD, not project root. Breaks when installed globally.
- **Fix:** Resolve relative to package root.

### W11. `EvidenceGate.verifyClaim()` falls back to empty ledger after engagement dispose
- **File:** `src/intelligence/evidence-gate.ts:33`
- **Problem:** `coreEvidenceLedger` Proxy falls back to `legacyEvidenceLedger` (empty) when context is gone.
- **Fix:** Acceptable for cleanup. Document.

### W12. Dual scope configuration (module-level + engagement)
- **Files:** `src/safety/scope-guard.ts:9-12`, `src/session/lifecycle.ts:263-267`
- **Problem:** Scope config set in two places with same logic. Redundant but could diverge.
- **Fix:** Remove one path.

---

## BROWSER + CAPTURE ISSUES (10 issues)

### B1. `dialog-watcher.ts` `hasXSSEvidence()` uses regex/substring detection
- **File:** `src/browser/dialog-watcher.ts:207-215`
- **Problem:** Violates no-regex architectural principle.

### B2. `reaction-observer.ts` uses regex for error/success classification
- **File:** `src/browser/reaction-observer.ts:238-239`

### B3. Dialog-inject fire-and-forget transaction
- **File:** `src/browser/dialog-inject.ts:145-161`
- **Problem:** `.then()` chain NOT awaited. Unhandled promise rejections.

### B4. `passive-observer.ts` also uses Playwright `page.on` — broken for Stagehand v3
- **File:** `src/capture/passive-observer.ts:66-67`

### B5. `human-observer.ts` types parameter as Playwright `Page` but uses with Stagehand
- **File:** `src/capture/human-observer.ts:1,286`

### B6. `camoufox-provider.ts` single-page limitation — `getActivePage()` always returns initial page
- **File:** `src/browser/camoufox-provider.ts:83,101`

### B7. `anti-bot.ts` `waitForResolution` rejects concurrent callers silently
- **File:** `src/browser/anti-bot.ts:211`

### B8. `har-parser.ts` `getSecrets` body scan only checks first regex pattern
- **File:** `src/capture/har-parser.ts:375`

### B9. `manager.ts` returns `any` — defeats type safety
- **File:** `src/browser/manager.ts:159,234`

### B10. `graph-bridge.ts` `stagehand_extract` result shape assumption wrong
- **File:** `src/capture/graph-bridge.ts:23`

---

## BUILD + CONFIG ISSUES (10 issues)

### G1. `src/core/**` excluded from ESLint
- **File:** `eslint.config.js:17`

### G2. `no-explicit-any: off` globally
- **File:** `eslint.config.js:24`

### G3. `CONTEXT_WINDOW_MAP` duplicate nvidia model entry
- **File:** `src/config.ts:594-596`

### G4. `solver.maxTokens` validated but never enforced
- **File:** `src/config.ts:190`

### G5. `config.depth` only read in `saveProjectConfig`
- **File:** `src/config.ts:497`

### G6. `config.agent.scansDir` legacy, dead for solver engine
- **File:** `src/config.ts:131`

### G7. `config-shared.ts` 100% duplicate, never imported
- **File:** `src/config-shared.ts`

### G8. `ink` hooks retained but Ink disabled
- **Files:** `src/hooks/use-input.ts`, `src/hooks/use-focus.ts`

### G9. `observability.ts` setup may not be used in solver path
- **File:** `src/observability.ts`

### G10. `tsconfig.json` `jsx: "preserve"` diverges from tsup/vitest `jsx: "automatic"`
- **File:** `tsconfig.json:12`

---

## SWARM + MULTI-MODEL ISSUES (8 issues)

### S1. No cross-provider failover in model selector
- **File:** `src/models/selector.ts:372-386`
- **Problem:** `fallbackSelection()` returns same default model. If exhausted, fallback also fails.
- **Fix:** Try other providers with available capacity.

### S2. `ContextWindowRegistry` re-created on every model call
- **File:** `src/models/middleware.ts:122`
- **Fix:** Hoist outside Proxy handler.

### S3. Debug `console.log` left in production code
- **File:** `src/runtime/task-attribution.ts:48,68`
- **Fix:** Remove.

### S4. `(store as any).nodes.values()` direct internal access
- **Files:** `src/workers/spawn-swarm.ts:81`, `src/orchestration/informed-task.ts:44`
- **Fix:** Use public `queryNodes()` API.

### S5. `WorkerFactory.create()` returns `any` instead of `Agent`
- **File:** `src/workers/factory.ts:38`

### S6. Legacy worker registry orphaned — never used by solver
- **File:** `src/workers/registry.ts`
- **Fix:** Delete.

### S7. Swarm parallel mode doesn't respect pool's `maxConcurrency`
- **File:** `src/workers/spawn-swarm.ts:240`

### S8. `routing.ts` hardcoded if/else per role
- **File:** `src/models/routing.ts:83-103`

---

## DEAD CODE MODULES (8 items)

| Module | Status |
|--------|--------|
| `src/intelligence/session-resume.ts` | Fully orphaned — legacy v6 |
| `src/intelligence/auth-recorder.ts` | Fully orphaned — all 7 functions never called |
| `src/intelligence/chain-planner.ts` | Retired — superseded by exploitation loop |
| `src/intelligence/hypotheses.ts` | Effectively dead — only test type import |
| `src/config-shared.ts` | 100% duplicate, never imported |
| `src/cli/scan.ts` | Exports `scanCommand` but never imported |
| `src/capture/browser-launcher.ts` | Legacy, duplicates browser infrastructure |
| `src/workers/registry.ts` | Legacy worker creation, unused by solver |

---

## ERROR HANDLING ISSUES (28 silent swallows on critical path)

### solver.ts — 10 SILENT SWALLOW, 2 FIRE-AND-FORGET
| Line | Pattern | What's Swallowed |
|------|---------|-----------------|
| 269-271 | `catch { return "" }` | Recent discoveries graph query |
| 286-288 | `catch { return undefined }` | Cross-engagement memory load |
| 421-424 | `catch { capturedRequestTotal = 0 }` | Captured request store |
| 470-472 | `catch {}` | Agent instructions fetch |
| 475-485 | `catch {}` | Conversation history recall |
| 577-597 | `catch {}` | Graph state snapshot |
| 762 | `.catch(() => {})` | `recordTechniqueFailed` fire-and-forget |
| 799 | `.catch(() => {})` | `recordTechniqueFailed` fire-and-forget |
| 909-917 | `catch {}` | New findings count |
| 934-946 | `catch {}` | Attack path analysis |
| 949-953 | `catch {}` | Reflexion state persistence |
| 959-975 | `catch {}` | Diagnosis |

### lifecycle.ts — 2 SILENT SWALLOW, 2 FIRE-AND-FORGET
| Line | Pattern | What's Swallowed |
|------|---------|-----------------|
| 417 | `catch {}` | Reaction observer detach |
| 492 | `setTimeout(() => { void attachObserver() })` | Human action capture (unhandled rejection) |
| 562 | `catch {}` | HAR capture stop |
| 905-914 | `process.on('SIGINT', async () => { ... })` | Async cleanup races with process.exit |

### dialog-inject.ts — 3 SILENT SWALLOW, 1 FIRE-AND-FORGET
| Line | Pattern | What's Swallowed |
|------|---------|-----------------|
| 133 | `catch {}` | Baseline capture failure |
| 145-161 | `.then()` not awaited | Transaction commit (unhandled rejection) |
| 220-222 | `catch {}` | Dialog read failure |
| 249-250 | `catch {}` | Reaction detection failure |

### engine.ts (web) — 4 SILENT SWALLOW
| Line | Pattern | What's Swallowed |
|------|---------|-----------------|
| 123 | `catch {}` | Reaction observer detach |
| 124 | `catch {}` | Human observer detach |
| 144-147 | `catch {}` | Finalize engagement memory |
| 204 | `.catch(() => {})` | Graph save failure |

---

## UNTESTED CRITICAL MODULES

| Module | Risk | Notes |
|--------|------|-------|
| `src/session.ts` | HIGH | 600+ lines, zero direct test |
| `src/session/lifecycle.ts` | HIGH | Session lifecycle manager — zero test |
| `src/session/engine-setup.ts` | HIGH | Engine setup — zero test |
| `src/solver/solver.ts` | MEDIUM | Tested indirectly through integration |
| `src/campaign/executor.ts` | MEDIUM | Complex concurrency subsystem — zero test |
| `src/campaign/runner.ts` | MEDIUM | Primitive runner — zero test |
| `src/browser/camoufox-provider.ts` | MEDIUM | Camoufox provider — zero test |
| `src/browser/dialog-inject.ts` | MEDIUM | Dialog injection — zero test |

---

## FIX PLAN (22 Phases)

| Phase | Content | Est. Files |
|-------|---------|------------|
| 1 | Init wiring fixes (resetAllProviderLimiters, BrowserManagerState, cross-engagement double reg, SkillRegistry path) | 5 modified |
| 2 | Instruction .md files (brain.md, core-contract.md) | 2 new, 2 modified |
| 3 | Methodology skills (security, API, cloud) | 3 new |
| 4 | Inject methodology into system prompt | 1 modified |
| 5 | Context tools (reflexion, discoveries, alerts, workflow) | 1 new |
| 6 | Solver cleanup (strip enriched goal) | 2 modified |
| 7 | Per-tool-call timeout + SIGINT abort propagation | 2 modified |
| 8 | Graph save resilience | 1 modified |
| 9 | Credential-reuse oracle fix | 2 modified |
| 10 | Dialog-inject transaction fix | 1 modified |
| 11 | Hard anti-loop gate | 2 modified |
| 12 | Council blackboard fix | 2 modified |
| 13 | CLI phase annotations | 2 modified |
| 14 | Web UI fixes (visibleAssistantText, fallback answer, skill name) | 3 modified |
| 15 | Browser fixes (Camoufox names, manager contradiction, state-bridge) | 3 modified |
| 16 | Tool reference cleanup (phantom tools, jwttool) | 2 modified |
| 17 | Swarm/multi-model fixes (failover, hoist, debug, types) | 5 modified |
| 18 | Init wizard multi-model walkthrough | 1 modified |
| 19 | Dead code removal (~30 files) | ~30 deleted |
| 20 | Duplicate mapping consolidation | 3 modified |
| 21 | Evolution + lazy services fixes | 3 modified |
| 22 | Verification (tests, CLI, Web) | — |

**Total: ~55 files modified, ~8 files created, ~35 files deleted, ~6000 lines changed.**
