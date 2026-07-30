# Brain + Skill Wiring Fix — Multi-Model Engine Audit Remediation

**Date:** 2026-07-30
**Author:** opencode
**Status:** IN PROGRESS — Phases 1-5 COMPLETE
**Depends on:** none (standalone)

---

## Problem Statement

The multi-model brain (`createSolverBrain()` in `src/solver/brain-tools.ts`) operates structurally blind in three critical dimensions:

1. **Cannot read skill methodology** — 56 skills (10 domains, ~5000+ lines) are invisible at runtime. The brain has `listSkills`/`searchSkills` (metadata only) and `loadSkillReference` (reference sub-docs only). There is no tool to load a skill's main `instructions` body. The brain's own instructions say "Step 2: Load relevant skill" but physically cannot do it.

2. **Cannot query the relational graph** — `getGraphSchema`, `getCaptureOverview`, `queryRelations` exist in `buildToolPack()` but are not wired into the brain. The brain is the orchestrator but cannot use the relational query infrastructure built for it.

3. **Cannot encode payloads or run scanners** — `encodeDecode`, `nuclei`, `sqlmap`, etc. are in `buildToolPack()` / `createToolRegistry()` but missing from the brain.

Additionally, the `matchedSkills` pipeline in `session.ts` is 100% dead (hardcoded `[]`), the `web/engine.ts` never forwards `matchedSkills`, the `modelSelector` is not shared with the brain, and the SSE streaming on the web UI is buffered.

### The Structural Root Cause

`createSolverBrain()` hand-assembles ~50 tools via direct imports and creates `new Agent()` directly. It **never calls** `buildToolPack()` (core/toolpack.ts) or `createAgent()` (mastra/index.ts). The toolpack was designed as the shared builder for both brain and council, but the brain was never migrated to use it.

```
brain-tools.ts: 50 hand-picked tools → new Agent()     ← CURRENT (broken)
toolpack.ts:    52+ shared tools → buildToolPack()       ← DESIGNED but unused by brain
mastra/index.ts: 65+ tools → createAgent()              ← council uses this
```

---

## Audit Findings Summary

| Category | Count | Severity |
|----------|-------|----------|
| Skill methodology invisible to brain | 56 skills, ~5000+ lines | CRITICAL |
| Missing brain tools (from toolpack) | 12 tools (3 critical, 9 high-medium) | CRITICAL |
| Missing brain tools (from registry) | 16+ tools (1 high, 15 medium-low) | HIGH |
| Dead code / broken wiring | 4 issues | HIGH |
| Structural inefficiencies | 3 issues | MEDIUM |
| SSE streaming | 3 issues | MEDIUM |
| Test coverage gaps | 4 issues | LOW |

---

## Hard Rules

1. **No hardcoded substring detection** — structured typed fields only
2. **No hardcoded enumerations in tool descriptions** — live schema discovery
3. **No bandaids** — fix design, not symptom
4. **`ultimatrix.yaml` excluded from commits** (`git add -- ':!ultimatrix.yaml'`)
5. **All imports verified** — every function exists at stated path
6. **Brain remains lean** — it's the orchestrator; don't bloat it to 70+ tools. Use `buildToolPack()` as the base, then add brain-specific extras only.

---

## Architecture Decision

**Migrate brain to use `buildToolPack()` as the base tool set.** This is the designed shared builder (`core/toolpack.ts` header says "Both the multi-model brain and the council factory compose the same tool groups"). The brain adds brain-specific extras (auth detection, council, reports, extensions, ref-store) on top.

```
BEFORE (brain-tools.ts):
  13 hand-assembled groups → Object.assign → new Agent()

AFTER:
  buildToolPack(deps, opts) → base 52 tools
  + brainExtras (auth, council, report, extensions, ref-store) → ~60 tools total
  → new Agent()
```

Net: ~300 lines removed from brain-tools.ts, ~25 lines added. Tool count goes from 50 to ~60 (gains 12 critical tools, loses nothing).

---

## Task Breakdown

### Phase 1: Skill Body Access (CRITICAL — unblocks everything else)

#### T1.1: Add `loadSkillBody` brain tool

**File:** `src/tools/skill-tools.ts`
**Change:** Add 4th exported tool `loadSkillBodyTool`.

