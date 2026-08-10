# Ultimatrix Core Architecture Slices — Implementation Tracker

**Live tracking file.** Update after every phase gate. Source of truth for what is done vs pending across the 12 architecture slices.

## Status Legend

- ✅ **DONE** — implemented, committed, verified
- 🟡 **DONE-UNCOMMITTED** — implemented in working tree, NOT in git
- 🔶 **PARTIAL** — some pieces exist, defined gaps remain
- ⬜ **PENDING** — not started

## Dependency Chain

```
Base (committed): scope-guard · evidence-gate/ledger · cross-engagement · workers/selector/skills/council · auth-detector/RBAC
                                        │
       ┌────────────────────────────────┘
       ▼
 01 SPIDER RUNTIME          ← start point
       │
       ├──────────────┬──────────────────────┐
       ▼              ▼                      ▼
 03 ENGAGEMENT       04 SECRET VAULT        10 EVENT PARITY
       │              │                      │
       ▼              ▼                      │
 07 DECISION LEDGER ────────────┐            │
       │              │         │            │
       ▼              ▼         ▼            ▼
 02 WORKFLOW STATE   09 PROOF  06 IDENTITY  10 EVENT PARITY (consumers)
       │              │         │
       ▼              ▼         ▼
 05 BROWSER PROVIDER 08 ORCH   10 (web wire)
       │              │
       ▼              ▼
 11 MEMORY SPLIT     12 ARCH EVALS
```

## Slice Status

| # | Slice | Status | Notes |
|---|-------|--------|-------|
| 01 | Spider Runtime Foundation | 🔶 (committed) | `SpiderRuntime` committed (`6f81103`). Classification deterministic (explicit allowAny), stale-stop, 9 events, snapshot resume. Frontier is discovery/limit state (agent-driven crawl); `workflows`/`assets` reserved for slice 06 |
| 02 | Workflow State & Persistence | 🟢 (Phase 5 done) | `WorkflowState` (version 1) + `WorkflowStore` (`src/workflow/`) — embeds `SpiderRuntimeState` + browser/model/worker/artifact/evidence/ledger refs; per-target `workflow.json` save/load/resume; version-gated coerce (refuses incompatible payloads); mutators (attachSpider/recordWorker/recordArtifact/recordEvidence) + lifetime-filtered sync (modelUsage/evidence). Wired: lifecycle + web engine + CLI solve pass stable `workflowId` to `runSpiderRuntime`, attach snapshot + persist after crawl, artifact-create listener folds durable artifacts into the workflow |
| 03 | Engagement Boundary & Policy | 🟢 (Phase 4 done) | `AuthorizationCategory` (10 cats) + `allowedCategories` gating (pure `isCategoryAuthorized` + ambient `isActionAuthorized`/`enforceAction` in scope-guard). External tools deny-by-default (`setExternalToolsConfig`, per-tool narrowing, both-gates-required). Proposed-scope approval: `EngagementBoundary.approveProposed` + `SpiderRuntime.approveProposed` (frontier reclassification) + `approvedOrigins` pre-approval + `scope_proposed` in typed EventMap. CLI `--approve-origin` (repeatable) + web `POST /api/spider/approve`; `'denied'` ToolRunStatus + scanner-tools deny gate |
| 04 | Secret Vault & Artifacts | 🟢 (Phase 2 done) | `redactObject`/`redactString`/`redactHeaders`/`redactArtifactMetadata` + `ArtifactRecord` lifecycle & provenance wired into screenshot/HAR/report/session/finding. Session cookies retained as operational store (restore intact); exposure redacted. Encrypt-at-rest + remote storage still out of scope. |
| 05 | Browser Provider Abstraction | 🟢 (Phase 7 done) | `BrowserProvider` interface + `StagehandProvider` wrapper (`src/browser/provider.ts` + `stagehand-provider.ts`) behind the shared manager. Config `browser.provider: 'stagehand'` (default) | `camofox` declared planned-only (fails clearly). Provider + session recorded in `WorkflowState`; resume with a different provider is a hard reject. `exportStorage` → redacted `session` artifact |
| 06 | Identity Role Reachability | 🟢 (Phase 6 done) | Typed `IdentityKind`/`IdentityContext`/`ReachabilityRecord`/`AuthTransition` (`src/identity/`). Spider runtime attaches session-level `currentIdentity` to frontier + page/endpoint/form discoveries, records deduped reachability + typed `auth_transition` events (`setIdentity`/`recordAuthFlow`, typed enum→kind map — refresh/form-fill do not change identity), persists via `REACHABILITY` nodes + `REACHES`/`HAS_ROLE` edges (`addReachability`), folds into `WorkflowState.reachability` + `runSpiderRuntime` persistence |
| 07 | Decision Ledger & Provenance | 🟢 (Phase 3 done) | `DecisionLedger`/`DecisionRecord`/`ProvenanceRecord`/`ProvenanceSource` singleton (`src/security/decision-ledger.ts`). Writes: model selection (selector), worker spawn incl. `routingReason` (spawn-worker/swarm), tool exec (worker-context), browser action (human-observer), scope classify (EngagementBoundary), finding create (writeFinding). Provenance refs on spider discoveries (`endpoint_seen`/`form_seen`/`page_seen` carry `provenanceId`) + evidence items (`EvidenceItem.provenanceIds`). `routingReason` typed at event seam (Phase 0). Ledger IDs in workflow state deferred to slice 02 |
| 08 | Orchestrator & Worker Routing | 🔶 | pool/selector/skills/council + `src/models/routing.ts` (untracked). Missing: orchestrator (ORCHESTRATION-LAYER-FIX T1–T8) |
| 09 | Proof Rules & Evidence Quality | 🔶 | evidence-gate + ledger committed; `writeFinding` fails closed (non-info). Missing: `ProofRule` module, report-path gate |
| 10 | CLI/Web Event Parity | 🔶 | All 9 typed events emit (uncommitted emitter). `spider:event` has ZERO subscribers; web gets 3 bridged phase events |
| 11 | Memory Split Project Global | 🔶 | `cross-engagement.ts` committed with `assertNoIdentity`. Missing: `MemoryScope`/policy types + boundary tests |
| 12 | Architecture Evals & Hardening | ⬜ | No eval fixtures or vertical tests |

