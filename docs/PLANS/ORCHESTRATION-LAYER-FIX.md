# Orchestration Layer Fix - Diagnosis + Advanced Playbook

**Date:** 2026-07-30
**Status:** PLANNED
**Goal:** Add a real orchestration layer that diagnoses target state, ranks advanced techniques, loads the right skills/tools/workers, and runs evidence-gated playbooks without prompt-only hacks.

---

## Root Cause

Ultimatrix already has strong pieces: graph state, HAR capture, dynamic skills, dynamic tools, workers, primitives, campaign execution, and EvidenceGate. The missing part is a central planner that reads current target state and decides what to load and run next.

Current weakness:

- The brain can run tools, but it does not first build a structured diagnosis.
- Advanced primitives exist, but selection is mostly left to model judgment.
- Campaign planning receives primitives with empty tags, so advanced relevance is weak.
- Missing context such as second user, alternate object IDs, auth state, or workflow order is not surfaced as a first-class requirement.
- Diagnosis, playbook planning, primitive execution, worker delegation, and evidence promotion are not tied together by one orchestration contract.

Fix:

- Add a diagnosis subsystem.
- Add a technique planner.
- Add `diagnoseTarget` and `runAdvancedPlaybook` tools.
- Fix primitive metadata exposure.
- Wire hunting flow to diagnose before advanced testing.
- Keep EvidenceGate as the only path to confirmed findings.

---

## Scope Rules

- Do not add a second skill registry.
- Do not add a second tool registry.
- Do not add a second worker orchestration system.
- Do not add a second evidence system.
- Do not confirm findings from diagnosis alone.
- Do not hardcode user-text routing such as "if user says SSRF then run SSRF".
- Do not add mandatory config.
- Keep all testing authorization assumptions outside the engine; the engine only acts on in-scope targets.

---

## New Types

**File:** `src/orchestration/types.ts`

Add:

- `AttackSurfaceSignal`
- `DiagnosisProfile`
- `TechniqueCandidate`
- `AdvancedPlaybook`
- `PlaybookRunResult`
- `PrimitiveMetadata`
- `MissingContextRequirement`

The types should describe:

- Discovered endpoints, params, methods, auth, headers, roles, workflows, relations, and prior findings.
- High-value signals such as object IDs, URL-like params, GraphQL routes, state-changing methods, auth-bound routes, workflow order, tenant markers, callback/webhook fields, and OAST/cloud indicators.
- Ranked candidate techniques with reason, confidence, required context, skills, primitives, workers, and evidence needs.

---

## Task Breakdown

### T1: Expose Real Primitive Metadata

**Files:**

- `src/primitives/framework.ts`
- `src/primitives/index.ts`
- `src/campaign/campaign-tool.ts`
- `src/campaign/types.ts`

**Fix:**

Add a helper such as `listPrimitiveMetadata()` that derives stable metadata from registered primitives:

- `id`
- `name`
- `description`
- `technique`
- `adaptsTo`
- `tags`
- `requiredContext`

Tags should be derived from primitive id, name, technique, description, and `adaptsTo`, not passed as empty arrays.

**Acceptance:**

- `runCampaign` passes non-empty primitive metadata.
- Campaign planner can prioritize authz, SSRF, GraphQL, workflow, deserialization, smuggling, and injection primitives based on tags.

---

### T2: Add Diagnosis Subsystem

**Files:**

- `src/orchestration/diagnosis.ts`
- `src/orchestration/types.ts`

**Fix:**

Implement `diagnoseTargetState(input)` to read:

- Graph endpoints
- Endpoint params and headers
- Auth schemes and auth flows
- RBAC roles
- workflows/actions
- graph relations
- findings/candidate findings/facts/hypotheses
- available skill metadata
- primitive metadata

It should emit a `DiagnosisProfile` with:

- `knownContext`
- `missingContext`
- `attackSurfaces`
- `rankedTechniques`
- `recommendedSkills`
- `recommendedPrimitives`
- `recommendedWorkers`

**Ranking requirements:**

- Rank IDOR/BOLA/authz when authenticated endpoints and object-like params exist.
- Rank workflow/business-logic tests when ordered actions or state-changing endpoints exist.
- Rank SSRF/OAST/cloud when URL, callback, redirect, webhook, host, image, file, import, or metadata-like params exist.
- Rank GraphQL tests for GraphQL endpoints.
- Rank second-order injection when VALUE_ORIGIN/REINGESTS-style relations or stored-input workflows exist.
- Rank smuggling/header injection when custom headers, proxy hints, or raw request surfaces exist.
- Rank deserialization when content types, payload shapes, or params suggest serialized objects.

**Acceptance:**

- Diagnosis does not execute tests.
- Diagnosis does not write findings.
- Diagnosis returns specific missing context instead of weak findings.

---

### T3: Add Technique Planner

**Files:**

- `src/orchestration/technique-planner.ts`
- `src/orchestration/types.ts`

**Fix:**

Implement `buildAdvancedPlaybook(profile, options)` to convert `DiagnosisProfile` into executable candidates.

The planner should:

- Use skill metadata and primitive metadata.
- Respect primitive applicability through context shape.
- Prefer high-value advanced techniques when context supports them.
- Attach required evidence criteria.
- Attach required missing context.
- Select direct primitive execution when enough context exists.
- Select worker delegation when reasoning or multi-step exploration is needed.

**Acceptance:**

- Planner output is structured.
- Planner can default to top-ranked candidates.
- Planner can accept user-selected candidate IDs.

---

### T4: Add `diagnoseTarget` Tool

**Files:**

