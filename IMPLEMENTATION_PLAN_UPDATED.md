# Ultimatrix Autonomous Security Engine — Implementation Plan

> **Status**: Living document — tasks checked off as completed with test results.

---

## Overview

Transform Ultimatrix from a chat-based tool into an **autonomous Observe→Learn→Attack engine** with:

- **File-based context** (like Octogent's tentacles) — persistent HAR + graph + traces, not shared memory
- **Swarm coordinator** (like Octogent's swarms) — parallel workers with concurrency limits
- **Skill-based delegation** (like Octogent's skills) — dynamic worker creation from technique-specific templates
- **Chain detection** — LLM-driven attack-chain reasoning across workers
- **Narrative logging** — human-readable progress updates (not just tool calls)
- **Progress dashboard** — cycle %, time remaining, findings count, confidence scores
- **Browser preview panel** — visible browser for CAPTCHAs, login flows, user intervention
- **Confidence scoring** — filter false positives before showing findings to user

---

## Architecture Principles

| Octogent Concept | Ultimatrix Adaptation | ✅ OR ❌ |
|---|---|---|
| Tentacles → durable context files | **Context Files** = HAR + graph + traces (persistent JSON) | ✅ CORRECT |
| Child terminals → parallel workers | **Swarm Coordinator** = parallel agents with concurrency limits | ✅ CORRECT |
| Tentacles → Skills | **Skills** = technique-specific worker templates with toolRefs | ✅ CORRECT |
| Parent coordinator → Swarm coordinator | **Supervisor** + **Swarm Coordinator** — hierarchical orchestration | ✅ CORRECT |
| Worktree mode → Isolated execution | **Isolated Scan Directories** — separate scans don't share memory | ✅ CORRECT |
| Channel messages → short comms | **Chain Detection** → cross-worker findings | ⚠️ FIXED: Use files for state, not channels |
| `todo.md` → Hypothesis queue | **Hypotheses** → attack plans → worker dispatch | ✅ CORRECT |

---

## File-Based Context Architecture (Like Octogent's Tentacles)

Instead of shared memory (dangerous), use **persistent context files** that all agents read/write:

```
./scans/<scanId>/
├── context/
│   ├── app-model.json          # HAR + graph + endpoints (created by spider)
│   ├── findings.json            # Current findings (updated by workers)
│   ├── hypotheses.json          # Attack hypotheses (updated by learn step)
│   ├── traces.json              # All traces (updated by tracing layer)
│   └── session.json             # Browser state (cookies, auth tokens)
├── traces/                      # HAR files per attack
│   ├── trace_001.har
│   └── trace_002.har
├── screenshots/                 # Finding screenshots
│   ├── screenshot_001.png
│   └── screenshot_002.png
└── report/
    └── ultimatrix-report.md     # Final report
```

**Why This is Better Than Shared Memory:**
- ✅ No race conditions (file system provides atomicity)
- ✅ No trust violations (workers read/write separate files)
- ✅ Debug-friendly (inspect any file to see state)
- ✅ Portable (scan can be resumed from disk)
- ✅ Version-controlled (can diff traces across cycles)

**How It Works:**
```typescript
// Spider writes app-model.json
await fs.writeJson(`./scans/${scanId}/context/app-model.json`, {
  target: { url, scope: [] },
  endpoints: [...],
  forms: [...],
  techStack: [...],
  auth: { type: 'JWT', tokenType: 'Bearer', tokenValue: '...' },
  cookies: [...],
  localStorage: {...}
})

// Worker reads app-model.json
const appModel = await fs.readJson(`./scans/${scanId}/context/app-model.json`)

// Worker writes findings.json
await fs.writeJson(`./scans/${scanId}/context/findings.json`, {
  findings: [
    { id: 'f_001', technique: 'xss', severity: 'critical', evidence: '...' },
    { id: 'f_002', technique: 'sqli', severity: 'high', evidence: '...' }
  ]
})

// LLM reads findings.json
const findings = await fs.readJson(`./scans/${scanId}/context/findings.json`)
```

---

## Unified Scan Structure

```typescript
interface Scan {
  id: string
  targetUrl: string
  startTime: Date
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed'
  cyclesCompleted: number
  totalFindings: number
  criticalFindings: number
  highFindings: number
  mediumFindings: number
  lowFindings: number
  workersActive: number
  workersCompleted: number
  exitCriteriaMet: boolean
  exitReason: string
}
```

---

## Task Table Legend

| Column | Meaning |
|--------|---------|
| **ID** | Task identifier (`PX.Y`) |
| **Task** | What to build/fix |
| **Files** | Source files to create/modify |
| **Deps** | Must-complete task IDs before this |
| **Test** | How to verify (unit test name / assertion) |
| **Status** | `⬜ Pending` / `🔄 In Progress` / `✅ Done` / `❌ Failed` |

Every task MUST have a corresponding unit test. Mark `✅ Done` only after:
1. Code compiles (`npm run lint` = 0 errors)
2. Unit test passes
3. Any existing tests still pass (`npm run test`)

---

## Hard Rule: No Bandaids, No Hacks

**Every task must be a proper implementation from scratch.** Absolutely forbidden:

- **Bandaids** — patching over a bug without fixing the root cause. If the old `AgentManager` is broken, rewrite it; don't add a wrapper.
- **Hardcoded logic** — no magic strings, no inline config, no `if (provider === 'openai')` branches. Everything configurable via `ultimatrix.yaml`.
- **Bending to old conventions** — if existing code does something wrong (e.g., duplicate tool definitions, `any` types), the fix is to **replace** it, not adapt the new code to fit the old pattern.
- **"It was there before"** — not a justification. If touching a file, clean it fully. No partial refactors.

**Test for this rule**: Before marking `✅ Done`, ask — *"Did I fix the root cause, or did I just make it work?"* If the latter, redo it properly.

---

## Phase P0: Foundation (Week 1)

**Goal**: Replace custom `AgentManager` with file-based context system. Create unified storage.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P0.1 | Create `ScanManager` — manages scan directories, creates `./scans/<scanId>/context/` structure | `src/scan-manager.ts` | None | `unit: scan-manager.test.ts` — creates directories, writes initial scan.json | ⬜ |
| P0.2 | Create `ContextWriter` — writes app-model.json (HAR + graph), findings.json, traces.json | `src/context/writer.ts` | P0.1 | `unit: context-writer.test.ts` — writes valid JSON to all context files | ⬜ |
| P0.3 | Create `ContextReader` — reads app-model.json, findings.json, traces.json | `src/context/reader.ts` | P0.1 | `unit: context-reader.test.ts` — reads all context files, validates schemas | ⬜ |
| P0.4 | Define Zod schemas for all context files: `AppModel`, `Finding`, `Hypothesis`, `Trace`, `Scan` | `src/context/schemas.ts` | None | `unit: context-schemas.test.ts` — `z.infer<>` compiles, valid/invalid test cases | ⬜ |
| P0.5 | Migrate `GraphStore` from JSON filesystem to LibSQL (for HAR + graph storage) | `src/graph/store.ts` | None | `unit: graph-store-libsql.test.ts` — CRUD nodes/edges, same API as JSON store | ⬜ |
| P0.6 | Register all tools in centralized Mastra tool registry (`createTool()` with consistent IDs) | `src/mastra/tools.ts` | None | `unit: tool-registry.test.ts` — all tool IDs resolve, no duplicates | ⬜ |
| P0.7 | Refactor `AgentManager` to use file-based context instead of shared memory | `src/lib/agent-manager.ts` | P0.1 | `unit: agent-manager-files.test.ts` — scan manager, context writer/reader work together | ⬜ |
| P0.8 | Kill all direct `new Agent(...)` calls outside `src/mastra/index.ts` — route through mastra agent map | `src/lib/agent-manager.ts`, `src/workers/factory.ts`, `src/spider/agent.ts` | P0.7 | `grep -r "new Agent(" src/ --include="*.ts"` returns only `src/mastra/index.ts` | ⬜ |
| P0.9 | Remove `AgentManager` singleton — inline into `src/mastra/index.ts` exports | `src/lib/agent-manager.ts` | P0.8 | `unit: no-singleton.test.ts` — no `static instance` in codebase | ⬜ |

---

## Phase P1: Narrative Logging (Week 1-2)

**Goal**: Every workflow step produces human-readable narrative output (not just tool calls).

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P1.1 | Create `NarrativeLogger` — formats output as narrative messages (not just tool calls) | `src/orchestrator/narrative-logger.ts` | None | `unit: narrative-logger.test.ts` — formats phase messages with emoji + details | ⬜ |
| P1.2 | Implement `observeNarrative()` — spider crawl → HAR capture → tech fingerprint → auth detection → narrative | `src/orchestrator/steps/observe.ts` | P1.1 | `int: observe-narrative.test.ts` — outputs "🕷️ SPIDER: Crawling https://target.com..." | ⬜ |
| P1.3 | Implement `learnNarrative()` — app-model reading → endpoint analysis → threat model building → narrative | `src/orchestrator/steps/learn.ts` | P1.1, P0.4 | `int: learn-narrative.test.ts` — outputs "🔍 LEARNING: Tech stack: react, node, postgresql" | ⬜ |
| P1.4 | Implement `attackNarrative()` — hypothesis selection → worker dispatch → attack execution → narrative | `src/orchestrator/steps/attack.ts` | P1.1 | `int: attack-narrative.test.ts` — outputs "⚔️ ATTACK: Testing /api/users... [10/12 endpoints tested]" | ⬜ |
| P1.5 | Implement `feedbackNarrative()` — chain detection → finding review → narrative update | `src/orchestrator/steps/feedback.ts` | P1.1 | `int: feedback-narrative.test.ts` — outputs "🔗 CHAIN DETECTED: XSS → Session Hijack..." | ⬜ |
| P1.6 | Create `NarrativeFormatter` — formats narrative messages for CLI and Web UI | `src/utils/narrative-formatter.ts` | P1.1 | `unit: narrative-formatter.test.ts` — formats for both CLI and UI | ⬜ |

**Expected Output Example:**
```
> ultimatrix "scan https://target.com"

🕷️ SPIDER: Crawling https://target.com
   Found 12 endpoints: /, /login, /api/users, /api/search, /admin
   Tech stack: react, node, postgresql
   Auth: JWT token in Authorization: Bearer header

🔍 LEARNING: Analyzing attack surface
   Reading app model... [reading 4 forms, 3 API endpoints]
   Detected: OAuth login, JWT tokens, admin panel
   Identified 8 techniques to test: xss, sqli, idor, jwt-esc, oauth-bypass, ssrf, ssti, race-condition

⚔️ ATTACK: Testing /api/users
   Attempting SQL injection on 'id' parameter...
   ✓ Injected: ' OR 1=1--
   ✓ Found: "column \"id\" does not exist"

🔗 CHAIN DETECTED: SQL Injection → Admin Access
   Can we use the database error to escalate?
   → Setting up admin panel access...

✓ Finding: Admin panel accessible via SQLi (CRITICAL)
   Evidence: Database error leaked in /api/users?id=' OR 1=1--
   Confidence: 92%
   Proof: curl -X GET 'https://target.com/api/users?id=1'' returned "column \"id\" does not exist"
```

---

## Phase P2: Progress Dashboard (Week 2)

**Goal**: Real-time progress indicators (cycle %, time remaining, findings count).

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P2.1 | Create `ProgressTracker` — tracks cycle progress, time elapsed, findings count | `src/orchestrator/progress-tracker.ts` | None | `unit: progress-tracker.test.ts` — tracks all metrics, calculates progress % | ⬜ |
| P2.2 | Create `ExitCriteriaEvaluator` — checks maxCycles, maxTotalTime, allEndpointsTested, noProgressThreshold | `src/orchestrator/exit-criteria.ts` | P0.4 | `unit: exit-criteria.test.ts` — evaluates all exit criteria, returns reason if met | ⬜ |
| P2.3 | Create `ProgressDashboard` UI component — displays progress bar, stats, exit criteria status | `src/components/progress-dashboard.tsx` | None | `int: progress-dashboard.test.ts` — renders progress bar and stats | ⬜ |
| P2.4 | Add cycle counter to narrative logging — shows "Cycle: 3/10 (30%)" | `src/orchestrator/narrative-logger.ts` | P2.1 | `int: cycle-counter.test.ts` — shows correct cycle % in narrative output | ⬜ |
| P2.5 | Add time remaining calculation — estimates time left based on progress | `src/orchestrator/progress-tracker.ts` | P2.1 | `unit: time-remaining.test.ts` — calculates accurate time remaining | ⬜ |
| P2.6 | Add findings count to progress dashboard — critical, high, medium, low counts | `src/components/progress-dashboard.tsx` | P2.3 | `int: findings-count.test.ts` — shows correct counts | ⬜ |

**Progress Dashboard Example:**
```typescript
// In autonomous-panel.tsx
<div className="progress-dashboard">
  <div className="progress-bar">
    <div className="progress-fill" style={{ width: '30%' }} />
    <span>Cycle: 3/10 (30%)</span>
  </div>
  <div className="progress-stats">
    <span>Time: 12:30 remaining</span>
    <span>Findings: 5 critical, 3 medium</span>
    <span>Workers: 2 active, 1 completed</span>
  </div>
  <div className="exit-criteria">
    <span>⏱️ Max time: 30 minutes</span>
    <span>🔄 Max cycles: 10</span>
    <span>✅ All endpoints: 12/12 tested</span>
  </div>
</div>
```

---

## Phase P3: Confidence Scoring (Week 2-3)

**Goal**: Filter false positives by scoring findings with confidence.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P3.1 | Create `ConfidenceScorer` — LLM scores findings with confidence (0-1) + rationale | `src/intelligence/confidence-scorer.ts` | None | `unit: confidence-scorer.test.ts` — outputs score + reasoning for finding | ⬜ |
| P3.2 | Create `ConfidenceEvaluator` — checks evidence quality (error messages, status codes, response size) | `src/intelligence/confidence-evaluator.ts` | P3.1 | `unit: confidence-evaluator.test.ts` — evaluates evidence quality | ⬜ |
| P3.3 | Integrate scoring into `writeFinding` tool — auto-score findings before saving | `src/tools/write-finding.ts` | P3.1 | `int: write-finding-score.test.ts` — finding includes confidence + reasoning | ⬜ |
| P3.4 | Add confidence threshold to UI — show only findings with confidence ≥ 0.8 by default | `src/components/findings-panel.tsx` | None | `int: confidence-threshold.test.ts` — filters findings correctly | ⬜ |
| P3.5 | Add confidence score badge to findings — 🔴 CRITICAL (92% confidence) | `src/components/findings-panel.tsx` | P3.4 | `int: confidence-badge.test.ts` — shows correct badge | ⬜ |

**Confidence Scoring Example:**
```typescript
// LLM returns:
{
  technique: 'sqli',
  evidence: 'Database error message leaked in response body',
  score: 0.92,
  reasoning: 'Error message is unexpected for legitimate request, response contains schema error',
  verified: true
}

// UI displays:
🔴 CRITICAL: SQL Injection in /api/users?id=1'
   Confidence: 92%
   Evidence: Database error message leaked in response body
   Reasoning: Error message is unexpected for legitimate request
```

---

## Phase P4: Browser Preview Panel (Week 3)

**Goal**: Visible browser for user intervention (CAPTCHAs, login flows).

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P4.1 | Create `BrowserManager` — manages Stagehand browser instances, handles tabs | `src/browser/manager.ts` | None | `unit: browser-manager.test.ts` — creates browser, opens tabs, closes tabs | ⬜ |
| P4.2 | Add `GET /api/browser/preview` — returns browser URL for iframe embedding | `src/app/api/browser/preview/route.ts` | P4.1 | `int: browser-preview-api.test.ts` — returns valid browser URL | ⬜ |
| P4.3 | Create `BrowserPreviewPanel` UI component — iframe with browser URL | `src/components/browser-preview.tsx` | P4.2 | `int: browser-preview.test.ts` — iframe renders correctly | ⬜ |
| P4.4 | Add browser URL to trace viewer tabs — "Browser Preview" tab | `src/components/trace-viewer.tsx` | P4.3 | `int: browser-tab.test.ts` — tab navigates to browser | ⬜ |
| P4.5 | Add "Solve CAPTCHA" button to browser preview — alerts user to solve CAPTCHA | `src/components/browser-preview.tsx` | P4.3 | `int: captcha-solve.test.ts` — button triggers alert | ⬜ |

**Browser Preview Panel Example:**
```typescript
// In trace-viewer.tsx
<Tabs defaultValue="http-trace">
  <TabsList>
    <TabsTrigger value="http-trace">HTTP Trace</TabsTrigger>
    <TabsTrigger value="browser-preview">Browser Preview</TabsTrigger>
    <TabsTrigger value="screenshots">Screenshots</TabsTrigger>
  </TabsList>

  <TabsContent value="browser-preview">
    <div className="browser-preview-container">
      <iframe
        src={browserUrl}
        className="w-full h-96 border rounded-lg"
        ref={browserRef}
        title="Browser Preview"
      />
      <div className="browser-controls">
        <Button onClick={solveCAPTCHA}>Solve CAPTCHA</Button>
        <Button onClick={closeTab}>Close Tab</Button>
      </div>
      {isCAPTCHA && (
        <Alert>
          ⚠️ CAPTCHA detected. Please solve it to continue the scan.
        </Alert>
      )}
    </div>
  </TabsContent>
</Tabs>
```

---

## Phase P5: Chain Detection (Week 2-3)

**Goal**: LLM-driven attack-chain reasoning across workers.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P5.1 | Create `ChainDetector` — detects chains from findings (XSS → session hijack → admin) | `src/intelligence/chain-detector.ts` | P0.4 | `unit: chain-detector.test.ts` — detects cross-technique chains | ⬜ |
| P5.2 | Create `ChainReasoner` — LLM generates chain description + impact analysis | `src/intelligence/chain-reasoner.ts` | P0.4 | `unit: chain-reasoner.test.ts` — outputs chain description + impact | ⬜ |
| P5.3 | Integrate chain detection into `feedbackNarrative()` — detects chains, outputs chain narrative | `src/orchestrator/steps/feedback.ts` | P5.1, P5.2 | `int: chain-narrative.test.ts` — outputs "🔗 CHAIN DETECTED: ..." | ⬜ |
| P5.4 | Add chain priority boost — chains have priority 100 (highest) | `src/intelligence/chain-prioritizer.ts` | P5.2 | `unit: chain-prioritizer.test.ts` — boosts chain attack priority | ⬜ |
| P5.5 | Add chain visualization to progress dashboard — shows active chains | `src/components/progress-dashboard.tsx` | P5.1 | `int: chain-visualization.test.ts` — shows chain count + description | ⬜ |

**Chain Detection Example:**
```typescript
// ChainDetector finds chains:
const chains = [
  {
    id: 'chain_001',
    techniques: ['xss', 'session-fixation', 'admin-access'],
    description: 'XSS in /search param can steal session cookies. Session fix on /login uses same cookie. Admin panel /admin has no auth.',
    impact: 'Attacker can: inject XSS → victim visits page → session stolen → access /admin as victim',
    severity: 'CRITICAL',
    evidence: [
      'XSS at /search?q=<script>alert(1)</script> (severity: CRITICAL)',
      'Session fixation at /login with same cookie (severity: HIGH)',
      'No auth on /admin (severity: CRITICAL)'
    ]
  }
]

// ChainReasoner generates:
{
  technique: 'chain-exploit',
  description: 'Chain detected: XSS → Session Hijack → Admin Access',
  techniques: ['xss', 'session-fixation', 'admin-access'],
  priority: 100, // Highest
  confidence: 0.9,
  reasoning: 'All three techniques confirmed. Chain is actionable.',
  estimatedEffort: 'medium',
  nextSteps: [
    '1. Inject XSS payload to steal session cookie',
    '2. Login to /admin using stolen cookie',
    '3. Confirm admin access'
  ]
}

// UI displays:
🔗 CHAIN DETECTED: XSS → Session Hijack → Admin Access

   Techniques: XSS, Session Fixation, Admin Access
   Impact: Attacker can: inject XSS → victim visits page → session stolen → access /admin as victim
   Severity: CRITICAL
   Confidence: 90%

   Next steps:
   1. Inject XSS payload to steal session cookie
   2. Login to /admin using stolen cookie
   3. Confirm admin access

   Priority: 100/100 (Highest)
```

---

## Phase P6: Tracing & Observability (Week 1-2)

**Goal**: Every attack generates a searchable trace (HAR + LLM-optimized JSON) persisted via LibSQL.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P6.1 | Create `HARCapture` — `page.route('**/*')` interceptor capturing request/response headers+body as HAR 1.2 | `src/tracing/har-capture.ts` | None | `unit: har-capture.test.ts` — capture produces valid HAR JSON with entries | ⬜ |
| P6.2 | Create `LLMTrace` builder — condensed trace: hypothesisId, technique, endpoint, request/response headers+body, wafDetected, verdict | `src/tracing/llm-trace.ts` | P6.1 | `unit: llm-trace.test.ts` — output matches LLMTrace schema | ⬜ |
| P6.3 | Create Mastra span processor — merges tool call spans + HAR → LLMTrace on span end | `src/tracing/span-processor.ts` | P6.2 | `unit: span-processor.test.ts` — span end triggers LLMTrace save | ⬜ |
| P6.4 | Extend `src/observability.ts` — register security span processor, `serviceName: 'ultimatrix'`, request context keys | `src/observability.ts` | P6.3 | `unit: observability-config.test.ts` — config includes security processor | ⬜ |
| P6.5 | Create `TraceWriter` — writes LLMTrace JSON to `./scans/<scanId>/traces/trace_*.json` | `src/tracing/trace-writer.ts` | P6.1 | `unit: trace-writer.test.ts` — writes trace to disk | ⬜ |
| P6.6 | Create `TraceReader` — reads traces from disk, returns filtered list | `src/tracing/trace-reader.ts` | P6.5 | `unit: trace-reader.test.ts` — reads traces, filters by technique/severity | ⬜ |
| P6.7 | Add `GET /api/trace/:sessionId` — returns trace list for session | `src/app/api/trace/[sessionId]/route.ts` | P6.6 | `int: trace-list-api.test.ts` — `fetch('/api/trace/ses_1')` returns trace array | ⬜ |
| P6.8 | Add `GET /api/trace/:sessionId/:traceId` — returns full trace with HAR/actions/screenshots | `src/app/api/trace/[sessionId]/[traceId]/route.ts` | P6.6 | `int: trace-detail-api.test.ts` — `fetch(...)` returns full LLMTrace JSON | ⬜ |
| P6.9 | Add `GET /api/trace/:sessionId/:traceId/har` — returns HAR file for trace | `src/app/api/trace/[sessionId]/[traceId]/har/route.ts` | P6.1 | `int: trace-har-api.test.ts` — `fetch(...)` returns HAR JSON | ⬜ |

---

## Phase P7: Skill Delegation Engine (Week 2)

**Goal**: Dynamic worker creation from skills, swarm-style parallel execution.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P7.1 | Create `SkillResolver` — maps `skillId` → `SkillCapability` (techniques, requiredTools, optionalTools, modelTier, contextRequirements) | `src/delegation/skill-resolver.ts` | None | `unit: skill-resolver.test.ts` — `resolveSkill('sql-injection')` returns capability with tools | ⬜ |
| P7.2 | Create `WorkerDelegator` — dynamic agent pool `Map<skillId, Agent>` | `src/delegation/worker-delegator.ts` | P7.1 | `unit: worker-delegator.test.ts` — spawns agent from skill, runs task | ⬜ |
| P7.3 | Create `SwarmCoordinator` — dispatches `DelegationRequest[]` with concurrency limit (3-5 workers) | `src/delegation/swarm-coordinator.ts` | P7.2 | `unit: swarm-coordinator.test.ts` — 5 workers run with ≤3 concurrency | ⬜ |
| P7.4 | Wire delegator into supervisor `spawn_worker`/`spawn_swarm` tools | `src/supervisor/tools/spawn-worker.ts`, `src/supervisor/tools/spawn-swarm.ts` | P7.3 | `int: supervisor-spawn.test.ts` — supervisor tool creates worker, executes task | ⬜ |
| P7.5 | Create `ToolContext` builder — injects required/optional tools + trace context + auth/session data per skill | `src/delegation/tool-context.ts` | P7.1 | `unit: tool-context.test.ts` — context includes all tools from SKILL.md toolRefs | ⬜ |
| P7.6 | Delete old `WorkerFactory` — no remaining imports | `src/workers/factory.ts` | P7.4 | `grep -r "WorkerFactory" src/` returns nothing | ⬜ |
| P7.7 | Delete old `WorkerPool` — no remaining imports | `src/workers/pool.ts` | P7.6 | `grep -r "WorkerPool" src/` returns nothing | ⬜ |

---

## Phase P8: Autonomous Workflow (Week 2-3)

**Goal**: Observe→Learn→Attack→Feedback workflow with narrative logging, progress, confidence scoring.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P8.1 | Create `observeStep` — incremental spider crawl + HAR capture + tech fingerprint + auth detection + narrative | `src/orchestrator/steps/observe.ts` | P0.2, P1.2, P6.1 | `int: observe-step.test.ts` — step outputs ObservationResult + narrative | ⬜ |
| P8.2 | Create `learnStep` — app-model reading + endpoint analysis + threat model building + hypotheses generation + narrative | `src/orchestrator/steps/learn.ts` | P0.4, P8.1, P5.4 | `int: learn-step.test.ts` — generates ≥3 attack hypotheses + narrative | ⬜ |
| P8.3 | Create `attackStep` — picks top N hypotheses, dispatches via SwarmCoordinator, returns AttackResult[] + narrative | `src/orchestrator/steps/attack.ts` | P7.3, P8.2, P6.5 | `int: attack-step.test.ts` — dispatches workers, results include traceId + narrative | ⬜ |
| P8.4 | Create `feedbackStep` — chain detection + finding triage + hypothesis adaptation + narrative | `src/orchestrator/steps/feedback.ts` | P5.3, P3.3, P8.3 | `int: feedback-step.test.ts` — chains detected, hypotheses re-prioritized + narrative | ⬜ |
| P8.5 | Compose workflow: `observe → learn → attack → feedback` cycle with progress tracking | `src/orchestrator/autonomous-workflow.ts` | P8.1-P8.4, P2.1 | `int: workflow-cycle.test.ts` — `createRun().start()` runs full cycle end-to-end + narrative | ⬜ |
| P8.6 | Add progress detection — 3 consecutive cycles with ≤1 finding → auto-stop "stuck" | `src/orchestrator/steps/feedback.ts` | P8.4 | `unit: progress-detection.test.ts` — workflow terminates early on no progress | ⬜ |

---

## Phase P9: Human-in-the-Loop (Week 3)

**Goal**: Workflow checkpoints with resume capability, wired to Web UI.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P9.1 | Create `POST /api/workflow/resume` — calls workflow.resume(runId, data) | `src/app/api/workflow/resume/route.ts` | P8.5 | `int: workflow-resume-api.test.ts` — `POST` resumes suspended workflow | ⬜ |
| P9.2 | Create `GET /api/workflow/checkpoint` SSE — streams checkpoint events | `src/app/api/workflow/checkpoint/route.ts` | P8.5 | `int: checkpoint-sse.test.ts` — SSE event received when workflow suspends | ⬜ |
| P9.3 | Create `CheckpointModal` — shadcn Dialog: cycle summary, findings, Continue/Stop/Focus actions | `src/components/checkpoint-modal.tsx` | P9.1, P9.2 | `int: checkpoint-modal.test.ts` — modal renders on suspend, button triggers resume API | ⬜ |
| P9.4 | Extend Activity panel — show cycle number, step name, duration, findings count | `src/components/activity-panel.tsx` | P9.2 | `int: activity-cycle.test.ts` — activity shows "Cycle 3: attack complete (5 findings)" | ⬜ |
| P9.5 | Wire auto-resume on user chat — `autoResumeSuspendedTools: true` in config | `src/lib/agent-manager.ts` | P8.5 | `int: chat-resume.test.ts` — user message during suspend resumes workflow | ⬜ |
| P9.6 | Add "Start Autonomous Scan" button — triggers workflow.run() | `src/components/chat.tsx` | P9.1 | `int: start-scan.test.ts` — button starts workflow, cycle state visible | ⬜ |

---

## Phase P10: Complete Missing Skills (Week 3-4)

**Goal**: Fill all empty skill directories so the engine has a complete attack library.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P10.1 | Write `file-upload/SKILL.md` — unrestricted upload, content-type bypass, path traversal, zip-slip. Uses `multipartUpload` | `src/skills/exploit/file-upload/SKILL.md` | None | `unit: skill-file-upload.test.ts` — skill loads, tools resolve | ⬜ |
| P10.2 | Write `graphql/SKILL.md` — introspection, batching, depth DoS, injection. Uses `graphqlIntrospect` | `src/skills/exploit/graphql/SKILL.md` | None | `unit: skill-graphql.test.ts` — skill loads, tools resolve | ⬜ |
| P10.3 | Write `oauth/SKILL.md` — CSRF on auth flow, redirect_uri bypass, token leakage, scope escalation | `src/skills/exploit/oauth/SKILL.md` | None | `unit: skill-oauth.test.ts` — skill loads, tools resolve | ⬜ |
| P10.4 | Create WebSocket tools — `wsConnect`, `wsSend`, `wsReceive`, `wsClose` | `src/tools/websocket-tools.ts` | None | `unit: websocket-tools.test.ts` — connect/send/receive/close cycle works | ⬜ |
| P10.5 | Write `websocket/SKILL.md` — WS message injection, auth bypass, replay, DoS | `src/skills/exploit/websocket/SKILL.md` | P10.4 | `unit: skill-websocket.test.ts` — skill loads, tools resolve | ⬜ |
| P10.6 | Write `ssrf/SKILL.md` — open redirect, blind SSRF via OAST, protocol smuggling, cloud metadata | `src/skills/advanced/ssrf/SKILL.md` | None | `unit: skill-ssrf.test.ts` — skill loads, tools resolve | ⬜ |
| P10.7 | Write `api-security/SKILL.md` — BOLA, BFLA, mass assignment, rate limit bypass, GraphQL depth | `src/skills/advanced/api-security/SKILL.md` | None | `unit: skill-api-security.test.ts` — skill loads, tools resolve | ⬜ |
| P10.8 | Write `xxe/SKILL.md` — in-band XXE, blind OOB XXE, XInclude, SVG XXE | `src/skills/advanced/xxe/SKILL.md` | None | `unit: skill-xxe.test.ts` — skill loads, tools resolve | ⬜ |
| P10.9 | Write `deserialization/SKILL.md` — PHP gadget chains, Java deser, JS proto pollution, ViewState | `src/skills/advanced/deserialization/SKILL.md` | None | `unit: skill-deserialization.test.ts` — skill loads, tools resolve | ⬜ |
| P10.10 | Write `template-injection/SKILL.md` — SSTI Jinja2/Pug/Handlebars, freemarker, EL | `src/skills/advanced/template-injection/SKILL.md` | None | `unit: skill-template-injection.test.ts` — skill loads | ⬜ |
| P10.11 | Write `csp-bypass/SKILL.md` — CDN bypass, nonce bypass, dangling markup, policy misconfig | `src/skills/advanced/csp-bypass/SKILL.md` | None | `unit: skill-csp-bypass.test.ts` — skill loads | ⬜ |

---

## Phase P11: Security-Specific Engine Fixes (Week 4)

**Goal**: Address security-specific flaws — auth persistence, WAF cache, payload mutator, blind detection, evidence packaging, rate limiter.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P11.1 | Add auth session persistence — cookies/session tokens saved to scan context | `src/context/session-store.ts` | P0.2 | `unit: auth-persistence.test.ts` — restart loads same auth state | ⬜ |
| P11.2 | Create WAF fingerprint cache — `Map<string, WafProfile>` shared across workers, populated by `checkWaf` | `src/intelligence/waf-cache.ts` | None | `unit: waf-cache.test.ts` — second worker on same endpoint gets cached profile | ⬜ |
| P11.3 | Create `PayloadMutator` — fuzzing grammar with encoder chains (URL/base64/hex/unicode), mutation templates per technique | `src/intelligence/payload-mutator.ts` | None | `unit: payload-mutator.test.ts` — generates 10+ variants per base payload | ⬜ |
| P11.4 | Integrate `PayloadMutator` into attack step — each hypothesis gets mutated payloads before dispatch | `src/orchestrator/steps/attack.ts` | P8.3, P11.3 | `unit: mutated-attack.test.ts` — attack sends variant payloads | ⬜ |
| P11.5 | Add blind detection automation — auto-poll OAST per cycle, correlate callbacks to hypothesisId | `src/intelligence/blind-detector.ts` | None | `unit: blind-detector.test.ts` — OAST callback auto-correlated to trace | ⬜ |
| P11.6 | Create `EvidencePackager` — finding includes curl command, HAR entry ref, screenshot URL, Playwright repro script | `src/intelligence/evidence-packager.ts` | P6.5 | `unit: evidence-packager.test.ts` — finding JSON has all PoC fields | ⬜ |
| P11.7 | Hook `EvidencePackager` into `writeFinding` tool — auto-generates PoC on finding creation | `src/tools/write-finding.ts` | P11.6 | `unit: write-finding-evidence.test.ts` — created finding includes evidence | ⬜ |
| P11.8 | Add rate limiter to `httpRequest` tool — token bucket per endpoint, backoff on 429 | `src/tools/http-tools.ts` | None | `unit: rate-limiter.test.ts` — 10 requests to same endpoint → backoff | ⬜ |
| P11.9 | Add rate limit config — `rateLimit: { requestsPerSecond, burstSize, backoffMs }` | `src/config.ts` | P11.8 | `unit: rate-limit-config.test.ts` — config validated on load | ⬜ |
| P11.10 | Add rate limit UI — shows rate limit status, backoff countdown | `src/components/progress-dashboard.tsx` | P11.9 | `int: rate-limit-ui.test.ts` — displays rate limit status correctly | ⬜ |

---

## Phase P12: UI Integration (Week 4-5)

**Goal**: Web UI shows narrative logging, progress dashboard, confidence scores, chain detection, browser preview.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P12.1 | Create `AutonomousPanel` — start/stop scan, cycle counter, current step, findings/cycle chart, progress bar | `src/components/autonomous-panel.tsx` | P9.6, P2.3, P2.6 | `int: autonomous-panel.test.ts` — panel shows live cycle state + narrative | ⬜ |
| P12.2 | Create `TraceViewer` — tabbed: HTTP trace (HAR table), Action trace (timeline), Screenshots (gallery) | `src/components/trace-viewer.tsx` | P6.8, P6.9, P4.3 | `int: trace-viewer.test.ts` — each tab renders correct data | ⬜ |
| P12.3 | Add Trace tab to sidebar — links to `/trace/:sessionId` | `src/app/page.tsx` | P12.2 | `int: trace-tab.test.ts` — new tab navigable, content renders | ⬜ |
| P12.4 | Create `ApprovalQueue` — queues pending checkpoints from multiple cycles | `src/components/approval-queue.tsx` | P9.3 | `int: approval-queue.test.ts` — multiple checkpoints stack correctly | ⬜ |
| P12.5 | Add session export — JSON download, "Download HAR", "Download Trace" per hypothesis | `src/components/trace-viewer.tsx` | P12.2 | `int: trace-export.test.ts` — export produces downloadable file | ⬜ |
| P12.6 | Create `ScanHistory` — list past sessions with summary (findings, cycles, status) | `src/components/scan-history.tsx` | P0.1 | `int: scan-history.test.ts` — history shows last 10 sessions | ⬜ |
| P12.7 | Add `GET /api/sessions` — returns session list with summaries | `src/app/api/sessions/route.ts` | P0.1 | `int: sessions-api.test.ts` — `fetch('/api/sessions')` returns array | ⬜ |
| P12.8 | Create `ChainVisualization` — Mermaid diagram showing chains (XSS → session hijack → admin) | `src/components/chain-visualization.tsx` | P5.5 | `int: chain-visualization.test.ts` — renders Mermaid diagram | ⬜ |

---

## Phase P13: CLI Integration (Week 5)

**Goal**: `ultimatrix auto` CLI command, config validation, model fallback, proxy support, scan resume.

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| P13.1 | Create `ultimatrix auto` CLI — `-t <url>`, `--cycles N`, `--budget N`, `--headless` | `src/cli/auto.ts` | P8.5 | `unit: cli-auto.test.ts` — parses args, starts workflow | ⬜ |
| P13.2 | Add config validation — Zod schema for `ultimatrix.yaml`, descriptive error messages | `src/config.ts` | None | `unit: config-validation.test.ts` — invalid config shows line-numbered error | ⬜ |
| P13.3 | Add model fallback chain — primary → secondary → tertiary on provider failure | `src/models/registry.ts` | None | `unit: model-fallback.test.ts` — primary failure auto-fallsback | ⬜ |
| P13.4 | Add proxy/Tor support — `--proxy <url>` in config, passed to Stagehand + httpRequest | `src/config.ts`, `src/browser/manager.ts` | None | `unit: proxy-config.test.ts` — browser + HTTP route through proxy | ⬜ |
| P13.5 | Add scan resume — `ultimatrix auto --resume <sessionId>` loads last state, continues | `src/cli/auto.ts` | P0.1, P8.5 | `int: scan-resume.test.ts` — resume replays from last checkpoint | ⬜ |

---

## Cross-Cutting Technical Debt

| ID | Task | Files | Deps | Test | Status |
|----|------|-------|------|------|--------|
| T1 | Deduplicate `httpRequest` — single in `src/mastra/tools.ts`, remove from workers | `src/tools/http-tools.ts`, `src/workers/*.ts` | P7.7 | `unit: no-duplicate-tools.test.ts` — each tool defined once | ⬜ |
| T2 | Add per-skill tool timeout — `timeout: number` in `SkillCapability`, passed to tool calls | `src/delegation/skill-resolver.ts`, `src/tools/*.ts` | P7.1 | `unit: skill-timeout.test.ts` — tool respects per-skill timeout | ⬜ |
| T3 | Add worker cleanup — `AbortController` on termination, remove from activeWorkers | `src/delegation/worker-delegator.ts` | P7.3 | `unit: worker-cleanup.test.ts` — terminated worker removed from pool | ⬜ |
| T4 | Fix `any` in supervisor tools — strict Zod schemas for `skill-search`, `execute-direct`, `spawn-worker` | `src/supervisor/tools/*.ts` | P7.7 | `unit: supervisor-tool-types.test.ts` — all inputs strictly typed | ⬜ |
| T5 | Add integration test scaffold — Playwright test server + test target + workflow run | `tests/integration/` | P8.5 | `npm run test:int` runs 1 integration test | ⬜ |
| T6 | Add HAR retention — `maxHarEntries: 100` in config, cleanup on session save | `src/tracing/trace-writer.ts` | P0.1 | `unit: har-retention.test.ts` — old entries pruned at save | ⬜ |
| T7 | Add graceful browser crash — workflow catches error, logs "restarting browser", re-inits | `src/orchestrator/autonomous-workflow.ts` | P8.5 | `unit: crash-recovery.test.ts` — browser crash triggers re-init | ⬜ |
| T8 | Add error recovery — checkpoint system rollback on failure | `src/scan-manager.ts` | P0.1 | `unit: error-recovery.test.ts` — on crash, can rollback to previous checkpoint | ⬜ |

---

## Complete Dependency Map

```
P0 Phase:
  P0.1 ─┬─→ P0.2 ─→ P0.7
         ├─→ P0.4
         ├─→ P0.5 ─→ P0.6
         └─→ P0.10
  P0.3 → P0.7
  P0.9 → P7.7, T4

P1 Phase:
  P6.1 ─→ P6.2 ─→ P6.3 ─→ P6.4
  P6.5 ─→ P6.6 ─→ P6.7 ─→ P6.8 ─→ P6.9
  P6.2 ─→ T6

P2 Phase:
  P7.1 ─→ P7.2 ─→ P7.3 ─→ P7.4 ─→ P7.7
  P7.2 ─→ P7.5 ─→ P7.7
  P7.3 ─→ T2, T3

P3 Phase:
  P3.1 ─→ P3.2 ─→ P3.3 ─→ P3.4
  P3.5 ─→ P3.6 ─→ P3.7 ─→ P3.8
  P3.6 ─→ P8.1, P8.5, P9.1, P9.2, P9.5, P13.1

P4 Phase:
  P4.1 ─→ P4.3 ─→ P12.4
  P4.2 ─→ P4.3, P4.4
  P4.5 ─→ P9.6 ─→ P12.1
  P4.1 ─→ P9.1

P5 Phase:
  P5.1 ─→ P5.2 ─→ P5.4
  P5.3 ─→ P8.4

P6 Phase:
  P0.2 ─→ P11.1
  P6.2 ─→ P11.6 ─→ P11.7
  P6.3 ─→ P11.8 ─→ P11.9

P7 Phase:
  P7.1 ─→ P7.2 ─→ P7.3 ─→ P7.4 ─→ P7.7
  P7.2 ─→ P7.5

P8 Phase:
  P8.1 ─→ P8.5 ─→ P8.6
  P8.2 ─→ P8.5
  P8.3 ─→ P8.5
  P8.4 ─→ P8.5
  P8.5 ─→ P9.1, P9.2, P9.5, P13.1

P9 Phase:
  P9.1 ─→ P9.3
  P9.2 ─→ P9.3, P9.4
  P9.5 ─→ P9.6

P10 Phase:
  P10.4 ─→ P10.5
  P10.1-P10.3, P10.6-P10.11 (no deps)

P11 Phase:
  P0.2 ─→ P11.1
  P11.3 ─→ P11.4
  P11.5
  P6.5 ─→ P11.6 ─→ P11.7
  P11.8 ─→ P11.9 ─→ P11.10

P12 Phase:
  P9.6 ─→ P12.1
  P6.8 ─→ P6.9 ─→ P12.2 ─→ P12.3, P12.5
  P9.3 ─→ P12.4
  P0.1 ─→ P12.6 ─→ P12.7
  P5.5 ─→ P12.8

P13 Phase:
  P8.5 ─→ P13.1 ─→ P13.5

T1-T8:
  T1 ─→ P7.7
  T2 ─→ P7.1
  T3 ─→ P7.3
  T4 ─→ P7.7
  T5 ─→ P8.5
  T6 ─→ P0.1
  T7 ─→ P8.5
  T8 ─→ P0.1
```

---

## Execution Order (Recommended Batches)

| Batch | Tasks | Why Together |
|-------|-------|-------------|
| **Week 1** | P0.1-P0.10, P11.1, P11.2 | Foundation + file-based context + auth persistence + WAF cache |
| **Week 1-2** | P1.1-P1.6, P6.1-P6.6, P11.3, P11.8, P11.9 | Tracing start + narrative logging + payload mutator + rate limiter |
| **Week 2** | P2.1-P2.7, P5.1-P5.4, P11.4, P11.5, P11.7 | Skill delegation + chain detection + mutator integration + blind detection |
| **Week 2-3** | P3.1-P3.6, P8.1-P8.6, P11.6, P7.1-P7.5 | Workflow steps + confidence scoring + chain reasoning + swarm coordinator |
| **Week 3** | P4.1-P4.6, P9.1-P9.6, P11.10 | Browser preview + checkpoint system + chain visualization |
| **Week 3-4** | P10.1-P10.11, T1, T2, T3, T4 | Fill all skills + cleanup debt |
| **Week 4-5** | P12.1-P12.8, T5, T6, T7, T8 | UI integration + integration tests + error recovery |
| **Week 5** | P13.1-P13.5 | CLI auto command + resume + proxy support |

---

## Verification Gates

| Gate | What Passes | Tasks Required |
|------|-------------|---------------|
| **G1: Foundation** | File-based context works, scan manager, context reader/writer, no shared memory | P0.1-P0.10 |
| **G2: Tracing** | HAR capture produces valid JSON, traces persisted to disk, API returns traces | P6.1-P6.9 |
| **G3: Skill Delegation** | SkillResolver maps skillId → capability, WorkerDelegator spawns workers, SwarmCoordinator limits concurrency | P7.1-P7.7 |
| **G4: Workflow** | observe → learn → attack → feedback cycle runs end-to-end with narrative logging | P8.1-P8.6 |
| **G5: Human** | Workflow suspends at checkpoint, resume via API, UI shows checkpoint modal | P9.1-P9.6 |
| **G6: Skills** | 11 skills loadable, SkillResolver maps all techniques to skills | P10.1-P10.11 |
| **G7: Security** | Auth persists, WAF caches, PayloadMutator works, OAST auto-polls, evidence packaged, rate limiter active | P11.1-P11.10 |
| **G8: UI** | Autonomous panel, trace viewer, browser preview, approval queue, scan history, chain visualization all render | P12.1-P12.8 |
| **G9: CLI** | `ultimatrix auto -t http://test.com` runs, `--resume` continues, proxy support works | P13.1-P13.5 |
| **G10: Debt** | No `any` types in supervisor tools, no duplicate tool defs, worker cleanup verified, error recovery works | T1-T8 |

---

## Honest Product Assessment

### What's Good:
1. ✅ **File-based context** (like Octogent) is the right approach
2. ✅ **Skill-based delegation** (like Octogent) is the right abstraction
3. ✅ **Swarm coordinator** (like Octogent) is the right parallel execution model
4. ✅ **Narrative logging** makes the tool feel "alive" and human-readable
5. ✅ **Confidence scoring** filters false positives before showing to user
6. ✅ **Chain detection** makes the tool feel "intelligent"
7. ✅ **Browser preview** enables user intervention (CAPTCHAs, login flows)

### What's Still Missing:
1. ⚠️ **Chain visualization** — Mermaid diagram of chains
2. ⚠️ **Chain-first report** — Report shows chains before individual findings
3. ⚠️ **Scan history** — Ability to resume old scans
4. ⚠️ **E2E tests** — Full workflow test from CLI to Web UI
5. ⚠️ **Performance testing** — Large targets (100+ endpoints) should be fast enough

### What You're Doing Right (vs Octogent):
1. ✅ **File-based context** vs Octogent's tentacles
2. ✅ **Skill-based delegation** vs Octogent's skills
3. ✅ **Swarm parallel execution** vs Octogent's child terminals

### What You're Not Copying (And Should):
1. ❌ **Tentacles** — Use context files, not tentacle directories
2. ❌ **Channel messages** — Use files for state, not channels
3. ❌ **Worktree mode** — Use isolated scan directories, not worktrees

---

## Open Questions

1. **Should the supervisor drive the orchestrator, or the orchestrator drive the supervisor?**
   - **Recommendation**: Supervisor decides WHAT to attack, orchestrator decides HOW (parallel workers, file-based context). This matches Octogent's pattern (parent coordinates, workers execute).

2. **How does the user know when work is "done"?**
   - **Recommendation**: Exit criteria (P2.2) automatically stop the scan, plus user can manually stop with `/quit` command.

3. **Should findings be auto-saved to a report file?**
   - **Recommendation**: Yes. Auto-save `ultimatrix-report-<timestamp>.md` at end of scan, plus incremental markdown files for each cycle.

4. **Multi-target?**
   - **Recommendation**: Not for v1. One scan = one target. User starts new shell for new target.

5. **Real-time chain updates?**
   - **Recommendation**: Chains detected every cycle, updates live in trace viewer.

---

*End of Implementation Plan — Total: ~7000 LOC across 135 tasks across 13 phases.*