```typescript
export const loadSkillBodyTool = createTool({
  id: 'loadSkillBody',
  description: 'Load a skill\'s full methodology instructions, tool chains, composition rules, and references. Returns the complete attack guidance for a specific skill.',
  inputSchema: z.object({
    skillId: z.string().describe('Skill ID (e.g. "injection/exploitation", "web-attacks/web-pentest")'),
  }),
  execute: async ({ skillId }) => {
    const skill = loadSkill(skillId)  // already imported at line 3
    if (!skill) return { ok: false, error: `Skill "${skillId}" not found` }
    return {
      ok: true,
      value: {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        tier: skill.tier,
        instructions: skill.instructions,
        toolRefs: skill.toolRefs,
        toolChains: skill.toolChains,
        compositionRules: skill.compositionRules,
        references: skill.references.map(r => ({ id: r.id, title: r.title })),
      },
    }
  },
})
```

**Lines changed:** +22
**Acceptance:** Tool is exported, `loadSkill` import already exists at line 3.

---

#### T1.2: Add `loadSkillBody` to `buildToolPack()` skill tools

**File:** `src/core/toolpack.ts`
**Change:** Import `loadSkillBodyTool` and add to `skillTools()` group.

```typescript
import { loadSkillReference, searchSkillTool, listSkills, loadSkillBodyTool } from '../tools/skill-tools'

function skillTools(p: string): Record<string, any> {
  return {
    listSkills: s(listSkills, p),
    searchSkills: s(searchSkillTool, p),
    loadSkillReference: s(loadSkillReference, p),
    loadSkillBody: s(loadSkillBodyTool, p),  // NEW
  }
}
```

**Lines changed:** +3 (1 import, 1 line in function)
**Acceptance:** `loadSkillBody` appears in all toolpack-built agent tool sets.

---

#### T1.3: Add `loadSkillBody` to brain-tools.ts skill tools

**File:** `src/solver/brain-tools.ts`
**Change:** Import and add to `skillTools` group.

```typescript
import { loadSkillReference, searchSkillTool, listSkills, loadSkillBodyTool } from '../tools/skill-tools'

const skillTools: Record<string, any> = {
  listSkills: sanitizeTool(listSkills, p),
  searchSkills: sanitizeTool(searchSkillTool, p),
  loadSkillReference: sanitizeTool(loadSkillReference, p),
  loadSkillBody: sanitizeTool(loadSkillBodyTool, p),  // NEW
}
```

**Lines changed:** +2
**Acceptance:** Brain can call `loadSkillBody({ skillId: "injection/exploitation" })` and receive full instructions.

---

#### T1.4: Add `loadSkillBody` to TOOL_IDS and registry

**File:** `src/mastra/tools.ts`
**Change:** Add `loadSkillBodyTool` import and add to `TOOL_IDS` and `createToolRegistry()`.

```typescript
import { loadSkillReference, searchSkillTool, loadSkillBodyTool } from '../tools/skill-tools'

// In TOOL_IDS array:
'loadSkillBody',

// In createToolRegistry():
loadSkillBody: loadSkillBodyTool,
```

**File:** `src/tools/registry.ts`
**Change:** Add `loadSkillBodyTool` to imports and `registerAllTools()`.

**Lines changed:** ~5 across both files
**Acceptance:** `loadSkillBody` appears in `TOOL_IDS` and is registered in the global tool registry.

---

### Phase 2: Migrate Brain to `buildToolPack()` (CRITICAL — closes 12+ tool gaps)

#### T2.1: Refactor `createSolverBrain()` to use `buildToolPack()`

**File:** `src/solver/brain-tools.ts`
**Change:** Replace 13 hand-assembled tool groups with `buildToolPack()` call + brain-specific extras.

**Before (lines 103-414):** 13 separate objects + manual Object.assign merge.

