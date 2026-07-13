---
title: "Council Engine Wiring — Root-Cause Fix Plan"
version: "1.0.0"
project: "Ultimatrix v8"
date: "2026-07-12"
status: "planned"
---

# Council Engine Wiring — Root-Cause Fix Plan

> **Problem Statement**: The Council engine (4 LLM members + HITL) exists in code but the wiring between components is broken at 8 architectural seams. The `interact` command with `engine: council` appears to work but silently loses: complexity→tier mapping, skill-filtered tools, multi-model routing, cross-engagement priors, HITL approval, and skill registry consistency.

> **Principle**: Fix the *type contracts* and *data flow* at each seam. No `as any` casts. No hardcoded mappings. No duplicate loaders. Each component declares its interface; the wiring layer translates faithfully.

---

## Broken Seams Inventory

| # | Seam | Root Cause | Impact |
|---|------|------------|--------|
| 1 | Council Proposal → WorkerConfig | Type mismatch: `TaskComplexity` ≠ `WorkerTier`; `impact/reasoning/evidenceRequired` dropped | Workers spawn with defaults, ignoring council's strategic assessment |
| 2 | Council Members → Tool Set | `toolRestrictions` undefined in persona metadata → all 68+ tools loaded | Context bloat, hallucination, skill-driven filtering architecture defeated |
| 3 | REPL Skill Match → Worker Spawn | `matchedSkills` (with full instructions) never passed to worker `context` field | Dynamic skill loading loses progressive disclosure benefit |
| 4 | Council Execution → Multi-Model Routing | `execute` callback calls `spawn()` directly, bypassing `dispatchSlices()` | Model selector, tier routing, per-slice budget completely unused |
| 5 | Council Members → Model Selection Tool | Solver brain gets `selectModel` tool; council members get nothing | No dynamic model reasoning in council despite "multi-model" claim |
| 6 | HITL Approval → Council Orchestrator | `humanApprove` callback defined in lifecycle but never passed to `debateOnce()` | High-impact proposals auto-rejected or auto-approved (config-dependent) |
| 7 | Skill Registry Instance | Two independent loaders: `SkillRegistry` (pool) vs `initSkillIndex()` (REPL) | Skills matched in REPL ≠ skills available to workers |
| 8 | Worker Creation Paths | Legacy `spawnWorker` tool vs Council `execute` callback = two code paths | Inconsistent worker config (tier, modelId, context, tenant, sandboxId) |

---

## Task Breakdown (Root-Cause Level)

### Task 1: Council Proposal → WorkerConfig Type-Safe Mapping

**Root Cause**: `CouncilProposal` (council/types.ts) and `WorkerConfig` (workers/factory.ts) have incompatible field names and types. The wiring code uses `as any` to paper over it.

**Files to Change**:
- `src/council/types.ts` — Add `toWorkerConfig()` method on `CouncilProposal`
- `src/session.ts` — Use the method instead of `as any` cast
- `src/workers/factory.ts` — Ensure `WorkerConfig` accepts all translated fields

**Fix Design**:
```typescript
// In CouncilProposal interface (council/types.ts)
export interface CouncilProposal {
  action: string
  skillId: string
  endpointId?: string
  complexity: TaskComplexity        // 'low' | 'medium' | 'high' | 'critical'
  impact: ImpactLevel               // 'low' | 'medium' | 'high' | 'critical'
  reasoning: string
  evidenceRequired: string[]

  // NEW: Faithful translation to WorkerConfig
  toWorkerConfig(overrides?: Partial<WorkerConfig>): WorkerConfig {
    return {
      skillId: this.skillId,
      task: this.action,
      tier: complexityToTier(this.complexity),
      context: {
        endpointId: this.endpointId,
        reasoning: this.reasoning,
        evidenceRequired: this.evidenceRequired,
        impact: this.impact,
        ...overrides?.context,
      },
      ...overrides,
    }
  }
}

// Pure function — no hardcoding, testable in isolation
function complexityToTier(c: TaskComplexity): WorkerTier {
  const map: Record<TaskComplexity, WorkerTier> = {
    low: 'fast',
    medium: 'balanced',
    high: 'powerful',
    critical: 'powerful',
  }
  return map[c]
}
```

