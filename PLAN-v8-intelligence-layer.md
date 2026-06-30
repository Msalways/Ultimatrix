# Ultimatrix v8 — VulnClaw-Inspired Intelligence Layer

> **Goal:** Adopt VulnClaw's best patterns (anti-hallucination, reflexion engine, solver loop, richer skills) into Ultimatrix — all in English, properly architected, with dual-engine support.

> **Status:** Planning complete. Implementation ready to begin.

---

## Architecture Overview

```
                    ┌──────────────────────┐
                    │   Engine Selector    │ ← config.engine: 'legacy' | 'solver'
                    │   (dual engine)      │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                ▼                 ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
    │  Legacy      │  │  Solver      │  │  Shared Layer    │
    │  Supervisor  │  │  Engine      │  │  (used by both)  │
    │  (Phase 1-5) │  │  (OODA)      │  │                  │
    │              │  │              │  │  • Evidence Gate  │
    │  observe →   │  │  REASON →    │  │  • Reflexion      │
    │  learn →     │  │  EXPLORE →   │  │  • Anti-Loop      │
    │  attack →    │  │  CONCLUDE →  │  │  • Finding Life   │
    │  loop        │  │  loop        │  │  • Failed Paths   │
    └──────────────┘  └──────────────┘  └──────────────────┘
              │                │                 │
              └────────────────┼────────────────┘
                               ▼
                    ┌──────────────────────┐
                    │   Skills Engine      │ ← 21 skills (7 core + 14 specialized)
                    │   + Knowledge Base   │   with loadable reference docs
                    └──────────────────────┘
```

---

## Phase 1: Shared Intelligence Layer

> These modules are used by BOTH engines and ALL workers. Build first.

### 1A. Evidence Anti-Hallucination Gate

| Field | Detail |
|-------|--------|
| **Priority** | P0 (highest impact) |
| **Status** | NOT STARTED |
| **File** | `src/intelligence/evidence-gate.ts` |
| **Test** | `test/intelligence/evidence-gate.test.ts` |
| **Depends on** | Nothing |
| **Blocks** | 1B, 1C, 2B, 3B, 3C |

**What it does:**
- Records every real tool output into an `evidenceBuffer`
- When LLM writes a finding, cross-checks: does the claimed evidence actually appear in real output?
- `extractFlags(text)` — regex finds flag-like patterns (`flag{...}`, `CTF{...}`)
- `verifyCompletion(goal, evidence)` — if goal requires flag, ensures one was found in real tool output
- All status signals in English: `VERIFIED`, `HALLUCINATION_DETECTED`, `EVIDENCE_MISSING`, `COMPLETION_GROUNDED`, `COMPLETION_REJECTED`

**API:**
```typescript
export class EvidenceGate {
  recordToolOutput(output: string): void
  verifyClaim(claim: string): { verified: boolean; missing: string[] }
  extractFlags(text: string): string[]
  verifyCompletion(goal: string): { grounded: boolean; reason: string }
  getBuffer(): string[]
  clear(): void
}
```

**Test coverage (~15 tests):**
- Records tool output correctly
- Verifies claim that exists in buffer
- Rejects claim that doesn't exist in buffer
- Extracts flags from text
- Handles multiple flag formats
- Rejects completion when goal wants flag but none found
- Accepts completion when flag found in real output
- Handles empty buffer gracefully
- Handles very large outputs
- etc.

---

### 1B. Reflexion Engine

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/intelligence/reflexion.ts` |
| **Test** | `test/intelligence/reflexion.test.ts` |
| **Depends on** | Nothing (parallel with 1A) |
| **Blocks** | 1C, 3C, 6 |

**What it does:**
- Classifies failures into 4 categories: `env_constraint`, `path_error`, `param_error`, `info_needed`
- Tracks consecutive failures per vulnerability type
- After 2 failures on same type → triggers reflection
- Progressive L0-L4 escalation with English hints
- Maintains failed paths list to prevent retry
- Analyzes failure patterns across attempts
- `extractExperience()` produces serializable summary for graph persistence

**Escalation levels (all English hints):**
- **L0:** Try raw payload without encoding
- **L1:** URL-encode special characters. Swap case (SeLeCt). Try whitespace variants (/\*\*/, newline, tab)
- **L2:** Double URL-encoding. Inline comments. HTML entity encoding
- **L3:** Unicode escapes (\u0027). Hex encoding (0x...). String concatenation (con||cat). Equivalent function substitution
- **L4:** Multi-layer encoding. Alternative syntax. Time-based blind or OOB channel. Switch to entirely different vulnerability class

**API:**
```typescript
export enum FailureCategory { ENV_CONSTRAINT, PATH_ERROR, PARAM_ERROR, INFO_NEEDED, UNKNOWN }
export enum EscalationLevel { L0, L1, L2, L3, L4 }

