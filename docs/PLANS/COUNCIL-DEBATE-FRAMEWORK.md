# Council Debate Framework — Implementation Plan

**Date:** 2026-07-11  
**Status:** IN PROGRESS  
**Scope:** 9 new files, 7 modified files, 3 files marked deprecated

---

## 1. Problem Statement

The council engine has working infrastructure (orchestrator, bus, types, factory, evidence-bridge, approval) but three critical gaps:

1. **Council can't act** — `execute` callback never wired in session.ts (debates happen, proposals approved, nothing executes)
2. **Personas are paper-thin** — 3-6 lines each vs 221 lines for the solver brain. No backstory, no debate protocol, no adversarial tension
3. **No debate memory** — members forget past positions, can contradict themselves, don't reference each other's arguments
4. **State isolation** — council blackboard is separate from core blackboard (facts/intents don't flow)
5. **Solver via runner is broken** — SingleAgentStrategy creates a passthrough stub agent that crashes
6. **Dead code** — CouncilStrategy, SingleAgentStrategy, and runner are unreachable from the REPL

---

## 2. Architecture

### Current flow (broken):
```
session.ts REPL
  ├─ council → debateOnce() DIRECTLY (no execute callback → no worker dispatch)
  ├─ solver → runSession() → SingleAgentStrategy → stub agent → CRASH
  └─ legacy → supervisor.stream()
```

### Target flow:
```
session.ts REPL
  ├─ council → debateOnce(real members, shared blackboard, execute callback)
  │            → members speak in parallel with rich personas
  │            → debate memory tracks stances across turns
  │            → skeptic genuinely challenges weak claims
  │            → execute callback dispatches to workerPool
  │            → results bridge to evidence ledger
  │
  ├─ solver → solve(real solverBrain, shared blackboard, evidence)
  │           → bypasses runner entirely
  │
  └─ council/strategy → @deprecated (dead code, marked but not deleted yet)
```

---

## 3. Part A — Council Debate Framework

### A1. Persona Markdown Files (7 new files)

**Location:** `src/council/personas/`

Each `.md` file has YAML frontmatter (metadata) + markdown body (LLM prompt).

#### A1.1 `charter.md` — Shared Team Charter
- Prepended to every member's prompt
- Establishes team identity: "You are a 4-member red team"
- Mission: "Find and prove real vulnerabilities with evidence"
- Rules of engagement: never propose blind, never execute without approval, never agree without reasoning
- Decision hierarchy: skeptic vetoes claims, strategist sets direction, operator executes, analyst correlates

#### A1.2 `strategist.md` — The Architect
- **Backstory:** 15 years offensive security lead, ran red team ops for Fortune 500
- **Expertise:** Attack surface mapping, kill chain construction, priority ranking
- **Perspective:** Thinks in chains: "XSS → session token theft → lateral movement"
- **Constraints:** Must reference evidence before proposing. One concrete proposal per turn.
- **Debate behavior:** Defends proposals with evidence. Revises when skeptic rejects.
- **Authority:** Attack direction — strategist decides what to test next

#### A1.3 `operator.md` — The Runner
- **Backstory:** Exploit developer and tooling specialist, writes custom payloads
- **Expertise:** Payload crafting, tool execution, worker delegation, results interpretation
- **Perspective:** Thinks practically — "Can I actually do this? What do I need?"
- **Constraints:** Reports exact observations. Never fabricates. Never improvises beyond plan.
- **Debate behavior:** Grounds proposals in reality. "I need auth cookies to test that endpoint."
- **Authority:** Execution — operator decides HOW to execute, not WHAT to test

#### A1.4 `skeptic.md` — The Auditor
- **Backstory:** Application security auditor, former developer, CI/CD security champion
- **Expertise:** Evidence verification, false positive detection, claim validation
- **Perspective:** Assumes everything is a false positive until proven otherwise
- **Constraints:** MUST reject any claim without supporting evidence. Can't be overridden by enthusiasm.
- **Debate behavior:** Adversarial by design. Not mean, but relentless. "Show me the error message."
- **Authority:** Evidence gating — skeptic has veto power on claims

#### A1.5 `analyst.md` — The Cartographer
- **Backstory:** Threat intelligence analyst, built MITRE ATT&CK mappings for APT groups
- **Expertise:** Pattern recognition, attack chain discovery, risk quantification
- **Perspective:** Thinks in graphs — "This finding connects to that endpoint which connects to this auth flow"
- **Constraints:** Must connect findings to concrete attack paths. No vague "maybe there's something."
- **Debate behavior:** Proposes chains and alternatives. "SQLi + IDOR is more impactful than XSS alone."
- **Authority:** Attack chains — analyst identifies chains, strategist decides whether to pursue

#### A1.6 `debate-protocol.md` — 5-Phase Debate Structure
```
Phase 1: Proposal (Strategist) — one concrete experiment
Phase 2: Challenge (all others) — skeptic verifies, analyst chains, operator assesses feasibility
Phase 3: Revision (Strategist) — revise if challenged, or defend with evidence
Phase 4: Execution (Operator) — execute approved proposal, report exact results
Phase 5: Reflection (all) — what worked, what failed, what was learned
```
Plus rules: 1 proposal per turn, skeptic has veto, 3 failures → escalate to human

#### A1.7 `output-contract.md` — Structured JSON Format
- Moved from hardcoded string in personas.ts
- JSON schemas for propose, critique, complete, escalate intents
- Impact and complexity level definitions

### A2. Persona Loader (`src/council/persona-loader.ts`)

**New file.** Reads `.md` files, parses YAML frontmatter, returns typed metadata + prompt.

```typescript
// Exports:
export function loadPersonaFile(role: string): LoadedPersona
export function loadCharter(): string
export function loadDebateProtocol(): string
export function loadOutputContract(): string
export function personaMetadata(role: string): PersonaMetadata
```

- Uses `yaml` package for frontmatter parsing (already a dependency via config.ts)
- Caches loaded files in a Map (files don't change at runtime)
- Returns `{ metadata: PersonaMetadata, prompt: string }`

### A3. Debate Memory (`src/council/debate-memory.ts`)

**New file.** Tracks member stances across debate turns.

```typescript
// Types:
export interface Stance {
  member: CouncilMemberRole
  round: number
  position: 'for' | 'against' | 'alternative'
  target: string
  reasoning: string
}

export interface FailedApproach {
  round: number
  technique: string
  endpoint: string
  reason: string
}

export interface DebateMemory {
  stances: Stance[]
  failedApproaches: FailedApproach[]
  provenFindings: Array<{ round: number; finding: string; evidence: string }>
}

// Functions:
export function extractStances(output: MemberOutput, role: CouncilMemberRole, round: number): Stance[]
export function extractFailedApproaches(result: string, round: number): FailedApproach[]
export function buildMemoryPrompt(memory: DebateMemory, role: CouncilMemberRole): string
export function detectContradictions(memory: DebateMemory, newStance: Stance): string | null
```

**`buildMemoryPrompt()`** generates a per-member section like:
```markdown
## Debate Memory — Your Past Positions
- Round 1: [for] SQL injection on /api/users (observed parameter in POST body)
- Round 2: [against] XSS on /search (no reflected input observed)

### Failed Approaches (DO NOT repeat):
- Round 2: SQLi on /api/admin → 403 forbidden

### Contradictions Detected:
(None)

Maintain consistency. If you change your mind, explain why with new evidence.
```

### A4. Rewrite `src/council/personas.ts`

Replace hardcoded persona strings with file loader:
```typescript
// Before: const STRATEGIST = `You are Hex — ...` (6 lines)
// After: loads from strategist.md (50+ lines of rich backstory)
```

- Imports `loadPersonaFile`, `loadCharter`, `loadDebateProtocol`, `loadOutputContract` from persona-loader.ts
- `personaFor(role)` now assembles: charter + role prompt + debate protocol + output contract
- `personaMetadata(role)` exposes YAML frontmatter for factory tool filtering
- Removes all hardcoded persona strings

### A5. Modify `src/council/types.ts`

Add new types:
```typescript
export interface Stance { ... }
export interface FailedApproach { ... }
export interface DebateMemory { ... }
export interface PersonaMetadata { ... }
```

### A6. Modify `src/council/orchestrator.ts`

**Phase 1 changes (parallel debate):**
- Build role-specific prompt per member (includes debate memory)
- Each member gets `buildGoalPrompt(goal, transcript, previousResults, debateMemory, memberRole)`

**After Phase 2 (post outputs to bus):**
- Extract stances from each output
- Update debate memory registry

**After Phase 8 (results analysis):**
- Extract failed approaches from execution results
- Update debate memory registry

**New parameter in `DebateOnceParams`:**
```typescript
debateMemory?: DebateMemory  // mutable, accumulated across turns
```

### A7. Modify `src/council/factory.ts`

**Per-role tool filtering:**
```typescript
// Before: all members get full 67+ tool registry
// After: read toolRestrictions from persona YAML frontmatter
const meta = personaMetadata(role)
const allowedTools = meta.toolRestrictions === '*' ? undefined : meta.toolRestrictions
const agent = createAgent(config, { ..., toolIds: allowedTools })
```

**Shared blackboard:**
```typescript
// Before: createCouncil() creates its own SharedBlackboard
// After: accepts optional blackboard param, wraps it
export function createCouncil(config, deps, sharedBlackboard?: Blackboard) {
  const blackboard = sharedBlackboard ? new SharedBlackboard(sharedBlackboard) : new SharedBlackboard()
  // ...
}
```

---

## 4. Part B — Wiring Fixes

### B1. Wire `execute` callback (`src/session.ts`)

```typescript
// Council REPL path (lines 54-70)
const execute = async (proposal: MemberOutput, ctx: CouncilExecuteContext) => {
  if (!proposal.proposal) return 'no proposal'
  const worker = await resources.workerPool!.spawn({
    skillId: proposal.proposal.skillId,
    task: proposal.proposal.action,
  })
  const result = await worker.generate(proposal.proposal.action)
  return result.text
}

const debateMemory: DebateMemory = { stances: [], failedApproaches: [], provenFindings: [] }

debateOnce({
  members: resources.council.members,
  bus: resources.council.bus,
  blackboard: resources.council.blackboard,
  goal: line,
  config: councilConfig,
  ledger: resources.coreServices.evidence,
  execute,
  debateMemory,  // accumulates across REPL turns
})
```

### B2. Share blackboard

**`src/council/factory.ts`:**
```typescript
export function createCouncil(config, deps, sharedBlackboard?: Blackboard) { ... }
```

**`src/session/lifecycle.ts`:**
```typescript
this._resources.council = await createCouncil(
  config,
  { skillRegistry, workerPool, browser },
  this._resources.coreServices.blackboard,  // ← shared
)
```

### B3. Bypass runner for solver (`src/session.ts`)

Replace Path B (runner → stub agent → crash) with direct solve:
```typescript
// Before (Path B — broken):
const toolPack = buildToolPack({ config, ... })
const result = await runSession({ goal: line, toolPack, ... })

// After (direct — working):
const result = await solve(resources.solverBrain, {
  origin: target,
  goal: line,
  model: config.model,
  blackboard: resources.coreServices.blackboard,
  evidence: resources.coreServices.evidence,
  loopDetector: resources.coreServices.loopDetector,
  reflexion: resources.coreServices.reflexion,
  config: { maxToolCalls, maxDurationMs, staleThreshold },
})
```

---

## 5. Part C — Cleanup

### C1. Skip solver brain for council (`src/session/lifecycle.ts`)
```typescript
if (config.engine !== 'council') {
  this._resources.solverBrain = await createSolverBrain(config, { ... })
}
```

### C2. Fix REPL banner (`src/session/lifecycle.ts`)
```typescript
const useSolver = config.engine === 'solver' || config.engine === 'multi-model' || config.engine === 'council'
```

### C3. Mark deprecated (`src/core/strategies/council.ts`, `single.ts`, `runner.ts`)
Add `@deprecated` JSDoc to CouncilStrategy, SingleAgentStrategy, runSession, resolveEnginePreset.

---

## 6. Files Summary

### New files (9):
| # | File | Lines (est) | Purpose |
|---|------|-------------|---------|
| 1 | `src/council/personas/charter.md` | ~40 | Shared team charter |
| 2 | `src/council/personas/strategist.md` | ~60 | Architect persona |
| 3 | `src/council/personas/operator.md` | ~50 | Runner persona |
| 4 | `src/council/personas/skeptic.md` | ~60 | Auditor persona |
| 5 | `src/council/personas/analyst.md` | ~55 | Cartographer persona |
| 6 | `src/council/personas/debate-protocol.md` | ~50 | 5-phase debate rules |
| 7 | `src/council/personas/output-contract.md` | ~60 | Structured JSON format |
| 8 | `src/council/persona-loader.ts` | ~80 | YAML frontmatter parser + loader |
| 9 | `src/council/debate-memory.ts` | ~120 | Stance registry + extraction + injection |

### Modified files (7):
| # | File | Change |
|---|------|--------|
| 1 | `src/council/personas.ts` | Rewrite: file loader replaces hardcoded strings |
| 2 | `src/council/orchestrator.ts` | Debate memory injection, stance extraction, role-specific prompts |
| 3 | `src/council/factory.ts` | Per-role tool filtering, shared blackboard param |
| 4 | `src/council/types.ts` | Add Stance, DebateMemory, PersonaMetadata types |
| 5 | `src/session.ts` | Wire execute callback, bypass runner for solver |
| 6 | `src/session/lifecycle.ts` | Share blackboard, skip solver brain for council, fix banner |
| 7 | `src/core/strategies/council.ts` | Mark @deprecated |

### Dead code (marked, not deleted):
| File | What |
|------|------|
| `src/core/strategies/council.ts` | CouncilStrategy class |
| `src/core/strategies/single.ts` | SingleAgentStrategy class |
| `src/core/runner.ts` | runSession() + resolveEnginePreset() |

---

## 7. Verification

1. `npm test` — all 1266 tests pass (update council tests for new file loader)
2. `npm run build:cli` — clean build
3. Council debate: members reference each other by role, skeptic challenges weak claims
4. Debate memory: stances persist across REPL turns, contradictions detected
5. Council execute: proposals actually spawn workers via execute callback
6. Solver: `engine: solver` runs with real brain agent (no stub crash)
7. Shared blackboard: council and solver see each other's facts/intents

---

## 8. Implementation Order

1. Create persona .md files (A1) — no dependencies
2. Create persona-loader.ts (A2) — depends on .md files
3. Add types to types.ts (A5) — no dependencies
4. Create debate-memory.ts (A3) — depends on types
5. Rewrite personas.ts (A4) — depends on loader
6. Modify factory.ts (A7) — depends on loader, types
7. Modify orchestrator.ts (A6) — depends on debate-memory, types
8. Wire session.ts (B1, B3) — depends on debate-memory
9. Share blackboard (B2) — depends on factory changes
10. Lifecycle cleanup (C1, C2) — independent
11. Mark deprecated (C3) — independent
12. Update tests — after all changes
13. Verify (npm test + build)
