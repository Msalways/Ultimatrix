# Ultimatrix v8 - Detailed Implementation Breakdown

## **OVERVIEW**

**Objective**: Fix all critical bugs in v8 and implement next-level features while restoring all v7 functionality.

**Timeline**: 4 Days

**Success Criteria**: All critical bugs fixed, v7 features verified, v8 next-level features implemented, 794+ tests passing.

---

## **PHASE 1: CRITICAL BUG FIXES** (Day 1)

### **1.1 Fix solverBrain Undefined Error**

**Status**: 🔴 CRITICAL - Blocks entire solver engine

**File**: `src/session.ts`

**Changes**:
1. Add imports (line ~20):
   ```typescript
   import { createAgent } from './mastra/index.js'
   import { CORE_CONTRACT } from './prompts/core-contract.js'
   ```

2. Create solver brain agent (before line 395):
   ```typescript
   const solverBrain = createAgent(config, {
     skillRegistry,
     workerPool,
     browser,
     memory
   })
   solverBrain.id = 'ultimatrix-solver-brain'
   solverBrain.name = 'Ultimatrix Organic Solver'
   solverBrain.instructions = BRAIN_INSTRUCTIONS
   ```

3. Fix solve call (remove `!`):
   ```typescript
   const result = await solve(solverBrain, {  // Remove !
     origin: target,
     goal: line,
     tools: sanitizedBrainTools,
     // ...
   })
   ```

**Expected Result**: Solver engine starts, REPL accepts input

**Verification**:
- `npx ultimatrix interact -t https://httpbin.org` → REPL starts
- Type "hi" → Solver responds conversationally

---

### **1.2 Implement Mastra fullStream Streaming**

**Status**: 🟠 HIGH - Missing tool events, improper streaming

**File**: `src/solver/solver.ts`

**Changes**:

**1.2.1 Add detectPhase function** (after line 98):
```typescript
function detectPhase(toolName?: string, toolArgs?: Record<string, unknown>): SolverPhase {
  if (!toolName) return 'reason'

  const toolUpper = toolName.toUpperCase()

  // Observe tools
  if (['GETTARGETSUMMARY', 'QUERYGRAPH', 'GETENDPOINTSWITHPARAMS', 'GETFULLCONTEXT'].includes(toolUpper)) {
    return 'observe'
  }

  // Learn tools
  if (['SKILLSEARCH', 'SKILLLOAD', 'SEARCHSKILLS', 'LOADSKILLREFERENCE'].includes(toolUpper)) {
    return 'learn'
  }

  // Attack tools
  if (['SPAWNWORKER', 'SPAWNSWARM', 'EXECUTEDIRECT', 'HTTPREQUEST'].includes(toolUpper)) {
    return 'attack'
  }

  // Record tools
  if (['WRITEFINDING', 'RECORDEVIDENCE', 'UPDATEGRAPH'].includes(toolUpper)) {
    return 'record'
  }

  return 'reason'
}
```