**After:**
```typescript
import { buildToolPack } from '../core/toolpack'

export function createSolverBrain(config: UltimatrixConfig, options: SolverBrainOptions) {
  const p = config.provider

  // ─── Base tools via shared toolpack ─────────────────────────
  // Same set as council: core, http, skill, session, misc, external,
  // research, orchestration, primitives, campaign, model-selection, browser
  const baseTools = buildToolPack(
    {
      config,
      skillRegistry: options.skillRegistry,
      workerPool: options.workerPool,
      browser: options.browser,
      modelSelector: options.modelSelector,
    },
    {
      includeOrchestration: true,
      includeResearch: true,
      includePrimitives: true,
    },
  )

  // ─── Brain-specific extras (not in toolpack) ────────────────
  const discoveryTools: Record<string, any> = {
    listTools: sanitizeTool(listToolsTool, p),
    loadTool: sanitizeTool(loadToolTool, p),
  }

  const refStoreTools: Record<string, any> = {
    getToolResult: sanitizeTool(/* same inline tool */, p),
  }

  const authTools: Record<string, any> = {
    detectAuthFlows: sanitizeTool(/* same inline tool */, p),
    testSessionValid: sanitizeTool(/* same inline tool */, p),
  }

  const councilTools: Record<string, any> = {
    requestCouncil: sanitizeTool(/* same inline tool */, p),
  }

  const miscExtras: Record<string, any> = {
    generateReport: sanitizeTool(/* same inline tool */, p),
  }

  // ─── Merge ──────────────────────────────────────────────────
  const allTools: Record<string, any> = {
    ...baseTools,
    ...discoveryTools,
    ...refStoreTools,
    ...authTools,
    ...councilTools,
    ...miscExtras,
  }

  // Acquired extension tools (MCP/plugin)
  try { Object.assign(allTools, getAcquiredToolMap()) } catch {}

  // TokenLimiter
  const registry = new ContextWindowRegistry(config)
  const contextWindow = registry.getContextWindow(config.model ?? '') || 128_000
  const tokenLimit = Math.floor(contextWindow * 0.7)
  const tokenLimiter = new TokenLimiterProcessor({ limit: tokenLimit, trimMode: 'best-fit' })

  const agentConfig: any = {
    name: 'ultimatrix-solver-brain',
    model: resolveModel(config),
    target: config.target,
    tools: allTools,
    instructions: getBrainInstructions(config, options.extraContext),
    inputProcessors: [tokenLimiter],
  }
  if (options.memory) agentConfig.memory = options.memory
  if (options.browser) agentConfig.context = { browser: options.browser }

  const agent = new Agent(agentConfig)
  agent.id = 'ultimatrix-solver-brain'
  agent.name = `Ultimatrix Solver Brain (${Object.keys(allTools).length} tools)`
  return agent
}
```

**Tools gained by brain:**

| Tool | Source | Impact |
|------|--------|--------|
| `getGraphSchema` | toolpack coreTools | CRITICAL — live schema discovery |
| `getCaptureOverview` | toolpack coreTools | CRITICAL — structural capture overview |
| `queryRelations` | toolpack coreTools | CRITICAL — relational business-logic hunting |
| `nuclei` | toolpack externalTools | HIGH — primary vulnerability scanner |
| `sqlmap` | toolpack externalTools | HIGH — SQL injection testing |
| `ffuf` | toolpack externalTools | HIGH — directory/param fuzzing |
| `nmap` | toolpack externalTools | MEDIUM — port scanning |
| `jwttool` | toolpack externalTools | MEDIUM — JWT testing |
| `arjun` | toolpack externalTools | MEDIUM — hidden param discovery |
| `corsy` | toolpack.externalTools | LOW-MEDIUM — CORS testing |
| `subfinder` | toolpack.externalTools | LOW — subdomain discovery |
| `gitleaks` | toolpack.externalTools | LOW — secret scanning |

**Lines removed:** ~300 (13 hand-assembled groups + merge logic)
**Lines added:** ~80 (buildToolPack call + brain extras)
**Net:** ~-220 lines

**Acceptance:**
- All 50+ existing brain tools still present
- 12 new tools gained from toolpack
- `npm run build:cli` clean
- No test regressions

---

#### T2.2: Pass `modelSelector` to brain

**File:** `src/session/engine-setup.ts`
**Change:** Reorder so `ModelSelector` is created BEFORE `createSolverBrain()`, and pass it.

**Before (lines 117-147):**
```typescript
// Brain created first (no modelSelector)
const solverBrain = createSolverBrain(config, { skillRegistry, workerPool, browser, memory, extraContext: harContextForLLM })
// ...
// ModelSelector created AFTER brain
result.modelSelector = new ModelSelector(...)
```

**After:**
```typescript
// ModelSelector created FIRST — shared by brain + council
const modelSelector = new ModelSelector(
  config.modelCapabilities ?? {},
  config.budgetPolicy ?? { ... },
  config,
)

// Brain gets the shared ModelSelector
const solverBrain = createSolverBrain(config, {
  skillRegistry,
  workerPool,
  browser,
  memory,
  extraContext: harContextForLLM,
  modelSelector,  // NEW — shared instance
})
result.modelSelector = modelSelector
```

