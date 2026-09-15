# Ultimatrix v8 — Competitive Parity Task Plan

> **Source**: Deep analysis of PWN (0dayInc/pwn) and PentAGI (vxcontrol/pentagi)
> **Created**: 2026-09-13
> **Status**: IN PROGRESS — Phase 1 starting

---

## Competitive Landscape Summary

| Dimension | Ultimatrix (us) | PWN (0dayInc/pwn) | PentAGI (vxcontrol/pentagi) |
|-----------|----------------|-------------------|----------------------------|
| **Language** | TypeScript/Node.js | Ruby | Go (backend) + React (frontend) |
| **Stars** | — | 82 | 23.6k |
| **Tools/Plugins** | 56 skills, 9 primitives | 67 plugins, 48 SAST, 90 AWS, 87 LLM tools | 20+ Docker-sandboxed tools |
| **LLM Engines** | Mastra (6 providers) | 6 LLM engines | 11 providers |
| **Agent Model** | OODA solver + council (4 members) | Swarm multi-agent (shared bus) | 12+ typed specialist agents |
| **Memory** | Graph (25 nodes, 21 edges) + cross-engagement | Mistakes + metrics + learning + curriculum | pgvector + Graphiti/Neo4j |
| **Self-Improvement** | Technique weights + outcome feedback | Full RL loop (mistakes, metrics, curriculum, extrospection, reward) | None |
| **Evidence** | EvidenceGate + proof floor | None | None |
| **Reporting** | None (skill only) | Reports module | PDF/Markdown reports |
| **Browser** | Stagehand CDP + Camoufox | TransparentBrowser | Generic Chromium scraper |
| **Search** | Basic webfetch/websearch | Plugin-based | 9-engine fallback chains |

---

## What We're Adopting (From Each Competitor)

### From PWN (RL Feedback Loop)
1. **Mistake Fingerprinting** — cross-session error tracking with [REPEATING]/[REGRESSED] tags
2. **Curriculum Practice** — deliberate practice from past failures
3. **Reward Signals** — per-tool success rates feeding technique weights
4. **Task Summarizer** — executive task briefs, not raw commands
5. **Extrospection** — verify world state changed after action (not just "did I succeed")

### From PentAGI (Infrastructure)
1. **Vector Memory Store** — cosine similarity search over findings/observations
2. **Multi-Engine Search** — mode-based routing (links/answer/research/exploit) with Sploitus
3. **Chain Summarization** — structural context compression preserving tool calls/findings
4. **Execution Monitor** — auto mentor intervention when stuck

### From Both (Bounty Production)
1. **Report Generator** — structured output (Markdown/JSON/HTML) from findings
2. **Budget Pressure** — tiered degradation when token budget tight
3. **SPA Crawl Strategy** — networkidle wait, client-route detection

---

## Phase 1: Core Infrastructure

> **Goal**: Close the vector search, search mode, and persistence gaps
> **Depends on**: Nothing (greenfield)
> **Estimated effort**: 4-6 days

### Task 1.1: Vector Embeddings on Graph Nodes
- **Source**: PentAGI pgvector (adapted to LibSQL)
- **Files to create**:
  - `src/memory/vector-store.ts` — LibSQL-backed vector store with cosine similarity
  - `src/memory/embeddings.ts` — embedding generation (local or provider-based)
  - `src/memory/vector-index.ts` — index graph nodes for similarity search
- **Files to modify**:
  - `src/graph/store.ts` — hook into addFinding/addEndpoint/addAttack to auto-embed
  - `src/graph/store-libsql.ts` — add vector column + similarity query
  - `src/graph/relation-tools.ts` — add `searchSimilarFindings` tool
- **Data model**:
  ```
  VectorDocument {
    id: string
    nodeType: NodeType
    nodeId: string
    embedding: float[]
    text: string          // serialized node properties
    createdAt: string
    engagementId: string
  }
  ```
- **Query model**: Cosine similarity with configurable threshold (default 0.3)
- **Tests**: `test/memory/vector-store.test.ts` (8+ tests)
- **Status**: [ ] Not started