**1.2.2 Replace textStream with fullStream** (lines 174-189):
```typescript
// Stream agent response
let fullText = ''
let toolCallsThisTurn = 0
let turnHadEvidence = false

try {
  const stream = await agent.stream(contextPrompt, {
    maxSteps: 10,
    toolChoice: 'auto'
  })

  for await (const chunk of stream.fullStream) {
    switch (chunk.type) {
      case 'text-delta':
        // User's conversational response
        fullText += chunk.payload.text
        budget.tokens += chunk.payload.text.length
        emit({ phase: 'reason', step: budget.toolCalls, text: chunk.payload.text })
        break

      case 'reasoning-delta':
        // Model's thinking process (technical)
        if (chunk.payload.text) {
          fullText += `\n[REASONING] ${chunk.payload.text}`
          budget.tokens += chunk.payload.text.length
        }
        break

      case 'tool-call':
        // Tool execution start
        if (chunk.payload.toolName && chunk.payload.toolName !== 'askUser') {
          budget.toolCalls++
          toolCallsThisTurn++

          const toolName = chunk.payload.toolName
          const toolArgs = chunk.payload.args || {}

          emit({
            phase: detectPhase(toolName, toolArgs),
            step: budget.toolCalls,
            toolName,
            toolArgs
          })
        }
        break

      case 'tool-result':
        // Tool execution complete
        if (chunk.payload.toolName) {
          const output = typeof chunk.payload.result === 'string'
            ? chunk.payload.result
            : JSON.stringify(chunk.payload.result)

          evidence.recordToolOutput(output)
          budget.tokens += output.length

          // Track attack paths
          const detectedPath = extractAttackPath(output)
          if (detectedPath) {
            loopDetector.recordAttackPath(detectedPath)
          }

          // Check if this produced meaningful evidence
          if (output.length > 100 && !output.includes('Error')) {
            turnHadEvidence = true
          }

          // Record tool call for deduplication
          if (stream.toolCalls && stream.toolCalls[toolCallsThisTurn - 1]) {
            const tc = stream.toolCalls[toolCallsThisTurn - 1]
            board.recordToolCall(
              tc.payload.toolName,
              JSON.stringify(tc.payload.args || {}).slice(0, 100),
              `turn-${budget.toolCalls}`
            )
          }
        }
        break

      case 'tool-error':
        // Tool execution failed
        if (chunk.payload.toolName) {
          log.error(`${chunk.payload.toolName} failed: ${chunk.payload.error}`)
          forensicLog.log({
            type: 'tool-error',
            agent: 'solver-brain',
            tool: chunk.payload.toolName,
            error: chunk.payload.error,
          })
        }
        break
    }
  }
} catch (err) {
  log.error(`Solver error: ${err instanceof Error ? err.message : String(err)}`)
  forensicLog.log({
    type: 'error',
    agent: 'solver-brain',
    error: String(err),
  })

  // Record error as tool output for evidence gate
  evidence.recordToolOutput(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  budget.tokens += 50

  // Continue loop, don't break on transient errors
  continue
}
```

**Expected Result**: Tool calls appear in order, errors logged, tool results captured

**Verification**:
- Manual: Type "test login" → See tool calls with arrows
- Check: Forensic log shows all solver tool calls
- Check: Errors show in console

---

### **1.3 Add Graph Persistence During Solver Runs**

**Status**: 🟠 HIGH - Risk of data loss during long runs

**Files to Modify**:
- `src/solver/solver.ts` (add onToolComplete callback)
- `src/session.ts` (call onToolComplete with graph save)

**1.3.1 Add onToolComplete to SolveParams** (solver.ts):
```typescript
export interface SolveParams {
  origin: string
  goal: string
  hints?: string[]
  config?: SolverConfig
  onPhase?: (event: PhaseEvent) => void
  onInterrupt?: (prompt: string) => Promise<string | null>
  onToolComplete?: (toolName: string, result?: unknown) => void
  tools: Record<string, any>
}
```

**1.3.2 Emit tool completion in fullStream loop** (solver.ts after line 230):
```typescript
case 'tool-result':
  // ... existing code ...
  evidence.recordToolOutput(output)
  budget.tokens += output.length

  // NEW: Emit tool completion
  params.onToolComplete?.(chunk.payload.toolName, chunk.payload.result)

  // Track attack paths...
  // Check evidence...
  // Record tool call...
  break
```

**1.3.3 Add graph save in session.ts** (before line 494):
```typescript
const result = await solve(solverBrain, {
  origin: target,
  goal: line,
  config: {
    maxToolCalls: config.solver?.maxSteps || 50,
    maxTokens: 100000,
    maxDurationMs: 300000,
    staleThreshold: config.antiLoop?.staleThreshold || 3,
    maxParallel: 1,
  },
  tools: sanitizedBrainTools,
  onPhase: (event) => {
    // ... existing onPhase code ...
  },
  onInterrupt: async (prompt: string) => {
    // ... existing onInterrupt code ...
  },
  onToolComplete: (toolName: string, result?: unknown) => {
    // Save graph after each tool execution
    workspace.getGraphStore()?.save().catch(err =>
      log.error('Graph save failed during solver: ' + String(err))
    )
  },
})
```

**Expected Result**: Graph saved after each tool execution

**Verification**:
- Manual: Run solver with 50+ tool calls
- Check: `output/<target>/graph.json` updates after each tool
- Check: No data loss if solver crashes

---

### **1.4 Add Solver Error Handling**

**Status**: 🟠 HIGH - Solver crashes silently on Mastra errors

