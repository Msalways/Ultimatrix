/**
 * Blackboard — Fact/Intent state-space + Plan model for the Solver engine.
 *
 * Models pentesting as directed search from origin (target) toward goal (flag/shell/confirmed vuln).
 *
 * - Fact:     confirmed objective truth from real tool output (exploration foothold)
 * - Intent:   declared exploration direction (not yet executed); produces a Fact on conclusion
 * - PlanTask: structured todo item (endpoint + technique + status)
 * - Plan:     ordered list of PlanTasks — the solver's roadmap
 * - Termination: goal achieved / frontier exhausted / budget reached
 *
 * Dedup: testedTasks Set tracks "endpoint|technique" combos — no repeat testing.
 *
 * Pure data structure, driven by solver.ts OODA loop.
 */

export enum IntentStatus {
  OPEN = 'open',
  EXPLORING = 'exploring',
  CONCLUDED = 'concluded',
  ABANDONED = 'abandoned',
}

export enum TaskStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  TESTED = 'tested',
  SKIPPED = 'skipped',
  BLOCKED = 'blocked',
}

export interface BoardFact {
  id: string
  description: string
  source: string
}

export interface BoardIntent {
  id: string
  fromFacts: string[]
  description: string
  status: IntentStatus
  resultFact: string | null
  note: string
}

export interface PlanTask {
  id: string
  endpoint: string
  technique: string
  priority: number
  status: TaskStatus
  resultFact: string | null
  resultNote: string
  testedKey: string
}

export interface ToolCallRecord {
  tool: string
  keyArgs: string
  intentId: string
  status: number
  note: string
}

export class Blackboard {
  origin = ''
  goal = ''
  facts: BoardFact[] = []
  intents: BoardIntent[] = []
  toolCalls: ToolCallRecord[] = []
  plan: PlanTask[] = []
  completed = false
  completeReason = ''

  private factSeq = 0
  private intentSeq = 0
  private taskSeq = 0
  private testedTasks = new Set<string>()

  constructor(data?: Partial<{ origin: string; goal: string; facts: BoardFact[]; intents: BoardIntent[]; plan: PlanTask[] }>) {
    if (data) {
      this.origin = data.origin || ''
      this.goal = data.goal || ''
      if (data.facts) this.facts = data.facts
      if (data.intents) this.intents = data.intents
      if (data.plan) {
        this.plan = data.plan
        for (const t of data.plan) {
          this.testedTasks.add(t.testedKey)
        }
      }
      this.recalcSequences()
    }
  }

  // ── Facts ────────────────────────────────────────────────────────────────

  addFact(description: string, source = ''): BoardFact {
    this.factSeq++
    const fact: BoardFact = {
      id: `f${String(this.factSeq).padStart(3, '0')}`,
      description: description.trim(),
      source,
    }
    this.facts.push(fact)
    return fact
  }

  getFact(id: string): BoardFact | undefined {
    return this.facts.find(f => f.id === id)
  }

  // ── Intents (legacy, kept for backward compat) ───────────────────────────

  addIntent(description: string, fromFacts: string[] = []): BoardIntent {
    this.intentSeq++
    const validFrom = fromFacts.filter(fid => this.getFact(fid))
    const intent: BoardIntent = {
      id: `i${String(this.intentSeq).padStart(3, '0')}`,
      fromFacts: validFrom,
      description: description.trim(),
      status: IntentStatus.OPEN,
      resultFact: null,
      note: '',
    }
    this.intents.push(intent)
    return intent
  }

  getIntent(id: string): BoardIntent | undefined {
    return this.intents.find(i => i.id === id)
  }

  openIntents(): BoardIntent[] {
    return this.intents.filter(i => i.status === IntentStatus.OPEN)
  }

  activeIntents(): BoardIntent[] {
    return this.intents.filter(i => i.status === IntentStatus.OPEN || i.status === IntentStatus.EXPLORING)
  }

  claimIntent(id: string): BoardIntent | undefined {
    const intent = this.getIntent(id)
    if (intent && intent.status === IntentStatus.OPEN) {
      intent.status = IntentStatus.EXPLORING
    }
    return intent
  }

  concludeIntent(id: string, factDescription: string, source = ''): BoardFact | null {
    const intent = this.getIntent(id)
    if (!intent) return null
    const fact = this.addFact(factDescription, source || `explore:${intent.id}`)
    intent.status = IntentStatus.CONCLUDED
    intent.resultFact = fact.id
    return fact
  }

