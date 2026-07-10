# Ultimatrix v8 — Detailed Technical Specifications

**Generated:** 2026-07-09
**Status:** Active Development
**Architecture:** Dual-Engine (Legacy Supervisor + OODA Solver) + Multi-Model Routing + Campaign Autonomy

---

## Specification Index

| Phase | Spec ID | Title | Status | Depends On |
|-------|---------|-------|--------|------------|
| **Meta** | [SPEC-99-001](99-meta/SPEC-99-001-architecture-overview.md) | Architecture Overview & Dependency Graph | ✅ Draft | — |
| **Meta** | [SPEC-99-002](99-meta/SPEC-99-002-glossary.md) | Glossary & Conventions | ✅ Draft | — |

### Phase 0 — Foundation (Multi-Model Correctness & Transparency)
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-00-001](00-foundation/SPEC-00-001-multi-model-correctness.md) | Multi-Model Engine Correctness (Hard Errors, Selector Persistence) | 📋 Planned | SPEC-99-001 |
| [SPEC-00-002](00-foundation/SPEC-00-002-repl-transparency.md) | REPL Transparency: Tier Map + Per-Turn Cost + Quota Status | 📋 Planned | SPEC-00-001 |
| [SPEC-00-003](00-foundation/SPEC-00-003-flat-brain-toolset.md) | Flat Full Toolset on Brain (Drop Skill Gate) | 📋 Planned | SPEC-00-001 |
| [SPEC-00-004](00-foundation/SPEC-00-004-evidence-gate-hardening.md) | Evidence Gate Hardening: Receipt-Backed Findings Only | 📋 Planned | SPEC-99-001 |
| [SPEC-00-005](00-foundation/SPEC-00-005-scope-guard-rate-limit.md) | Scope Guard + Per-Host Rate Limiting (Safety/Legal) | 📋 Planned | SPEC-00-001 |
| [SPEC-00-006](00-foundation/SPEC-00-006-config-schema-extensions.md) | Config Schema Extensions for Multi-Model & Campaigns | 📋 Planned | SPEC-99-001 |

### Phase 1 — Business-Logic Analyser (THE Differentiator)
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-01-001](01-analyser/SPEC-01-001-graph-schema-extensions.md) | Graph Schema Extensions: ValueOrigin, HeaderSemantic, AuthScheme, UseCase, Hypothesis | 📋 Planned | SPEC-99-001 |
| [SPEC-01-002](01-analyser/SPEC-01-002-value-provenance.md) | Value Provenance Engine: HAR/API → Param←Response Mapping | 📋 Planned | SPEC-01-001 |
| [SPEC-01-003](01-analyser/SPEC-01-003-auth-decode-reuse.md) | Auth Decode & Reuse Detection: Basic/JWT/Custom → AuthScheme Nodes | 📋 Planned | SPEC-01-001 |
| [SPEC-01-004](01-analyser/SPEC-01-004-use-case-invariant-extraction.md) | Use-Case Inference + Invariant Extraction (UI→API→DOM Correlation) | 📋 Planned | SPEC-01-002, SPEC-01-003 |
| [SPEC-01-005](01-analyser/SPEC-01-005-human-hypothesis-ingestion.md) | Human Hypothesis Ingestion: Structured Input → HypothesisNode | 📋 Planned | SPEC-01-001 |
| [SPEC-01-006](01-analyser/SPEC-01-006-analyser-orchestrator.md) | Analyser Orchestrator: Pipeline + Incremental Updates | 📋 Planned | SPEC-01-002, SPEC-01-003, SPEC-01-004, SPEC-01-005 |