**Verification**:
- Unit test: `proposal.toWorkerConfig()` produces valid `WorkerConfig` with correct tier mapping
- Integration: Council proposal for "critical" complexity → worker gets `tier: 'powerful'`
- No `as any` casts in session.ts execute callback

---

### Task 2: Council Members Get Skill-Filtered Tool Sets

**Root Cause**: `personaMetadataFor(role).toolRestrictions` returns `undefined` for all roles. `createAgent` receives no `toolIds` filter → loads all tools.

**Files to Change**:
- `src/council/personas.ts` — Add `toolRestrictions` to each role's metadata
- `src/council/factory.ts` — Derive restrictions from skill registry + goal context (not hardcoded)
- `src/solver/skills/tool-filter.ts` — Export `resolveToolsForSkills()` for reuse

**Fix Design**:
```typescript
// In personas.ts — each role declares its tool authority via skill domains
export const personaMetadata: Record<CouncilMemberRole, PersonaMetadata> = {
  strategist: {
    tier: 'balanced',
    toolRestrictions: [
      'queryGraph', 'getTargetSummary', 'getEndpointsWithParams',
      'listSkills', 'searchSkills', 'loadSkillReference',
      'buildResearchMap', 'planResearchExperiments', 'getPriorPatterns'
    ],
    description: 'Plans attack surface coverage, selects skills, proposes hypotheses',
  },
  operator: {
    tier: 'balanced',
    toolRestrictions: [
      'spawnWorker', 'spawnSwarm', 'executeDirect', 'httpRequest',
      'runPrimitive', 'getOastUrl', 'checkOastCallbacks',
      'detectReactions', 'getDialogEvidence', 'getRecentChanges',
      'verifyChains', 'recordEvidence', 'writeFinding', 'askUser'
    ],
    description: 'Executes approved experiments via workers, records evidence',
  },
  skeptic: {
    tier: 'balanced',
    toolRestrictions: [
      'queryGraph', 'getEndpointsWithParams', 'verifyChains',
      'recordEvidence', 'getCapturedHeaders', 'storeSession'
    ],
    description: 'Verifies claims against evidence ledger, rejects unsupported proposals',
  },
  analyst: {
    tier: 'balanced',
    toolRestrictions: [
      'queryGraph', 'getTargetSummary', 'getEndpointsWithParams',
      'buildResearchMap', 'compareResearchResponses',
      'recordFindingCandidate', 'assessCandidateReportability',
      'getResearchStatus', 'detectChains', 'verifyChains'
    ],
    description: 'Synthesizes results, detects chains, updates cross-engagement memory',
  },
}

// In factory.ts — derive allowed tools from matched skills + role restrictions
function getAllowedToolsForRole(
  role: CouncilMemberRole,
  goal: string,
  skillRegistry: SkillRegistry
): string[] {
  // 1. Get role's declared restrictions (from persona metadata)
  const roleTools = personaMetadata[role].toolRestrictions ?? []

  // 2. Get skills relevant to current goal
  const matched = skillRegistry.matchSkills(goal, { /* context */ })
  const skillTools = resolveToolsForSkills(matched.map(s => s.skill.id))

  // 3. Union: role authority ∩ skill relevance (skill-driven filtering)
  return [...new Set([...roleTools, ...skillTools])]
}
```

**Verification**:
- Strategist cannot call `spawnWorker` (not in restrictions)
- Operator cannot call `buildResearchMap` (not in restrictions)
- All members get tools relevant to matched skills for current goal
- Tool count per member ~15-25 (not 68+)

---

### Task 3: Progressive Skill Loading → Worker Context

