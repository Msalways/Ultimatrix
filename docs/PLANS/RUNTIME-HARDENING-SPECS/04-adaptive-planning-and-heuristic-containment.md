# 04. Adaptive Planning and Heuristic Containment

## Goal

Use heuristics to reduce search cost without allowing fixed vocabulary to define target semantics, execution choice, graph truth, or findings.

## Root Cause

Endpoint names, parameter names, descriptions, tags, and response text are classified in several modules using different substring tables. These classifications feed campaign relevance, workflow/entity graph properties, tool selection, primitive resolution, reflexion, and follow-up selection without preserving their heuristic origin.

## Planning Contract

Separate observed features, heuristic hints, and LLM selections:

```typescript
interface PlanningContext {
  observations: ObservedFeature[]
  hints: KnowledgeRecord<PlanningHint>[]
  graphRefs: string[]
  availableCapabilityIds: string[]
}

interface PlanningDecision {
  hypothesis: string
  selectedSkillIds: string[]
  selectedCapabilityIds: string[]
  targetRefs: string[]
  experimentDraft: SecurityExperiment
  rationale: string
}
```

The LLM returns `PlanningDecision` through structured output. Runtime validates exact IDs, scope, availability, and experiment shape. It does not infer missing selections from prose.

## Allowed Heuristics

Heuristics may:

- Produce low-authority candidate hints.
- Rank search results when the LLM explicitly calls discovery.
- Recognize standards and protocol structures.
- Suggest missing observations to gather.

Heuristics may not:

- Automatically activate skills.
- Widen an agent's tool view.
- Mark access granted or a finding confirmed.
- Persist ownership, role, workflow, sensitivity, or use-case as observed truth.
- Force a failure category when evidence is ambiguous.

## Campaign Planning

- Replace `hasParams => relevant` with capability prerequisites declared by each primitive/capability.
- Endpoint observations expose structural features: methods, value shapes, content types, recorded identities, observed state changes, schemas, and graph relations.
- Fixed name matches are optional hints with provenance and bounded score contribution.
- The LLM may select an unexpected capability if it supplies a valid target reference and experiment.
- Campaign dedupe keys derive from experiment identity and changed variables, not vocabulary.

## Graph Semantics

- Preserve raw observed fields separately from inferred labels.
- Workflow/entity/use-case inference writes `KnowledgeRecord` hints.
- A hint can be promoted to observed only by direct capture or explicit user statement with provenance.
- Existing typed properties that currently hide inference are migrated to authority-bearing fields.

## Failure and Reflexion

Tool adapters return typed failure information where available: transport error, timeout, denied status, schema validation failure, unavailable dependency, or unknown. Free-text classifiers are a legacy fallback and return a hint, never an authoritative category.

`unknown` is a valid reflexion input. The LLM receives raw evidence references and decides the next strategy through structured planning.

## Consolidation

- Skill search belongs to `SkillCatalog`.
- Capability lookup belongs to a typed capability registry.
- Workflow/entity hint derivation belongs to one inference module.
- Delete duplicate technique/tool/free-text resolvers after callers migrate.

## Tests

- Non-English and opaque endpoint names still produce plans from observed structure.
- Misleading names do not activate a skill or confirm behavior.
- Parameter presence alone does not schedule every primitive.
- Unknown failure text remains unknown.
- Hint provenance survives graph persistence and reload.
- Structured LLM selections with valid IDs work even without keyword overlap.
- Invalid IDs and unavailable capabilities are rejected without fallback guessing.

## Acceptance Criteria

- Every heuristic-derived value is identifiable as a hint.
- Execution routing starts from a validated `PlanningDecision`.
- No free-text matcher can directly activate, authorize, execute, or confirm.
