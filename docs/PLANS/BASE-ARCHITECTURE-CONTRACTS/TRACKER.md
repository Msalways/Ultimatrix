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
| 01 | Service Ownership (F1) | ✅ COMMITTED `0b982f7` | Scoped gate verified by contract test; selector shared via container; ALS audit clean |
| 02 | Canonical Registries (F2) | ✅ COMMITTED `1877696` | SkillRegistry live read-through; I2 mid-session import spawnable; engagement selector |
| 03 | Agent Result Envelope (F3) | ✅ COMMITTED `34745f9` | Envelope + I3 bridging + resultRef persistence + shared informed-task builder with session intelligence |
| 04 | Resource Claim Registry (F4) | ✅ DONE-UNCOMMITTED | claim-registry.ts; exploitation-loop + playbook claim-before-fire; metadata-first technique resolution; I4 tests |

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

- [x] F2.1 SkillRegistry live read-through: has/get/load/search/list/count resolve the shared loader index; snapshot demoted to warm-up fallback (authoritative only when index absent/empty — preserves unit-test-mock + no-skill installs)
- [x] F2.2 Contract test I2: mid-session manageSkills add → stale-warmed registry authorizes + spawns user/<id> immediately; remove de-authorizes instantly
- [x] F2.3 Engagement-scoped selector: council factory spawn tools take deps.modelSelector; per-member `new ModelSelector` → deps→engagement→construct fallback; toolpack modelSelectionTools same resolution
- [x] F2.4 Registry rule documented (AGENTS.md contracts §2, done in F1)
- **Gate F2: PASSED** — 2214/2214, tsc clean

### Phase F3 — Agent Result Envelope (spec 03)

- [x] F3.1 `WorkerExecutionEnvelope` {workerId, summary, evidenceRecorded, resultRef?} exported from worker-pool-executor
- [x] F3.2 Executor extracts Mastra toolResults defensively (top-level + steps[] shapes), bridges via `bridgeWorkerEvidence` into coreEvidenceLedger, capped 25/worker — I3 contract test green
- [x] F3.3 Full sanitized result persisted via ToolResultStore; graph resolves engagement-container-first (F1); getToolResult works — contract test reads payload back through the ref
- [x] F3.4 Swarm: completed results carry `resultRef` (TaskState + coerce + executor→coordinator persistence added); sequential chaining emits `[full output: <ref> via get-tool-result]` pointers instead of 200-char JSON slices
- [x] F3.5 Shared `buildInformedTask` helper (src/manager/tools/informed-task.ts) dedupes spawn-worker/spawn-swarm endpoint-context blocks (swarm gains tags field)
- [x] F3.6 Informed task appends Session Intelligence block: evolution technique outcomes + demoted warnings + captured-request replay hint
- **Gate F3: PASSED** — 2219/2219, tsc clean, build clean

### Phase F4 — Resource Claim Registry (spec 04)

- [x] F4.1 `src/runtime/claim-registry.ts`: check-and-set claims {resourceKey, owner, purpose, ttl}, sweep-on-read expiry, owner release/refresh, `endpointResourceKey` canonical key, `withEndpointClaim` wrapper
- [x] F4.2 Claim-before-fire wired: exploitation loop (per agenda item), playbook primitive candidates. Campaign slices + spawn inherit coordination via shared endpoints (documented: in-flight semantics — cross-turn dedup remains graph-driven via proofs/coverage)
- [x] F4.3 Technique→primitive resolution is registry-metadata-first (token vs tags/technique fields); frozen map demoted to last-resort fallback for legacy tokens
- [x] I4 contract test: concurrent claim blocks second path with holder attribution; release unblocks; same-owner refresh; TTL steal
- **Gate F4: PASSED** — 2226/2226, tsc clean, build clean

## Program Completion Checklist

- [ ] base-contracts test suite covers I1–I4 and runs in CI path (`npm test`)
- [ ] AGENTS.md: architecture contracts section added
- [ ] Memory block updated