  abandonIntent(id: string, note = ''): BoardIntent | undefined {
    const intent = this.getIntent(id)
    if (intent) {
      intent.status = IntentStatus.ABANDONED
      if (note) intent.note = note
    }
    return intent
  }

  markComplete(reason: string): void {
    this.completed = true
    this.completeReason = reason.trim()
  }

  // ── Plan (structured todo list) ──────────────────────────────────────────

  /**
   * Create a plan task. Returns the task with assigned ID.
   */
  addTask(endpoint: string, technique: string, priority: number): PlanTask {
    this.taskSeq++
    const id = `t${String(this.taskSeq).padStart(3, '0')}`
    const testedKey = this.makeTestedKey(endpoint, technique)
    const task: PlanTask = {
      id,
      endpoint,
      technique,
      priority,
      status: TaskStatus.PENDING,
      resultFact: null,
      resultNote: '',
      testedKey,
    }
    this.plan.push(task)
    return task
  }

  /**
   * Get next pending task by priority (lowest number = highest priority).
   */
  nextTask(): PlanTask | undefined {
    const pending = this.plan
      .filter(t => t.status === TaskStatus.PENDING)
      .sort((a, b) => a.priority - b.priority)
    return pending[0]
  }

  getTask(id: string): PlanTask | undefined {
    return this.plan.find(t => t.id === id)
  }

  /**
   * Mark a task as in-progress.
   */
  startTask(id: string): PlanTask | undefined {
    const task = this.getTask(id)
    if (task && task.status === TaskStatus.PENDING) {
      task.status = TaskStatus.IN_PROGRESS
    }
    return task
  }

  /**
   * Mark a task as tested (completed with a finding or observation).
   */
  completeTask(id: string, factDescription: string): PlanTask | undefined {
    const task = this.getTask(id)
    if (!task) return undefined

    task.status = TaskStatus.TESTED
    task.resultNote = factDescription

    // Create a fact from the task result
    const fact = this.addFact(factDescription, `plan:${task.id}`)
    task.resultFact = fact.id

    // Record in tested set for dedup
    this.testedTasks.add(task.testedKey)

    return task
  }

  /**
   * Mark a task as skipped (no progress, dead end, or human-directed skip).
   */
  skipTask(id: string, reason: string): PlanTask | undefined {
    const task = this.getTask(id)
    if (!task) return undefined

    task.status = TaskStatus.SKIPPED
    task.resultNote = reason

    // Still record as tested to prevent re-testing
    this.testedTasks.add(task.testedKey)

    return task
  }

  /**
   * Mark a task as blocked (WAF, rate limit, auth required, etc.).
   */
  blockTask(id: string, reason: string): PlanTask | undefined {
    const task = this.getTask(id)
    if (!task) return undefined

    task.status = TaskStatus.BLOCKED
    task.resultNote = reason
    return task
  }

  /**
   * Has this endpoint+technique combination already been tested?
   * Hard dedup guard — prevents the LLM from re-testing.
   */
  isTested(endpoint: string, technique: string): boolean {
    return this.testedTasks.has(this.makeTestedKey(endpoint, technique))
  }

  /**
   * Normalize a dedup key from endpoint + technique.
   */
  makeTestedKey(endpoint: string, technique: string): string {
    return `${endpoint.trim().toLowerCase()}|${technique.trim().toLowerCase()}`
  }

  /**
   * Summary of plan progress — for prompt injection and display.
   */
  planSummary(): string {
    if (this.plan.length === 0) return '(no plan)'
    const lines: string[] = []
    for (const t of this.plan) {
      const status = t.status === TaskStatus.IN_PROGRESS ? '...' :
        t.status === TaskStatus.TESTED ? 'done' :
        t.status === TaskStatus.SKIPPED ? 'skip' :
        t.status === TaskStatus.BLOCKED ? 'blocked' :
        'todo'
      const result = t.resultNote ? ` — ${t.resultNote}` : ''
      lines.push(`  ${t.id} [${status}] ${t.endpoint} — ${t.technique}${result}`)
    }
    return lines.join('\n')
  }

  /**
   * Count plan task statuses.
   */
  planCounts(): Record<string, number> {
    const counts: Record<string, number> = {}
    for (const t of this.plan) {
      counts[t.status] = (counts[t.status] || 0) + 1
    }
    return counts
  }