**File**: `src/solver/solver.ts`

**Changes**:

**1.4.1 Wrap stream in Try-Catch** (line 179):
```typescript
try {
  const stream = await agent.stream(contextPrompt, {
    maxSteps: 10,
    toolChoice: 'auto'
  })

  for await (const chunk of stream.fullStream) {
    // ... existing switch statement ...
  }

} catch (err) {
  log.error(`Solver error: ${err instanceof Error ? err.message : String(err)}`)
  forensicLog.log({
    type: 'error',
    agent: 'solver-brain',
    error: String(err),
  })

  // Record error as tool output for evidence gate
  evidence.recordToolOutput(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  budget.tokens += 50

  // Continue loop, don't break on transient errors
  continue
}
```

**Expected Result**: Solver handles errors gracefully, continues to next iteration

**Verification**:
- Manual: Disconnect network → solver handles error gracefully
- Check: Forensic log shows solver errors
- Manual: Try malformed request → solver continues

---

### **1.5 Enhanced Solver Visualization**

**Status**: 🟡 MEDIUM - Tool calls don't show up nicely in REPL

**File**: `src/session.ts` (lines 406-434)

**Changes**:

**1.5.1 Improve onPhase Callback**:
```typescript
onPhase: (event) => {
  // Display text output from brain (conversational)
  if (event.text) {
    process.stdout.write(event.text)
  }

  // Display tool calls with arrows
  if (event.phase === 'attack' && event.toolName) {
    const toolStr = event.toolArgs
      ? `${event.toolName} ${JSON.stringify(event.toolArgs).slice(0, 60)}...`
      : event.toolName

    log.dim(`  → ${toolStr}`)
  }

  // Display tool results
  if (event.phase === 'complete' && event.text?.includes('✓')) {
    log.success(`✓ ${event.toolName} completed`)
  }

  // Display error
  if (event.phase === 'tool-error') {
    log.error(`✗ ${event.toolName} failed: ${event.error}`)
  }

  // Display reasoning (technical)
  if (event.phase === 'reason' && event.text?.includes('[REASONING]')) {
    log.dim(`[THOUGHT] ${event.text}`)
  }

  // Display progress
  if (event.phase === 'complete' || event.phase === 'stale' || event.phase === 'interrupt') {
    const p = event.progress
    if (p) {
      log.dim(`Progress: ${p.tested}/${p.total} tested, ${p.findings} findings, ${p.pending} pending`)
    }
  }

  // Log to forensic log
  forensicLog.log({
    type: 'solver-phase',
    agent: 'solver-brain',
    phase: event.phase,
    step: event.step,
    toolName: event.toolName,
    toolArgs: event.toolArgs,
    reason: event.reason,
    progress: event.progress,
  })
},
```

**Expected Result**: Clean, readable tool call visualization

**Verification**:
- Manual: Type "test login" → See arrow `→` next to tool names
- Manual: Check visual output is clean and readable
- Check: Errors show as red text with ✗

---

## **PHASE 2: v7 FEATURE VERIFICATION** (Day 2)

### **2.1 Verify Rate Limiting in Solver** ✓

**Status**: ✅ Already implemented

**Verification**:
1. Set `requestsPerMinute: 25` in config
2. Run solver with 30+ tool calls
3. Check: Waits for rate limit cooldown
4. Check: Log shows "Rate limited, retry X/Y in Xms"
5. Check: Forensic log shows all API calls

**Files to Check**:
- `src/models/middleware.ts`
- `src/models/rate-limiter.ts`

---

### **2.2 Verify Worker Integration** ✓

**Status**: ✅ Already implemented

**Verification**:
1. Type "test login for SQLi"
2. Check: Spider uses `spawn-worker` correctly
3. Check: Workers have skill-filtered tools
4. Check: Workers return findings to graph
5. Check: Workers respect rate limiting

**Files to Check**:
- `src/workers/pool.ts`
- `src/manager/agent.ts`
- `src/manager/tools/spawn-worker.ts`

---

### **2.3 Verify Graph Integration** ✓

**Status**: ✅ Already implemented

**Verification**:
1. Run solver, find vulnerabilities
2. Check: Findings appear in `output/<target>/graph.json`
3. Check: All endpoints, findings, actions recorded
4. Check: Graph saves after each user input
5. Check: Graph saves during solver runs (Phase 1.3)