### Phase 2 — Campaign Autonomy (Primitive Framework + Planner + Executor)
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-02-001](02-campaign/SPEC-02-001-primitive-framework.md) | Technique Primitive Framework (Generator + Executor + Oracle) | ✅ Implemented | SPEC-99-001 |
| [SPEC-02-002](02-campaign/SPEC-02-002-flagship-primitives.md) | Flagship Primitives: invariantProbe, workflowBypass, concurrencyHarness, authzMatrix, configTrust, idorSwapper, ssrfOast | ✅ Implemented | SPEC-02-001 |
| [SPEC-02-003](02-campaign/SPEC-02-003-campaign-planner.md) | Campaign Planner: Endpoint×Param×Role×State×Technique Matrix | ✅ Implemented | SPEC-01-004, SPEC-02-002 |
| [SPEC-02-004](02-campaign/SPEC-02-004-campaign-executor.md) | Campaign Executor: Parallel Slices, Rate-Limit, Scope, Budget | ✅ Implemented | SPEC-02-003 |
| [SPEC-02-005](02-campaign/SPEC-02-005-evidence-gate-primitives.md) | Evidence Gate Inside Primitives: Confirmed/Unconfirmed Only | ✅ Implemented | SPEC-00-004, SPEC-02-001 |
| [SPEC-02-006](02-campaign/SPEC-02-006-rewire-solver-campaigns.md) | Rewire solve() → Strategist Emits Campaigns (Primary Loop) | 📋 Planned | SPEC-02-004, SPEC-00-003 |
| [SPEC-02-007](02-campaign/SPEC-02-007-campaign-continuity.md) | Campaign Continuity: Retest on Change, Backlog Management | 📋 Planned | SPEC-02-004 |

### Phase 3 — Attack-Path Solver + Verified Case File + AI Red Team
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-03-001](03-attack-path/SPEC-03-001-attack-path-solver.md) | Attack-Path Solver: Graph Traversal Unauth→Sensitive | 📋 Planned | SPEC-01-004, SPEC-02-003 |
| [SPEC-03-002](03-attack-path/SPEC-03-002-verified-case-file.md) | Verified Case File: Forensic Log + Exploit + Decision Log + Remediation | 📋 Planned | SPEC-00-004, SPEC-02-005 |
| [SPEC-03-003](03-attack-path/SPEC-03-003-ai-trust-boundary.md) | AI Trust Boundary: Prompt Injection → Tool Abuse via Browser+OAST | 📋 Planned | SPEC-02-002 (aiTrust primitive) |
| [SPEC-03-004](03-attack-path/SPEC-03-004-chain-verification.md) | Chain Verification: Composed Low-Sev → Critical via Evidence Gate | 📋 Planned | SPEC-03-001, SPEC-00-004 |

### Phase 4 — Fleet + Self-Improvement (Moat)
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-04-001](04-fleet/SPEC-04-001-agent-fleet.md) | Agent Fleet: Specialized Agents per Technique/Role/Tenant, Slice-Level Multi-Model Fan-Out | 📋 Planned | SPEC-00-001, SPEC-02-004 |
| [SPEC-04-002](04-fleet/SPEC-04-002-continuity-retest.md) | Continuity: Automated Retest on Deploy, Finding Regression Tracking | 📋 Planned | SPEC-02-007 |
| [SPEC-04-003](04-fleet/SPEC-04-003-outcome-feedback-loop.md) | Outcome Feedback Loop: Report Accepted? Fix Held? → Reflexion + Technique Library | 📋 Planned | SPEC-02-005 |
| [SPEC-04-004](04-fleet/SPEC-04-004-cross-engagement-memory.md) | Cross-Engagement Pattern Memory (Privacy-Preserving) | 📋 Planned | SPEC-04-003 |

### Phase 5 — Product & Market Readiness
| Spec ID | Title | Status | Depends On |
|---------|-------|--------|------------|
| [SPEC-05-001](05-product/SPEC-05-001-repl-polish.md) | REPL Polish: Streaming, Inline Finding Cards, Approval Gates, Session Replay | 📋 Planned | SPEC-00-002 |
| [SPEC-05-002](05-product/SPEC-05-002-web-ui-parity.md) | Web UI (Next.js) Feature Parity: Campaign Dashboard, Graph Explorer, Hypothesis Board, Case File Viewer | 📋 Planned | SPEC-02-006, SPEC-03-002 |
| [SPEC-05-003](05-product/SPEC-05-003-sdk-hardening.md) | SDK Hardening: TypeScript-First Streaming API, Webhooks, Multi-Target Orchestration | 📋 Planned | SPEC-02-006 |
| [SPEC-05-004](05-product/SPEC-05-004-remote-execution.md) | Remote Execution: Browserbase/Steel, Remote OAST, Sandboxed Workers (Firecracker/K8s) | 📋 Planned | SPEC-04-001 |
| [SPEC-05-005](05-product/SPEC-05-005-provider-key-management.md) | Provider/Key Management UX: Health Checks, Rotation, Per-Project Overrides | 📋 Planned | SPEC-00-006 |

