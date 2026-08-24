# Jarvis Lethality Program — Implementation Tracker

**Live tracking file.** Update after every phase gate. Source of truth for done vs pending across specs 01-04.

## Status Legend

- ✅ **DONE** — implemented, verified
- 🔶 **DONE-UNCOMMITTED** — in working tree, not in git
- ◻️ **PARTIAL** — some pieces exist; gaps remain (listed)
- ⬜ **PENDING** — not started

## Spec Status

| # | Spec | Status | Notes |
|---|------|--------|-------|
| 01 | Brain Lethality (B) | 🔶 DONE-UNCOMMITTED | OODA mandate + `[PATH:]` restore + shared discipline extraction + envelope enrichment (facts/capture/alert guidance) + reflexion/priors injection; 15 new guard tests |
| 02 | Camoufox Provider (A) | 🔶 DONE-UNCOMMITTED | Full provider implemented (Playwright firefox launch, fail-closed executable resolution); Playwright-native capture on shared builder; 7 tools over primitives; provider-dispatched capture; observers native; vocab purged; locks flipped. A10 live-target validation = MANUAL step (needs a provisioned Camoufox binary + hostile target) |
| 03 | Discovery Resilience (C) | 🔶 DONE-UNCOMMITTED | Honest frontier + `agent_stopped`, text-round stale accounting, endpoint hygiene, js-miner+shadow revival (`src/discovery/post-crawl.ts`), INTENT hypotheses, capture fidelity markers, typed anti-bot signals, capture-source label. PRODUCED edges deferred (no typed target — see C6 note) |
| 04 | Jarvis Conversation Layer (D) | ✅ DONE-UNCOMMITTED | Evolution loop closed (recorder/planner weights/engagement memory/draft synthesis), persona config, briefing + /brief + /learned, skill validation gate + manageSkills tool + CLI `skills` + **POST/DELETE /api/skills routes (D8 done)** + pack-import docs (docs/SKILL-PACKS.md, D9 done) |

## Dependency Chain

```
01 BRAIN ──► 02 CAMOUFOX ──► 03 DISCOVERY ──┐
      │                                     ├──► program complete
      └─────────────────────────────────────┴──► 04 JARVIS (needs 01 builder)
```

## Phase Gates

Each gate: green `tsc --noEmit` + green tests + clean tsup build + commit. Tick `[x]` when done.

### Phase B — Brain Lethality (spec 01)

- [x] B1. Extract shared `EVIDENCE_DISCIPLINE` + `ASSUMPTION_VERIFICATION` constants from CORE_CONTRACT; consumed by brain instructions AND CORE_CONTRACT (single source)
- [x] B2. Rewrite `getBrainInstructions`: OODA hunting mandate + observe→react→attack loop (capability language, zero tool ids)
- [x] B3. Add `[PATH:]` declaration contract + path-diversity rule to brain instructions (restores solver.ts:595 extraction)
- [x] B4. Envelope: actionable remediation text for `stale-execution` and `unsupported-claims` alerts
- [x] B5. Envelope: surface bounded recent blackboard facts (sanitized) + plan refs (existing) 
- [x] B6. Envelope: captured-request count from `CapturedRequestStore` + replay-seam hint line
- [x] B7. Per-turn injection: reflexion lesson summary (`toPromptBlock`) + cross-engagement priors block (`loadPriorsBlock` in solver; survives capability-turn rebuild via `contextSuffix`)
- [x] B8. Resolve `_extraContext`: deleted (no callers passed it)
- [x] B9. Guard tests: test/prompts/brain-lethality.test.ts — 15 tests (mandate/loop/PATH/diversity phrases, zero TOOL_IDS, shared-section presence both sides, alert guidance, facts surfacing, capture awareness, backward compat); prompt-no-hardcoded-tools green
- **Gate B: PASSED** — tsc clean, 2179 pass / 4 pre-existing failures unchanged, tsup build clean (ESM/CJS/DTS). Not yet committed.

### Phase A — Camoufox Provider (spec 02)

