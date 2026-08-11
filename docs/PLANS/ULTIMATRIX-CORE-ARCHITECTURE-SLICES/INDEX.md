# Ultimatrix Core Architecture Slices

**Status:** COMPLETE — all 12 slices implemented, committed, and verified (full suite 2054/2054, tsc 0 errors, clean tsup build).
**Purpose:** Break the core architecture improvement plan into buildable slices that can be implemented one at a time without re-deciding the architecture.

---

## Original Goal

Move Ultimatrix toward a deterministic, workflow-owned runtime where crawling, scope policy, browser state, evidence, workers, artifacts, memory, and reporting all share typed state and provenance.

The intended architecture keeps the existing dual engine shape but makes `multi-model` the future primary path:

- The spider is a shared runtime used by CLI and web.
- Workflow state owns crawl, browser, model, artifact, evidence, and worker metadata.
- Scope is claim-based and explicit, not same-host-only.
- Secrets are redacted before durable persistence.
- Browser execution is provider-neutral but defaults to current Stagehand/Playwright behavior.
- Findings are proof-rule gated.
- CLI and web consume the same typed runtime events.
- Project memory and global user preference memory are separated.

---

## Current Completion Status

| Slice | Status | Notes |
|---|---|---|
| 01. Spider Runtime Foundation | Implemented + committed | `SpiderRuntime` shared by CLI+web; stale stop, scope classification (explicit allow-any input), snapshot resume, 10 typed events. Frontier is discovery/limit state; `workflows`/`assets` reserved for slice 06. |
| 02. Workflow State and Persistence | Implemented + committed | `WorkflowState` (version 1) + `WorkflowStore` (`src/workflow/`) — embeds `SpiderRuntimeState` + browser/model/worker/artifact/evidence/ledger refs; per-target `workflow.json` save/load/resume; version-gated coerce; lifetime-filtered sync. Wired into lifecycle + web engine + CLI solve (stable `workflowId`, post-crawl attach + persist, artifact-create listener). |
| 03. Engagement Boundary and Policy | Implemented + committed | `AuthorizationCategory` (10) + `allowedCategories` gating, external tools deny-by-default, proposed-scope approval workflow (CLI `--approve-origin` + web `/api/spider/approve`), `scope_proposed` typed event. |
| 04. Secret Vault and Artifacts | Implemented + committed | `SecretVault` normalized API (`redactValue`/`redactString`/`redactHeaders`/`redactObject`/`redactUrl`/`redactArtifactMetadata`); redaction wired into browser storage export, report generation, screenshot metadata, session/finding paths; `ArtifactRecord` lifecycle + provenance (`src/security/artifacts.ts`). |
| 05. Browser Provider Abstraction | Implemented + committed | `BrowserProvider` interface + `StagehandProvider` wrapper; config-driven selection (`browser.provider`, default stagehand); provider + session recorded in `WorkflowState`; resume with a different provider is a hard reject; `camofox` fails clearly as planned-only. |
| 06. Identity Role Reachability | Implemented + committed | Typed `IdentityKind`/`IdentityContext`/`ReachabilityRecord`/`AuthTransition` (`src/identity/`). Spider runtime attaches session-level `currentIdentity` to frontier + page/endpoint/form discoveries, records deduped reachability + typed `auth_transition` events; persisted via `REACHABILITY` nodes + `REACHES`/`HAS_ROLE` edges and `WorkflowState.reachability` (resume-safe). |
| 07. Decision Ledger and Provenance | Implemented + committed | Central `DecisionLedger`/`DecisionRecord`/`ProvenanceRecord` (`src/security/decision-ledger.ts`); writes from model selection, worker spawn (incl. `routingReason`), tool exec, browser action, scope classify, finding create; provenance refs on spider discoveries + evidence items. |
| 08. Orchestrator and Worker Routing | Implemented + committed | `src/orchestration/` — diagnosis, technique-planner (`SIGNAL_FAMILIES`, worker delegation), playbook-runner, tools `diagnoseTarget` + `runAdvancedPlaybook`; campaign feeds `listPrimitiveMetadata()` tags; typed routing via `src/models/routing.ts` (`resolveModelRef`, `COMPLEXITY_TIER_MAP`). |
| 09. Proof Rules and Evidence Quality | Implemented + committed | `ProofRule`/`ProofCheckResult` + deterministic severity floors (`src/intelligence/proof-rules.ts`): critical ≥2 structured captures, high ≥1 non-text, medium/low ≥1 any-kind, info none. `writeFinding` fails closed (FindingNode `proofCheck` + `finding.proof` decision), report generator excludes failed-proof findings and emits proof metadata. |
| 10. CLI/Web Event Parity | Implemented + committed | `src/spider/render.ts` shared typed renderer (all 10 `SpiderRuntimeEvent` types, zero substring); CLI `lifecycle.runSpider` + web `engine.runSpider` subscribe scoped by `workflowId`; SSE `solve/route.ts` forwards typed frames; `chat-stream.tsx` renders via `spiderEventLine`; parity fixtures. |
| 11. Memory Split Project Global | Implemented + committed | `src/memory/policy.ts` shape-based target-sensitive gate + `evaluateMemoryWrite` routing (project accepts all, global reroutes workflow-scoped kinds, blocks sensitive fail-closed) + `src/memory/global-store.ts` gated `GlobalMemoryStore` + cross-engagement gate refactor. |
| 12. Architecture Evals and Hardening | Implemented + committed | `src/evals/` (types/runner/harness/fixtures) + `test/evals/architecture.test.ts` — 8 vertical cases driving the REAL runtime modules with LLM-boundary fakes only; `npm run test:evals`. |