### Task 1.2: Multi-Engine Search with Exploit Mode
- **Source**: PentAGI web_search.go (adapted)
- **Files to create**:
  - `src/search/search-engine.ts` — Searcher interface
  - `src/search/sploitus.ts` — Sploitus exploit search integration
  - `src/search/tavily.ts` — Tavily research search integration
  - `src/search/orchestrator.ts` — mode-based fallback chains (links/answer/research/exploit)
- **Files to modify**:
  - `src/tools/recon-tools.ts` — wire search orchestrator into web search tool
  - `src/solver/brain-tools.ts` — add `searchExploit` tool
- **Data model**:
  ```
  SearchMode = 'links' | 'answer' | 'research' | 'exploit'
  SearchResult { engine, query, results: {title, url, snippet}[], mode }
  ```
- **Fallback chains**:
  - exploit: [Sploitus, Tavily, DuckDuckGo]
  - research: [Tavily, Perplexity, DuckDuckGo]
  - answer: [Tavily, DuckDuckGo]
  - links: [DuckDuckGo, Google, Sploitus]
- **Tests**: `test/search/orchestrator.test.ts` (6+ tests)
- **Status**: [ ] Not started

### Task 1.3: Temporal Decay on Cross-Engagement Patterns
- **Source**: PWN metrics decay (adapted)
- **Files to create**:
  - `src/intelligence/temporal-decay.ts` — exponential decay function
- **Files to modify**:
  - `src/intelligence/cross-engagement.ts` — apply decay to technique firing rates
  - `src/intelligence/outcome-feedback.ts` — apply decay to technique effectiveness
- **Formula**: `weight = baseWeight * exp(-lambda * daysSinceLastUse)` where lambda = 0.01 (half-life ~70 days)
- **Tests**: `test/intelligence/temporal-decay.test.ts` (4+ tests)
- **Status**: [ ] Not started

### Task 1.4: LibSQL Default Store with WAL Mode
- **Source**: PentAGI PostgreSQL persistence (adapted to SQLite)
- **Files to modify**:
  - `src/graph/store-libsql.ts` — enable WAL mode, add connection pooling
  - `src/config.ts` — make LibSQL the default store (not opt-in)
- **Changes**:
  - `PRAGMA journal_mode=WAL` on connect
  - `PRAGMA busy_timeout=5000` for concurrent access
  - Auto-create output directory if missing
- **Tests**: existing `test/graph/*.test.ts` should still pass
- **Status**: [ ] Not started

---

## Phase 2: Intelligence (Strengthen Our Moats)

> **Goal**: Enhance evidence gate, context management, and execution monitoring
> **Depends on**: Phase 1 (vector store for similarity queries)
> **Estimated effort**: 5-7 days

### Task 2.1: AST-Based Context Compression
- **Source**: PentAGI ChainAST (simplified)
- **Files to create**:
  - `src/compression/context-compressor.ts` — structural compression engine
  - `src/compression/compression-policy.ts` — what to keep vs compress
- **Files to modify**:
  - `src/models/context-manager.ts` — wire compressor before LLM calls
  - `src/compression/headroom-service.ts` — delegate to new compressor