- [x] A1. De-typed seam: `BrowserSession.browser: BrowserHandle` (union of StagehandBrowser | CamofoxBrowserHandle); `isCamofoxHandle` type guard; flow-tools/dialog-watcher migrated to provider-blind `getActiveBrowserContext()`; spider grounding reads handle.page
- [x] A2. Config `browser.camofox {executablePath?, humanize?, locale?, proxy?}` + CAMOUFOX_EXECUTABLE env; FAIL-CLOSED when binary absent (no silent chromium fallback)
- [x] A3. `CamoufoxProvider` (src/browser/camoufox-provider.ts): playwright firefox launch, storageState export, screenshots, manager registration
- [x] A4. `attachHarCaptureViaPlaywright` (src/session/playwright-network-capture.ts) feeding the shared builder via new builder adapters (`onPlaywrightResponse`/`setPlaywrightResponseBody`/`onPlaywrightRequestFailed`); capture dispatch by `isCamofoxHandle` in lazy-services + lifecycle (no vendor sniffing)
- [x] A5. Same 7 tool ids over Playwright primitives (src/browser/camoufox-tools.ts): navigate/act(selector)/extract/observe(ariaSnapshot)/screenshot/tabs/close — result shapes match stagehand contracts so wrapStagehandTools applies scope-guard/reaction wrapping unchanged
- [x] A6. Dialog watcher resolves context via requireContext() branch (Playwright addInitScript native); reaction observers work on Playwright pages natively
- [x] A7. Frozen vocabulary purged: spider/instructions, agent-manager, mastra/tools upsertPage description → capability language
- [x] A8. Challenge detection at grounding (typed signals into `state.challengeSignals`; challenge at landing → honest error, no fake page recorded)
- [x] A9. Locks flipped: provider.test camofox→resolves; engagement-runtime test asserts fail-closed launch executable check; evals browser-lifecycle case now asserts camofoxResolves
- [ ] A10. MANUAL live validation: provision a Camoufox binary (set browser.camofox.executablePath), run `ultimatrix interact -t <challenge-protected-target>` end-to-end
- **Gate A: PASSED** — tsc 0 errors, 2203 pass / 4 pre-existing failures unchanged, build clean (ESM/CJS/DTS). Not yet committed.

### Phase D remainder

- [x] D8. Web routes: POST /api/skills (markdown|path import via manageSkills gate) + DELETE /api/skills?id=
- [x] D9. Curated-pack importer docs (docs/SKILL-PACKS.md)
- **Gate D remainder: PASSED** (same verification run as Gate A)

### Phase C — Discovery Resilience (spec 03)

- [x] C1. Honest frontier: `dequeue()` + `countActionable(maxDepth)`; terminal reason is `frontier_exhausted` ONLY when nothing actionable remains, else new `agent_stopped` (union extended)
- [x] C2. Stale accounting: text deltas coalesce into rounds (`TEXT_ROUND_CHARS=4000`) so text-only models accrue staleness; tool results unchanged
- [x] C3. Endpoint hygiene: baseline links enter frontier only; param-bearing links become Endpoints with typed params (`linkQueryParams`)
- [x] C4. js-miner revived via `runPostCrawlDiscovery` (`src/discovery/post-crawl.ts`): captured script/HTML bodies → Endpoints tagged `js-mined` (passive records of delivered content; cap 50; addEndpoint upsert-dedupes). DEVIATION from spec noted: recorded as passive endpoint records, not SpiderRuntime proposed-frontier items — the approval flow is closed by crawl end
- [x] C5. shadowApiDiscovery in spider agent toolpack AND auto-run at crawl completion (lifecycle + lazy-services); in-scope results tagged `shadow-api`
- [x] C6. Hypotheses → INTENT nodes (`store.addIntent`, attackPath field) — PARTIAL by design: PRODUCED edges deferred because `Hypothesis.targetEndpoints` are analyser-space ids with no resolvable graph counterpart (needs url-keyed targets first; documented in har-bridge)
- [x] C7. Evidence fidelity: >1MB bodies stored truncated WITH `extra.wasTruncated` marker; same-requestId redirects folded into `extra.redirectChain`; responseMeta method de-hardcoded. Timings honestly left `{}` (CDP provides no breakdown)
- [x] C8. Anti-bot rewritten to typed signals: `CHALLENGE_STATUS` + mitigation headers (`cf-mitigated`, `x-datadome`) + exact platform frame hosts; VENDOR_PATTERNS regex tables deleted; thin-interstitial corroboration for blocked statuses; 16 tests incl. source-scan no-vocab guard
- [x] C9. Fallback HAR labeled `captureSource: 'anonymous-fallback'` on WorkflowState (+ coerce support, `setCaptureSource` mutator) at both dispatch sites
- **Gate C: PASSED** — tsc clean, 2181 pass / 4 pre-existing failures unchanged, build clean. New tests: test/spider/honest-stop.test.ts (6), anti-bot rewrite (16). Not yet committed.

