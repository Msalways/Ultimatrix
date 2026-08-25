import { randomUUID } from 'node:crypto'
import type { WorkflowStore } from '../workflow/store'
import type {
  TaskAcceptanceCriterion,
  TaskAttemptState,
  TaskRetryableStatus,
  TaskRetryPolicy,
  TaskState,
  WorkflowEvidenceRef,
} from '../workflow/types'
import { buildTaskContextCheckpoint } from './task-context'
import { createTaskAttribution, runWithTaskAttribution } from './task-attribution'

export interface TaskRequest {
  taskId?: string
  objective: string
  skillId?: string
  parentTaskId?: string
  dependencyTaskIds?: string[]
  contextRefs?: string[]
  requiredCapabilities?: string[]
  complexity?: 'low' | 'medium' | 'high' | 'critical'
  acceptanceCriteria?: TaskAcceptanceCriterion[]
  tokenLimit?: number
  timeoutMs?: number
  maxAttempts?: number
  retryOn?: TaskRetryableStatus[]
  retryBackoffMs?: number
  modelId?: string
  provider?: string
  tier?: string
  signal?: AbortSignal
  onWorkerAssigned?: (worker: { workerId: string; workerName: string }) => void
}

export interface TaskExecutionResult {
  workerId?: string
  summary: string
  /** F3 — ToolResultStore ref for the full worker output (getToolResult). */
  resultRef?: string
  evidence?: WorkflowEvidenceRef[]
  graphRefs?: string[]
}

export interface TaskRunOptions {
  signal?: AbortSignal
  onWorkerAssigned?: (worker: { workerId: string; workerName: string }) => void
}

export interface TaskExecutionControl {
  assignWorker(worker: { workerId: string; workerName: string }): Promise<void>
  waitForInput(wait: { reason: string; inputKey?: string }): Promise<void>
}

export type TaskExecutor = (
  task: Readonly<TaskState>,
  signal: AbortSignal,
  control: TaskExecutionControl,
) => Promise<TaskExecutionResult>

const DEFAULT_RETRY_POLICY: TaskRetryPolicy = { maxAttempts: 1, retryOn: [], backoffMs: 0 }
const RETRYABLE_STATUSES: readonly TaskRetryableStatus[] = ['failed', 'timed_out', 'interrupted']
const emptyUsage = () => ({ inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, reportedCalls: 0 })

function cloneTask(task: TaskState): TaskState {
  return {
    ...task,
    dependencyTaskIds: [...task.dependencyTaskIds],
    contextRefs: [...task.contextRefs],
    requiredCapabilities: [...task.requiredCapabilities],
    acceptanceCriteria: task.acceptanceCriteria.map((criterion) => ({ ...criterion })),
    acceptanceResults: task.acceptanceResults.map((result) => ({ ...result })),
    budget: { ...task.budget },
    retryPolicy: { ...task.retryPolicy, retryOn: [...task.retryPolicy.retryOn] },
    attemptHistory: task.attemptHistory.map((attempt) => ({ ...attempt, evidenceRefs: [...attempt.evidenceRefs], graphRefs: [...attempt.graphRefs], usage: { ...attempt.usage } })),
    evidenceRefs: [...task.evidenceRefs],
    graphRefs: [...task.graphRefs],
    usage: { ...task.usage },
    contextCheckpoints: task.contextCheckpoints.map((checkpoint) => ({
      ...checkpoint,
      contextRefs: [...checkpoint.contextRefs],
      dependencies: checkpoint.dependencies.map((dependency) => ({ ...dependency, evidenceRefs: [...dependency.evidenceRefs], graphRefs: [...dependency.graphRefs] })),
      priorAttempts: checkpoint.priorAttempts.map((attempt) => ({ ...attempt })),
    })),
    wait: task.wait ? { ...task.wait } : undefined,
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason) }, { once: true })
  })
}