**Lines changed:** ~8 (reorder + add param)
**Acceptance:** Brain's `selectModel` tool uses the same `ModelSelector` instance as worker dispatch.

---

### Phase 3: Restore `matchedSkills` Pipeline (HIGH — pre-load skills into prompt)

#### T3.1: Populate `matchedWithInstructions` in session.ts REPL

**File:** `src/session.ts`
**Change:** Replace hardcoded empty array with lightweight registry search.

**Before (line 350):**
```typescript
const matchedWithInstructions: any[] = []
```

**After:**
```typescript
import { loadSkill } from './solver/skills/loader'

// Use goal text to find candidate skills via registry (metadata-only search,
// then load full body for top matches). No substring scanning — the registry
// uses weighted scoring on id/name/description/triggers/toolRefs.
const matchedWithInstructions: any[] = []
if (line.trim().length > 3 && resources.skillRegistry) {
  const candidates = resources.skillRegistry.search(line.trim()).slice(0, 3)
  for (const c of candidates) {
    const full = loadSkill(c.id)
    if (full) matchedWithInstructions.push(full)
  }
}
```

**Lines changed:** +8
**Acceptance:**
- Typing "SQL injection" in REPL pre-loads `injection/exploitation` into prompt
- `solver.ts:613-643` executes and builds `## Relevant Methodology` block
- Empty/special commands (e.g. `/council`) don't trigger search

---

#### T3.2: Forward `matchedSkills` in WebEngine

**File:** `src/web/engine.ts`
**Change:** Accept and forward `matchedSkills` param.

**Before (line 129-160):**
```typescript
async solve(params: {
  goal: string
  solverConfig?: SolverConfig
  onMessage?: (msg: SolverStreamMessage) => void
  onPhase?: (event: PhaseEvent) => void
}): Promise<SolveResult> {
```

**After:**
```typescript
async solve(params: {
  goal: string
  solverConfig?: SolverConfig
  onMessage?: (msg: SolverStreamMessage) => void
  onPhase?: (event: PhaseEvent) => void
  matchedSkills?: Array<{ id: string; name: string; description: string; instructions: string; toolRefs: string[]; toolChains: any[]; compositionRules: any }>
}): Promise<SolveResult> {
```

And in the `solve()` call (line 148):
```typescript
const result = await solve(this.engineServices.solverBrain!, {
  // ... existing params ...
  matchedSkills: params.matchedSkills,  // NEW
})
```

**Lines changed:** +5
**Acceptance:** Web API route can now pass `matchedSkills` if populated.

---

#### T3.3: Populate `matchedSkills` in `/api/solve` route

**File:** `src/app/api/solve/route.ts`
**Change:** Load skills from goal text before calling `engine.solve()`.

```typescript
import { loadSkill } from '@/solver/skills/loader'
import { SkillRegistry } from '@/solver/skills/registry'

// Before engine.solve():
let matchedSkills: any[] | undefined
if (goal.length > 3) {
  const tempRegistry = new SkillRegistry()
  tempRegistry.loadFromDirectory('skills')
  const candidates = tempRegistry.search(goal).slice(0, 3)
  const loaded = candidates.map(c => loadSkill(c.id)).filter(Boolean)
  if (loaded.length > 0) matchedSkills = loaded
}

const result = await engine.solve({
  goal,
  solverConfig,
  onMessage: (msg) => send('solver', msg),
  onPhase: (event) => send('phase', event),
  matchedSkills,  // NEW
})
```

**Lines changed:** +12
**Acceptance:** Web solve endpoint pre-loads relevant skills into the enriched goal prompt.

---

### Phase 4: SSE Streaming Fix (MEDIUM — web UI real-time feedback)

#### T4.1: Fix SSE response headers and streaming

**File:** `src/app/api/solve/route.ts`
**Changes:**