### Phase D — Jarvis Conversation Layer + Self-Evolution (spec 04 + spec 05)

- [x] D1. Config `assistant {name, tone}` (default jarvis); persona prose in brain instructions with tone line; zero tool ids
- [x] D2. Briefing builder (`src/runtime/briefing.ts`): state/coverage/capture/evolution/drafts from typed stores only; `/brief` command
- [x] D3. Import validation gate (`src/solver/skills/validate.ts`): frontmatter/name-match/toolRefs⊆TOOL_IDS/primitives⊆registry/non-empty fences/BOM/size — the P0 defect rejected at the door (11 tests)
- [x] D5. `manageSkills` brain tool: list/add(markdown|path|dir+refs)/remove/hot-reload via `configureSkillSources` union (4 round-trip tests)
- [x] D6. Loader upgraded: folder-per-skill layout (`<dir>/SKILL.md` + refs/) now scanned for extra dirs — agentskills.io-standard libraries drop in
- [x] D7. CLI `ultimatrix skills list|add|remove`
- [ ] D8. Web POST /api/skills import route + panel (P2 remainder)
- [ ] D9. Curated-pack importer docs (P2 remainder)

### Phase D-EVOL — Self-Evolution (spec 05)

- [x] EV1. Deterministic hooks: committed findings → `recordTechniqueConfirmed` (control-tools chokepoint); solver tool-error vulnTypes → `recordTechniqueFailed` (3-strike dampening) — `src/intelligence/evolution.ts`
- [x] EV2. Never-fired loop closed: `finalizeEngagementMemory` now called at lifecycle cleanup AND web-engine close (store optional, resolved internally to keep entrypoints getter-free)
- [x] EV3. Read-side live: planner `scoreFor` multiplies evolved weight (`getTechniqueWeight`) with visible reasoning trail
- [x] EV4. Draft-skill synthesis (`src/intelligence/draft-skills.ts`): confirmed technique + replayed proof + no skill coverage → deterministic SKILL.md draft from the typed proof recipe into `<target>/skills-drafts/`, marked unvalidated; promoted via the D3 gate
- [x] EV5. Visibility: `/learned` command + Evolution section in briefing
- **Gate D: PASSED** — tsc clean, 2203 pass / 4 pre-existing failures unchanged, build clean. New tests: evolution(5), skill-validate(11), manage-skills(4), briefing(2). Not yet committed.
- Note: hybrid learning per user decision — deterministic seams + reflective distillation happens at engagement finalize (cross-engagement summary); draft-skill promotion requires explicit human gate.

## Program Completion Checklist

- [ ] Live run: hostile (challenge-protected) target → crawl completes or degrades honestly; findings land with proofs — **requires provisioned Camoufox binary (A10, manual)**
- [ ] Live run: REPL opens with named briefing; one conversational skill import works end-to-end
- [x] Anti-loop diversity wired: `[PATH:]` contract in brain instructions; extraction live at solver.ts
- [ ] AGENTS.md updated with new modules/config
- [x] Memory block updated with final status
- [ ] Commit all phases

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-08-23 | Camoufox coexists with Stagehand (per-workflow choice), default stays stagehand | WorkflowStore already locks providers; low risk; A/B comparable |
| 2026-08-23 | Camoufox v1 = crawl-grade act/extract (ariaSnapshot+evaluate), not Stagehand-quality self-healing AI actions | Root cause being fixed is fingerprinting, not interaction quality; honest scope |
| 2026-08-23 | Playwright-native context events chosen for Firefox capture (not hand-sliced protocol subset) | Standing constraint #1: platform-native mechanisms only |
| 2026-08-23 | HTTP-first frontier drainer DEFERRED | Re-evaluate after Camoufox proves out; documented in spec 03 Out-of-Scope |
| 2026-08-23 | Persona default name `jarvis`, configurable via `assistant.name` | User vision; avoids hardcoding identity into prompts beyond config interpolation |
