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
| 02 | Workflow State & Persistence | ⬜ | No `WorkflowState`; state split across session/web/browser/evidence globals |
| 03 | Engagement Boundary & Policy | 🔶 | `EngagementBoundary` class + allowed/proposed/denied + `scope_proposed` (rides untracked runtime). Missing: `AuthorizationCategory`, approval flow |
| 04 | Secret Vault & Artifacts | 🟢 (Phase 2 done) | `redactObject`/`redactString`/`redactHeaders`/`redactArtifactMetadata` + `ArtifactRecord` lifecycle & provenance wired into screenshot/HAR/report/session/finding. Session cookies retained as operational store (restore intact); exposure redacted. Encrypt-at-rest + remote storage still out of scope. |
| 05 | Browser Provider Abstraction | 🔶 | `browser.provider: 'stagehand'` config field exists. Missing: `BrowserProvider` interface, `StagehandProvider`, camofox |
| 06 | Identity Role Reachability | 🔶 | AuthStateDetector + rbac-learner + auth-recorder committed. Missing: typed `IdentityKind`/`ReachabilityRecord`, spider integration |
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
- [ ] `AuthorizationCategory` + `allowedCategories` gating
- [ ] External-tool opt-in wiring
- [ ] Proposed-scope approval workflow (CLI + web)
- [ ] `scope_proposed` in typed `EventMap`
- [ ] Tests + commit

### Phase 5 — Slice 02 WorkflowState
- [ ] `WorkflowState` type (embeds `SpiderRuntimeState`, browser/model/worker/artifact/evidence/ledger refs)
- [ ] Persistence save/load + resume
- [ ] Replace target-keyed crawl globals
- [ ] Tests + commit

### Phase 6 — Slice 06 Identity Reachability
- [ ] `IdentityKind`/`IdentityContext`/`ReachabilityRecord` types
- [ ] Attach identity context to frontier + discovered resources
- [ ] Auth transition typed state + role-aware events
- [ ] Persist reachability in workflow + graph
- [ ] Tests + commit

### Phase 7 — Slice 05 Browser Provider
- [ ] `BrowserProvider` interface + `StagehandProvider` wrapper
- [ ] camofox opt-in (config)
- [ ] Provider recorded in `WorkflowState`; resume mismatch reject
- [ ] Tests + commit

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