export class ReflexionEngine {
  recordAttempt(path, success, category?, details?, vulnType?): void
  shouldReflect(): boolean
  shouldEscalate(): boolean
  getEscalationLevel(): EscalationLevel
  getEscalationHints(): string[]
  getFailedPaths(): string[]
  analyzeFailurePatterns(): FailurePattern[]
  toPromptBlock(): string        // Lightweight block for every prompt
  toReflectionPrompt(): string   // Full reflection takeover prompt
  extractExperience(): ExperienceSummary
  static classifyFailure(output: string): FailureCategory
}
```

**Test coverage (~20 tests):**
- Records success resets counters
- Records failure increments counters
- Triggers reflection after N same-vuln failures
- Escalation level increases with failures
- L0-L4 hints are correct at each level
- Failed paths are tracked and deduplicated
- classifyFailure correctly categorizes WAF/403
- classifyFailure correctly categorizes "no injection"
- classifyFailure correctly categorizes bad payload syntax
- etc.

---

### 1C. Anti-Loop / Stale Detection

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/intelligence/anti-loop.ts` |
| **Test** | `test/intelligence/anti-loop.test.ts` |
| **Depends on** | Nothing (parallel with 1A, 1B) |
| **Blocks** | 2B, 3B |

**What it does:**
- Tracks rounds since last finding
- Tracks per-URL failure count → blocks unreachable targets after N failures
- Detects dead-end markers in LLM output
- Distinguishes meaningful progress from failed retries
- Detects current attack path from LLM output

**All signals in English:**
```
STALE_MARKERS:    no_new_findings, repeated_endpoint, same_technique, dead_end
DEAD_END_MARKERS: does_not_exist, cannot_access, failed, blocked, no_injection, not_vulnerable, eliminated
FAILED_ACCESS:    SSLError, ReadTimeout, connection_timeout, 502 Bad Gateway, Connection refused
ATTACK_PATHS:     sqli, xss, ssrf, rce, ssti, deserialization, file_upload, xxe, info_leak, brute_force
```

**API:**
```typescript
export class LoopDetector {
  roundsSinceLastFindings: number
  failedTargets: Map<string, number>
  blockedTargets: Set<string>

  recordRound(hasNewFinding: boolean): void
  isStale(threshold: number): boolean
  trackFailedTarget(url: string, error: string): string | null  // returns blocked hostname
  isTargetBlocked(hostname: string): boolean
}

export function detectDeadEnd(llmOutput: string): boolean
export function isMeaningfulStep(step: string): boolean
export function detectAttackPath(llmOutput: string): string | null
```

**Test coverage (~12 tests):**
- Stale detection triggers after threshold
- Stale resets when finding discovered
- Failed target tracked and blocked
- Blocked target not retried
- Dead end detection works
- Meaningful step vs failed retry distinguished
- Attack path correctly identified for SQLi/XSS/SSRF
- etc.

---

### 1D. Finding Lifecycle Management

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | Enhanced `src/tools/control-tools.ts` |
| **Test** | Enhanced `test/tools/control-tools.test.ts` |
| **Depends on** | 1A (uses EvidenceGate for auto-verification) |
| **Blocks** | 3B |

**What it changes:**
- `writeFinding` now sets `lifecycleStatus` based on evidence level
- High/Critical findings without evidence auto-tagged as `[UNVERIFIED]`
- Semantic dedup: if two findings >75% text overlap, keep the one with stronger evidence
- Evidence levels: L1=claimed, L2=has some evidence, L3=tool-verified, L4=PoC-confirmed
- New finding properties: `lifecycleStatus`, `evidenceLevel`, `findingId`, `verifiedAt`, `verificationNote`