1. Add `export const dynamic = 'force-dynamic'` at top of file (line 4)
2. Add anti-buffering headers to response:
```typescript
return new Response(stream, {
  headers: {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',  // ADD no-transform
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // NEW — prevent proxy buffering
  },
})
```
3. Remove `writeGuard` (lines 45, 50, 52, 57) — JS is single-threaded, `controller.enqueue()` is synchronous, guard is dead code:
```typescript
// BEFORE:
let writeGuard = false
const send = (event: string, data: unknown) => {
  if (controllerClosed || writeGuard) return
  writeGuard = true
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  } catch { controllerClosed = true }
  finally { writeGuard = false }
}

// AFTER:
const send = (event: string, data: unknown) => {
  if (controllerClosed) return
  try {
    controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
  } catch { controllerClosed = true }
}
```

**Lines changed:** ~8
**Acceptance:** SSE events stream in real-time instead of buffering until completion.

---

#### T4.2: Handle `spider:progress` and `phase` events in chat

**File:** `src/components/chat-stream.tsx`
**Change:** Add handlers for `spider:progress` and top-level `phase` events.

In `handleSSEEvent()` (after line 220, before the closing `}`):

```typescript
} else if (event === 'spider:progress') {
  const d = JSON.parse(data)
  addMessage({
    id: nextId(),
    type: 'graph-update',
    nodeType: 'Spider',
    nodeId: '',
    label: d.message || `Crawling... +${d.endpoints ?? 0} endpoints, +${d.pages ?? 0} pages`,
    timestamp: Date.now(),
  } as any)
} else if (event === 'phase') {
  const d = JSON.parse(data)
  setPhase(d.phase, d.step)
  // Also show phase in chat so user sees progress during spider + solve
  if (d.text) {
    addMessage({
      id: nextId(),
      type: 'phase',
      phase: d.phase,
      step: d.step,
      timestamp: Date.now(),
    } as any)
  }
}
```

**Lines changed:** ~18
**Acceptance:** Spider progress and solve phases appear in the chat panel in real-time.

---

### Phase 5: Bug Fixes (HIGH — broken wiring)

#### T5.1: Fix `workers/pool.ts` type mismatch

**File:** `src/workers/pool.ts`
**Change:** Line 141 — `skillRegistry.get()` returns `SkillMeta` (no `.instructions`). Fix to use `loadSkill()`.

**Before (line 141-144):**
```typescript
const skill = (this.factory as any).skillRegistry?.get?.(config.skillId)
// ...
systemPrompt: skill?.instructions || '',
```

**After:**
```typescript
import { loadSkill } from '../solver/skills/loader'
// ...
const fullSkill = loadSkill(config.skillId)
// ...
systemPrompt: fullSkill?.instructions || '',
```

**Lines changed:** +2 (1 import, 1 line change)
**Acceptance:** Context budget validation sees actual skill instruction size.

---

#### T5.2: Fix `resolveToolsForSkills` to use metadata-only path

**File:** `src/solver/skills/tool-filter.ts`
**Change:** Replace `loadSkill(id)` with `initSkillIndex().get(id)` — only needs `toolRefs` from metadata, not full body.

**Before (line 47-55):**
```typescript
function resolveToolsForSkills(skillIds: string[]): string[] {
  const tools = new Set<string>(CORE_TOOLS)
  for (const id of skillIds) {
    const skill = loadSkill(id)  // loads full body + refs unnecessarily
    if (skill) {
      for (const t of skill.toolRefs) { tools.add(t) }
    }
  }
  return [...tools]
}
```

**After:**
```typescript
import { initSkillIndex } from './loader'

function resolveToolsForSkills(skillIds: string[]): string[] {
  const tools = new Set<string>(CORE_TOOLS)
  const index = initSkillIndex()
  for (const id of skillIds) {
    const meta = index.get(id)
    if (meta) {
      for (const t of meta.toolRefs) { tools.add(t) }
    }
  }
  return [...tools]
}
```

**Lines changed:** +2 (1 import, 1 line change), -1 (remove loadSkill call)
**Acceptance:** `resolveToolsForSkills` no longer reads full skill files from disk.

---

#### T5.3: Fix `tool-selector.ts` to use metadata-only path

**File:** `src/tools/tool-selector.ts`
**Change:** Same pattern — replace `loadSkill()` with `initSkillIndex().get()`.

**Lines changed:** ~2
**Acceptance:** No unnecessary disk reads for metadata.

---

### Phase 6: Tests (REQUIRED — verify all fixes)

#### T6.1: Add `loadSkillBody` tool tests

**File:** `test/tools/skill-tools.test.ts` (extend existing)
**Tests:** 5 new tests.

