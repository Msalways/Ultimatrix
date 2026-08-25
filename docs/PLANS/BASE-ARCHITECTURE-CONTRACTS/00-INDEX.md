# 00. Program Index — Base Architecture Contracts

**Program thesis:** Before more layers are added, the foundation gets explicit contracts. Four structural defects cause every wiring symptom observed in audits; each phase closes one defect by making an invariant enforceable.

**Constraint:** The legacy engine (`engine: 'legacy'`, `src/manager/agent.ts` + specialists) is FROZEN — never refactored. All changes live in the solver/multi-model path or are additive shared-module changes. Internal API evolution of `EngagementServices` is in scope (web/CLI/tests updated in-phase).

## Defects

| # | Defect | Symptom evidence |
|---|--------|------------------|
| **D1** | Wiring-by-global-mutable-state | EvidenceGate global swaps; active-browser side channels; services reach sideways into singletons instead of receiving dependencies |
| **D2** | Registries without one canonical instance | SkillRegistry frozen snapshot vs shared loader index (breaks mid-session imports); 3 ModelSelector instances; 2 worker populations |
| **D3** | Stringly-typed seams between agents | Worker `GenerateResult.text` only (toolCalls dropped → evidence-bridge orphaned); swarm chaining sliced to 200 chars; ToolResultStore never written |
| **D4** | No concurrency/claim contract | Three escalation paths select independently; no endpoint dedup/locks across paths/sessions |

## Spec Index

| # | Spec | Phase | Status |
|---|------|-------|--------|
| 01 | [Service Ownership](./01-service-ownership.md) | F1 | IN PROGRESS |
| 02 | [Canonical Registries](./02-canonical-registries.md) | F2 | PENDING |
| 03 | [Agent Result Envelope](./03-agent-result-envelope.md) | F3 | PENDING |
| 04 | [Resource Claim Registry](./04-claim-registry.md) | F4 | PENDING |

## Invariants (asserted by test/base-contracts after each phase)

- I1: Evidence-gate resolution is engagement-scoped; a gate registered inside one engagement context never bleeds into another
- I2: A skill imported mid-session is spawnable by workers in the same session
- I3: After any worker completes, its toolCalls are represented in the evidence ledger
- I4: Two escalation paths cannot hold the same endpoint claim simultaneously

## Sound foundations (explicitly NOT rebuilt)

Graph-as-truth · evidence-gate concept · provider abstractions · lazy capability activation · workflow persistence · AsyncLocalStorage service container pattern (to be completed, not replaced).