- `src/orchestration/tools.ts`
- `src/tools/registry.ts`
- `src/core/toolpack.ts`

**Fix:**

Create a Mastra tool:

```ts
diagnoseTarget({
  target?: string,
  includeSkills?: boolean,
  includePrimitives?: boolean,
  maxCandidates?: number
})
```

It should return:

- target summary
- known context
- missing context
- attack surface signals
- ranked technique candidates
- recommended skills/primitives/workers

**Acceptance:**

- Registered globally.
- Included in solver/council toolpack.
- Does not run attacks.
- Does not write findings.

---

### T5: Add `runAdvancedPlaybook` Tool

**Files:**

- `src/orchestration/tools.ts`
- `src/orchestration/playbook-runner.ts`
- `src/tools/registry.ts`
- `src/core/toolpack.ts`

**Fix:**

Create a Mastra tool:

```ts
runAdvancedPlaybook({
  candidateIds?: string[],
  maxCandidates?: number,
  commit?: boolean
})
```

Behavior:

- Run diagnosis if no profile is supplied.
- Build playbook from top candidates or selected candidate IDs.
- Load skill bodies on demand.
- Respect skill `toolRefs`, `toolChains`, `compositionRules`, `requires`, `enhances`, and `conflicts`.
- Run applicable primitives through `runPrimitiveById`.
- Delegate to existing `WorkerPool` when candidate requires exploratory reasoning.
- Record evidence through existing primitive and control-tool paths.
- Promote confirmed findings only through EvidenceGate-backed `writeFinding`.
- Store unconfirmed results as observations/candidates, not confirmed findings.

**Acceptance:**

- No duplicate worker path.
- No duplicate evidence path.
- Direct primitive runs and worker delegation both work.
- Tool returns `PlaybookRunResult` with executed, skipped, confirmed, unconfirmed, missing context, and loaded skills.

---

### T6: Fix Campaign Primitive Relevance

**Files:**

- `src/campaign/campaign-tool.ts`
- `src/campaign/planner.ts`
- `test/campaign/*`

**Fix:**

Replace:

```ts
tags: []
```

with real metadata from `listPrimitiveMetadata()`.

Improve planner relevance using:

- primitive tags
- endpoint params
- auth state
- method type
- content type/header signals
- endpoint use case/tags
- graph relation hints

**Acceptance:**

- Advanced primitives appear in planned slices only when relevant.
- Generic fallback behavior remains unchanged when metadata is incomplete.

---

### T7: Update Solver Hunting Flow

**Files:**

- `src/solver/brain-instructions.ts`
- `src/solver/solver.ts`
- `src/core/toolpack.ts`

**Fix:**

On hunting turns:

1. Observe graph/capture state.
2. Call `diagnoseTarget`.
3. Load relevant skills/tools.
4. Run `runAdvancedPlaybook` if enough context exists.
5. Ask for specific missing context if required.

On talking turns:

- Do not call diagnosis.
- Do not run tools.

If endpoints are missing:

- Discovery comes first.

If second role/session/object IDs are needed:

- Ask specifically for that context.

**Acceptance:**

- Hunting integration test shows diagnosis before advanced skill loading.
- Talking-mode regression test shows no diagnosis/tool calls.

---

### T8: Tests

**Files:**

- `test/orchestration/diagnosis.test.ts`
- `test/orchestration/technique-planner.test.ts`
- `test/orchestration/playbook-runner.test.ts`
- `test/campaign/planner.test.ts` or nearby existing campaign tests
- `test/solver/solver.test.ts` or a new focused regression test

**Required tests:**

- IDOR/BOLA/authz is ranked for authenticated endpoints with object-like params.
- Workflow/business logic is ranked for ordered actions or state-changing endpoints.
- SSRF/cloud is ranked for URL/webhook/callback-like params.
- GraphQL is ranked for GraphQL endpoints.
- Missing context is returned for auth, second user, alternate object ID, OAST host, and workflow steps.
- Campaign planner receives non-empty primitive metadata.
- `runAdvancedPlaybook` loads skill bodies on demand.
- `runAdvancedPlaybook` respects skill composition rules.
- Primitive-confirmed findings still require EvidenceGate-backed evidence.
- Unconfirmed candidates are not stored as findings.
- Talking-mode prompts do not run diagnosis.

---

## Implementation Order

1. Add `src/orchestration/types.ts`.
2. Add primitive metadata helper.
3. Fix `runCampaign` primitive metadata.
4. Add diagnosis subsystem.
5. Add technique planner.
6. Add playbook runner.
7. Add `diagnoseTarget` and `runAdvancedPlaybook` tools.
8. Register tools in `src/tools/registry.ts` and `src/core/toolpack.ts`.
9. Update solver hunting instructions.
10. Add tests.
11. Run focused tests.
12. Run `npm run build:cli`.

---

## Verification Commands

```powershell
npm test -- test/orchestration/diagnosis.test.ts
npm test -- test/orchestration/technique-planner.test.ts
npm test -- test/orchestration/playbook-runner.test.ts
npm test -- test/campaign
npm test -- test/solver
npm run build:cli
```

---

## Done Criteria

- `diagnoseTarget` summarizes current graph/capture state and ranks actionable advanced techniques.
- `runAdvancedPlaybook` executes selected/top candidates using existing primitives/workers.
- Campaign planning uses real primitive metadata.
- Solver hunting flow diagnoses before advanced orchestration.
- Missing context is explicit and actionable.
- Confirmed findings still require EvidenceGate.
- No new mandatory config.
- No duplicate registries, worker systems, or evidence systems.