1. `loadSkillBody` returns full instructions for valid skill ID
2. `loadSkillBody` returns `ok: false` for unknown skill ID
3. `loadSkillBody` includes `toolRefs`, `toolChains`, `compositionRules`
4. `loadSkillBody` includes `references` array
5. `loadSkillBody` result is cacheable (second call returns same data)

---

#### T6.2: Add brain toolset parity test

**File:** `test/solver/brain-toolset-parity.test.ts` (NEW)
**Tests:** 3 new tests.

1. Brain has all `buildToolPack()` base tools — compare `Object.keys(brainTools)` vs `Object.keys(buildToolPack(deps))`
2. Brain has all 3 critical graph tools: `getGraphSchema`, `getCaptureOverview`, `queryRelations`
3. Brain has `loadSkillBody` tool

---

#### T6.3: Update `tool-wiring-drift.test.ts`

**File:** `test/skills/tool-wiring-drift.test.ts`
**Change:** Add `loadSkillBody` to the canonical tool ID list.

**Lines changed:** +1

---

#### T6.4: Add `matchedSkills` population test

**File:** `test/session/matched-skills.test.ts` (NEW)
**Tests:** 3 new tests.

1. Goal text "SQL injection" loads `injection/exploitation` skill
2. Empty goal text does not trigger skill loading
3. Unknown goal text loads no skills (graceful degradation)

---

## Dependency Graph

```
T1.1 (loadSkillBody tool)
  ├── T1.2 (add to toolpack)
  ├── T1.3 (add to brain-tools)
  └── T1.4 (add to TOOL_IDS + registry)

T2.1 (migrate brain to buildToolPack) ← depends on T1.2, T1.3
T2.2 (modelSelector sharing)

T3.1 (session.ts matchedSkills) ← depends on T1.1
T3.2 (web/engine.ts forwarding)
T3.3 (/api/solve skill loading) ← depends on T1.1

T4.1 (SSE headers)
T4.2 (spider:progress in chat)

T5.1 (pool.ts type fix)
T5.2 (tool-filter.ts metadata path)
T5.3 (tool-selector.ts metadata path)

T6.1 (loadSkillBody tests) ← depends on T1.1
T6.2 (brain toolset parity test) ← depends on T2.1
T6.3 (tool-wiring-drift update) ← depends on T1.4
T6.4 (matchedSkills test) ← depends on T3.1
```

**Recommended build order:**
1. Phase 1 (T1.1 → T1.2 → T1.3 → T1.4) — unblocks everything
2. Phase 2 (T2.1 → T2.2) — biggest impact
3. Phase 3 (T3.1 → T3.2 → T3.3) — skill pre-loading
4. Phase 4 (T4.1, T4.2) — SSE streaming (independent)
5. Phase 5 (T5.1, T5.2, T5.3) — bug fixes (independent)
6. Phase 6 (T6.1 → T6.4) — tests last

---

## Estimated Impact

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Brain tool count | ~50 | ~60 | +10 |
| Brain can load skill body | NO | YES | +56 skills accessible |
| Brain has getGraphSchema | NO | YES | +schema discovery |
| Brain has getCaptureOverview | NO | YES | +structural overview |
| Brain has queryRelations | NO | YES | +relational hunting |
| Brain has encodeDecode | NO | YES | +payload encoding |
| Brain has nuclei/sqlmap/etc | NO | YES | +external scanners |
| matchedSkills populated | NEVER | Per-turn | +skill context |
| SSE streaming buffered | YES | NO | +real-time feedback |
| spider:progress visible | NO | YES | +user feedback |
| modelSelector shared | NO | YES | +rate-limit consistency |
| brain-tools.ts size | ~466 lines | ~150 lines | -316 lines |

---

## Verification Checklist

- [ ] `npm test` — all 1789+ tests pass
- [ ] `npm run build:cli` — clean build
- [ ] `npx ultimatrix interact -t https://httpbin.org` — brain loads skills, shows tool calls
- [ ] Web UI: POST /api/solve streams events in real-time (not buffered)
- [ ] Web UI: spider progress visible in chat during crawl
- [ ] Brain tool list includes `getGraphSchema`, `queryRelations`, `loadSkillBody`, `nuclei`
- [ ] `searchSkills("SQL injection")` → `loadSkillBody("injection/exploitation")` returns 417-line methodology
