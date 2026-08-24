# Ultimatrix Runtime Hardening Specifications

**Status:** RELEASE BLOCKERS IMPLEMENTED; DEPRECATED API CLEANUP AND DEFERRED PRODUCT MILESTONES REMAIN  
**Source audit:** [`../SKILL-RUNTIME-WIRING-GAPS.md`](../SKILL-RUNTIME-WIRING-GAPS.md)  
**Purpose:** Root-cause specifications for the wiring, heuristic, architecture, SDK, and product gaps found during the 2026-08-13 audit.

## Current Status

This directory is the current planning source of truth. The older `ULTIMATRIX-CORE-ARCHITECTURE-SLICES` tracker is historical; use it only for background on the first architecture pass.

- Implemented release blockers: workflow-owned runtime services, durable decision snapshots, proof-gated finding promotion, typed experiment/retest oracles, task lifecycle persistence, worker/task routing, SDK replay/case-file/CI scaffolding, and native runtime budget accounting.
- Active cleanup: retire deprecated standalone fallbacks, keep skill discovery metadata-only, fail closed on unknown skill IDs, and keep execution/reporting/recon/campaign tools out of invariant `CORE_TOOLS`.
- Deferred product milestones: real OS/container worker sandboxing, remediation worktree/PR pipeline, public benchmark suite, and plugin/connector UI polish.

## Design Rules

1. One owner per mutable runtime concern; no ambient engagement-sensitive globals.
2. One public path per invariant; duplicate bypass APIs are removed, not wrapped indefinitely.
3. LLMs choose goals, hypotheses, experiments, and capabilities through typed outputs.
4. Deterministic code enforces authorization, execution, evidence capture, and proof.
5. Heuristics create hints only. Observations and proofs require captured evidence.
6. Unknown or ambiguous state fails closed or remains inconclusive.
7. CLI, Web, SDK, council, and workers use the same runtime composition root.
8. A slice is complete only when a vertical test exercises the real public entrypoint.

## Dependency Order

| Order | Spec | Gaps |
|---|---|---|
| 1 | [01 Runtime Ownership and Persistence](01-runtime-ownership-and-persistence.md) | A2-A6, A8 |
| 2 | [02 Skill Activation and Tool Views](02-skill-activation-and-tool-views.md) | G1-G10 |
| 3 | [03 Evidence, Experiments, and Findings](03-evidence-experiments-and-findings.md) | H1-H3, H7, A1, P1 |
| 4 | [04 Adaptive Planning and Heuristic Containment](04-adaptive-planning-and-heuristic-containment.md) | H4-H6, H8 |
| 5 | [05 Orchestration and Terminal Lifecycle](05-orchestration-and-terminal-lifecycle.md) | A2, A7 |
| 6 | [06 SDK and Delivery Surface](06-sdk-and-delivery-surface.md) | P2-P7 |
| 7 | [07 Vertical Evals and Rollout](07-vertical-evals-and-rollout.md) | Cross-cutting verification |
| 8 | [08 Native Runtime Harness Kernel](08-native-runtime-harness-kernel.md) | Durable tasks, harness adapters, cancellation, recovery |

Specs 1-3 are release blockers. Specs 4-6 depend on their contracts. Spec 7 is implemented alongside every earlier spec, not deferred until the end.

Spec 8 is the execution kernel that makes specs 2, 4, and 5 operational. Its first proof slice is intentionally smaller than the final design and must not be presented as complete production wiring.

## Definition of Done

- The old bypass or duplicate path is deleted or made private in the same change.
- Public types and persistence formats are versioned where applicable.
- Existing stored workflows either migrate deterministically or fail with a clear incompatibility error.
- Tests cover direct CLI, WebEngine, SDK, council, and worker entrypoints as applicable.
- Negative tests prove unknown IDs, missing proof, missing sandbox, ambiguous outcomes, and concurrent engagements fail safely.
- Build, focused tests, architecture evals, and the full suite pass.

## Review Gates

Each spec contains explicit decisions, non-goals, migration behavior, and acceptance criteria. Review and lock a spec before implementation. If implementation needs a new architectural decision, update the spec first rather than hiding the decision inside a patch.
