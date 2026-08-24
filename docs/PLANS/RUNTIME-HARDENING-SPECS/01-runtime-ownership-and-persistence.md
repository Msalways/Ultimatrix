# 01. Runtime Ownership and Persistence

**Status:** PRODUCTION OWNERSHIP BLOCKER COMPLETE; DEPRECATED STANDALONE FALLBACKS REMAIN

## Goal

Replace engagement-sensitive singletons with one workflow-owned service context, make terminal state authoritative, and persist redacted workflow, ledger, identity, and browser-provider state coherently.

## Root Cause

CLI, Web, and workers call process-global getters and setters for state whose correct value depends on the active engagement. A `workflowId` tag does not isolate the mutable object. Persistence is also fragmented: workflow snapshots, graph state, decisions, and artifacts are saved independently and at different lifecycle points.

## Required Architecture

Introduce one composition root used by CLI, Web, SDK, and tests:

```typescript
interface EngagementRuntime {
  readonly workflow: WorkflowStore
  readonly graph: GraphStore
  readonly oast: OastStore
  readonly boundary: EngagementBoundary
  readonly decisions: DecisionLedger
  readonly artifacts: ArtifactRegistry
  readonly evidence: EvidenceLedger
  readonly browser: BrowserProvider
  readonly forensicLog: ForensicLog
  readonly skills: SkillCatalog
  readonly workers: WorkerPool

  saveCheckpoint(reason: CheckpointReason): Promise<void>
  close(outcome: WorkflowOutcome): Promise<void>
}
```

`createEngagementRuntime(config, target, options)` is the only production constructor. Dependencies may be injected for tests. No service inside this context reads an engagement-sensitive global.

Process-level resources may remain shared only behind explicit managers. A shared browser process is acceptable; browser contexts/pages and provider identity must be owned by `EngagementRuntime`.

## State and Persistence Contract

- Bump `WorkflowState.version` because durable state semantics change.
- Store `decisionLedgerPath` or an embedded ledger snapshot, not an unused ID.
- Save workflow, ledger, and graph through `saveCheckpoint()` using temporary files plus atomic replace.
- Redact the durable workflow representation at serialization, not at individual callers.
- Operational secrets needed for resume go to the existing operational secret/session store and are referenced by opaque IDs.
- `close()` is idempotent and performs terminal snapshot, reachability persistence, ledger/artifact sync, graph save, and cleanup in that order.

```typescript
type WorkflowOutcome =
  | { status: 'completed'; stopReason: SpiderStopReason }
  | { status: 'failed'; error: SerializedError }
  | { status: 'aborted'; reason: string }
```

## Browser Provider

- `createBrowserProvider(config.browser.provider)` creates the configured provider.
- CLI and Web never call `getOrCreateBrowser()` directly.
- The workflow records `provider.name` and the provider-created session/context ID.
- Resume rejects provider mismatch before opening a browser.
- Planned providers fail during runtime creation, not after workflow mutation.

## Identity and Reachability

`ReachabilityRecord` is self-contained and stores its identity snapshot at observation time:

```typescript
interface ReachabilityRecord {
  // existing locator fields
  identity: Pick<IdentityContext, 'id' | 'kind' | 'roleName' | 'tenantId'>
  observedAt: string
}
```

Persistence copies the record as-is. It must never enrich historical records from `state.currentIdentity`.

## Concurrency

- Web session registry maps engine ID to its own `EngagementRuntime`.
- Scope, external-tool policy, ledger, artifact listener, graph, OAST, observers, and logger come from that runtime.
- Shared process managers cannot expose mutable "current target" state.
- Cleanup unregisters only resources owned by that runtime.

## Migration

- Version-1 workflows are loaded through a pure migration function.
- Existing reachability without embedded identity uses its own legacy identity fields when present; otherwise it is marked `identity.kind = 'unknown'`, never assigned the final identity.
- Existing raw URL fields are redacted during migration before the version-2 file is written.
- In-memory legacy ledger data cannot be reconstructed and is explicitly recorded as unavailable.

## Remove

- Production use of engagement-sensitive `getGlobal*` and `set*` APIs.
- Mutable workspace "current target" semantics.
- Direct CLI/Web browser-manager construction.
- Persistence-time identity rewriting.

Compatibility adapters may exist only at deprecated legacy boundaries and must require an explicit runtime argument internally.

## Tests

- Two WebEngines operate concurrently with different targets, policies, stores, ledgers, artifacts, and logs without cross-observation.
- Every terminal spider outcome returns, emits, and persists identical terminal state.
- Ledger and provenance survive runtime recreation.
- Workflow files contain no sensitive URL query value, fragment, userinfo, bearer value, cookie, or signed token.
- Identity transitions preserve before/after reachability ownership.
- Configured provider instance and persisted provider match.
- Version-1 migration is deterministic and idempotent.