Additional partial implementation:

- Config and model-role work is partially complete.
- CLI/web typed spider stream work is partially complete.
- Secret vault and related tests are partially complete.

---

## Dependency Order

1. [01. Spider Runtime Foundation](01-spider-runtime-foundation.md)
2. [02. Workflow State and Persistence](02-workflow-state-and-persistence.md)
3. [03. Engagement Boundary and Policy](03-engagement-boundary-and-policy.md)
4. [04. Secret Vault and Artifacts](04-secret-vault-and-artifacts.md)
5. [05. Browser Provider Abstraction](05-browser-provider-abstraction.md)
6. [06. Identity Role Reachability](06-identity-role-reachability.md)
7. [07. Decision Ledger and Provenance](07-decision-ledger-and-provenance.md)
8. [08. Orchestrator and Worker Routing](08-orchestrator-and-worker-routing.md)
9. [09. Proof Rules and Evidence Quality](09-proof-rules-and-evidence-quality.md)
10. [10. CLI/Web Event Parity](10-cli-web-event-parity.md)
11. [11. Memory Split Project Global](11-memory-split-project-global.md)
12. [12. Architecture Evals and Hardening](12-architecture-evals-and-hardening.md)

Slices 03, 04, and 07 are policy/data-quality foundations. Do not build higher-level automation that bypasses them.

---

## Current Blockers

All original blockers are resolved (tracked in [TRACKER.md](TRACKER.md)):

- ~~TypeScript error in `src/browser/dialog-inject.ts` around spreading a non-object type.~~ RESOLVED
- ~~TypeScript event typing errors for `routingReason` in worker spawn events.~~ RESOLVED
- ~~Spider runtime test failure where an external CDN URL is classified as `allowed` instead of `proposed`.~~ RESOLVED — classification now takes explicit `allowAny` input and is independent of ambient global scope state.
- ~~The configured Node path works only when run unsandboxed: `C:\nvm4w\nodejs\node.exe`.~~ REFUTED — machine artifact, not a repo-level issue.

---

## Recommended Next Slice

All 12 slices are complete. Remaining work is optional post-MVP extensibility (MCP result caching, plugin sandboxing, skill-merit decay, cross-session MCP discovery persistence, MCP/plugin Web UI) and legacy v6 tech-debt cleanup (`disproven` lifecycle enum, legacy type errors, lint runtime).

---

## Whole-Plan Definition of Done

The architecture plan is done when:

- One spider runtime serves CLI and web.
- Workflow state can be persisted and resumed with crawl, browser, evidence, artifact, model, and worker metadata.
- Every discovered URL is classified as `allowed`, `proposed`, or `denied`.
- Proposed scope is visible to CLI/web and never executed automatically.
- Secret-like values are redacted before durable storage in HAR, storage exports, screenshots metadata, graph records, reports, traces, and generated tests.
- Browser execution is selected by config and remains fixed for a workflow.
- Crawl output can answer which identity or role reached each page, endpoint, form, and workflow.
- Decisions, routing reasons, evidence, and discoveries are inspectable after a run.
- Workers receive bounded typed context and emit typed results.
- Findings cannot be reported without satisfying deterministic proof rules.
- CLI and web consume equivalent typed runtime events.
- Global memory stores only user preferences, never target-sensitive data.
- Architecture evals cover crawl completion, routing, worker spawning, policy decisions, evidence quality, browser lifecycle, config fallback, and recovery.

---

## Verification Commands

Targeted verification:

```powershell
npm run test:evals
node .\node_modules\typescript\bin\tsc --noEmit
```

```powershell
node .\node_modules\vitest\vitest.mjs run test\spider\runtime.test.ts test\security\secret-vault.test.ts test\config\config.test.ts test\analysis\har-bridge.test.ts test\models\selector.test.ts test\evals\architecture.test.ts
```

Full verification:

```powershell
npm test
npm run build:cli
```