**Files to Check**:
- `src/graph/store.ts`
- `src/session.ts` (line 494)

---

### **2.4 Verify Intelligence Layer** ✓

**Status**: ✅ Already implemented

**Verification**:
1. Test anti-loop detection
2. Check: Stale detection triggers after threshold
3. Check: Attack path declaration ([PATH: xxx])
4. Check: Evidence gate validates findings
5. Check: Reflexion provides hints after failures

**Files to Check**:
- `src/intelligence/anti-loop.ts`
- `src/intelligence/evidence-gate.ts`
- `src/intelligence/reflexion.ts`

---

## **PHASE 3: v8 NEXT-LEVEL FEATURES** (Day 3)

### **3.1 Multi-Agent Solver**

**Status**: 🚀 NEXT-LEVEL

**File**: `src/solver/multi-agent-manager.ts` (create)

**Architecture**:
```typescript
export class MultiAgentSolver {
  private brains: Map<string, Agent> = new Map()
  private queue: MultiAgentTask[] = []
  private results: MultiAgentResult[] = []

  async initialize(config: UltimatrixConfig, skillRegistry: SkillRegistry, ...) {
    // Create specialized solver brains
    this.brains.set('main', createSolverBrain(config, skillRegistry, ...))
    this.brains.set('recon', createSolverBrain(config, skillRegistry, ...))
    this.brains.set('exploit', createSolverBrain(config, skillRegistry, ...))
  }

  async submitTask(task: MultiAgentTask): Promise<void> {
    this.queue.push(task)
  }

  async runParallel(maxParallel: number = 3): Promise<MultiAgentResult[]> {
    const workers: Promise<MultiAgentResult>[] = []

    for (let i = 0; i < maxParallel; i++) {
      if (this.queue.length === 0) break

      const task = this.queue.shift()!
      workers.push(this.runAgent(task))
    }

    return Promise.all(workers)
  }

  private async runAgent(task: MultiAgentTask): Promise<MultiAgentResult> {
    const agent = this.brains.get(task.agentId)!
    const result = await solve(agent, {
      origin: task.origin,
      goal: task.goal,
      tools: task.tools,
    })
    return result
  }
}
```

**Integration** (session.ts):
```typescript
const multiAgentSolver = new MultiAgentSolver(config, skillRegistry, ...)

// Submit parallel tasks
multiAgentSolver.submitTask({
  agentId: 'main',
  goal: 'Find SQL injection vulnerabilities',
  origin: 'https://example.com',
})

// Run parallel
const results = await multiAgentSolver.runParallel(3)

results.forEach(result => {
  if (result.completed) {
    log.success(`Agent ${result.agentId} completed`)
    log.info(`Findings: ${result.facts}`)
  }
})
```

**Expected Result**: Multiple agents run in parallel, results combined

**Verification**:
- Manual: Configure multi-agent solver
- Check: Multiple agents run in parallel
- Check: Results combine in graph

---

### **3.2 Adaptive Budgeting**

**Status**: 🚀 NEXT-LEVEL

**File**: `src/solver/solver.ts`

**Changes**:

**3.2.1 Update Budget interface** (line 71):
```typescript
interface Budget {
  toolCalls: number
  tokens: number
  startTime: number
  maxToolCalls: number
  maxTokens: number
  maxDurationMs: number
  staleCycles: number
  lastToolSignature: string | null
  staleCount: number
  growthFactor: number  // NEW
}
```

**3.2.2 Update DEFAULTS** (line 53):
```typescript
const DEFAULTS: Required<SolverConfig> = {
  maxToolCalls: 50,
  maxTokens: 100000,
  maxDurationMs: 300000,
  staleThreshold: 3,
  maxParallel: 1,
  growthFactor: 1.0,  // NEW
}
```

**3.2.3 Update budget check** (line 158):
```typescript
if (budget.toolCalls >= budget.maxToolCalls * budget.growthFactor) {
  emit({ phase: 'complete', step: budget.toolCalls, reason: 'budget_reached' })
  return makeResult(false, 'budget_reached', budget, board)
}

if (budget.tokens >= budget.maxTokens * budget.growthFactor) {
  emit({ phase: 'complete', step: budget.toolCalls, reason: 'budget_reached' })
  return makeResult(false, 'budget_reached', budget, board)
}
```