## Phases

Each phase gate: green `tsc --noEmit` + green tests + commit. Tick `[x]` when done.

### Phase 0 — Lock In The Foundation
- [x] Fix 3 tsc blockers: `dialog-inject.ts` TS2698, `spawn-worker.ts` + `spawn-swarm.ts` TS2353
- [x] `tsc --noEmit` green
- [x] Targeted tests green (spider, secret-vault, config, har-bridge, selector)
- [x] Commit untracked foundation: `src/spider/`, `src/security/`, `src/models/routing.ts`, `src/web/{auth,persisted-graph,session-registry}.ts`, `docs/PLANS/` (EXCLUDE `ultimatrix*.yaml` creds) — commit `6f81103`
- [x] INDEX.md blockers 1+2 resolved; blocker 4 (Node path) dropped as machine artifact

### Phase 1 — Slice 01 Hardening
- [x] Classification decoupled from global `_allowAny` (explicit boundary input, no global read)
  - `isUrlInScope(url, config, { allowAny })` — explicit override wins; `undefined` inherits ambient flag
  - `EngagementBoundary(target, config, allowAny?)` + threading through `SpiderRuntime`/`runSpiderRuntime` + CLI/web callers (`isAllowAny()`)
- [x] CDN test green (`test/spider/runtime.test.ts:26` → `proposed`) — 1835/1835 full suite
- [x] `nextFrontierItem`: REMOVED (dead path — crawl is agent-driven, frontier is discovery/limit state, never a nav pump)
- [x] Dead `workflows`/`assets` state: KEPT as reserved slice-06 contract fields, documented inline; population deferred to slice 06
- [x] Commit — `30d5ae4`

### Phase 2 — Slice 04 Redaction (highest risk)
- [x] SecretVault API normalized: `redactValue`/`redactSecret`, `redactString` (JWT + Bearer/Basic shapes), `redactHeaders`, `redactObject` (deep), `redactUrl` (query params), `redactArtifactMetadata`
- [x] Redact browser storage export (`flow-tools.ts`): `observeHumanActions` values, flow-group values, `saveLearnedFlow` naturalLanguage redacted; raw step `value` retained as operational replay data
- [x] Redact report generation (`generator.ts`): findings/evidence/forensic pass through `redactFinding`/`redactForensicEvent` (headers, bodies, URLs, query tokens) before JSON/HTML/Markdown render
- [x] Redact screenshot metadata: `captureScreenshot` context sanitized via `redactString` before filename + `redactObject` on solve-results JSON dump
- [x] `ArtifactRecord` lifecycle + provenance (`src/security/artifacts.ts`): `ArtifactKind` (incl. session), `ArtifactStatus`, `ProvenanceRef`, registry singleton; wired into screenshot/HAR/report/session/finding paths
- [x] Design decision (user): session cookies/localStorage stay in graph as OPERATIONAL store (restore keeps working); all EXPOSURE paths redacted — records/reports/LLM-visible values/screenshot filenames. Encrypt-at-rest explicitly out of scope per slice 04
- [x] Tests: artifacts(6), secret-vault(+7 normalized API), generator(+7 redaction), flow-tools(+3). Full suite 1858/1858, 181 files
- [x] Commit

