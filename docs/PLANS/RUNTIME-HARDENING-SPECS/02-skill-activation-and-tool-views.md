# 02. Skill Activation and Tool Views

## Goal

Make progressive skill disclosure an explicit lifecycle: catalog discovery, exact activation, body loading, and final tool authorization use one source of truth across every engine.

## Root Cause

Metadata discovery, body loading, prompt injection, and tool filtering are separate pipelines. Some entrypoints preload bodies from free-form goal matching; the solver keeps a static full tool pack; worker IDs are not validated; and tools appended after filtering bypass restrictions.

## Canonical Components

Use the existing loader implementation behind one injected facade; do not create another index:

```typescript
interface SkillCatalog {
  list(filter?: SkillFilter): readonly SkillMeta[]
  search(query: SkillQuery): readonly SkillSearchResult[]
  get(skillId: string): SkillMeta | undefined
  load(skillId: string): Skill | undefined
  reset(): void
}

interface SkillActivationStore {
  activate(request: ActivateSkillRequest): ActiveSkill
  deactivate(skillId: string): void
  listActive(scope: ActivationScope): readonly ActiveSkill[]
  endTurn(turnId: string): void
}
```

`SkillRegistry`, loader search, manager search, and technique-registry search become callers of `SkillCatalog` or are removed. There is one scoring implementation and one cache.

## Discovery and Activation

- Runtime bootstrap parses frontmatter only.
- `listSkills` and `searchSkills` return metadata only.
- Free-form goal text never automatically loads or activates a skill.
- The LLM or user activates by an exact catalog ID through `activateSkill`.
- Activation loads the body once, records origin and lifetime, and returns the activated methodology.
- `loadSkillBody` remains read-only inspection or is replaced by `activateSkill`; it cannot silently modify authorization.

```typescript
interface ActivateSkillRequest {
  skillId: string
  lifetime: 'turn' | 'session' | 'worker'
  turnId?: string
  workerId?: string
  activatedBy: 'llm' | 'user' | 'system'
}
```

Unknown IDs return a typed error before model routing or agent construction.

## Tool View

Assemble candidates first, filter once last:

```text
canonical registry
  + role tools
  + browser tools
  + enabled extension tools
  + explicitly acquired tools
          |
          v
 final intersection:
   invariant core
   + active skill toolRefs
   + role allow-list
   + engagement policy
          |
          v
 exposed agent tools
```

`CORE_TOOLS` is reduced to lifecycle essentials: skill discovery/activation, user interaction, evidence recording, safe graph reads, and delegation control needed by the role. Execution primitives, campaign, recon, findings, graph mutation, browser actions, and extensions require an explicit active-skill or role capability.

Unknown `toolRefs` fail agent creation. Extra/browser tools cannot be appended after filtering.

## Agent Lifecycle

- Brain tool views are calculated per turn from active state. If Mastra cannot mutate an existing agent tool set safely, create a turn-scoped agent from stable memory and model configuration.
- Workers require one valid `worker` activation and receive that skill body plus its tool view.
- Council persona tools and activated skill tools are intersected; neither can widen the other.
- Session activation survives turns only when explicitly requested.

## Entry Point Parity

- CLI solve, interactive session, WebEngine, SDK, council, legacy adapters, and API skill routes obtain the same catalog from `EngagementRuntime`.
- Delete goal-based preload code from session and WebEngine.
- Direct CLI solve must not construct an empty registry.
- Spawn-worker and spawn-swarm validate through the injected catalog.

## Events

Emit typed events: `skill.discovered`, `skill.activated`, `skill.deactivated`, and `skill.rejected`. Never log the full skill body.

## Tests

- Bootstrap loads metadata but no body.
- Search never changes activation or tool state.
- Exact activation loads once and applies the declared tool view.
- Unknown skill and tool IDs fail closed.
- Turn/session/worker lifetimes expire correctly.
- Browser, extension, extra, and role tools cannot bypass filtering.
- CLI, Web, SDK, council, and worker expose identical catalog results.
- A real spawn test proves the worker receives exactly the calculated final view.

## Acceptance Criteria

- One catalog, one search behavior, one activation store, and one final tool-view builder exist.
- No automatic goal-to-skill preload remains.
- No worker can be created for an unknown skill.
- `toolRefs` have observable effect on the final exposed tools.