**3.2.4 Track successful findings** (after line 242):
```typescript
let successfulToolCalls = 0
let promisingEndpoints = 0

// After evidence recorded:
if (turnHadEvidence) {
  successfulToolCalls++
  promisingEndpoints++
  budget.growthFactor = Math.min(budget.growthFactor + 0.1, 2.0)
}
```

**Expected Result**: Budget grows when finding vulnerabilities, auto-stops on completion

**Verification**:
- Manual: Run solver with "Find SQL injection"
- Check: Budget increases when finding vulnerabilities
- Check: Auto-stops when goal achieved

---

### **3.3 Solver Reflexion Loop**

**Status**: 🚀 NEXT-LEVEL

**File**: `src/solver/reflexion-loop.ts` (create)

**Architecture**:
```typescript
export class SolverReflexionLoop {
  private recentAttempts: SolverAttempt[] = []
  private failureCategories: Map<string, number> = new Map()

  recordAttempt(params: SolverAttempt): void {
    this.recentAttempts.push(params)

    if (!params.success) {
      const category = this.classifyFailure(params.output)
      this.failureCategories.set(category,
        (this.failureCategories.get(category) || 0) + 1
      )
    }

    if (this.recentAttempts.length > 5) {
      this.recentAttempts.shift()
    }
  }

  shouldReflect(): boolean {
    const totalFailures = Array.from(this.failureCategories.values())
      .reduce((a, b) => a + b, 0)
    return totalFailures >= 3 || this.recentAttempts.length >= 5
  }

  getReflectionHints(): string[] {
    const hints: string[] = []

    this.failureCategories.forEach((count, category) => {
      if (count >= 2) {
        hints.push(`Warning: Repeated ${category} failures. Try different technique.`)
      }
    })

    const recent = this.recentAttempts.slice(-3)
    if (recent.every(a => !a.success)) {
      hints.push('No success in recent attempts. Consider changing strategy.')
    }

    return hints
  }

  toPromptBlock(): string {
    if (!this.shouldReflect()) {
      return ''
    }

    const hints = this.getReflectionHints()
    if (hints.length === 0) {
      return ''
    }

    return `
## Solver Reflexion

Recent Analysis:
${hints.map(h => `- ${h}`).join('\n')}

Suggestion: Review your approach and consider:
1. Trying alternative attack vectors
2. Using different tool parameters
3. Asking for human guidance
`
  }

  private classifyFailure(output: string): string {
    const upper = output.toUpperCase()

    if (upper.includes('WAF') || upper.includes('403') || upper.includes('BLOCKED')) {
      return 'WAF_BLOCKED'
    }

    if (upper.includes('NO INJECTION') || upper.includes('NOT VULNERABLE')) {
      return 'NOT_VULNERABLE'
    }

    if (upper.includes('ERROR') || upper.includes('FAIL')) {
      return 'EXECUTION_ERROR'
    }

    return 'UNKNOWN'
  }
}
```

**Integration** (solver.ts):
```typescript
import { SolverReflexionLoop } from './reflexion-loop.ts'

export async function solve(agent: Agent, params: SolveParams): Promise<SolveResult> {
  // ... existing code ...

  const reflexionLoop = new SolverReflexionLoop()

  while (true) {
    // ... existing loop code ...

    // Record attempt for reflexion
    reflexionLoop.recordAttempt({
      goal: params.goal,
      output: fullText,
      success: false, // Updated after tool execution
    })

    // Check if reflection needed
    if (reflexionLoop.shouldReflect()) {
      const reflectionHints = reflexionLoop.toPromptBlock()

      if (reflectionHints) {
        log.dim(reflectionHints)

        const response = await params.onInterrupt?.(reflectionHints)
        if (response && response.trim().toLowerCase() === 'stop') {
          emit({ phase: 'interrupt', step: budget.toolCalls, reason: 'interrupted' })
          return makeResult(false, 'interrupted', budget, board)
        }
      }
    }

    // ... rest of loop ...
  }
}
```

**Expected Result**: Reflexion hints appear after repeated failures, solver asks for direction

**Verification**:
- Manual: Run solver, fail multiple times on same technique
- Check: Reflexion hints appear
- Check: Solver asks "Should I try a different technique?"