### Phase 3 — Slice 07 Decision Ledger
- [x] `DecisionLedger`/`DecisionRecord`/`ProvenanceRecord`/`ProvenanceSource` — `src/security/decision-ledger.ts` (singleton, workflowId threading, query helpers, best-effort writes)
- [x] Fix `routingReason` on `emitWorkerSpawned` opts + `EventMap['worker:spawned']` (verified — resolved Phase 0 `6f81103`, asserted by test)
- [x] Ledger writes: model selection (selector), worker spawn (spawn-worker/swarm), tool exec (worker-context), browser action (human-observer), scope classification (EngagementBoundary), finding creation (writeFinding)
- [x] Provenance refs on spider discoveries (`provenanceId` on endpoint/form/page records + events) + evidence items (`EvidenceItem.provenanceIds`)
- [x] Tests (13): routing-reason event seam, model-selection persistence (incl. fallback), spider discovery provenance, evidence provenance, ledger redaction (secret-shaped URLs/values), query helpers — full suite 1871/1871, tsc green, clean build
- [x] Commit — `0e609a5`

### Phase 4 — Slice 03 Engagement Completion
- [x] `AuthorizationCategory` + `allowedCategories` gating
- [x] External-tool opt-in wiring
- [x] Proposed-scope approval workflow (CLI + web)
- [x] `scope_proposed` in typed `EventMap`
- [x] Tests + commit

### Phase 5 — Slice 02 WorkflowState
- [x] `WorkflowState` type (embeds `SpiderRuntimeState`, browser/model/worker/artifact/evidence/ledger refs)
- [x] Persistence save/load + resume
- [x] Replace target-keyed crawl globals
- [x] Tests + commit

### Phase 6 — Slice 06 Identity Reachability
- [x] `IdentityKind`/`IdentityContext`/`ReachabilityRecord` types
- [x] Attach identity context to frontier + discovered resources
- [x] Auth transition typed state + role-aware events
- [x] Persist reachability in workflow + graph
- [x] Tests + commit

### Phase 7 — Slice 05 Browser Provider
- [x] `BrowserProvider` interface + `StagehandProvider` wrapper
- [x] camofox opt-in (config)
- [x] Provider recorded in `WorkflowState`; resume mismatch reject
- [x] Tests + commit

### Phase 8 — Slice 09 Proof Rules
- [ ] `ProofRule`/`ProofCheckResult` + default floors
- [ ] Gate `writeFinding` + report generator
- [ ] Conflict handling
- [ ] Tests + commit

### Phase 9 — Slice 08 Orchestrator (ORCHESTRATION-LAYER-FIX.md)
- [ ] T1 primitive metadata · T2 diagnosis · T3 planner · T4 `diagnoseTarget` tool · T5 `runAdvancedPlaybook` tool · T6 campaign relevance · T7 solver hunting flow · T8 tests
- [ ] Commit

### Phase 10 — Slice 10 Event Parity
- [ ] Subscribe web to `spider:event` typed stream
- [ ] CLI event renderer parity
- [ ] Remove text-delta-only progress assumptions
- [ ] Parity fixtures + commit

### Phase 11 — Slice 11 Memory Split
- [ ] `MemoryScope`/`MemoryWriteRequest`/`MemoryPolicyResult` types
- [ ] Target-sensitive detector + routing
- [ ] Block global writes of secrets/target data
- [ ] Boundary tests + commit

### Phase 12 — Slice 12 Architecture Evals
- [ ] Vertical crawl→policy→worker→evidence→report eval
- [ ] Browser lifecycle eval · recovery evals · config fallback eval
- [ ] Commit + close plan DoD

## Blockers

| # | Blocker | Status |
|---|---------|--------|
| 1 | `dialog-inject.ts:81` TS2698 non-object spread | ✅ RESOLVED (Phase 0, commit `6f81103`) |
| 2 | `routingReason` TS2353 on worker spawn events (×2) | ✅ RESOLVED (Phase 0, commit `6f81103`) — `routingReason?: string` added to `emitWorkerSpawned` opts + `EventMap['worker:spawned']` |
| 3 | CDN URL classified `allowed` not `proposed` (`test/spider/runtime.test.ts:26`) | ✅ RESOLVED (Phase 1) — root cause was `test/setup.ts:8` `setAllowAny(true)` short-circuiting `scope-guard.ts:31`; classification now takes explicit `allowAny` input |
| 4 | Node path `C:\nvm4w\nodejs\node.exe` unsandboxed | REFUTED — machine artifact, doc-only. Dropped from INDEX.md |

## Definition of Done (INDEX.md whole-plan)

- [ ] One spider runtime serves CLI and web
- [ ] Workflow state persisted + resumed (crawl, browser, evidence, artifact, model, worker)
- [ ] Every URL classified `allowed`/`proposed`/`denied`; proposed never auto-executed
- [ ] Secret-like values redacted before durable storage everywhere
- [ ] Browser provider selected by config, fixed per workflow
- [ ] Crawl output answers identity/role reachability
- [ ] Decisions, routing reasons, evidence, discoveries inspectable after a run
- [ ] Workers receive bounded typed context, emit typed results
- [ ] Findings fail closed on proof rules
- [ ] CLI and web consume equivalent typed runtime events
- [ ] Global memory stores only user preferences
- [ ] Architecture evals cover crawl, routing, spawning, policy, evidence, browser lifecycle, config fallback, recovery
