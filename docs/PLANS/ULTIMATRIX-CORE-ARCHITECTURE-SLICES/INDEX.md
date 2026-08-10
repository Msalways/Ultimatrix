# Ultimatrix Core Architecture Slices

**Status:** Planned, with several slices partially implemented in current source.
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
| 01. Spider Runtime Foundation | Implemented + committed | `SpiderRuntime` shared by CLI+web; stale stop, scope classification (explicit allow-any input), snapshot resume, 9 typed events. Frontier is discovery/limit state; `workflows`/`assets` reserved for slice 06. |
| 02. Workflow State and Persistence | Implemented + committed | `WorkflowState` (version 1) + `WorkflowStore` (`src/workflow/`) — embeds `SpiderRuntimeState` + browser/model/worker/artifact/evidence/ledger refs; per-target `workflow.json` save/load/resume; version-gated coerce; lifetime-filtered sync. Wired into lifecycle + web engine + CLI solve (stable `workflowId`, post-crawl attach + persist, artifact-create listener). |
| 03. Engagement Boundary and Policy | Implemented + committed | `AuthorizationCategory` (10) + `allowedCategories` gating, external tools deny-by-default, proposed-scope approval workflow (CLI `--approve-origin` + web `/api/spider/approve`), `scope_proposed` typed event. |
| 04. Secret Vault and Artifacts | Partially complete | Secret vault work exists, but redaction is not yet guaranteed across all persistence paths. |
| 05. Browser Provider Abstraction | Implemented + committed | `BrowserProvider` interface + `StagehandProvider` wrapper; config-driven selection (`browser.provider`, default stagehand); provider + session recorded in `WorkflowState`; resume with a different provider is a hard reject; `camofox` fails clearly as planned-only. |
| 06. Identity Role Reachability | Implemented + committed | Typed `IdentityKind`/`IdentityContext`/`ReachabilityRecord`/`AuthTransition` (`src/identity/`). Spider runtime attaches session-level `currentIdentity` to frontier + page/endpoint/form discoveries, records deduped reachability + typed `auth_transition` events; persisted via `REACHABILITY` nodes + `REACHES`/`HAS_ROLE` edges and `WorkflowState.reachability` (resume-safe). |
| 07. Decision Ledger and Provenance | Mostly pending | Some routing reasons exist, but no central decision/provenance ledger. |
| 08. Orchestrator and Worker Routing | Mostly pending | Worker pool exists; multi-model orchestration needs typed routing and bounded context. |
| 09. Proof Rules and Evidence Quality | Implemented + committed | `ProofRule`/`ProofCheckResult` + deterministic severity floors (`src/intelligence/proof-rules.ts`): critical ≥2 structured captures, high ≥1 non-text, medium/low ≥1 any-kind, info none. `writeFinding` fails closed (FindingNode `proofCheck` + `finding.proof` decision), report generator excludes failed-proof findings and emits proof metadata. |
| 10. CLI/Web Event Parity | Partially complete | Typed spider stream work exists, but web progress still needs full runtime event parity. |
| 11. Memory Split Project Global | Mostly pending | Cross-session memory exists; target-sensitive/global boundary needs enforcement. |
| 12. Architecture Evals and Hardening | Mostly pending | Targeted tests exist; vertical architecture evals are missing. |

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

Start with [01. Spider Runtime Foundation](01-spider-runtime-foundation.md).

Reason:

- It already exists and is partially complete.
- It blocks reliable CLI/web event parity.
- It exposes the current scope-classification bug.
- Workflow state should attach spider state instead of inventing a second crawl model.

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
node .\node_modules\typescript\bin\tsc --noEmit
```

```powershell
node .\node_modules\vitest\vitest.mjs run test\spider\runtime.test.ts test\security\secret-vault.test.ts test\config\config.test.ts test\analysis\har-bridge.test.ts test\models\selector.test.ts
```

Full verification after the slices stabilize:

```powershell
npm test
npm run build:cli
```