## Acceptance Criteria

- All production entrypoints use `createEngagementRuntime()`.
- No engagement-sensitive mutable singleton remains on a production call path.
- Checkpoints are redacted and recoverable after interruption.
- Concurrent engagement eval passes repeatedly without ordering dependence.

## Implementation Progress

Implemented on 2026-08-14: `createEngagementRuntime()` owns workflow, workspace, graph, OAST store, decisions, artifacts, evidence, usage, forensic log, scope policy, and the configured browser provider. Task-local async context lets existing tool boundaries resolve those owned instances without cross-engagement mutation. Concurrent runtime tests overlap getter-based operations and verify isolation across every owned service.

Direct `solve`, `WebEngine`, and target-backed `SessionLifecycle` paths now construct and execute through this runtime. Browser provider mismatch fails before workflow creation; Web config reload cannot change provider. Workflow checkpoints redact at the persistence boundary and use atomic replacement. Decision/provenance snapshots persist and restore through `decisions.json`.

Spider reachability now embeds the observation-time identity. Persistence no longer enriches historical records from the final active identity, and legacy records without identity metadata migrate to `identity.kind = 'unknown'`.

The public `Ultimatrix` SDK now creates one lazy `EngagementRuntime` per instance, runs learn/generate/replay inside its engagement context, persists capture results through the owned graph, and closes the owned workflow. Concurrent SDK instances persist distinct workflow identities without global workspace mutation.

HTTP cookie, token, client, and named-session state is now owned by `EngagementRuntime`. Existing HTTP tools resolve `getGlobalSessionManager()` through the active async engagement context, so overlapping engagements cannot observe or reuse each other's authentication state.

The deprecated `AgentManager` is now a compatibility shell over an injected or target-created `EngagementRuntime`. Its graph, OAST store, workflow, task coordinator, chat, and spider paths resolve through that runtime. The OAST HTTP listener multiplexes opaque engagement routes and dispatches each callback to its owning store and context.

Human capture, passive network observation, reaction detection, dialog capture, anti-bot challenge state, action recording, and Stagehand browser handles now resolve from the active `EngagementRuntime`. Their module-level instances remain compatibility-only fallbacks outside an engagement context. Overlapping runtime tests prove that each engagement receives distinct observers, recorder, challenge state, and browser handle; recorder data is checkpointed with the owning workflow.

Quota tracking, tool-status events, provider limiter caches, HTTP sessions, pending finding evidence, and the active evidence gate are now engagement-owned. Provider configuration from one concurrent engagement can no longer select the limiter policy or consume the pending evidence of another engagement.

Dynamic extension registries and graph tool-result stores now require explicit owners. CLI report/scan, direct solve, SDK replay, and Web target paths use runtime services directly. Read-only commands call `dispose()` so they release owned listeners and browser resources without falsely changing workflow terminal state. Public CLI/Web compatibility tests reject reintroduction of ambient `getGlobal*` access.

Intentionally process-shared resources are limited to immutable catalogs/caches and host safety coordination keyed by resource identity, such as static technique metadata, tool availability, robots data by host, and the multiplexed OAST listener. They must not contain a mutable current target, workflow, credential, or browser page.

Remaining cleanup is non-blocking API retirement: remove deprecated standalone fallbacks after downstream callers have migrated. A shared browser process may be introduced later only behind an explicit host manager with session-addressed handles. Cross-engagement provider-account quota coordination also belongs in an explicit credential-keyed host manager; until that exists, engagement limiters prefer isolation over silently sharing the first caller's configuration.

The Web code-generation API is now target-addressed through `TargetManager` and reads the selected `WebEngine` recorder. The process-wide `AgentManager.getInstance()` constructor was removed; legacy adapters must now be explicitly constructed or bound with `AgentManager.forRuntime(runtime)`.

The OAST HTTP listener is now a shared host resource with opaque per-engagement routes. Each registration owns its store, TTL/config snapshot, and engagement context; callbacks and structured evidence are routed to that owner. Stopping one engine unregisters only that engine, and the listener closes after the final owner exits. Concurrent startup shares one readiness promise, so no caller observes an unbound port.

Typed runtime events are now engagement-owned. Solver, worker, graph, finding, browser, and spider helpers resolve the active runtime bus; Web solve, worker-status, and swarm SSE routes require a target and subscribe through its `WebEngine`. Each engine retains only its own bounded worker history, and the browser SSE client reconnects when the active target changes.

Web browser and status APIs now require an explicit target and read or destroy only that target's `WebEngine`. They no longer inspect or close the compatibility browser fallback.
