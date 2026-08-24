import type { SkillRegistry } from '../solver/skills/registry'
import type { TaskAcceptanceCriterion, TaskAcceptanceResult, TaskState } from '../workflow/types'
import type { TaskCoordinator, TaskRequest } from './task-coordinator'

export interface TaskProposal extends Omit<TaskRequest, 'signal' | 'onWorkerAssigned'> {
  taskId: string
}

export interface TaskGraphProposal {
  tasks: TaskProposal[]
  maxParallel?: number
}

export interface TaskGraphValidationError {
  taskId?: string
  code: 'empty_graph' | 'duplicate_id' | 'existing_id' | 'missing_dependency' | 'self_dependency' | 'cycle' | 'unknown_skill' | 'invalid_parallelism' | 'invalid_task'
  message: string
}

export interface TaskGraphValidationResult {
  valid: boolean
  errors: TaskGraphValidationError[]
}

export interface TaskGraphRunResult {
  status: 'completed' | 'needs_replan' | 'cancelled' | 'invalid'
  tasks: TaskState[]
  validationErrors: TaskGraphValidationError[]
  replan: {
    required: boolean
    reasons: string[]
    unresolvedTaskIds: string[]
  }
}

export function validateTaskGraph(
  proposal: TaskGraphProposal,
  coordinator: TaskCoordinator,
  skills: Pick<SkillRegistry, 'has'>,
): TaskGraphValidationResult {
  const errors: TaskGraphValidationError[] = []
  if (proposal.tasks.length === 0) errors.push({ code: 'empty_graph', message: 'Task graph must contain at least one task' })
  const maxParallel = proposal.maxParallel ?? 1
  if (!Number.isInteger(maxParallel) || maxParallel < 1) {
    errors.push({ code: 'invalid_parallelism', message: 'maxParallel must be a positive integer' })
  }

  const ids = new Set<string>()
  for (const task of proposal.tasks) {
    if (ids.has(task.taskId)) errors.push({ taskId: task.taskId, code: 'duplicate_id', message: `Duplicate task ID: ${task.taskId}` })
    ids.add(task.taskId)
    if (coordinator.getTask(task.taskId)) errors.push({ taskId: task.taskId, code: 'existing_id', message: `Task ID already exists: ${task.taskId}` })
    if (!task.skillId || !skills.has(task.skillId)) errors.push({ taskId: task.taskId, code: 'unknown_skill', message: `Unknown skill: ${task.skillId ?? '(missing)'}` })
    if (!task.objective.trim()) errors.push({ taskId: task.taskId, code: 'invalid_task', message: `Task ${task.taskId} requires an objective` })
    if (task.timeoutMs !== undefined && (!Number.isFinite(task.timeoutMs) || task.timeoutMs <= 0)) errors.push({ taskId: task.taskId, code: 'invalid_task', message: `Task ${task.taskId} has invalid timeoutMs` })
    if (task.tokenLimit !== undefined && (!Number.isFinite(task.tokenLimit) || task.tokenLimit <= 0)) errors.push({ taskId: task.taskId, code: 'invalid_task', message: `Task ${task.taskId} has invalid tokenLimit` })
  }

  for (const task of proposal.tasks) {
    for (const dependency of task.dependencyTaskIds ?? []) {
      if (dependency === task.taskId) errors.push({ taskId: task.taskId, code: 'self_dependency', message: `Task ${task.taskId} depends on itself` })
      else if (!ids.has(dependency)) errors.push({ taskId: task.taskId, code: 'missing_dependency', message: `Task ${task.taskId} depends on missing task ${dependency}` })
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const byId = new Map(proposal.tasks.map((task) => [task.taskId, task]))
  const visit = (taskId: string): boolean => {
    if (visiting.has(taskId)) return true
    if (visited.has(taskId)) return false
    visiting.add(taskId)
    for (const dependency of byId.get(taskId)?.dependencyTaskIds ?? []) {
      if (byId.has(dependency) && visit(dependency)) return true
    }
    visiting.delete(taskId)
    visited.add(taskId)
    return false
  }
  for (const task of proposal.tasks) {
    if (visit(task.taskId)) {
      errors.push({ taskId: task.taskId, code: 'cycle', message: `Task graph contains a cycle involving ${task.taskId}` })
      break
    }
  }

  return { valid: errors.length === 0, errors }
}

export function evaluateTaskAcceptance(task: TaskState): TaskAcceptanceResult[] {
  return task.acceptanceCriteria.map((criterion: TaskAcceptanceCriterion) => {
    if (criterion.type === 'summary_present') {
      const length = task.resultSummary?.trim().length ?? 0
      return { id: criterion.id, passed: length > 0, actual: `summary_length:${length}` }
    }
    const count = task.evidenceRefs.length
    return { id: criterion.id, passed: count >= criterion.minCount, actual: `evidence_count:${count}` }
  })
}

export class TaskGraphRunner {
  constructor(
    private readonly coordinator: TaskCoordinator,
    private readonly skills: Pick<SkillRegistry, 'has'>,
  ) {}

  async run(proposal: TaskGraphProposal, signal?: AbortSignal): Promise<TaskGraphRunResult> {
    const validation = validateTaskGraph(proposal, this.coordinator, this.skills)
    if (!validation.valid) return this.result('invalid', [], validation.errors)

    await this.coordinator.planBatch(proposal.tasks)

    return this.runPersisted(proposal.tasks.map((task) => task.taskId), proposal.maxParallel ?? 1, signal)
  }

  async resume(taskIds?: string[], maxParallel = 1, signal?: AbortSignal): Promise<TaskGraphRunResult> {
    await this.coordinator.recoverInterrupted()
    const selected = taskIds ?? this.coordinator.listTasks().map((task) => task.taskId)
    const unknownSkills = selected
      .map((taskId) => this.coordinator.getTask(taskId))
      .filter((task): task is TaskState => Boolean(task?.skillId && !this.skills.has(task.skillId)))
    for (const task of unknownSkills) {
      if (task.status === 'planned') await this.coordinator.blockPlanned(task.taskId, `Skill unavailable on resume: ${task.skillId}`)
    }
    return this.runPersisted(selected, maxParallel, signal)
  }

  private async runPersisted(taskIds: string[], maxParallel: number, signal?: AbortSignal): Promise<TaskGraphRunResult> {
    const pending = new Set(taskIds.filter((taskId) => this.coordinator.getTask(taskId)?.status === 'planned'))
    while (pending.size > 0) {
      if (signal?.aborted) {
        for (const taskId of pending) await this.coordinator.blockPlanned(taskId, 'Task graph execution cancelled before dispatch')
        return this.result('cancelled', taskIds.map((taskId) => this.coordinator.getTask(taskId)!).filter(Boolean), [])
      }

      let changed = false
      for (const taskId of [...pending]) {
        const task = this.coordinator.getTask(taskId)!
        const failedDependency = task.dependencyTaskIds
          .map((dependencyId) => this.coordinator.getTask(dependencyId))
          .find((dependency) => dependency && dependency.status !== 'planned' && dependency.status !== 'queued' && dependency.status !== 'running' && dependency.status !== 'completed')
        if (failedDependency) {
          await this.coordinator.blockPlanned(taskId, `Dependency ${failedDependency.taskId} ended as ${failedDependency.status}`)
          pending.delete(taskId)
          changed = true
        }
      }

      const ready = [...pending]
        .map((taskId) => this.coordinator.getTask(taskId)!)
        .filter((task) => task.dependencyTaskIds.every((dependencyId) => this.coordinator.getTask(dependencyId)?.status === 'completed'))
        .slice(0, maxParallel)

      if (ready.length === 0) {
        if (changed) continue
        throw new Error('Validated task graph reached an unschedulable state')
      }

      await Promise.all(ready.map(async (task) => {
        const completed = await this.coordinator.executePlanned(task.taskId, { signal })
        if (completed.status === 'completed' && completed.acceptanceCriteria.length > 0) {
          await this.coordinator.recordAcceptance(completed.taskId, evaluateTaskAcceptance(completed))
        }
        pending.delete(task.taskId)
      }))
    }

    const tasks = taskIds.map((taskId) => this.coordinator.getTask(taskId)!).filter(Boolean)
    const status = signal?.aborted ? 'cancelled' : tasks.every((task) => task.status === 'completed') ? 'completed' : 'needs_replan'
    return this.result(status, tasks, [])
  }

  private result(status: TaskGraphRunResult['status'], tasks: TaskState[], validationErrors: TaskGraphValidationError[]): TaskGraphRunResult {
    const unresolved = tasks.filter((task) => task.status !== 'completed')
    return {
      status,
      tasks,
      validationErrors,
      replan: {
        required: status === 'needs_replan',
        reasons: unresolved.map((task) => `${task.taskId}:${task.status}${task.error ? `:${task.error}` : ''}`),
        unresolvedTaskIds: unresolved.map((task) => task.taskId),
      },
    }
  }
}