---

## Dependency Graph (Text)
```
SPEC-99-001 (Architecture)
  │
  ├─► SPEC-00-001 (Multi-Model Correctness)
  │     ├─► SPEC-00-002 (REPL Transparency)
  │     ├─► SPEC-00-003 (Flat Brain Toolset)
  │     ├─► SPEC-00-004 (Evidence Gate Hardening)
  │     ├─► SPEC-00-005 (Scope Guard)
  │     └─► SPEC-00-006 (Config Extensions)
  │
  ├─► SPEC-01-001 (Graph Schema Extensions)
  │     ├─► SPEC-01-002 (Value Provenance)
  │     ├─► SPEC-01-003 (Auth Decode/Reuse)
  │     │     └─► SPEC-01-004 (Use-Case + Invariant) ◄── SPEC-01-002
  │     │
  │     └─► SPEC-01-005 (Human Hypothesis Ingestion)
  │           └─► SPEC-01-006 (Analyser Orchestrator)
  │
  ├─► SPEC-02-001 (Primitive Framework) ◄── SPEC-00-004
  │     ├─► SPEC-02-002 (Flagship Primitives)
  │     │     └─► SPEC-02-003 (Campaign Planner) ◄── SPEC-01-004
  │     │           └─► SPEC-02-004 (Campaign Executor)
  │     │                 ├─► SPEC-02-005 (Evidence Gate in Primitives)
  │     │                 ├─► SPEC-02-006 (Rewire Solver) ◄── SPEC-00-003
  │     │                 └─► SPEC-02-007 (Continuity)
  │     │
  │     ├─► SPEC-03-001 (Attack-Path Solver) ◄── SPEC-01-004, SPEC-02-003
  │     ├─► SPEC-03-002 (Verified Case File) ◄── SPEC-00-004, SPEC-02-005
  │     ├─► SPEC-03-003 (AI Trust Boundary) ◄── SPEC-02-002
  │     └─► SPEC-03-004 (Chain Verification) ◄── SPEC-03-001, SPEC-00-004
  │
  ├─► SPEC-04-001 (Agent Fleet) ◄── SPEC-00-001, SPEC-02-004
  │     ├─► SPEC-04-002 (Continuity Retest) ◄── SPEC-02-007
  │     ├─► SPEC-04-003 (Outcome Feedback) ◄── SPEC-02-005
  │     └─► SPEC-04-004 (Cross-Engagement Memory) ◄── SPEC-04-003
  │
  └─► SPEC-05-001 (REPL Polish) ◄── SPEC-00-002
        ├─► SPEC-05-002 (Web UI Parity) ◄── SPEC-02-006, SPEC-03-002
        ├─► SPEC-05-003 (SDK Hardening) ◄── SPEC-02-006
        ├─► SPEC-05-004 (Remote Execution) ◄── SPEC-04-001
        └─► SPEC-05-005 (Key Management) ◄── SPEC-00-006
```

---

## Quick Start for Implementers

1. **Read** [SPEC-99-001](99-meta/SPEC-99-001-architecture-overview.md) for architecture context
2. **Start with Phase 0** — All later phases depend on multi-model correctness
3. **Each spec includes:** Problem statement, Acceptance criteria, File-level changes, Test requirements, Rollback plan
4. **Update status** in this README when moving: 📋 Planned → 🔄 In Progress → ✅ Implemented → 🧪 Verified

---

*Auto-generated from codebase analysis. Keep this index updated as specs are created/completed.*
