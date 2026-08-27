# Unified Improvement Plan - Index

**Project**: Ultimatrix v8 - Architecture Hardening & Swarm Enhancement  
**Status**: 🚀 IN PROGRESS  
**Last Updated**: 2026-08-26  
**Overall Progress**: 35% Complete

---

## 📋 Master Tracker

| Phase | Feature Area | Status | Spec | Implementation | Tests | Commit |
|-------|-------------|--------|------|---------------|-------|--------|
| **F1** | Constants Extraction & Maintainability | 🟡 IN PROGRESS | [SPEC](./specs/F1-CONSTANTS-EXTRACTION.md) | [IMPL](./impl/F1-CONSTANTS.md) | [TEST](./tests/F1-CONSTANTS.md) | `0b982f7` |
| **F2** | Canonical Registries (Skills/Selectors) | 🟢 DONE | [SPEC](./specs/F2-REGISTRIES.md) | [IMPL](./impl/F2-REGISTRIES.md) | [TEST](./tests/F2-REGISTRIES.md) | `1877696` |
| **F3** | Agent Result Envelope & Evidence | 🟢 DONE | [SPEC](./specs/F3-ENVELOPE.md) | [IMPL](./impl/F3-ENVELOPE.md) | [TEST](./tests/F3-ENVELOPE.md) | `34745f9` |
| **F4** | Resource Claim Registry & Metadata Resolution | 🟢 DONE | [SPEC](./specs/F4-CLAIMS.md) | [IMPL](./impl/F4-CLAIMS.md) | [TEST](./tests/F4-CLAIMS.md) | `cb3099e` |
| **F5** | Stigmergic Coordination Layer (Swarm) | 🔴 PENDING | [SPEC](./specs/F5-STIGMERGIC.md) | [IMPL](./impl/F5-STIGMERGIC.md) | [TEST](./tests/F5-STIGMERGIC.md) | - |
| **F6** | Primitive Gaps (Creds/Chains/AD/Cloud) | 🔴 PENDING | [SPEC](./specs/F6-PRIMITIVES.md) | [IMPL](./impl/F6-PRIMITIVES.md) | [TEST](./tests/F6-PRIMITIVES.md) | - |
| **F7** | Go Worker Runtime (Optional) | 🟡 DEFERRED | [SPEC](./specs/F7-GO-WORKERS.md) | [IMPL](./impl/F7-GO-WORKERS.md) | [TEST](./tests/F7-GO-WORKERS.md) | - |

---

## 📋 Specification Documents

| Spec | Title | Status | Description |
|------|-------|--------|-------------|
| [01-CONSTANTS-EXTRACTION](./specs/F1-CONSTANTS-EXTRACTION.md) | Constants Extraction & Maintainability | 🟡 IN PROGRESS | Extract all magic numbers/strings to centralized constants |
| [02-REGISTRIES](./specs/F2-REGISTRIES.md) | Canonical Registries (Skills/Selectors) | ✅ DONE | Live skill registry + engagement-scoped selectors |
| [03-ENVELOPE](./specs/F3-ENVELOPE.md) | Agent Result Envelope & Evidence | ✅ DONE | Typed worker envelopes, evidence bridging, result refs |
| [04-CLAIMS](./specs/F4-CLAIMS.md) | Resource Claim Registry | ✅ DONE | In-flight claim coordination, metadata-first technique resolution |
| [05-STIGMERGIC](./specs/F5-STIGMERGIC.md) | Stigmergic Coordination Layer | 🔴 PENDING | Pheromone coordination, decay, swarm scheduling |
| [06-PRIMITIVES](./specs/F6-PRIMITIVES.md) | Missing Lethal Primitives (Creds/Chains/AD/Cloud) | 🔴 PENDING | Missing lethal primitives to fill the fuel tank |
| [07-GO-WORKERS](./specs/F7-GO-WORKERS.md) | Go Worker Runtime (Optional) | 🟡 DEFERRED | Go worker runtime for performance |

---

## 📊 Overall Progress

```
Phase F1 (Constants):     ████████░░ 50%  (Extracting timeout/browser constants)
Phase F2 (Registries):    ██████████ 100% (Done)
Phase F3 (Envelope):      ██████████ 100% (Done)
Phase F4 (Claims):        ██████████ 100% (Done)
Phase F5 (Stigmergic):    ░░░░░░░░░░  0%  (Pending)
Phase F6 (Primitives):    ░░░░░░░░░░  0%  (Pending)
Phase F7 (Go Workers):    ░░░░░░░░░░  0%  (Deferred)

Overall: ████████░░░░░░ 40% Complete
```

---

## 🎯 Immediate Next Actions

### This Week (Priority Order)
1. **Complete F1 Constants Extraction** - Finish timeout/browser/network constants extraction
2. **Write F5 Stigmergic Spec** - Design pheromone coordination layer spec
3. **Write F6 Spec** - Detail missing lethal primitives (Creds/Chains/AD/Cloud)

### Next Week
1. **Implement F1** - Complete constants extraction with tests
2. **Start F5** - Implement PheromoneCoordinator + Worker emission
3. **Start F6** - Credential Reuse Engine (highest ROI primitive)

---

## 📁 File Structure

```
docs/PLANS/UNIFIED-IMPROVEMENT-PLAN/
├── 00-INDEX.md                    # This file
├── TRACKER.md                     # Detailed task tracker
├── specs/
│   ├── F1-CONSTANTS-EXTRACTION.md
│   ├── F2-REGISTRIES.md
│   ├── F3-ENVELOPE.md
│   ├── F4-CLAIMS.md
│   ├── F5-STIGMERGIC.md          (TO BE CREATED)
│   ├── F6-PRIMITIVES.md          (TO BE CREATED)
│   └── F7-GO-WORKERS.md          (TO BE CREATED)
├── impl/
│   ├── F1-CONSTANTS.md
│   ├── F2-REGISTRIES.md
│   ├── F3-ENVELOPE.md
│   ├── F4-CLAIMS.md
│   ├── F5-STIGMERGIC.md          (TO BE CREATED)
│   ├── F6-PRIMITIVES.md          (TO BE CREATED)
│   └── F7-GO-WORKERS.md
└── tests/
    ├── F1-CONSTANTS.md
    ├── F2-REGISTRIES.md
    ├── F3-ENVELOPE.md
    ├── F4-CLAIMS.md
    ├── F5-STIGMERGIC.md          (TO BE CREATED)
    ├── F6-PRIMITIVES.md          (TO BE CREATED)
    └── F7-GO-WORKERS.md          (TO BE CREATED)
```

---

## 🔗 Related Documents

- [Base Architecture Contracts](../BASE-ARCHITECTURE-CONTRACTS/00-INDEX.md) - Foundation contracts
- [JARVIS-LETHALITY-PROGRAM](../JARVIS-LETHALITY-PROGRAM/) - Overall program tracking
- [AGENTS.md](../../../AGENTS.md) - Agent instructions
- [STRIX-AUDIT.md](../../../STRIX-AUDIT.md) - Audit findings that drove this plan

---

## 📝 Notes

- **Legacy Engine**: FROZEN - Do not modify `src/manager/agent.ts` or legacy supervisor
- **Breaking Changes**: Allowed in solver/multi-model path only
- **Testing**: All phases require tsc clean + full test suite pass before commit
- **A10 Manual**: Camoufox live validation remains manual step

---

*Last Updated: 2026-08-27 | Next Review: 2026-09-01*