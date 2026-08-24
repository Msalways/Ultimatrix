# 01. Brain Lethality (Phase B)

## Goal

Make the solver brain an active hunter: give it an observe→react→attack mandate, restore anti-loop attack-path participation, and make runtime state (blackboard facts, alerts, captured traffic) actually reach its context.

## Current State

- System prompt (`getBrainInstructions`, src/solver/brain-instructions.ts:5-18): 18 bullets, ~370 words. Frames the agent as a passive "conversational analyst buddy". No exploitation mandate. `_extraContext` param is dead (sole caller passes only config — brain-tools.ts:235).
- `[PATH:]` extraction at solver.ts:595 feeds `loopDetector.recordAttackPath()`, but the only instruction to emit those tags lives in CORE_CONTRACT ("Attack Path Declaration", core-contract.ts:59-63), which the solver brain never receives (CORE_CONTRACT is imported only by legacy supervisor, spider, workers). Anti-loop attack-class diversity tracking is structurally starved on the primary engine path.
- Runtime envelope (`buildRuntimeEnvelope`, src/runtime/context-envelope.ts:26-70) exposes counts + ref ids only. Blackboard facts appear solely as a count (solver.ts:941); `board.addFact` content (exploitation-loop notes solver.ts:867, attack-path facts solver.ts:803) never reaches the next prompt.
- Alerts are bare flags `{type:'stale-execution'|'unsupported-claims', count}` with no remediation semantics.
- Reflexion lessons and cross-engagement priors are pull-only (`getPriorPatterns` tool); no per-turn injection.
- Workers/spider receive CORE_CONTRACT discipline ([CONFIRMED]/[SUSPECTED], assumption verification, path diversity) that their orchestrating brain lacks.

## Gaps Addressed

- Brain has no offensive objective; a polite Q&A agent satisfies its current prompt.
- Anti-loop diversity dimension blind on the solver path.
- Deterministic intelligence layers produce facts the brain cannot see.

## In Scope

1. Rewrite `getBrainInstructions()` to include:
   - OODA hunting mandate: "your objective is confirmed, evidenced findings; every turn either observes, reacts to observed consequences, or attacks."
   - Observe→react→attack loop in structural language (no tool ids — capability phrasing per standing constraint #2).
   - Attack-path declaration: declare the attack class being pursued each turn via a free-form `[PATH: <type>]` tag (restores solver.ts:595 extraction).
   - Path-diversity rule: after repeated failures on one class, switch to fundamentally different classes, not re-encodings.
   - Assumption verification and evidence-discipline sections imported from a shared module (see task 4).
2. Enrich `buildRuntimeEnvelope`:
   - Actionable alert text (e.g., stale-execution → "switch attack class; declare new [PATH:]").
   - Surface last-N blackboard fact strings (bounded, budget-aware).
   - Captured-request count from `CapturedRequestStore` + replay-seam hint.
3. Per-turn injection of reflexion lessons (L0-L2 summaries) and cross-engagement `priors.promptBlock` into the enriched goal.
4. Extract shared Evidence & Integrity / Assumption Verification sections of CORE_CONTRACT into a shared exported constant consumed by BOTH the brain instructions and CORE_CONTRACT (single source, no copy-drift).
5. Use or delete `_extraContext`.

## Out of Scope

- Council personas unchanged (separate charter governs them).
- Tool additions (replay tools already exist from P3.1).
- Any change to evidence-gate or proof-floor semantics.

## Public Types / Interfaces

```typescript
// src/prompts/core-contract.ts
export const EVIDENCE_DISCIPLINE: string   // extracted shared section
export const ASSUMPTION_VERIFICATION: string

// src/solver/brain-instructions.ts — signature unchanged,
// body now composes persona + OODA mandate + shared discipline sections.
export function getBrainInstructions(config: UltimatrixConfig, extraContext?: string): string

// src/runtime/context-envelope.ts
export interface RuntimeEnvelopeInput {
  // existing fields...
  blackboardFacts?: { total: number; recent: string[] }   // NEW
  capturedRequests?: { total: number }                    // NEW
}
```

## Data Flow

Per turn: solver builds envelope → now includes bounded facts + capture counts + remediation-tagged alerts → enriched goal carries reflexion/priors blocks → brain system prompt contains OODA mandate + `[PATH:]` contract → brain output tags parsed by existing extractAttackPath → LoopDetector diversity tracking becomes live.

## Failure Modes

- Prompt grows unbounded → cap instructions at ~700 words; envelope sections stay inside existing token budget (`runtimeEnvelopeTokenBudget`).
- Facts leak secrets → facts pass through existing `sanitizeDurableContext` before inclusion; bodies/secrets excluded by shape gate.
- `[PATH:]` tag abused as free text → acceptable; extractor treats any tag as valid class label (already true, core-contract.ts:61).
- Regression: prompts naming concrete tool ids → existing guard test must stay green (test/skills/prompt-no-hardcoded-tools.test.ts).

## Tests

- Brain instructions contain: OODA mandate phrase, `[PATH:` contract, diversity rule, zero TOOL_IDS matches (existing test).
- Envelope includes recent facts (bounded), capture counts, and remediation text for both alert types.
- Shared discipline constant appears in both brain instructions and CORE_CONTRACT output.
- Existing evals stay green (`npm run test:evals`) — especially scope-policy case asserting "ambient allow-any never leaks".

## Acceptance Criteria

- [ ] Solver brain emits `[PATH:]` tags during live runs (verify via forensic log / LoopDetector state).
- [ ] Stale-loop recovery visible: after stale threshold, brain switches declared class within one turn.
- [ ] Blackboard facts from exploitation loop visible in next-turn context.
- [ ] Full suite green; no new tsc errors.

## Dependencies

None external — pure prompt/envelope work. Unlocks value of specs 02-04.