**New FindingNode properties:**
```typescript
lifecycleStatus: 'candidate' | 'pending_verification' | 'verified' | 'rejected' | 'needs_review'
evidenceLevel: 'L1' | 'L2' | 'L3' | 'L4'
findingId: string           // Generated dedup key (vulnType + endpoint)
verifiedAt?: string
verificationNote?: string
```

**Test coverage (~10 tests):**
- High severity without evidence gets UNVERIFIED tag
- Evidence levels assigned correctly
- Semantic dedup prevents duplicates
- Lifecycle transitions work
- etc.

---

### 1E. Confirmed Facts vs Unverified Assumptions

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **File** | Enhanced `src/graph/store.ts` |
| **Test** | Enhanced `test/graph/store.test.ts` |
| **Depends on** | Nothing (parallel) |
| **Blocks** | 2B, 3B |

**What it changes:**
- Graph metadata tracks two lists: `confirmedFacts` and `unverifiedAssumptions`
- Both lists injected into worker prompts
- Prevents workers from building reasoning chains on false assumptions

**API:**
```typescript
// On GraphStore:
addConfirmedFact(fact: string): void
addUnverifiedAssumption(assumption: string): void
getConfirmedFacts(): string[]
getUnverifiedAssumptions(): string[]
```

**Test coverage (~5 tests):**
- Adds confirmed facts
- Adds unverified assumptions
- Retrieval works
- Deduplication
- etc.

---

## Phase 2: Solver Engine

> New solver engine as alternative to legacy supervisor. User selects via config.

### 2A. Blackboard (Fact/Intent State Space)

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/solver/blackboard.ts` |
| **Test** | `test/solver/blackboard.test.ts` |
| **Depends on** | Nothing (parallel) |
| **Blocks** | 2B |

**What it does:**
- Pure data structure: Facts (confirmed truths) + Intents (exploration directions)
- Intent lifecycle: OPEN → EXPLORING → CONCLUDED (produces Fact) or ABANDONED
- Tool call record log to prevent cross-intent repetition
- `toPromptGraph()` renders entire state in English for LLM consumption
- Checkpoint support: detect when state hasn't changed to skip expensive REASON calls

**API:**
```typescript
export class Blackboard {
  origin: string
  goal: string
  facts: BoardFact[]
  intents: BoardIntent[]
  toolCalls: ToolCallRecord[]
  completed: boolean
  completeReason: string

  addFact(description: string, source?: string): BoardFact
  addIntent(description: string, fromFacts?: string[]): BoardIntent
  claimIntent(id: string): void
  concludeIntent(id: string, factDescription: string): BoardFact | null
  abandonIntent(id: string, note?: string): void
  markComplete(reason: string): void
  recordToolCall(tool: string, keyArgs: string, intentId?: string, status?: number, note?: string): void
  openIntents(): BoardIntent[]
  activeIntents(): BoardIntent[]
  hasCalled(tool: string, keyArgs: string): boolean
  toolCallSummary(maxLines?: number): string
  toPromptGraph(): string
  getSummary(): Record<string, unknown>
}
```

**Prompt rendering (all English):**
```
goal: Find SQL injection or XSS on target
origin: https://example.com

facts:
  - f001: Target origin=https://example.com (origin)
  - f002: Login page at /admin returns 200 with form [user, pass] (explore:i001)

intents:
  - i001 [concluded] from=f001 -> f002: Explore login page for auth bypass
  - i002 [open] from=f002: Test login form for SQL injection on user field

executed_tools (do NOT repeat):
  - i001: httpRequest(GET, /admin) -> 200
```

**Test coverage (~18 tests):**
- Fact CRUD
- Intent lifecycle (open → claim → conclude/abandon)
- Tool call recording and dedup
- Prompt rendering in English
- Checkpoint detection
- Completed state
- Abandoned intent notes
- etc.

---

### 2B. Solver Loop (OODA)

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/solver/solver.ts` |
| **Test** | `test/solver/solver.test.ts` |
| **Depends on** | 1A, 1B, 1C, 2A |
| **Blocks** | 2C |