  // ── Tool calls (dedup-aware) ─────────────────────────────────────────────

  recordToolCall(tool: string, keyArgs: string, intentId = '', status = 0, note = ''): void {
    this.toolCalls.push({
      tool,
      keyArgs: keyArgs.slice(0, 200),
      intentId,
      status,
      note: note.slice(0, 120),
    })
  }

  hasCalled(tool: string, keyArgs: string): boolean {
    return this.toolCalls.some(tc => tc.tool === tool && tc.keyArgs === keyArgs.slice(0, 200))
  }

  toolCallSummary(maxLines = 40): string {
    if (this.toolCalls.length === 0) return ''
    const seen = new Map<string, string>()
    for (const tc of this.toolCalls) {
      const key = `${tc.tool}(${tc.keyArgs})`
      if (!seen.has(key)) {
        seen.set(key, `  ${tc.intentId || '-'}: ${tc.tool}(${tc.keyArgs})${tc.note ? ` -> ${tc.note}` : ''}`)
      }
    }
    const lines = [...seen.values()].slice(-maxLines)
    return lines.join('\n')
  }

  // ── Prompt graph ─────────────────────────────────────────────────────────

  toPromptGraph(): string {
    const lines = [`goal: ${this.goal || '(not set)'}`, `origin: ${this.origin || '(not set)'}`]

    lines.push('facts:')
    if (this.facts.length > 0) {
      for (const fact of this.facts) {
        const src = fact.source ? ` (${fact.source})` : ''
        lines.push(`  - ${fact.id}: ${fact.description}${src}`)
      }
    } else {
      lines.push('  (none)')
    }

    lines.push('intents:')
    if (this.intents.length > 0) {
      for (const intent of this.intents) {
        const frm = intent.fromFacts.length > 0 ? ` from=${intent.fromFacts.join(',')}` : ''
        const res = intent.resultFact ? ` -> ${intent.resultFact}` : ''
        const note = intent.note ? `  // ${intent.note}` : ''
        lines.push(`  - ${intent.id} [${intent.status}]${frm}${res}: ${intent.description}${note}`)
      }
    } else {
      lines.push('  (none)')
    }

    lines.push('plan:')
    if (this.plan.length > 0) {
      for (const t of this.plan) {
        const status = t.status === TaskStatus.IN_PROGRESS ? '...' :
          t.status === TaskStatus.TESTED ? 'done' :
          t.status === TaskStatus.SKIPPED ? 'skip' :
          t.status === TaskStatus.BLOCKED ? 'blocked' :
          'todo'
        const result = t.resultNote ? ` — ${t.resultNote}` : ''
        lines.push(`  - ${t.id} [${status}] ${t.endpoint} — ${t.technique}${result}`)
      }
    } else {
      lines.push('  (no plan created yet)')
    }

    const tcSummary = this.toolCallSummary(30)
    if (tcSummary) {
      lines.push('executed_tools (do NOT repeat these tool+args combos):')
      lines.push(tcSummary)
    }

    return lines.join('\n')
  }

  getSummary(): Record<string, unknown> {
    const statusCounts: Record<string, number> = {}
    for (const intent of this.intents) {
      statusCounts[intent.status] = (statusCounts[intent.status] || 0) + 1
    }
    return {
      completed: this.completed,
      facts: this.facts.length,
      intents: this.intents.length,
      openIntents: this.openIntents().length,
      intentStatusCounts: statusCounts,
      completeReason: this.completeReason,
      planTotal: this.plan.length,
      planCounts: this.planCounts(),
    }
  }

  private recalcSequences(): void {
    if (this.facts.length > 0) {
      const nums = this.facts.map(f => parseInt(f.id.slice(1), 10)).filter(n => !isNaN(n))
      this.factSeq = nums.length > 0 ? Math.max(...nums) : this.facts.length
    }
    if (this.intents.length > 0) {
      const nums = this.intents.map(i => parseInt(i.id.slice(1), 10)).filter(n => !isNaN(n))
      this.intentSeq = nums.length > 0 ? Math.max(...nums) : this.intents.length
    }
    if (this.plan.length > 0) {
      const nums = this.plan.map(t => parseInt(t.id.slice(1), 10)).filter(n => !isNaN(n))
      this.taskSeq = nums.length > 0 ? Math.max(...nums) : this.plan.length
    }
  }
}
