import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ModelSelector } from '../../models/selector'
import type { SkillRegistry } from '../../solver/skills/registry'
import type { TaskCoordinator } from '../../runtime/task-coordinator'
import { getEngagementServices } from '../../runtime/engagement-context'
import { TaskGraphRunner, validateTaskGraph, type TaskGraphProposal } from '../../runtime/task-graph'

const acceptanceSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), description: z.string().min(1), type: z.literal('summary_present') }),
  z.object({ id: z.string().min(1), description: z.string().min(1), type: z.literal('evidence_count'), minCount: z.number().int().min(1) }),
])

const taskSchema = z.object({
  taskId: z.string().min(1),
  objective: z.string().min(1),
  skillId: z.string().min(1),
  parentTaskId: z.string().optional(),
  dependencyTaskIds: z.array(z.string()).default([]),
  contextRefs: z.array(z.string()).default([]),
  requiredCapabilities: z.array(z.string()).default([]),
  complexity: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
  acceptanceCriteria: z.array(acceptanceSchema).default([]),
  tokenLimit: z.number().positive().optional(),
  timeoutMs: z.number().int().positive().optional(),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  retryOn: z.array(z.enum(['failed', 'timed_out', 'interrupted'])).default([]),
  retryBackoffMs: z.number().int().min(0).max(60_000).default(0),
  tier: z.enum(['fast', 'balanced', 'powerful']).optional(),
  modelId: z.string().optional(),
  provider: z.string().optional(),
})

export function createRunTaskGraphTool(
  coordinator: TaskCoordinator,
  skills: SkillRegistry,
  modelSelector?: ModelSelector,
) {
  const compactResult = (result: Awaited<ReturnType<TaskGraphRunner['run']>>) => ({
    ...result,
    tasks: result.tasks.map((task) => ({
      taskId: task.taskId,
      status: task.status,
      workerId: task.workerId,
      modelId: task.modelId,
      resultSummary: task.resultSummary,
      evidenceRefs: task.evidenceRefs,
      graphRefs: task.graphRefs,
      error: task.error,
      acceptanceResults: task.acceptanceResults,
      attempts: task.attempts,
      usage: task.usage,
    })),
  })
  return createTool({
    id: 'run-task-graph',
    description: 'Execute a typed dependency graph of worker tasks. Use dependencies for ordering and acceptance criteria for runtime-verifiable completion. Returns structured replan reasons when work is partial, blocked, or failed.',
    inputSchema: z.object({
      tasks: z.array(taskSchema).max(50).default([]),
      maxParallel: z.number().int().min(1).max(20).default(1),
      resumeTaskIds: z.array(z.string().min(1)).optional().describe('Resume persisted tasks by exact ID. Use an empty array to resume all persisted tasks.'),
      resumeWaitingTask: z.object({
        taskId: z.string().min(1),
        contextRef: z.string().min(1).optional(),
      }).optional().describe('Resume one task after its requested external input is available.'),
    }),
    outputSchema: z.object({
      status: z.enum(['completed', 'needs_replan', 'cancelled', 'invalid']),
      tasks: z.array(z.object({
        taskId: z.string(),
        status: z.string(),
        workerId: z.string().optional(),
        modelId: z.string().optional(),
        resultSummary: z.string().optional(),
        evidenceRefs: z.array(z.string()),
        graphRefs: z.array(z.string()),
        error: z.string().optional(),
        acceptanceResults: z.array(z.object({ id: z.string(), passed: z.boolean(), actual: z.string() })),
        attempts: z.number().int(),
        usage: z.object({
          inputTokens: z.number().int().nonnegative(),
          outputTokens: z.number().int().nonnegative(),
          totalTokens: z.number().int().nonnegative(),
          modelCalls: z.number().int().nonnegative(),
          reportedCalls: z.number().int().nonnegative(),
        }),
      })),
      validationErrors: z.array(z.object({ taskId: z.string().optional(), code: z.string(), message: z.string() })),
      replan: z.object({ required: z.boolean(), reasons: z.array(z.string()), unresolvedTaskIds: z.array(z.string()) }),
    }),
    execute: async ({ tasks, maxParallel, resumeTaskIds, resumeWaitingTask }, context) => {
      const runner = new TaskGraphRunner(coordinator, skills)
      if (resumeWaitingTask) {
        await coordinator.resumeWaiting(resumeWaitingTask.taskId, resumeWaitingTask.contextRef)
        return compactResult(await runner.resume([resumeWaitingTask.taskId], maxParallel, (context as any)?.abortSignal))
      }
      if (resumeTaskIds) return compactResult(await runner.resume(resumeTaskIds.length > 0 ? resumeTaskIds : undefined, maxParallel, (context as any)?.abortSignal))
      const initialProposal = { tasks, maxParallel } as TaskGraphProposal
      const initialValidation = validateTaskGraph(initialProposal, coordinator, skills)
      if (!initialValidation.valid) return runner.run(initialProposal, (context as any)?.abortSignal)

      const routedTasks = tasks.map((task) => {
        const effectiveSelector = modelSelector ?? getEngagementServices()?.modelSelector
  if (task.modelId || !effectiveSelector) return task
        const selection = effectiveSelector.selectForTask({
          skillId: task.skillId,
          taskDescription: task.objective,
          complexity: task.complexity,
          requiredCapabilities: task.requiredCapabilities,
        }, 'worker')
        return { ...task, modelId: selection.modelId, provider: selection.provider, tier: selection.tier }
      })
      const result = await runner.run({ tasks: routedTasks, maxParallel } as TaskGraphProposal, (context as any)?.abortSignal)
      return compactResult(result)
    },
  })
}