**Root Cause**: `session.ts` loads full skill bodies for matched skills (`matchedWithInstructions`) but the council `execute` callback discards them when spawning workers.

**Files to Change**:
- `src/session.ts` — Pass matched skills to `debateOnce` via `execute` callback closure
- `src/council/orchestrator.ts` — Accept `matchedSkills` in `DebateOnceParams`, pass to `execute` context
- `src/workers/factory.ts` — Worker agent receives skill instructions via `createAgent` `skills` parameter

**Fix Design**:
```typescript
// In session.ts — capture matched skills in execute callback
const matchedSkillsForTurn = matchedWithInstructions // from resolveSkillsForInput + loadSkill

const execute = async (proposal: MemberOutput, ctx: CouncilExecuteContext) => {
  if (!proposal.proposal) return 'no proposal'

  // Find the skill that matches the proposal's skillId
  const skill = matchedSkillsForTurn.find(s => s.id === proposal.proposal!.skillId)

  const worker = await resources.workerPool!.spawn({
    ...proposal.proposal.toWorkerConfig(),  // Task 1 fix
    context: {
      ...proposal.proposal.toWorkerConfig().context,
      skillInstructions: skill?.instructions,  // Progressive disclosure: only this skill's body
      skillReferences: skill?.references,
    },
  })
  // ...
}

// In workers/factory.ts — createAgent already accepts `skills: Skill[]`
// Just ensure the skill object passed has `instructions` and `references`
```