---

### **3.4 Real-Time Graph Visualization**

**Status**: 🚀 NEXT-LEVEL

**File**: `src/solver/progress-graph.ts` (create)

**Architecture**:
```typescript
export class SolverProgressGraph {
  private phases: SolverPhaseData[] = []
  private totalToolCalls: number = 0
  private toolUsage: Map<string, number> = new Map()
  private attackPaths: Set<string> = new Set()

  recordPhase(phase: SolverPhase, toolName?: string, toolArgs?: Record<string, unknown>): void {
    this.phases.push({
      phase,
      step: this.totalToolCalls,
      timestamp: Date.now(),
      toolName,
      toolArgs,
    })

    if (toolName) {
      this.toolUsage.set(toolName, (this.toolUsage.get(toolName) || 0) + 1)
    }
  }

  recordAttackPath(path: string): void {
    this.attackPaths.add(path)
  }

  getStats(): SolverProgressStats {
    const phaseCounts = this.phases.reduce((acc, p) => {
      acc[p.phase] = (acc[p.phase] || 0) + 1
      return acc
    }, {} as Record<SolverPhase, number>)

    return {
      totalPhases: this.phases.length,
      toolCalls: this.totalToolCalls,
      toolUsage: Object.fromEntries(this.toolUsage),
      attackPaths: Array.from(this.attackPaths),
      phaseDistribution: phaseCounts,
    }
  }

  generateMarkdown(): string {
    const stats = this.getStats()

    return `
## Solver Progress

**Time Elapsed**: ${Math.round((Date.now() - stats.startTime) / 1000)}s

**Phases**:
${Object.entries(stats.phaseDistribution)
  .sort((a, b) => b[1] - a[1])
  .map(([phase, count]) => `- **${phase}**: ${count}`)
  .join('\n  ')}

**Tool Usage**:
${Object.entries(stats.toolUsage)
  .sort((a, b) => b[1] - a[1])
  .map(([tool, count]) => `- ${tool}: ${count}`)
  .join('\n  ')}

**Attack Paths Declared**:
${Array.from(stats.attackPaths).join('\n  - ')}

**Status**: ${this.getStatus()}
`
  }

  private getStatus(): string {
    const latestPhase = this.phases[this.phases.length - 1]?.phase
    const consecutiveReasoning = this.phases.filter(p => p.phase === 'reason').length

    if (consecutiveReasoning > 10) {
      return 'Thinking...'
    }

    if (latestPhase === 'complete') {
      return 'Completed'
    }

    if (latestPhase === 'stale') {
      return 'Stale - Consider new technique'
    }

    return 'Active'
  }
}

interface SolverPhaseData {
  phase: SolverPhase
  step: number
  timestamp: number
  toolName?: string
  toolArgs?: Record<string, unknown>
}

interface SolverProgressStats {
  totalPhases: number
  toolCalls: number
  toolUsage: Record<string, number>
  attackPaths: string[]
  phaseDistribution: Record<SolverPhase, number>
  startTime: number
}
```

**Integration** (solver.ts):
```typescript
import { SolverProgressGraph } from './progress-graph.ts'

export async function solve(agent: Agent, params: SolveParams): Promise<SolveResult> {
  // ... existing code ...

  const progressGraph = new SolverProgressGraph()

  // In the loop:
  emit({ phase: 'observe', step: budget.toolCalls, text: 'Starting organic exploration...' })

  // ... main loop ...

  progressGraph.recordPhase('observe', undefined, undefined)
  progressGraph.recordPhase('reason', undefined, undefined)
  progressGraph.recordPhase('attack', toolName, toolArgs)
  progressGraph.recordPhase('record', undefined, undefined)

  // After loop, display progress graph
  if (params.onProgress) {
    params.onProgress(progressGraph.generateMarkdown())
  }
}
```

**Expected Result**: Real-time progress graph shows phases, tool usage, attack paths

**Verification**:
- Manual: Run solver for 50+ tool calls
- Check: Progress graph updates in real-time
- Check: Shows phase distribution
- Check: Shows tool usage
- Check: Shows attack paths
- Check: Status indicator (Active/Thinking/Completed/Stale)

---

## **PHASE 4: TESTING & VERIFICATION** (Day 4)