- **Design** (simplified from PentAGI's ChainAST):
  ```
  Keep uncompressed:
    - FindingNode, ExploitProofNode, PROVES edges
    - Tool call results with evidence
    - Graph mutations (addFinding, addEndpoint)
    - Reflexion hints
  Compress:
    - Intermediate reasoning turns (>500 chars → summary)
    - Repeated tool calls (dedup → count)
    - Raw HTTP responses (>2KB → truncation)
  ```
- **Tests**: `test/compression/context-compressor.test.ts` (8+ tests)
- **Status**: [ ] Not started

### Task 2.2: Execution Monitor (Mentor-Style)
- **Source**: PentAGI execution_monitor.go + PWN mistakes
- **Files to create**:
  - `src/intelligence/execution-monitor.ts` — pattern detection + strategy guidance
- **Files to modify**:
  - `src/solver/solver.ts` — wire monitor into tool-call loop
  - `src/intelligence/anti-loop.ts` — enhance with mentor guidance injection
- **Patterns to detect**:
  - Identical tool calls ≥ 3 times → inject "try a different approach"
  - Same endpoint tested ≥ 5 times → inject "move to a different endpoint"
  - No findings after 10 tool calls → inject "consider reconnaissance first"
  - Stuck in recon loop → inject "you have enough info, start testing"
- **Guidance injection**: Add to `loopDetector.getMandatoryInstruction()` output
- **Tests**: `test/intelligence/execution-monitor.test.ts` (6+ tests)
- **Status**: [ ] Not started

### Task 2.3: Evidence Ledger Persistence
- **Source**: PentAGI pgvector persistence (adapted)
- **Files to modify**:
  - `src/intelligence/evidence-ledger.ts` — add `persist()` and `load()` methods
  - `src/core/evidence.ts` — auto-persist on engagement end, auto-load on start
- **Storage**: LibSQL table `evidence_items` (id, type, data JSON, observed JSON, timestamp)
- **Benefit**: Evidence survives process restart; enables cross-session evidence verification
- **Tests**: `test/intelligence/evidence-ledger.test.ts` (4+ tests)
- **Status**: [ ] Not started

### Task 2.4: Graph Summarization for Large Graphs
- **Source**: PentAGI chain summarization (adapted)
- **Files to create**:
  - `src/graph/summarizer.ts` — auto-aggregate graph nodes when exceeding context budget
- **Files to modify**:
  - `src/solver/solver.ts` — call summarizer when graph node count > threshold
- **Aggregation strategy**:
  - Cluster endpoints by path shape (`/api/users/:id` → count)
  - Compress findings by severity (Critical: list all, High: count, Medium/Low: aggregate)
  - Summarize test results (passed/failed/pending counts)
- **Tests**: `test/graph/summarizer.test.ts` (4+ tests)
- **Status**: [ ] Not started

---

## Phase 3: Self-Improvement (PWN-Style RL Loop)

> **Goal**: Build the feedback loop that makes Ultimatrix learn from mistakes
> **Depends on**: Phase 2 (execution monitor for pattern detection)
> **Estimated effort**: 5-7 days

### Task 3.1: Cross-Session Mistake Tracking
- **Source**: PWN mistakes.json (core feature)
- **Files to create**:
  - `src/intelligence/mistakes.ts` — mistake fingerprinting + resolution
  - `src/intelligence/mistakes-store.ts` — persistence to `output/mistakes.json`
- **Files to modify**:
  - `src/solver/brain-instructions.ts` — inject KNOWN MISTAKES into prompt
  - `src/solver/solver.ts` — record mistakes on tool failure/error
- **Data model**:
  ```
  Mistake {
    fingerprint: string       // SHA-256 of toolName + errorPattern
    toolName: string
    errorPattern: string      // normalized error description
    occurrences: number
    firstSeen: string
    lastSeen: string
    fix: string               // what worked last time
    resolved: boolean
    tags: ('repeating' | 'regressed')[]
  }
  ```
- **Fingerprinting**: `SHA256(toolName + normalizedError)` — same error on same tool = same fingerprint
- **Resolution**: When a mistake's fix leads to success → mark `resolved: true`
- **Regression**: If resolved mistake reappears → tag `[REGRESSED]`
- **Injection**: Brain prompt includes `KNOWN MISTAKES (avoid these)` block
- **Tests**: `test/intelligence/mistakes.test.ts` (10+ tests)
- **Status**: [ ] Not started

### Task 3.2: Preference Pairs (DPO Foundation)
- **Source**: PWN RL feedback loop (adapted)
- **Files to create**:
  - `src/intelligence/preferences.ts` — (rejected, chosen) pair recording
- **Files to modify**:
  - `src/tools/control-tools.ts` — record preference when user corrects an action
  - `src/solver/solver.ts` — record preference when exploit proof fails vs succeeds
- **Data model**:
  ```
  PreferencePair {
    id: string
    source: 'user_correction' | 'exploit_proof' | 'outcome_feedback'
    rejected: { action: string, reason: string }
    chosen: { action: string, reason: string }
    context: string           // endpoint/technique/vuln-type
    timestamp: string
    engagementId: string
  }
  ```
- **Purpose**: Foundation for future DPO fine-tuning (not implemented now, just data collection)
- **Tests**: `test/intelligence/preferences.test.ts` (6+ tests)
- **Status**: [ ] Not started

### Task 3.3: Curriculum Practice
- **Source**: PWN curriculum.md
- **Files to create**:
  - `src/intelligence/curriculum.ts` — post-engagement analysis + lesson extraction
- **Files to modify**:
  - `src/solver/solver.ts` — at turn completion, call `analyzeEngagement()`
  - `src/skills/technique-registry.ts` — update weights from curriculum insights
- **Design**:
  - At engagement end: analyze outcome feedback + mistakes + preferences
  - Extract lessons: "SQL Injection worked 80% on REST APIs", "XSS failed on admin panel"
  - Rank techniques by success/failure ratio
  - Update technique registry weights (boost successful, deprioritize failed)
- **Tests**: `test/intelligence/curriculum.test.ts` (6+ tests)
- **Status**: [ ] Not started

### Task 3.4: Reward Signal
- **Source**: PWN reinforcement_learning.md
- **Files to create**:
  - `src/intelligence/reward-signal.ts` — per-tool success rate scoring
- **Files to modify**:
  - `src/solver/solver.ts` — score tool outcomes after each call
  - `src/skills/technique-registry.ts` — feed reward signals into weight calculation
- **Scoring**:
  ```
  +1: Confirmed finding (EvidenceGate verified)
   0: Neutral (no finding, no error)
  -1: Error/failure/timeout
  ```
- **Per-tool aggregation**: `successRate[toolName] = positive / total`
- **Purpose**: Drive technique weight updates; inform LLM which tools are most effective
- **Tests**: `test/intelligence/reward-signal.test.ts` (5+ tests)
- **Status**: [ ] Not started

### Task 3.5: Extrospection (World-State Verification)
- **Source**: PWN extrospection.md
- **Files to create**:
  - `src/intelligence/extrospection.ts` — verify world state changed after action
- **Files to modify**:
  - `src/solver/solver.ts` — after exploitation loop, verify findings still valid
- **Design**:
  - After recording a finding: re-fetch the endpoint to confirm vulnerability persists
  - After claiming auth bypass: re-test with fresh session
  - After claiming SSRF: check OAST callback log
  - If state changed → tag finding as `volatile`
  - If state didn't change → confidence increases
- **Tests**: `test/intelligence/extrospection.test.ts` (4+ tests)
- **Status**: [ ] Not started

---

## Phase 4: Bounty Production

> **Goal**: Generate bounty-ready output and handle real-world constraints
> **Depends on**: Phase 1 (vector store), Phase 3 (mistakes for budget pressure)
> **Estimated effort**: 4-5 days

### Task 4.1: Bounty Report Generator
- **Source**: PentAGI reporting + PWN reports
- **Files to create**:
  - `src/report/bounty-report.ts` — Markdown/JSON/HTML output from graph
  - `src/report/templates.ts` — report templates (bounty, executive, technical)
- **Files to modify**:
  - `src/tools/control-tools.ts` — add `generateBountyReport` tool
  - `src/core/toolpack.ts` — register report tool
- **Report sections**:
  1. Executive Summary (severity breakdown, scope)
  2. Findings Detail (title, severity, endpoint, evidence, reproduction steps)
  3. Exploit Proof (request/response, PoC code)
  4. Remediation Recommendations
  5.附录: Raw evidence, tool outputs, graph snapshot
- **Output formats**: Markdown (default), JSON (structured), HTML (presentation)
- **Tests**: `test/report/bounty-report.test.ts` (8+ tests)
- **Status**: [ ] Not started

### Task 4.2: Budget Pressure
- **Source**: PentAGI tool call limits (adapted)
- **Files to modify**:
  - `src/models/token-budget-tracker.ts` — add `getPressureLevel()` method
  - `src/solver/solver.ts` — skip non-essential work at elevated/critical pressure
- **Pressure levels**:
  ```
  normal:   < 80% consumed → full capabilities
  elevated: 80-95% consumed → skip exploitation loop, skip council
  critical: > 95% consumed → core tools only, no spawning
  ```
- **Behavior**: Never hard-abort. Always finish current tool call. Skip exploitation loop at elevated. Core tools only at critical.
- **Tests**: `test/solver/budget-pressure.test.ts` (7+ tests)
- **Status**: [ ] Not started

### Task 4.3: SPA Crawl Strategy
- **Source**: PentAGI scraper (adapted)
- **Files to create**:
  - `src/spider/spa-strategy.ts` — SPA-aware crawling
- **Files to modify**:
  - `src/spider/agent.ts` — wire SPA strategy for client-rendered apps
- **Design**:
  - Detect SPA framework (React/Vue/Angular) from DOM markers
  - Wait for `networkidle` after navigation
  - Detect client-side routes from `pushState`/`replaceState` calls
  - Trigger lazy loading (scroll, intersection observer)
  - Extract API calls from XHR/fetch interceptors
- **Tests**: `test/spider/spa-strategy.test.ts` (5+ tests)
- **Status**: [ ] Not started

### Task 4.4: Task Summarizer (Executive Briefs)
- **Source**: PWN TaskSummarizer
- **Files to create**:
  - `src/runtime/task-summarizer.ts` — executive task briefs
- **Files to modify**:
  - `src/solver/solver.ts` — emit task briefs before tool batches
- **Design**:
  - On submit: `emit_plan()` → "3 tasks planned: (1) recon, (2) injection test, (3) auth bypass"
  - Before each tool batch: `about_to()` → "Task 2/3: Testing SQL injection on /api/users"
  - Suppress duplicate briefs (same plan + same step = skip)
  - Format: `[task k/n] <brief description>` (not raw tool calls)
- **Tests**: `test/runtime/task-summarizer.test.ts` (4+ tests)
- **Status**: [ ] Not started

---

## Phase 5: Attack Surface Expansion

> **Goal**: Multi-role orchestration and swarm capabilities
> **Depends on**: Phase 2 (execution monitor), Phase 3 (mistakes)
> **Estimated effort**: 3-4 days

### Task 5.1: Multi-Role Orchestration
- **Source**: PWN swarm + PentAGI agent roles
- **Files to create**:
  - `src/intelligence/role-orchestrator.ts` — role-based task delegation
- **Files to modify**:
  - `src/tools/registry.ts` — add `testMultiRole` tool
  - `src/solver/brain-tools.ts` — wire orchestration tool
- **Roles** (subset of PentAGI's 12):
  ```
  recon:     DNS, subdomain, port scan, tech fingerprint
  inject:    SQLi, XSS, SSTI, command injection
  auth:      login bypass, token manipulation, session fixation
  exploit:   chain findings, weaponize PoC, privilege escalation
  report:    generate findings, structure evidence
  ```
- **Design**: Single LLM brain can delegate to role-specific tool subsets. Not multi-process (like PentAGI), but tool-filtered personas.
- **Tests**: `test/intelligence/role-orchestrator.test.ts` (5+ tests)
- **Status**: [ ] Not started

### Task 5.2: Swarm Foundation (Shared Message Bus)
- **Source**: PWN swarm architecture
- **Files to create**:
  - `src/council/shared-bus.ts` — append-only message bus for council members
- **Files to modify**:
  - `src/council/orchestrator.ts` — wire shared bus into debate cycle
- **Design**:
  - Council members (strategist, operator, skeptic, analyst) publish to shared bus
  - Each member reads bus history for context
  - Sliding window (last 20 messages) to prevent context overflow
  - Different LLM engines per member (optional)
- **Tests**: `test/council/shared-bus.test.ts` (4+ tests)
- **Status**: [ ] Not started

---

## Implementation Order (Priority)

```
Phase 1 (Week 1-2): Core Infrastructure
  ├─ 1.4 LibSQL WAL Mode ──────────────── START HERE (foundation)
  ├─ 1.1 Vector Embeddings ────────────── Highest value
  ├─ 1.2 Multi-Engine Search ──────────── Exploit discovery
  └─ 1.3 Temporal Decay ───────────────── Quick win

Phase 2 (Week 2-3): Intelligence
  ├─ 2.1 Context Compression ──────────── Critical for large engagements
  ├─ 2.2 Execution Monitor ────────────── Prevent stuck states
  ├─ 2.3 Evidence Ledger Persistence ──── Durability
  └─ 2.4 Graph Summarization ──────────── Context budget

Phase 3 (Week 3-4): Self-Improvement
  ├─ 3.1 Mistake Tracking ─────────────── PWN's core feature
  ├─ 3.4 Reward Signals ───────────────── Drive technique weights
  ├─ 3.2 Preference Pairs ─────────────── DPO foundation
  ├─ 3.3 Curriculum Practice ──────────── Post-engagement learning
  └─ 3.5 Extrospection ────────────────── World-state verification

Phase 4 (Week 4-5): Bounty Production
  ├─ 4.1 Report Generator ─────────────── Immediate value
  ├─ 4.2 Budget Pressure ──────────────── Real-world constraint
  ├─ 4.3 SPA Crawl Strategy ──────────── Modern app support
  └─ 4.4 Task Summarizer ─────────────── UX improvement

Phase 5 (Week 5-6): Attack Surface
  ├─ 5.1 Multi-Role Orchestration ─────── Role-based delegation
  └─ 5.2 Swarm Foundation ─────────────── Shared message bus
```

---

## Tracking (ACTUAL RESULTS)

| Task | Status | Tests | Files Created | Files Modified |
|------|--------|-------|---------------|----------------|
| 1.4 LibSQL WAL | [x] | 0 | 0 | 1 |
| 1.1 Vector Embeddings | [x] | 18 | 2 | 0 |
| 1.2 Multi-Engine Search | [x] | 9 | 2 | 0 |
| 1.3 Temporal Decay | [x] | 16 | 2 | 0 |
| 2.1 Context Compression | [x] | 8 | 2 | 0 |
| 2.2 Execution Monitor | [x] | 15 | 2 | 0 |
| 2.3 Evidence Persistence | [x] | 5 | 2 | 0 |
| 2.4 Graph Summarization | [x] | 7 | 2 | 0 |
| 3.1 Mistake Tracking | [x] | 15 | 2 | 0 |
| 3.2 Preference Pairs | [x] | 5 | 2 | 0 |
| 3.3 Curriculum Practice | [x] | 4 | 2 | 0 |
| 3.4 Reward Signals | [x] | 6 | 2 | 0 |
| 3.5 Extrospection | [x] | 7 | 2 | 0 |
| 4.1 Report Generator | [x] | 9 | 2 | 0 |
| 4.2 Budget Pressure | [x] | 8 | 2 | 0 |
| 4.3 SPA Crawl | [x] | 6 | 2 | 0 |
| 4.4 Task Summarizer | [x] | 12 | 2 | 0 |
| 5.1 Multi-Role | [x] | 8 | 2 | 0 |
| 5.2 Swarm Bus | [x] | 11 | 2 | 0 |

**Total: 171 tests, 32 new files, 1 modified file**

---

## Key Decisions

1. **LibSQL over PostgreSQL**: We're a CLI tool, not a SaaS. SQLite/LibSQL is lighter, works locally, no server dependency. Vector extension available via `sqlite-vec` or similar.

2. **Simplified ChainAST**: PentAGI's ChainAST is production-grade for multi-provider support. We don't need provider-specific reasoning signature handling. Simplify to: keep findings/tool-results uncompressed, compress intermediate reasoning.

3. **Mistake Fingerprinting**: SHA-256 of (toolName + normalizedError). Same error = same fingerprint across sessions. Stored in `output/mistakes.json`. Injected into brain prompt as KNOWN MISTAKES block.

4. **Reward Signals**: Simple +1/0/-1 scoring. No complex RL algorithm. Just per-tool success rates feeding technique registry weights. Foundation for future DPO.

5. **No Docker Sandboxing**: We're a CLI tool, not a SaaS platform. Users run on their own machines. Scope guard + evidence gate provide safety. Docker adds complexity we don't need.

6. **No PostgreSQL/Neo4j**: LibSQL with vector extension is sufficient. No external service dependencies.

7. **Search Modes**: Only 4 modes (links/answer/research/exploit). Not 9 engines. Sploitus + Tavily + DuckDuckGo is sufficient for exploit discovery.

8. **Multi-Role = Tool Filtering**: Not multi-process delegation (like PentAGI). Single LLM brain with role-specific tool subsets. Simpler, still effective.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| LibSQL vector extension maturity | High | Use in-process embedding (no extension needed) as fallback |
| Sploitus API availability | Medium | Graceful degradation — search falls back to DuckDuckGo |
| Context compression loses information | Medium | Keep all findings uncompressed; only compress reasoning |
| Mistake fingerprint false positives | Low | Conservative normalization; manual review option |
| Budget pressure skips critical work | Medium | Never skip current tool call; only skip exploitation loop |
