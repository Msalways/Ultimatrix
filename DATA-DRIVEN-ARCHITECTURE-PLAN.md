# Data-Driven Architecture Plan — No Blind Spots

> **Root principle**: Every layer of the system must be data-driven, not blind.
> The graph accumulates knowledge; every consumer reads it to make decisions.
> Capture modules enrich, not overwrite. The brain perceives full state.
> No bandaids, no hardcoded instructions, no frozen vocabularies.

## Architectural Rules (apply to ALL work)

1. No hardcoded tool names in brain instructions — the brain discovers tools from descriptions
2. No frozen vocabularies — the LLM queries a live schema endpoint to discover valid values
3. No regex/substring detection — structured typed fields only at all seams
4. No bandaids — fix the design, not the symptom
5. No fire-and-forget — capture modules read-before-write, consumers read-before-decide
6. No circular self-verification — `confirmed = verified` (gate's verdict), not `observed && verified`
7. LLM perceives FULL state via structured access — no pre-summarized/lossy context

---

## Wave 1: Graph Memory Wiring (Council + Capture + Brain)

### Gap 1: Council Graph-Blindness

**Root cause**: `buildGoalPrompt()` (orchestrator.ts:101) builds member prompts with goal + transcript + debate memory + intelligence context — but ZERO target graph state. `session.ts` doesn't even pass `IntelligenceContext` to `debateOnce()`. Council members debate "what to test" blind to accumulated findings, endpoints, auth flows, and attack paths.

**Fix**: Layered graph-state injection into council prompts.

| # | File | Change | Status |
|---|------|--------|--------|
| 1a | `src/council/types.ts` | Add `graphState?` and `captureOverview?` fields to `IntelligenceContext` | pending |
| 1b | `src/council/orchestrator.ts` | In `buildGoalPrompt()`, inject graphState as "## Current Target State" block. If `captureOverview` present, inject as "## Structural Overview" block | pending |
| 1c | `src/session.ts` | Construct `IntelligenceContext` with graph state + reflexion/anti-loop signals, pass to `debateOnce()` | pending |

### Gap 2: Capture Modules Fire-and-Forget

**Root cause**: `passive-observer`, `graph-bridge`, `dialog-inject` write to the graph via `addEndpoint`/`upsertPage` without reading existing node data. `addEndpoint` does dedup by URL+method and merges via `Object.assign`, but capture modules don't check if existing data is richer.

**Fix**: `mergeEndpoint()` method that reads-then-merges non-destructively. Capture modules call it instead of `addEndpoint`.

| # | File | Change | Status |
|---|------|--------|--------|
| 2a | `src/graph/store.ts` | Add `mergeEndpoint(url, method, newData)` — reads existing, merges only fields not already present, appends source | pending |
| 2b | `src/graph/store-libsql.ts` | Mirror `mergeEndpoint` for LibSQL store | pending |
| 2c | `src/capture/passive-observer.ts` | Use `mergeEndpoint` instead of `addEndpoint` | pending |
| 2d | `src/capture/graph-bridge.ts` | Use `mergeEndpoint` for discovered endpoints; read-before-write for `upsertPage` | pending |
| 2e | `src/browser/dialog-inject.ts` | Read existing page before `upsertPage`, merge only richer fields | pending |

### Gap 3: Brain Capture Visibility

**Root cause**: Solver injects `getTargetSummary()` snapshot into enriched goal, but no diff of what changed since last turn. Brain doesn't see "what's new" — it sees a flat snapshot every turn.

**Fix**: "## Recent Discoveries" section that diffs graph state before/after each turn.

| # | File | Change | Status |
|---|------|--------|--------|
| 3a | `src/solver/solver.ts` | After "## Current Graph State", add "## Recent Discoveries" section — diffs `graphStateSnapshot` vs current state (new endpoints, findings, auth flows, untested actions) | pending |

### Gap 1-3 Tests

| File | Tests | What |
|------|-------|------|
| `test/council/graph-state-injection.test.ts` | 4 | buildGoalPrompt includes graph state, layered capture overview, backward compat, format matches solver |
| `test/capture/read-before-write.test.ts` | 3 | mergeEndpoint preserves richer data, adds new fields, creates when not found |
| `test/solver/recent-discoveries.test.ts` | 3 | Diff shows new endpoints, new findings, empty when nothing changed |

---

## Wave 2: Hybrid Payload Generation

### Problem
Static JSON payloads go stale. New WAF bypasses, DBMS-specific syntax, and novel techniques emerge. The LLM already knows these patterns from training — it just needs the seam to pass crafted payloads and the feedback loop to learn what works.

### Design
Static JSON is the seed baseline, not the ceiling. The brain observes target behavior and crafts additional context-aware payloads. The evidence gate filters non-working ones. Outcome feedback learns across sessions.

| # | File | Change | Status |
|---|------|--------|--------|
| 4a | `src/solver/brain-instructions.ts` | ~5 sentence payload adaptation principle (zero tool names, zero examples, zero field references) | pending |
| 4b | `src/primitives/framework.ts` | Add `mergedPayloads?: string[]` to `TechniqueContext`. In `runPrimitive()`, merge `ctx.payloads` + primitive defaults with dedup | pending |
| 4c | `src/primitives/framework.ts` | Tag each `AttackStep.metadata` with `payloadSource: 'static' \| 'llm' \| 'mutation'`. Include in `recordObserved` | pending |
| 4d | `src/intelligence/evidence-ledger.ts` | Add `payloadSource?: string` to `ObservedFacts` | pending |
| 4e | `src/intelligence/outcome-feedback.ts` | Add `PayloadOutcome` interface + `recordPayloadOutcome()` method — tracks per-payload worked/failed/source/context | pending |
| 4f | `src/primitives/framework.ts` | Add `adaptsTo?: string[]` to `TechniquePrimitive` interface | pending |
| 4g | `src/primitives/index.ts` | `listPrimitiveCapabilitiesTool` returns `adaptsTo` from primitive declarations | pending |

### Wave 2 Tests

| File | Tests | What |
|------|-------|------|
| `test/primitives/payload-merge.test.ts` | 5 | Merge + dedup, provenance tagging, backward compat, empty payloads, payloadSet override |
| `test/primitives/payload-provenance.test.ts` | 3 | Step metadata tagging, recordObserved includes source, oracle sees source |
| `test/intelligence/outcome-feedback-payloads.test.ts` | 4 | Record payload outcome, get effectiveness, cross-vuln-type, context tracking |

---

## Wave 3: Remaining Depth-Plan Items

### P3.4: Remove Circular Self-Verification — CANCELLED

**Analysis**: After implementing `confirmed = verified` (removing the `observed &&` check), 6 tests failed. Investigation revealed the `observed && verified` pattern is NOT circular self-verification — it's a correct two-layer design:
- `observed` = the oracle's domain-specific analysis (did the response indicate a vulnerability? e.g., was access denied? was a database error leaked?)
- `verified` = the gate's structural verification (was the evidence actually recorded in the ledger?)

The gate verifies that the CLAIM is backed by recorded evidence, but the oracle determines whether the OBSERVED BEHAVIOR constitutes a vulnerability. These are different concerns. Removing `observed &&` causes false positives: the gate confirms any claim with recorded evidence, even when the oracle's domain logic determined the attack didn't succeed (e.g., credentials rejected → access denied → not a vulnerability).

**Decision**: Keep `confirmed = observed && verified`. The pattern is architecturally correct.

### P1.5: Wordlist Bootstrap

**Root cause**: Wordlists ship in `payloads/wordlists/` and adapters fall back to `defaultWordlistDir()`, but `cli/init.ts` doesn't copy them to `~/.config/ultimatrix/wordlists/` during setup.

| # | File | Change | Status |
|---|------|--------|--------|
| 6a | `src/cli/init.ts` | Copy shipped wordlists from `payloads/wordlists/` to `~/.config/ultimatrix/wordlists/` during init wizard | pending |

---

## Wave 4: Future Work (Not In Scope This Session)

These items require dedicated planning and are noted for completeness:

- **P5.1-P5.8**: Primitive deepening (union extraction, DBMS fingerprinting, barrier sync, shape-detect trust fields, ID walking, header SSRF, multi-step state machine, boundary values)
- **P6.1-P6.9**: New primitives (xxe, deserialization, request-smuggling, cache-poisoning, prototype-pollution, graphql, websocket, ssti-split, jwt)
- **P7.4**: New adapters (commix, dalfox, hydra, testssl.sh, nikto, kiterunner, amass, whatweb)
- **P8.1-P8.3**: Skill library enrichment (deepen 13 shallow skills, fill 3 stubs, add skills for new primitives)
- **P9.1-P9.3**: Brain instructions update (multi-step composition, variant-aware tool selection, exploitation-readiness directive)

---

## Execution Order

```
Wave 1 (Graph Memory):
  2a (store.ts mergeEndpoint) ──┐
  2b (store-libsql mirror) ──── ├──> 2c-e (capture modules) ──> 3a (solver recent discoveries)
  1a (types) ──────────────────┤
  1b (orchestrator prompt) ─── ├──> 1c (session.ts wires it all)
  Tests ───────────────────────┘

Wave 2 (Hybrid Payloads):
  4d (evidence-ledger type) ──┐
  4b (merge logic) ───────────┤
  4c (provenance tagging) ──── ├──> 4e (outcome feedback) ──> 4g (listPrimitiveCapabilities)
  4f (adaptsTo interface) ────┤
  4a (brain instructions) ────┘
  Tests ───────────────────────┘

Wave 3 (Depth-Plan Remainder):
  5a-j (circular self-verification) ── independent
  6a (wordlist bootstrap) ──────────── independent
  Tests ──────────────────────────────┘

Final: Build + full test suite
```