**What it does:**
- OODA loop: REASON → EXPLORE → CONCLUDE → repeat
- Seeds initial fact from origin/goal
- REASON: reads blackboard, checks completion, proposes new intents (max 3)
- EXPLORE: claims one intent, executes tool calls (max 4 rounds per intent)
- CONCLUDE: based ONLY on real tool output, writes fact or abandons
- Anti-hallucination integration: verify claims against evidence buffer
- Stale detection: 3 empty REASON streaks = stop
- Parallel exploration support (maxParallel config)
- Checkpoint: skip REASON if blackboard unchanged and open intents exist

**Loop structure:**
```
1. Seed: addFact("Target origin={origin}; goal={goal}")
2. REASON: Call LLM with blackboard state → {complete: bool, intents: [...]}
3. If complete → verify evidence → if grounded, done
4. EXPLORE: Claim intent → call LLM with tool access → collect evidence
5. CONCLUDE: Call LLM with ONLY real tool output → {advanced: bool, fact: string}
6. If advanced → addFact. If not → abandonIntent.
7. Check: complete? → done. No open intents? → reason again (3 empty = stop). Budget? → stop.
```

**API:**
```typescript
export interface SolveResult {
  completed: boolean
  reason: string        // 'goal_achieved' | 'frontier_exhausted' | 'budget_reached'
  steps: number
  facts: number
}

export async function solve(
  agent: Agent,
  params: {
    origin: string
    goal: string
    hints?: string[]
    maxSteps?: number       // Default 40
    maxIntents?: number     // Default 3
    maxToolRounds?: number  // Default 4
    maxParallel?: number    // Default 1
  }
): Promise<SolveResult>
```

**Test coverage (~15 tests):**
- Seeds initial fact
- REASON proposes intents
- EXPLORE calls tools and collects evidence
- CONCLUDE writes fact when advancing
- CONCLUDE abandons when dead end
- Anti-hallucination rejects false flags
- Completion requires grounded evidence
- Loop terminates after max steps
- Loop terminates when frontier exhausted
- Checkpoint skips redundant REASON
- etc.

---

### 2C. Engine Selector

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **Files** | `src/config.ts`, `src/session.ts` |
| **Test** | `test/config/config.test.ts` (extend) |
| **Depends on** | 2B |
| **Blocks** | Phase 3 |

**What it changes:**
- Config gets `engine: 'legacy' | 'solver'` (default: `'solver'`)
- Config gets `solver: SolverConfig` block
- `src/session.ts` routes to correct engine based on config
- CLI gets `ultimatrix solve -t <url>` command (explicit solver)

**New config fields:**
```typescript
engine: 'legacy' | 'solver'
solver: {
  maxSteps: 40
  maxIntents: 3
  maxToolRounds: 4
  maxParallel: 1
}
antiLoop: {
  staleThreshold: 5
  maxFailedTarget: 3
  deadEndThreshold: 2
}
reflexion: {
  enabled: true
  maxSameVulnFails: 2
  maxTotalNoProgress: 5
  escalationMaxLevel: 4
}
```

**Test coverage (~8 tests):**
- Default engine is solver
- Legacy engine routes correctly
- Solver engine routes correctly
- Config validation includes new fields
- etc.

---

## Phase 3: Core Contract & Enhanced Prompts

> Upgrade all instruction files with anti-hallucination, assumption verification, and path diversity.