### **4.1 Unit Tests** ✓

**Files to Create**:
- `test/solver/multi-agent-manager.test.ts`
- `test/solver/adaptive-budgeting.test.ts`
- `test/solver/reflexion-loop.test.ts`
- `test/solver/progress-graph.test.ts`
- `test/solver/mastra-streaming.test.ts`

**Test Coverage**:
- Multi-agent task submission and execution
- Adaptive budget growth on success
- Reflexion trigger conditions
- Progress graph phase tracking
- Graph persistence during solver runs
- Mastra fullStream event handling

### **4.2 Integration Tests** ✓

**Manual Tests**:
1. `npx ultimatrix interact -t https://httpbin.org` → REPL starts, "hi" works
2. Type "test login" → See tool calls with arrows
3. Check graph saves after each user input
4. Configure rate limiting → Verify cooldown works
5. Configure multi-agent → Verify parallel execution
6. Run solver 50+ times → Verify graph persistence
7. Force error → Verify solver handles gracefully
8. Test attack paths → Verify [PATH: xxx] notation

### **4.3 Regression Tests** ✓

**Verify v7 Features Still Work**:
1. Spider crawl deduplication
2. Worker pool management
3. Rate limiting
4. Graph database persistence
5. Intelligence layer (anti-loop, evidence gate, reflexion)
6. Legacy supervisor (if still needed)

**Expected Result**: 794+ tests passing, no regression

---

## **PHASE 5: DOCUMENTATION** (Day 4)

### **5.1 Update README.md** ✓

**Add**:
- Multi-agent solver configuration
- Adaptive budgeting explanation
- Solver reflexion loop details
- Progress graph usage
- Troubleshooting common issues

### **5.2 Create CHANGELOG.md** ✓

**Entries**:
- v8.1.0 - Critical bug fixes (solverBrain, Mastra streaming)
- v8.1.1 - Graph persistence during solver runs
- v8.2.0 - Multi-agent solver
- v8.2.1 - Adaptive budgeting
- v8.3.0 - Solver reflexion loop
- v8.3.1 - Real-time graph visualization

### **5.3 Update Developer Guide** ✓

**Add**:
- Solver brain architecture
- Mastra fullStream usage
- Progress graph API
- Multi-agent setup
- Debugging tips

---

## **IMPLEMENTATION CHECKLIST**

### **Day 1 - Critical Bug Fixes** ✅
- [ ] Fix solverBrain undefined error
- [ ] Implement Mastra fullStream streaming
- [ ] Add graph persistence during solver runs
- [ ] Add solver error handling
- [ ] Enhanced solver visualization

### **Day 2 - v7 Feature Verification** ✅
- [ ] Verify rate limiting in solver
- [ ] Verify worker integration
- [ ] Verify graph integration
- [ ] Verify intelligence layer

### **Day 3 - v8 Next-Level Features** ✅
- [ ] Implement multi-agent solver
- [ ] Implement adaptive budgeting
- [ ] Implement solver reflexion loop
- [ ] Implement real-time progress graph

### **Day 4 - Testing & Documentation** ✅
- [ ] Write unit tests
- [ ] Run integration tests
- [ ] Run regression tests
- [ ] Update README.md
- [ ] Create CHANGELOG.md
- [ ] Update developer guide

---

## **SUCCESS METRICS**

✅ **Critical Bugs Fixed**:
- solverBrain undefined error resolved
- Solver uses Mastra fullStream
- Graph saves during long runs
- Errors handled gracefully

✅ **v7 Features Restored**:
- Rate limiting works in solver
- Worker integration verified
- Graph database works
- Intelligence layer active

✅ **v8 Next-Level Features**:
- Multi-agent solver functional
- Adaptive budgeting allocates resources
- Reflexion loop provides hints
- Progress graph visualizes progress

✅ **All Tests Pass**:
- 794+ tests passing
- New tests for multi-agent, adaptive, reflexion, progress graph
- No regression in v7 features

✅ **Documentation Complete**:
- README updated
- CHANGELOG created
- Developer guide complete

---

**Total Time**: 4 Days
**Total Changes**: 12 files (6 new, 6 modified)
**New Features**: 4 next-level features
**Bug Fixes**: 5 critical bugs

**READY TO START IMPLEMENTATION?**
