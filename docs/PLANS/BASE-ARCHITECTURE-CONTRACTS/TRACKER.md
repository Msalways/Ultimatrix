# Base Architecture Contracts — Implementation Tracker

**Live tracking file.** Update after every phase gate.

## Status Legend

- ✅ **DONE** — implemented, verified
- 🔶 **DONE-UNCOMMITTED** — working tree only
- ◻️ **PARTIAL** — gaps listed
- ⬜ **PENDING**

## Spec Status

| # | Spec | Status | Notes |
|---|------|--------|-------|
| 01 | Service Ownership (F1) | ✅ DONE-UNCOMMITTED | Scoped gate verified by contract test; selector shared via container; ALS audit clean |
| 02 | Canonical Registries (F2) | ⬜ PENDING | SkillRegistry live delegation; engagement ModelSelector |
| 03 | Agent Result Envelope (F3) | ⬜ PENDING | Envelope type at pool executor; evidence-bridge on worker path; ToolResultStore written |
| 04 | Resource Claim Registry (F4) | ⬜ PENDING | Graph-backed claims; metadata-based technique resolution |

## Phase Gates

Each gate: green `tsc --noEmit` + green tests + clean tsup build. Legacy engine files untouched.

### Phase F1 — Service Ownership (spec 01)

- [x] F1.0 Discovery: scoped gate mechanism already exists — `getFindingState()` resolves `EngagementServices.findingState` with legacy fallback (`control-tools.ts:29-45`); `setEvidenceGateForFindings` is context-aware
- [x] F1.1 Contract test I1: gate in context A invisible in B/outside, persists across re-entry (`test/base-contracts/service-ownership.test.ts`)
- [x] F1.2 ALS audit: lifecycle (175/572/707/780/848/873) + web engine (93/162/309/335/340/460) all wrap via `runtime.run()` — no unwrapped entrypoints found
- [x] F1.3 `EngagementServices.modelSelector?`; engine-setup attaches shared session selector into scoped container; spawn-worker/spawn-swarm/run-task-graph resolve ctor→engagement fallback
- [x] F1.4 Ownership rule documented in AGENTS.md "Architecture Contracts (Base)" section
- **Gate F1: PASSED** — 2212/2212, tsc clean, build clean

### Phase F2 — Canonical Registries (spec 02)

- [ ] F2.1 `SkillRegistry.has()/load()/list()` delegate live to the shared loader index (snapshot becomes read-through cache)
- [ ] F2.2 Contract test: manageSkills add mid-session → spawnWorker accepts user/<id> immediately (I2)
- [ ] F2.3 Engagement-scoped ModelSelector: council factory + spawn tools resolve the session instance (no per-member news)
- [ ] F2.4 Registry rule documented: one canonical authority per concept
- **Gate F2:** tsc + tests + build green → commit

### Phase F3 — Agent Result Envelope (spec 03)

- [ ] F3.1 `WorkerExecutionEnvelope` type {text, toolCalls, findings, evidenceRefs, graphRefs, resultRef}
- [ ] F3.2 Pool executor builds envelope; toolCalls bridged via `bridgeWorkerToolCall/Evidence` into coreEvidenceLedger (I3)
- [ ] F3.3 Full result stored via ToolResultStore.store(); compact ref returned to brain (getToolResult works)
- [ ] F3.4 Swarm sequential chaining passes resultRef + typed findings (replaces 200-char slices); parallel mode passes refs too
- [ ] F3.5 One shared informed-task builder for spawn-worker/spawn-swarm (dedupe; swarm gains tags field)
- [ ] F3.6 Worker informed-task carries compact brain-state: evolution summary + reflexion failedPaths + recent discoveries counts
- **Gate F3:** tsc + tests + build green → commit

### Phase F4 — Resource Claim Registry (spec 04)

- [ ] F4.1 Typed claim store (workflow-backed): claim(endpointKey, owner, purpose, ttl) with check-and-set semantics
- [ ] F4.2 ExploitationTracker agenda items claim before fire; playbook candidates claim; campaign slices claim (I4 contract test: concurrent claim blocks double-fire)
- [ ] F4.3 `TECHNIQUE_TO_PRIMITIVE` frozen map replaced by registry-metadata resolution (tags/appliesTo), map retained as last-resort fallback only
- **Gate F4:** tsc + tests + build green → commit

## Program Completion Checklist

- [ ] base-contracts test suite covers I1–I4 and runs in CI path (`npm test`)
- [ ] AGENTS.md: architecture contracts section added
- [ ] Memory block updated
