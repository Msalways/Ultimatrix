# 00. Program Index — Jarvis Lethality Program

**Program goal:** Turn Ultimatrix from a disciplined-but-passive analyzer into a lethal, conversational security-research buddy ("Jarvis"): a brain that hunts, discovery that survives hostile targets, and a persistent knowledge-driven dialogue.

**Status:** PLANNING COMPLETE — implementation not started (except where marked).

## Program Thesis

Three root causes cap lethality today:

1. **The brain is not told to hunt.** Its system prompt frames it as a passive "conversational analyst" with zero attack mandate, no observe→react→find loop, and no attack-path declaration — which also starves the anti-loop diversity tracker (`[PATH:]` tags are extracted at `src/solver/solver.ts:595` but the instruction to emit them lives only in CORE_CONTRACT, which the solver brain never receives).
2. **Discovery has a single point of failure.** The only crawler is an LLM driving a detectable Chromium browser. One bot challenge kills the crawl; the frontier queue is decorative (never dequeued); designed fallbacks (js-miner, shadow API discovery) are dead code. Root cause of challenge-blocked crawls is a fingerprintable browser — hence Camoufox.
3. **Knowledge does not flow back.** Blackboard facts are write-only from the brain's perspective; hypotheses persist as wrong node types; external agentskills.io-standard skill libraries have no ingestion path despite the loader already supporting extra dirs.

## Spec Index

| # | Spec | Phase | Effort | Status |
|---|------|-------|--------|--------|
| 01 | [Brain Lethality](./01-brain-lethality.md) | B | S | PENDING |
| 02 | [Camoufox Provider](./02-camoufox-provider.md) | A | L | PENDING |
| 03 | [Discovery Resilience](./03-discovery-resilience.md) | C | M | PENDING |
| 04 | [Jarvis Conversation Layer](./04-jarvis-conversation-layer.md) | D | M | PENDING |

## Execution Order

```
B (01 brain)  ── hours, unlocks value of everything after
   │
A (02 camoufox) ── long pole, root-cause fix for hostile targets
   │
C (03 discovery) ──┐
D (04 jarvis)   ───┴── can interleave once A lands
```

## Already Shipped (dependencies satisfied)

| Prerequisite | Where |
|---|---|
| P0 payload restoration: all 56 skills carry full payload arsenals | skills/*.md (53 files restored, +8,651 lines) |
| P1.5 skill→primitive wiring: `SkillMeta.primitives` + drift guard, 23 skills wired | src/solver/skills/loader.ts, test/skills/primitive-wiring.test.ts |
| P3.1 captured-request replay: store + list/replay tools | src/capture/captured-request-store.ts, src/tools/replay-tools.ts |
| BrowserProvider seam with fail-closed camofox placeholder | src/browser/provider.ts |
| Evidence gate, proof floors, exploit proofs, decision ledger | src/intelligence/, src/security/ |

## Standing Constraints (apply to every spec)

1. No bandaids, no hand-slicing platform mechanisms — prefer platform-native paths, document rejected options.
2. No hardcoded enumerations or vendor vocabulary in prompts/descriptions; capability discovered live.
3. No regex/keyword/substring detection for state classification — typed fields only.
4. Fail-closed on safety seams (scope, evidence, approvals).
5. Every phase gate: green `tsc --noEmit`, green tests, clean build, then commit.
6. `ultimatrix.yaml` contains a plaintext credential in git history — EXCLUDE from every commit (`git add -- ':!ultimatrix.yaml'`).
