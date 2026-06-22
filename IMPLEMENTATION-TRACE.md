# Ultimatrix v6 Implementation Trace

> Started: Implementation of the skill-driven dynamic swarm architecture
> Plan: ULTIMATRIX-IMPLEMENTATION-PLAN.md

## Phase 1: Skill System Foundation
- [ ] Task 1.1: Create `src/skills/loader.ts` - Parse SKILL.md YAML frontmatter + markdown body
- [ ] Task 1.2: Create `src/skills/registry.ts` - Skill index and BM25 search
- [ ] Task 1.3: Update all SKILL.md files with `toolRefs` and `version`
- [ ] Task 1.4: Create `src/mastra/workspace.ts` - Mastra Workspace integration
- [ ] Acceptance: Can load/search skills, 0 type errors

## Phase 2: Model Registry & Configuration
- [ ] Task 2.1: Extend `UltimatrixConfig` with `modelTiers` and `tierCreds`
- [ ] Task 2.2: Create `src/models/registry.ts` - Model tier resolution
- [ ] Task 2.3: Create `buildTierModelConfig()` in `src/config.ts`
- [ ] Acceptance: Can resolve any tier to valid MastraModelConfig

## Phase 3: Dynamic Worker Factory
- [ ] Task 3.1: Create `src/tools/resolver.ts` - Map toolRefs to actual tools
- [ ] Task 3.2: Create `src/workers/factory.ts` - Dynamic worker creation from skills
- [ ] Task 3.3: Create `src/workers/pool.ts` - Worker lifecycle management
- [ ] Task 3.4: Refactor existing workers to use factory internally
- [ ] Acceptance: Can spawn workers from skills, backward compatible

## Phase 4: Supervisor Tools
- [ ] Task 4.1: Create `src/supervisor/tools/skill-search.ts`
- [ ] Task 4.2: Create `src/supervisor/tools/skill-load.ts`
- [ ] Task 4.3: Create `src/supervisor/tools/spawn-worker.ts`
- [ ] Task 4.4: Create `src/supervisor/tools/spawn-swarm.ts`
- [ ] Task 4.5: Create `src/supervisor/tools/execute-direct.ts`
- [ ] Task 4.6: Replace `src/manager/instructions.ts` with skill-driven instructions
- [ ] Task 4.7: Modify `src/manager/agent.ts` with new supervisor
- [ ] Acceptance: Supervisor can search/load/spawn/execute skills

## Phase 5: Swarm Orchestrator
- [ ] Task 5.1: Create `src/swarm/builder.ts` - Swarm workflow builder
- [ ] Task 5.2: Create `src/swarm/chains.ts` - Cross-worker chain detection
- [ ] Task 5.3: Create `src/swarm/formatter.ts` - Result formatting
- [ ] Acceptance: Parallel execution, synthesis, chain detection

## Phase 6: Integration & Refactor
- [ ] Task 6.1: Update `src/lib/agent-manager.ts` with new registries
- [ ] Task 6.2: Update `src/intelligence/hypotheses.ts` with skill search
- [ ] Task 6.3: Create `src/app/api/skills/route.ts` and `src/app/api/workers/route.ts`
- [ ] Task 6.4: Update `src/cli/assess.ts` and `src/cli/scan.ts`
- [ ] Task 6.5: Backward compatibility - all 270 tests pass
- [ ] Acceptance: Full integration, 0 type errors, all tests pass

## Phase 7: New Skills
- [ ] Task 7.1: Create `skills/exploit/graphql/SKILL.md`
- [ ] Task 7.2: Create `skills/exploit/oauth/SKILL.md`
- [ ] Task 7.3: Create `skills/exploit/file-upload/SKILL.md`
- [ ] Task 7.4: Create `skills/exploit/websocket/SKILL.md`
- [ ] Acceptance: 4 new skills with proper frontmatter, discoverable by supervisor

## Phase 8: Testing & Final Verification
- [ ] Task 8.1: Create `tests/e2e/dynamic-skills.test.ts`
- [ ] Task 8.2: Run full test suite (270 tests)
- [ ] Task 8.3: Verify build (`tsup` clean)
- [ ] Task 8.4: Verify type errors (0)
- [ ] Acceptance: All tests pass, 0 type errors, clean build

## Overall Success Criteria
| Criterion | Status |
|---|---|
| Skills loaded dynamically | ⏳ |
| Workers spawned dynamically | ⏳ |
| Multi-model per tier | ⏳ |
| Supervisor skill-driven | ⏳ |
| Swarm execution | ⏳ |
| Cross-worker chains | ⏳ |
| 0 type errors | ⏳ |
| All tests pass | ⏳ |
| Clean build | ⏳ |