export class TaskCoordinator {
  private readonly controllers = new Map<string, AbortController>()
  private checkpointTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly workflow: WorkflowStore,
    private readonly executeTask: TaskExecutor,
    private readonly now: () => number = Date.now,
  ) {}

  async run(request: TaskRequest): Promise<TaskState> {
    const task = await this.plan(request)
    return this.executePlanned(task.taskId, request)
  }

  async plan(request: TaskRequest): Promise<TaskState> {
    const task = this.buildPlannedTask(request, new Set(this.workflow.state.tasks.map((item) => item.taskId)))
    await this.checkpoint(task)
    return task
  }

  async planBatch(requests: TaskRequest[]): Promise<TaskState[]> {
    const reservedIds = new Set(this.workflow.state.tasks.map((task) => task.taskId))
    const tasks = requests.map((request) => {
      const task = this.buildPlannedTask(request, reservedIds)
      reservedIds.add(task.taskId)
      return task
    })
    await this.checkpointBatch(tasks)
    return tasks
  }

  private buildPlannedTask(request: TaskRequest, reservedIds: Set<string>): TaskState {
    if (!request.objective.trim()) throw new Error('Task objective is required')
    if (request.timeoutMs !== undefined && (!Number.isFinite(request.timeoutMs) || request.timeoutMs <= 0)) throw new Error('Task timeoutMs must be a positive finite number')
    if (request.tokenLimit !== undefined && (!Number.isFinite(request.tokenLimit) || request.tokenLimit <= 0)) throw new Error('Task tokenLimit must be a positive finite number')
    if (request.maxAttempts !== undefined && (!Number.isInteger(request.maxAttempts) || request.maxAttempts < 1)) throw new Error('Task maxAttempts must be a positive integer')
    if (request.retryBackoffMs !== undefined && (!Number.isFinite(request.retryBackoffMs) || request.retryBackoffMs < 0)) throw new Error('Task retryBackoffMs must be a non-negative finite number')
    if (request.retryOn?.some((status) => !RETRYABLE_STATUSES.includes(status))) throw new Error('Task retryOn contains an unsupported status')

    const timestamp = this.now()
    const taskId = request.taskId ?? `task-${randomUUID()}`
    if (reservedIds.has(taskId)) throw new Error(`Task ${taskId} already exists; retry must create a new execution attempt`)
    return {
      taskId,
      objective: request.objective,
      skillId: request.skillId,
      parentTaskId: request.parentTaskId,
      dependencyTaskIds: request.dependencyTaskIds ?? [],
      contextRefs: request.contextRefs ?? [],
      requiredCapabilities: request.requiredCapabilities ?? [],
      complexity: request.complexity,
      acceptanceCriteria: request.acceptanceCriteria ?? [],
      acceptanceResults: [],
      budget: { tokenLimit: request.tokenLimit, timeoutMs: request.timeoutMs },
      retryPolicy: {
        maxAttempts: request.maxAttempts ?? DEFAULT_RETRY_POLICY.maxAttempts,
        retryOn: request.retryOn ?? DEFAULT_RETRY_POLICY.retryOn,
        backoffMs: request.retryBackoffMs ?? DEFAULT_RETRY_POLICY.backoffMs,
      },
      status: 'planned',
      attempts: 0,
      attemptHistory: [],
      modelId: request.modelId,
      provider: request.provider,
      tier: request.tier,
      evidenceRefs: [],
      graphRefs: [],
      usage: emptyUsage(),
      contextCheckpoints: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  }

  async executePlanned(taskId: string, options: TaskRunOptions = {}): Promise<TaskState> {
    const stored = this.workflow.state.tasks.find((task) => task.taskId === taskId)
    if (!stored) throw new Error(`Task ${taskId} does not exist`)
    if (stored.status !== 'planned') throw new Error(`Task ${taskId} is ${stored.status}, expected planned`)
    const task = cloneTask(stored)
    let resumedFromWait = task.attemptHistory.at(-1)?.status === 'waiting'

    while (task.attempts < task.retryPolicy.maxAttempts || resumedFromWait) {
      resumedFromWait = false
      const terminal = await this.executeAttempt(task, options)
      if (['completed', 'waiting', 'cancelled', 'budget_exceeded', 'budget_unverifiable'].includes(terminal.status)) return terminal
      const retryStatus = terminal.status === 'timed_out' ? 'timed_out' : 'failed'
      if (!terminal.retryPolicy.retryOn.includes(retryStatus) || terminal.attempts >= terminal.retryPolicy.maxAttempts) return terminal
      terminal.status = 'planned'
      terminal.workerId = undefined
      terminal.error = undefined
      terminal.completedAt = undefined
      terminal.updatedAt = this.now()
      await this.checkpoint(terminal)
      await sleep(terminal.retryPolicy.backoffMs, options.signal)
    }
    return task
  }

  private async executeAttempt(task: TaskState, options: TaskRunOptions): Promise<TaskState> {
    task.attempts += 1
    const attempt: TaskAttemptState = {
      attemptId: `${task.taskId}:attempt:${task.attempts}`,
      number: task.attempts,
      status: 'queued',
      modelId: task.modelId,
      provider: task.provider,
      evidenceRefs: [],
      graphRefs: [],
      usage: emptyUsage(),
    }
    const contextCheckpoint = buildTaskContextCheckpoint(task, this.workflow.state.tasks, task.attempts, this.now())
    attempt.contextCheckpointId = contextCheckpoint.checkpointId
    task.contextCheckpoints.push(contextCheckpoint)
    task.attemptHistory.push(attempt)
    task.status = 'queued'
    task.updatedAt = this.now()
    await this.checkpoint(task)

    const controller = new AbortController()
    const forwardAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) forwardAbort()
    else options.signal?.addEventListener('abort', forwardAbort, { once: true })
    this.controllers.set(task.taskId, controller)

    let timedOut = false
    let budgetUnverifiable = false
    let waiting = false
    let timer: ReturnType<typeof setTimeout> | undefined
    task.status = 'running'
    attempt.status = 'running'
    attempt.startedAt = this.now()
    task.startedAt ??= attempt.startedAt
    task.updatedAt = attempt.startedAt
    await this.checkpoint(task)

    const remainingTokenLimit = task.budget.tokenLimit === undefined
      ? undefined
      : Math.max(0, task.budget.tokenLimit - task.usage.totalTokens)
    const attribution = createTaskAttribution(task.taskId, remainingTokenLimit, (error) => controller.abort(error))
    const captureUsage = () => {
      attempt.usage = { ...attribution.usage }
      task.usage = task.attemptHistory.reduce((total, item) => ({
        inputTokens: total.inputTokens + item.usage.inputTokens,
        outputTokens: total.outputTokens + item.usage.outputTokens,
        totalTokens: total.totalTokens + item.usage.totalTokens,
        modelCalls: total.modelCalls + item.usage.modelCalls,
        reportedCalls: total.reportedCalls + item.usage.reportedCalls,
      }), emptyUsage())
    }

    try {
      if (remainingTokenLimit === 0) {
        attribution.budgetExceeded = true
        throw new Error(`Task ${task.taskId} exhausted its ${task.budget.tokenLimit} token budget`)
      }
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Task cancelled')
      if (task.budget.timeoutMs) {
        timer = setTimeout(() => {
          timedOut = true
          controller.abort(new Error(`Task ${task.taskId} exceeded ${task.budget.timeoutMs}ms`))
        }, task.budget.timeoutMs)
      }
      const result = await runWithTaskAttribution(attribution, () => this.executeTask(task, controller.signal, {
        assignWorker: async (worker) => {
          if (attempt.workerId && attempt.workerId !== worker.workerId) throw new Error(`Attempt ${attempt.attemptId} is already assigned to worker ${attempt.workerId}`)
          attempt.workerId = worker.workerId
          task.workerId = worker.workerId
          task.updatedAt = this.now()
          await this.checkpoint(task)
          options.onWorkerAssigned?.(worker)
        },
        waitForInput: async (wait) => {
          const timestamp = this.now()
          waiting = true
          task.status = 'waiting'
          task.wait = { ...wait, requestedAt: timestamp }
          attempt.status = 'waiting'
          attempt.completedAt = timestamp
          task.updatedAt = timestamp
          await this.checkpoint(task)
          controller.abort(new Error(`Task ${task.taskId} is waiting for input`))
        },
      }))
      captureUsage()
      if (waiting) return task
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('Task cancelled')
      if (task.budget.tokenLimit !== undefined && attribution.usage.reportedCalls < attribution.usage.modelCalls) {
        budgetUnverifiable = true
        throw new Error(`Task ${task.taskId} cannot verify token budget because provider usage was unavailable`)
      }

      task.workerId = result.workerId ?? task.workerId
      attempt.workerId = result.workerId ?? attempt.workerId
      task.resultSummary = result.summary.slice(0, 2000)
      if (result.resultRef) task.resultRef = result.resultRef
      attempt.resultSummary = task.resultSummary
      const attributedEvidence = [...attribution.evidence.values()]
      const evidence = [...attributedEvidence, ...(result.evidence ?? [])]
      const evidenceRefs = evidence.map((item) => item.id)
      task.evidenceRefs = [...new Set([...task.evidenceRefs, ...evidenceRefs])]
      attempt.evidenceRefs = evidenceRefs
      const graphRefs = [...new Set([...attribution.graphRefs, ...(result.graphRefs ?? [])])]
      task.graphRefs = [...new Set([...task.graphRefs, ...graphRefs])]
      attempt.graphRefs = graphRefs
      for (const item of evidence) this.workflow.recordEvidence(item)
      task.status = 'completed'
      attempt.status = 'completed'
      attempt.completedAt = this.now()
      task.completedAt = attempt.completedAt
      task.updatedAt = attempt.completedAt
      await this.checkpoint(task)
      return task
    } catch (error) {
      captureUsage()
      if (waiting) return task
      budgetUnverifiable ||= task.budget.tokenLimit !== undefined && attribution.usage.reportedCalls < attribution.usage.modelCalls
      task.status = attribution.budgetExceeded ? 'budget_exceeded' : timedOut ? 'timed_out' : controller.signal.aborted ? 'cancelled' : budgetUnverifiable ? 'budget_unverifiable' : 'failed'
      attempt.status = task.status
      task.error = error instanceof Error ? error.message : String(error)
      attempt.error = task.error
      attempt.completedAt = this.now()
      task.completedAt = attempt.completedAt
      task.updatedAt = attempt.completedAt
      await this.checkpoint(task)
      return task
    } finally {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', forwardAbort)
      this.controllers.delete(task.taskId)
    }
  }

  async resumeWaiting(taskId: string, contextRef?: string): Promise<TaskState> {
    const task = this.workflow.state.tasks.find((item) => item.taskId === taskId)
    if (!task) throw new Error(`Task ${taskId} does not exist`)
    if (task.status !== 'waiting') throw new Error(`Task ${taskId} is ${task.status}, expected waiting`)
    if (contextRef) task.contextRefs = [...new Set([...task.contextRefs, contextRef])]
    task.status = 'planned'
    task.wait = undefined
    task.workerId = undefined
    task.error = undefined
    task.completedAt = undefined
    task.updatedAt = this.now()
    await this.checkpoint(task)
    return task
  }

  async recordAcceptance(taskId: string, results: TaskState['acceptanceResults']): Promise<TaskState> {
    const task = this.workflow.state.tasks.find((item) => item.taskId === taskId)
    if (!task) throw new Error(`Task ${taskId} does not exist`)
    if (task.status !== 'completed') throw new Error(`Task ${taskId} is ${task.status}, expected completed`)
    task.acceptanceResults = results.map((result) => ({ ...result }))
    if (results.some((result) => !result.passed)) task.status = 'partial'
    task.updatedAt = this.now()
    await this.checkpoint(task)
    return task
  }

  async blockPlanned(taskId: string, reason: string): Promise<TaskState> {
    const task = this.workflow.state.tasks.find((item) => item.taskId === taskId)
    if (!task) throw new Error(`Task ${taskId} does not exist`)
    if (task.status !== 'planned') throw new Error(`Task ${taskId} is ${task.status}, expected planned`)
    task.status = 'blocked'
    task.error = reason
    task.completedAt = this.now()
    task.updatedAt = task.completedAt
    await this.checkpoint(task)
    return task
  }

  getTask(taskId: string): TaskState | undefined {
    return this.workflow.state.tasks.find((task) => task.taskId === taskId)
  }

  listTasks(): readonly TaskState[] {
    return this.workflow.state.tasks
  }

  cancel(taskId: string, reason = 'Task cancelled'): boolean {
    const controller = this.controllers.get(taskId)
    if (!controller) return false
    controller.abort(new Error(reason))
    return true
  }

  /** Requeue retryable interrupted work; fail closed when policy forbids retry. */
  async recoverInterrupted(): Promise<TaskState[]> {
    const interrupted = this.workflow.state.tasks.filter((task) => task.status === 'queued' || task.status === 'running')
    for (const task of interrupted) {
      const attempt = task.attemptHistory.at(-1)
      if (attempt && (attempt.status === 'queued' || attempt.status === 'running')) {
        attempt.status = 'interrupted'
        attempt.error = 'Execution interrupted before a terminal checkpoint'
        attempt.completedAt = this.now()
      }
      const retryable = task.retryPolicy.retryOn.includes('interrupted') && task.attempts < task.retryPolicy.maxAttempts
      task.status = retryable ? 'planned' : 'failed'
      task.workerId = undefined
      task.error = retryable ? undefined : 'Execution interrupted before a terminal checkpoint'
      task.completedAt = retryable ? undefined : this.now()
      task.updatedAt = this.now()
      this.workflow.recordTask(task)
    }
    if (interrupted.length > 0) await this.workflow.save()
    return interrupted
  }

  private async checkpoint(task: TaskState): Promise<void> {
    await this.checkpointBatch([task])
  }

  private async checkpointBatch(tasks: TaskState[]): Promise<void> {
    const snapshots = tasks.map(cloneTask)
    const pending = this.checkpointTail.then(async () => {
      for (const snapshot of snapshots) this.workflow.recordTask(snapshot)
      await this.workflow.save()
    })
    this.checkpointTail = pending.catch(() => {})
    await pending
  }
}