### 3A. Core Contract

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/prompts/core-contract.ts` (NEW) |
| **Test** | `test/prompts/core-contract.test.ts` (NEW) |
| **Depends on** | Nothing (parallel) |
| **Blocks** | 3B, 3C |

**What it does:**
- Single source of truth for authorization framing, anti-hallucination rules, workflow rules
- ~300 words, all English
- Used by BOTH engines and ALL workers

**Content covers:**
- Sandbox framing (authorized testing environment)
- Evidence conflict resolution priority
- Workflow rules (passive before active, prove narrow flow before expanding)
- Anti-hallucination rules (never fabricate tool results, never fabricate flags, never skip verification)
- Output format (structured, conclusion-first)
- Network context (all domains in scope are internal test assets)
- No unnecessary warnings

**Test coverage (~5 tests):**
- Module exports correct string
- Contains required phrases
- etc.

---

### 3B. Enhanced Supervisor Instructions (Legacy Engine)

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **File** | `src/manager/instructions.ts` (modify) |
| **Depends on** | 1A, 1C, 3A |
| **Blocks** | Nothing |

**What it changes:**
- Replace thin authorization banner with core contract from 3A
- Inject anti-hallucination rules
- Add assumption verification directive
- Add path diversity constraint (3 failures → fundamentally different approach)
- Add user hint priority (user says "test X" → do X immediately)
- Add stale round awareness (inject LoopDetector state)

---

### 3C. Enhanced Worker Instructions

| Field | Detail |
|-------|--------|
| **Priority** | P0 |
| **Status** | NOT STARTED |
| **Files** | All 4 worker instruction files (modify) |
| **Depends on** | 1A, 1B, 1C, 3A |
| **Blocks** | Nothing |

**Files to modify:**
- `src/workers/instructions/injection.ts`
- `src/workers/instructions/auth-control.ts`
- `src/workers/instructions/advanced.ts`
- `src/workers/instructions/recon.ts`

**What each gets:**
- Core contract from 3A (replaces thin authorization banner)
- Evidence gate awareness: "Your claims will be verified against real tool output"
- Reflexion state block: include `reflexion.toPromptBlock()` (dynamic per-worker)
- Failed paths list: "Do NOT retry these paths: [list]"
- Escalation hints: current level hints from reflexion engine
- Real test > local simulation rule
- Assumption verification rule

---

## Phase 4: Skills Engine

> Expand from 4 skills to 21 skills with loadable reference docs.

### 4A. Skill Loader & Registry

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **Files** | `src/skills/loader.ts` (NEW), `src/skills/registry.ts` (NEW) |
| **Test** | `test/skills/loader.test.ts` (NEW) |
| **Depends on** | Nothing (parallel) |
| **Blocks** | 4B, 4C |

**What it does:**
- Loads skill markdown files from `src/skills/` directory
- Each skill has optional `refs/` subdirectory with loadable reference docs
- `searchSkills(query)` finds relevant skills by keyword
- Single source of truth for all 21 skills

**API:**
```typescript
export interface Skill {
  id: string
  name: string
  category: 'core' | 'specialized'
  description: string
  instructions: string
  references: Reference[]
  toolRefs: string[]
}

export function loadSkill(id: string): Skill
export function loadAllSkills(): Skill[]
export function searchSkills(query: string): Skill[]
export function loadReference(skillId: string, refId: string): string
export function listReferences(skillId: string): Reference[]
```

**Test coverage (~10 tests):**
- Loads core skill correctly
- Loads specialized skill correctly
- Reference loading works
- searchSkills finds by keyword
- Missing skill returns null
- etc.

---

### 4B. Dynamic Skill Dispatch

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **File** | `src/skills/dispatcher.ts` (NEW) |
| **Test** | `test/skills/dispatcher.test.ts` (NEW) |
| **Depends on** | 4A |
| **Blocks** | 4C |

**What it does:**
- Routes user input to appropriate skills based on keyword matching
- Returns array of matched skills sorted by relevance
- Supports both automatic dispatch and manual skill selection

**Routing table:**
```
"SQL injection", "sqli"       → injection, web-security-advanced
"XSS", "cross-site"           → injection, web-security-advanced
"IDOR", "authorization"       → authorization, web-pentest
"race condition"              → race-conditions, web-pentest
"file upload"                 → web-pentest
"WAF", "blocked"              → waf-bypass
"JWT", "token"                → authorization
"SSRF"                        → web-security-advanced
"command injection", "RCE"    → injection, web-security-advanced
"CTF", "flag"                 → ctf-web, ctf-crypto, ctf-misc
"recon", "enumerate"          → recon, osint-recon
"AI", "MCP"                   → ai-mcp-security
```

**Test coverage (~10 tests):**
- Correct routing for SQLi
- Correct routing for XSS
- Correct routing for IDOR
- Correct routing for CTF
- Empty input returns empty
- Multiple skills matched
- etc.

---

### 4C. Full Skill Library (21 Skills)

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **Files** | 21 skill files + reference docs under `src/skills/` |
| **Depends on** | 4A |
| **Blocks** | Nothing |

**Directory structure:**
```
src/skills/
  core/
    pentest-flow.md
    recon.md
    vuln-discovery.md
    exploitation.md
    post-exploitation.md
    reporting.md
    waf-bypass.md
  specialized/
    authorization.md          (enhance existing)
    business-logic.md         (enhance existing)
    information-disclosure.md (enhance existing)
    race-conditions.md        (enhance existing)
    web-pentest.md            (NEW)
    web-security-advanced.md  (NEW)
    crypto-toolkit.md         (NEW)
    ctf-web.md                (NEW)
    ctf-crypto.md             (NEW)
    ctf-misc.md               (NEW)
    osint-recon.md            (NEW)
    ai-mcp-security.md        (NEW)
    intranet-pentest.md       (NEW)
    pentest-tools.md          (NEW)
    refs/
      web-pentest/
        api-testing.md
        form-injection.md
        csrf-testing.md
        file-upload.md
      web-security-advanced/
        sqli-advanced.md
        xss-advanced.md
        ssrf-advanced.md
        rce-advanced.md
        ... (34 reference docs total)
      ctf-web/
        php-bypass.md
        rce-techniques.md
        ssti.md
        deserialization.md
        ... (9 reference docs)
      ... (all specialized skill refs)