**Verification**:
- Worker spawned for `web-pentest` skill receives only `web-pentest.md` instructions (not all 56 skills)
- Skill references (refs/*.md) available to worker via `loadSkillReference` tool
- No skill body loaded unless council proposes that skill

---

### Task 4: Council Execution Uses `dispatchSlices` for Multi-Model Routing

**Root Cause**: `execute` callback calls `workerPool.spawn()` + `execute()` directly, bypassing `dispatchSlices()` which handles model selection, tier routing, concurrency, and tenant isolation.

**Files to Change**:
- `src/session.ts` — Replace `execute` callback with slice dispatcher
- `src/workers/pool.ts` — Ensure `dispatchSlices` accepts single-slice arrays (already does)
- `src/council/orchestrator.ts` — `CouncilExecuteContext` exposes `modelSelector` and `workerPool`

**Fix Design**:
```typescript
// In session.ts — build execute callback that uses dispatchSlices
const execute = async (proposal: MemberOutput, ctx: CouncilExecuteContext) => {
  if (!proposal.proposal) return 'no proposal'

  const slice: DispatchSlice = {
    id: `council-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    skillId: proposal.proposal.skillId,
    task: proposal.proposal.action,
    complexity: proposal.proposal.complexity,
    requiredCapabilities: [], // Could be derived from skill's mitreAttack/owaspRefs
    context: proposal.proposal.toWorkerConfig().context,
    tenant: resources.tenant, // If multi-tenant
    sandboxId: resources.sandboxId,
  }

  const results = await resources.workerPool!.dispatchSlices([slice], {
    modelSelector: resources.modelSelector, // Must be exposed on resources
    perSliceRole: 'worker',
  })

  const result = results[0]
  if (result.error) throw new Error(result.error)
  return typeof result.result?.text === 'string'
    ? result.result.text
    : String(result.result ?? '')
}

// In lifecycle.ts setupEngine() — expose modelSelector on resources
this._resources.modelSelector = new ModelSelector(
  config.modelCapabilities ?? {},
  config.budgetPolicy ?? { ... },
  config,
)
```

**Verification**:
- Council proposal for "critical" complexity → slice routed to `powerful` tier model
- Model selector logs: `[pool] slice council-xxx → nvidia/nemotron-3-ultra-550b-a55b (powerful) [worker]`
- Concurrency respected: `maxConcurrency` gates simultaneous council executions
- Tenant/sandbox isolation works if configured

---

### Task 5: Council Members Get `selectModel` Tool for Dynamic Reasoning

**Root Cause**: Solver brain has `selectModel` tool (brain-tools.ts:266-292). Council members have no equivalent — they cannot reason about model selection despite architecture claiming "dynamic model routing per role."

**Files to Change**:
- `src/council/factory.ts` — Add `selectModel` tool to council members (at least strategist + operator)
- `src/models/selector.ts` — Ensure `ModelSelector.explainSelection()` works for council context

**Fix Design**:
```typescript
// In factory.ts makeMember() — add selectModel tool for strategist and operator
const modelSelectionTools: Record<string, any> = {}
if (role === 'strategist' || role === 'operator') {
  const selector = new ModelSelector(
    config.modelCapabilities ?? {},
    config.budgetPolicy ?? { enforcement: 'soft', scope: 'session', resetOn: 'never', allocation: { brain: 0.3, workers: 0.6, spider: 0.1 }, maxModelCallsPerTask: 15, trackTokens: false },
    config,
  )
  modelSelectionTools.selectModel = sanitizeTool(createTool({
    id: 'selectModel',
    description: 'Select optimal model for a proposed task. Use when planning (strategist) or executing (operator) to justify model choice.',
    inputSchema: z.object({
      skillId: z.string(),
      taskDescription: z.string(),
      complexity: z.enum(['low', 'medium', 'high', 'critical']),
      requiredCapabilities: z.array(z.string()).optional(),
    }),
    execute: async ({ skillId, taskDescription, complexity, requiredCapabilities }) => {
      const selection = selector.selectForTask({ skillId, taskDescription, complexity, requiredCapabilities }, 'worker')
      return { ok: true, selection, explanation: selector.explainSelection(selection, { skillId, taskDescription, complexity }) }
    },
  }), config.provider)
}

// Merge into extraTools
const extraTools = { ...roleSpecificTools, ...modelSelectionTools }
```

**Verification**:
- Strategist calls `selectModel` before proposing high-complexity task
- Operator calls `selectModel` when executing approved proposal
- Model selection reasoning appears in council transcript (structured output)

---

### Task 6: Wire HITL Approval Through to Council Orchestrator

**Root Cause**: `humanApprove` callback exists in `lifecycle.ts` (for legacy engine) but `session.ts` never passes it to `debateOnce()`. Council orchestrator's `decideApproval()` receives `undefined` → falls back to config default.

**Files to Change**:
- `src/session.ts` — Create `humanApprove` callback using existing `askUser` tool pattern
- `src/council/orchestrator.ts` — Ensure `decideApproval` handles async human callback correctly
- `src/council/approval.ts` — Verify `ApprovalMode` enum includes 'hitl' path

**Fix Design**:
```typescript
// In session.ts — inside REPL loop, before debateOnce call
const humanApprove = async (proposal: MemberOutput): Promise<boolean> => {
  if (!proposal.proposal) return false

  const impact = proposal.proposal.impact
  const action = proposal.proposal.action
  const skillId = proposal.proposal.skillId

  // Only prompt for high/critical impact (per approval mode)
  if (impact === 'low' || impact === 'medium') return true

  const question = `\n[HITL] Council proposes: ${action}\nSkill: ${skillId} | Impact: ${impact}\nReasoning: ${proposal.proposal.reasoning}\nApprove? (y/n): `
  const answer = await askUserTool(question) // Use existing askUser tool
  return answer.toLowerCase().startsWith('y')
}

// Pass to debateOnce
const result = await debateOnce({
  // ...
  humanApprove,
})
```

**Verification**:
- High-impact proposal → CLI prompts "Approve? (y/n)"
- User types "y" → proposal executes
- User types "n" → proposal rejected, skeptic logs rejection
- Low/medium impact → auto-approved (configurable via `approvalMode`)

---

### Task 7: Single Skill Registry Instance (Shared Across REPL + Workers)

**Root Cause**: Two independent skill loaders — `SkillRegistry` (pool) and `initSkillIndex()` (tool-filter.ts) — with separate caches. Skills added at runtime visible to one but not the other.

**Files to Change**:
- `src/solver/skills/loader.ts` — Export singleton `SkillRegistry` instance
- `src/solver/skills/tool-filter.ts` — Use `SkillRegistry` instead of `initSkillIndex()`
- `src/session/lifecycle.ts` — Reuse same registry instance
- `src/session.ts` — Use `resources.skillRegistry` for matching

**Fix Design**:
```typescript
// In loader.ts — singleton registry
let sharedRegistry: SkillRegistry | null = null

export function getSharedSkillRegistry(): SkillRegistry {
  if (!sharedRegistry) {
    sharedRegistry = new SkillRegistry()
    sharedRegistry.loadFromDirectory(SKILLS_DIR)
  }
  return sharedRegistry
}

// In tool-filter.ts — use shared registry
import { getSharedSkillRegistry } from './loader'

export function resolveSkillsForInput(userInput: string): SkillMeta[] {
  const registry = getSharedSkillRegistry()
  // ... use registry.matchSkills() or registry.search()
}

// In lifecycle.ts — reuse shared registry
const skillRegistry = getSharedSkillRegistry()
const workerPool = new WorkerPool(config, skillRegistry, browser)
this._resources.skillRegistry = skillRegistry

// In session.ts — use resources.skillRegistry
const matchedSkills = resources.skillRegistry.matchSkills(line, context)
```

**Verification**:
- Add skill file at runtime → visible to both REPL matching and worker pool
- `listSkills` command in REPL shows same count as `workerPool.list().length` skill references
- No duplicate cache invalidation bugs

---

### Task 8: Unify Worker Creation Paths (Legacy Tool + Council Callback)

**Root Cause**: Two code paths create workers with different config completeness:
- `src/manager/tools/spawn-worker.ts` → passes full `WorkerConfig`
- `src/session.ts` council `execute` → passes partial config via `as any`

**Files to Change**:
- `src/manager/tools/spawn-worker.ts` — Refactor to use `proposal.toWorkerConfig()` (Task 1)
- `src/session.ts` — Council `execute` uses same translation
- `src/workers/factory.ts` — Single `create()` method handles all fields

**Fix Design**:
```typescript
// In spawn-worker.ts — accept CouncilProposal or WorkerConfig
export function createSpawnWorkerTool(config: UltimatrixConfig, skillRegistry: SkillRegistry, workerPool: WorkerPool) {
  return createTool({
    id: 'spawnWorker',
    description: 'Spawn a specialist worker for a skill-defined task',
    inputSchema: z.object({
      // Accept either full WorkerConfig or CouncilProposal fields
      skillId: z.string(),
      task: z.string(),
      tier: z.enum(['fast', 'balanced', 'powerful']).optional(),
      modelId: z.string().optional(),
      context: z.any().optional(),
      // CouncilProposal fields (auto-translated)
      complexity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      impact: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      reasoning: z.string().optional(),
      evidenceRequired: z.array(z.string()).optional(),
      endpointId: z.string().optional(),
    }),
    execute: async (input) => {
      // Unified translation
      const workerConfig: WorkerConfig = {
        skillId: input.skillId,
        task: input.task,
        tier: input.tier ?? (input.complexity ? complexityToTier(input.complexity) : 'balanced'),
        modelId: input.modelId,
        context: {
          ...input.context,
          reasoning: input.reasoning,
          evidenceRequired: input.evidenceRequired,
          impact: input.impact,
          endpointId: input.endpointId,
        },
      }
      const worker = workerPool.spawn(workerConfig)
      return await workerPool.execute(workerConfig)
    },
  })
}
```

**Verification**:
- `spawnWorker` tool and council `execute` produce identical `WorkerConfig` for same input
- All fields (tier, modelId, context, tenant, sandboxId) respected in both paths
- No `as any` casts in either path

---

## Cross-Cutting Concerns

### Type Safety Enforcement
- All `as any` casts at seams removed
- Zod schemas validate at boundaries (proposal → worker config)
- TypeScript strict mode passes without errors

### Observability
- Forensic log events for: council proposal → worker spawn → model selection → execution → evidence recording
- Token usage tracked per council round + worker slice
- Model selection reasoning logged for audit

### Backward Compatibility
- Legacy `spawnWorker` tool signature unchanged (optional fields added)
- Existing REPL sessions continue working
- Council engine opt-in via config (not forced)

---

## Implementation Order (Dependency Graph)

```
Task 1 (Proposal→WorkerConfig) ──┐
                                 ├── Task 3 (Skill Context) ──┐
Task 7 (Shared Registry) ────────┤                              ├── Task 4 (dispatchSlices)
Task 2 (Skill-Filtered Tools) ───┘                              │
                                                                │
Task 6 (HITL) ──────────────────────────────────────────────────┘
                                                                │
Task 5 (selectModel Tool) ──────────────────────────────────────┘
                                                                │
Task 8 (Unify Paths) ───────────────────────────────────────────┘
```

**Recommended Sequence**: 1 → 7 → 2 → 3 → 4 → 6 → 5 → 8

---

## Verification Checklist (All Must Pass)

| Check | Command / Test |
|-------|----------------|
| TypeScript strict build | `npm run typecheck` |
| All 1299 tests pass | `npm run test` |
| CLI build clean | `npm run build:cli` |
| Council REPL starts | `npx ultimatrix interact -t http://localhost:3000` (with `engine: council`) |
| High-impact proposal prompts HITL | Manual: propose critical action → see "Approve? (y/n)" |
| Model selector logs appear | Check `[pool] slice ... → model (tier) [worker]` in output |
| Skill count consistent | `listSkills` in REPL === skills in worker pool |
| Worker gets skill instructions | Worker output references skill-specific methodology |
| No `as any` casts in session.ts | `grep -n "as any" src/session.ts` returns 0 |
| Forensic log has council events | Check `forensic.ndjson` for `council-proposal`, `council-execution`, `model-selection` |

---

## Acceptance Criteria

The Council engine is **fixed** when:

1. **`interact` with `engine: council`** runs a full REPL session where:
   - User goal → council debates → proposes task → HITL prompt (for high impact) → worker spawns with correct tier → model selector routes → evidence recorded → chain detected → next round

2. **No silent data loss** at any seam:
   - Proposal complexity → worker tier (verified)
   - Proposal reasoning/evidenceRequired → worker context (verified)
   - Matched skill body → worker instructions (verified)
   - Model selection → actual model used (verified)

3. **Architecture matches documentation**:
   - Skill-driven tool filtering active on council members
   - Multi-model routing active on council executions
   - Cross-engagement memory consulted by analyst
   - HITL gate functional for critical proposals

---

## Out of Scope (Separate Work)

- Cloudflare challenge handling in Stagehand
- ESLint rule tuning for large codebase
- Legacy v6 module type errors (`src/context/`, `src/lib/agent-manager.ts`, `src/swarm/`)
- Web UI (Next.js) integration with council engine
- Distributed worker execution (horizontal scaling)

---

## Reference Files

| File | Purpose |
|------|---------|
| `src/council/types.ts` | `CouncilProposal`, `TaskComplexity`, `ImpactLevel`, `MemberOutput` |
| `src/workers/factory.ts` | `WorkerConfig`, `WorkerTier` |
| `src/solver/skills/tool-filter.ts` | `resolveToolsForSkills()`, `CORE_TOOLS` |
| `src/workers/pool.ts` | `WorkerPool.dispatchSlices()`, `DispatchSlice` |
| `src/models/selector.ts` | `ModelSelector.selectForTask()`, `explainSelection()` |
| `src/council/approval.ts` | `decideApproval()`, `ApprovalMode` |
| `src/session.ts` | REPL loop, `execute` callback, `debateOnce` call |
| `src/session/lifecycle.ts` | `setupEngine()`, resource initialization |