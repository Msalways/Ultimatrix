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
| 01. Spider Runtime Foundation | Partially complete | `SpiderRuntime` exists, but stale handling, resume, and URL classification need hardening. |
| 02. Workflow State and Persistence | Mostly pending | Runtime state is still split across target/session globals and subsystem-specific stores. |
| 03. Engagement Boundary and Policy | Mostly pending | Scope guard exists, but claim-based boundary and proposal workflow are incomplete. |
| 04. Secret Vault and Artifacts | Partially complete | Secret vault work exists, but redaction is not yet guaranteed across all persistence paths. |
| 05. Browser Provider Abstraction | Mostly pending | Current behavior is Stagehand/Playwright-specific. |
| 06. Identity Role Reachability | Mostly pending | Auth detection exists, but role-specific reachability is not first-class crawl output. |
| 07. Decision Ledger and Provenance | Mostly pending | Some routing reasons exist, but no central decision/provenance ledger. |
| 08. Orchestrator and Worker Routing | Mostly pending | Worker pool exists; multi-model orchestration needs typed routing and bounded context. |
| 09. Proof Rules and Evidence Quality | Mostly pending | Evidence gate exists; deterministic finding proof floors are not centralized. |
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

These must be resolved before claiming the architecture slice plan is verified:

- TypeScript error in `src/browser/dialog-inject.ts` around spreading a non-object type.
- TypeScript event typing errors for `routingReason` in worker spawn events.
- Spider runtime test failure where an external CDN URL is classified as `allowed` instead of `proposed`.
- The configured Node path works only when run unsandboxed: `C:\nvm4w\nodejs\node.exe`.

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
& C:\nvm4w\nodejs\node.exe .\node_modules\typescript\bin\tsc --noEmit
```

```powershell
& C:\nvm4w\nodejs\node.exe .\node_modules\vitest\vitest.mjs run test\spider\runtime.test.ts test\security\secret-vault.test.ts test\config\config.test.ts test\analysis\har-bridge.test.ts test\models\selector.test.ts
```

Full verification after the slices stabilize:

```powershell
npm test
npm run build:cli
```