```

**All content in English.** Adapted from VulnClaw's Chinese skills, properly structured.

---

## Phase 5: Graph Schema Extensions

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **File** | `src/graph/schema.ts` (modify) |
| **Test** | `test/graph/store.test.ts` (extend) |
| **Depends on** | 2A |
| **Blocks** | 6 |

**New node types:**
```typescript
NodeType.FACT = 'Fact'         // Confirmed truth from solver engine
NodeType.INTENT = 'Intent'     // Exploration direction from solver
NodeType.REFLEXION = 'Reflexion' // Failure pattern record (persisted)
```

**New edge types:**
```typescript
EdgeType.BUILT_ON = 'BUILT_ON'         // Intent built on Fact(s)
EdgeType.PRODUCED_BY = 'PRODUCED_BY'   // Intent produced Fact
```

---

## Phase 6: Reflexion Persistence

| Field | Detail |
|-------|--------|
| **Priority** | P1 |
| **Status** | NOT STARTED |
| **File** | `src/intelligence/reflexion-store.ts` (NEW) |
| **Test** | `test/intelligence/reflexion-store.test.ts` (NEW) |
| **Depends on** | 1B, 5 |
| **Blocks** | Nothing |

**What it does:**
- Saves ReflexionState to graph as ReflexionNode after each session
- Loads relevant past reflexion hints for a given vuln type
- Enables cross-session learning: "Last time SQLi failed due to WAF, try bypass"

**API:**
```typescript
export function saveReflexionState(graphStore, workerId, state): void
export function loadReflexionState(graphStore, workerId): ReflexionState | null
export function getRelevantHints(graphStore, vulnType): string[]
```

**Test coverage (~6 tests):**
- Saves state correctly
- Loads state correctly
- Returns null for missing state
- Gets relevant hints by vuln type
- etc.

---

## Phase 7: New Tools

### 7A. Load Reference Tool

| Field | Detail |
|-------|--------|
| **Priority** | P2 |
| **Status** | NOT STARTED |
| **File** | `src/tools/skill-tools.ts` (NEW) |
| **Test** | `test/tools/skill-tools.test.ts` (NEW) |
| **Depends on** | 4A |
| **Blocks** | Nothing |

**API:**
```typescript
export const loadSkillReference = createTool({
  id: 'loadSkillReference',
  description: 'Load a specific reference document from a skill for detailed methodology.',
  inputSchema: z.object({
    skillId: z.string(),
    referenceId: z.string(),
  }),
})
```

**Test coverage (~5 tests):**
- Loads existing reference
- Returns error for missing reference
- etc.

---

### 7B. Encode/Decode Tool

| Field | Detail |
|-------|--------|
| **Priority** | P2 |
| **Status** | NOT STARTED |
| **File** | `src/tools/encode-decode.ts` (NEW) |
| **Test** | `test/tools/encode-decode.test.ts` (NEW) |
| **Depends on** | Nothing (parallel) |
| **Blocks** | Nothing |

**Operations:** base64, hex, URL, HTML, JWT decode, auto-decode

**Test coverage (~10 tests):**
- Base64 encode/decode round-trip
- URL encode/decode
- JWT decode
- Auto-decode detects format
- etc.

---

## Phase 8: Config & CLI Updates

| Field | Detail |
|-------|--------|
| **Priority** | P2 |
| **Status** | NOT STARTED |
| **Files** | `src/config.ts`, `src/cli/index.ts` |
| **Test** | `test/config/config.test.ts` (extend) |
| **Depends on** | 2C |
| **Blocks** | Nothing |

**Changes:**
- Config schema gets `engine`, `solver`, `antiLoop`, `reflexion`, `skills` blocks
- CLI gets `ultimatrix solve -t <url>` command
- `ultimatrix scan` respects `engine` config
- `ultimatrix interact` routes to selected engine

---

## Dependency Graph

```
Phase 1A ──────────────────────────────────────┐
Phase 1B ──────────────────────────────────────┤
Phase 1C ──────────────────────────────────────┤
Phase 1E ──────────────────────────────────────┤
Phase 2A ──────────────────────────────────────┤
Phase 3A ──────────────────────────────────────┤  (all parallel)
Phase 4A ──────────────────────────────────────┤
Phase 7B ──────────────────────────────────────┘
                │
                ▼
Phase 1D (needs 1A) ──────────────────────────┐
Phase 2B (needs 1A,1B,1C,2A) ─────────────────┤
Phase 4B (needs 4A) ──────────────────────────┤  (parallel batch 2)
Phase 5  (needs 2A) ──────────────────────────┘
                │
                ▼
Phase 2C (needs 2B) ──────────────────────────┐
Phase 3B (needs 1A,1C,3A) ────────────────────┤  (parallel batch 3)
Phase 3C (needs 1A,1B,1C,3A) ─────────────────┤
Phase 4C (needs 4A) ──────────────────────────┤
Phase 6  (needs 1B,5) ────────────────────────┤
Phase 7A (needs 4A) ──────────────────────────┘
                │
                ▼
Phase 8 (needs 2C) ─────────────────────────── LAST
```

---

## Implementation Order

| Batch | Phases | Description | Parallel? |
|-------|--------|-------------|-----------|
| **1** | 1A, 1B, 1C, 1E, 2A, 3A, 4A, 7B | Foundation — no dependencies | YES |
| **2** | 1D, 2B, 4B, 5 | Depends on batch 1 | YES |
| **3** | 2C, 3B, 3C, 4C, 6, 7A | Depends on batch 2 | YES |
| **4** | 8 | Depends on batch 3 | NO |

---

## Test Estimate

| Phase | New Tests |
|-------|-----------|
| 1A | ~15 |
| 1B | ~20 |
| 1C | ~12 |
| 1D | ~10 |
| 1E | ~5 |
| 2A | ~18 |
| 2B | ~15 |
| 2C | ~8 |
| 3A | ~5 |
| 4A | ~10 |
| 4B | ~10 |
| 5 | ~8 |
| 6 | ~6 |
| 7A | ~5 |
| 7B | ~10 |
| 8 | ~5 |
| **Total** | **~162 new tests** |

**Estimated total after:** 483 existing + ~162 new = **~645 tests across ~50 files**

---

## Files Created/Modified Summary

### New Files (~30)
- `src/intelligence/evidence-gate.ts`
- `src/intelligence/reflexion.ts`
- `src/intelligence/anti-loop.ts`
- `src/intelligence/reflexion-store.ts`
- `src/solver/blackboard.ts`
- `src/solver/solver.ts`
- `src/prompts/core-contract.ts`
- `src/skills/loader.ts`
- `src/skills/registry.ts`
- `src/skills/dispatcher.ts`
- `src/tools/skill-tools.ts`
- `src/tools/encode-decode.ts`
- `src/skills/core/*.md` (7 files)
- `src/skills/specialized/*.md` (14 files)
- `src/skills/specialized/refs/**/*.md` (~100 reference docs)
- Test files (~16 files)

### Modified Files (~10)
- `src/config.ts` — engine, solver, antiLoop, reflexion, skills config
- `src/session.ts` — engine routing
- `src/cli/index.ts` — `solve` command
- `src/graph/schema.ts` — Fact, Intent, Reflexion node types
- `src/tools/control-tools.ts` — Finding lifecycle
- `src/manager/instructions.ts` — Core contract, anti-hallucination
- `src/workers/instructions/*.ts` — All 4 worker files enhanced
- `src/mastra/tools.ts` — Register new tools
- `test/config/config.test.ts` — Extended tests
- `test/graph/store.test.ts` — Extended tests
