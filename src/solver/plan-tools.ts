/**
 * Plan Tools — Brain's structured planning interface
 *
 * createPlan: Brain creates the initial test plan from context analysis
 * updatePlan: Brain marks tasks as tested/skipped/blocked after each test
 * getPlan: Brain reads current plan status
 *
 * These are Mastra tools on the brain agent.
 * The solver loop intercepts tool results and syncs the Blackboard.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type {Blackboard, PlanTask} from '../core/blackboard'

const PlanTaskSchema = z.object({
  endpoint: z.string().describe('Endpoint path or URL (e.g. "/api/users", "https://target.com/login")'),
  technique: z.string().describe('Attack technique to test (e.g. "sqli", "xss", "idor", "auth_bypass")'),
  priority: z.number().int().min(1).max(10).default(5).describe('Priority (1=highest, 10=lowest)'),
})

const UpdateSchema = z.object({
  taskId: z.string().describe('Task ID to update (e.g. "t001")'),
  status: z.enum(['tested', 'skipped', 'blocked']).describe('New status'),
  note: z.string().describe('Result description or skip/block reason'),
})

/**
 * createPlan tool — Brain creates the initial test plan.
 *
 * Call once at the start of the solver session.
 * Brain analyzes target context + skills + goal → proposes structured plan.
 */
export function createCreatePlanTool(board: Blackboard) {
  return createTool({
    id: 'createPlan',
    description: `Create a structured test plan with ordered tasks. Each task = one endpoint + one technique.

RULES:
- Plan BEFORE testing — no blind exploration
- One task per endpoint+technique combination
- Priority 1 = test first (highest value), Priority 10 = test last
- Start with recon/intent tasks, move to exploitation
- Include diverse techniques (sqli, xss, idor, auth_bypass, etc.)
- Plan 5-15 tasks max — replan as you learn`,
    inputSchema: z.object({
      tasks: z.array(PlanTaskSchema).min(1).max(20).describe('Ordered list of test tasks'),
    }),
    outputSchema: z.object({
      planId: z.string(),
      taskCount: z.number(),
      tasks: z.array(z.object({
        id: z.string(),
        endpoint: z.string(),
        technique: z.string(),
        priority: z.number(),
      })),
    }),
    execute: async ({ tasks }) => {

      // Deduplicate by endpoint+technique (within batch AND against already-tested)
      const seen = new Set<string>()
      const unique: Array<{ endpoint: string; technique: string; priority: number }> = []
      for (const t of tasks) {
        const key = board.makeTestedKey(t.endpoint, t.technique)
        if (!seen.has(key) && !board.isTested(t.endpoint, t.technique)) {
          seen.add(key)
          unique.push({ ...t, priority: t.priority ?? 5 })
        }
      }

      // Create tasks on the board
      const created: PlanTask[] = []
      for (const t of unique) {
        const task = board.addTask(t.endpoint, t.technique, t.priority)
        created.push(task)
      }

      return {
        planId: `plan-${Date.now()}`,
        taskCount: created.length,
        tasks: created.map(t => ({
          id: t.id,
          endpoint: t.endpoint,
          technique: t.technique,
          priority: t.priority,
        })),
      }
    },
  })
}

/**
 * updatePlan tool — Brain updates task status after testing.
 *
 * Called after each test cycle (EXPLORE + CONCLUDE).
 * Marks the completed/skipped/blocked task on the blackboard.
 */
export function createUpdatePlanTool(board: Blackboard) {
  return createTool({
    id: 'updatePlan',
    description: `Update a plan task's status after testing. ALWAYS call this after testing a task.

- "tested": You confirmed something (finding, observation, or new fact)
- "skipped": No progress possible (dead end, blocked, or not worth pursuing)
- "blocked": Can't test (WAF, auth required, rate limit)`,
    inputSchema: UpdateSchema,
    outputSchema: z.object({
      taskId: z.string(),
      status: z.string(),
      factId: z.string().nullable(),
      planProgress: z.object({
        total: z.number(),
        tested: z.number(),
        skipped: z.number(),
        blocked: z.number(),
        pending: z.number(),
      }),
    }),
    execute: async ({ taskId, status, note }) => {

      let task: PlanTask | undefined
      if (status === 'tested') {
        task = board.completeTask(taskId, note)
      } else if (status === 'skipped') {
        task = board.skipTask(taskId, note)
      } else if (status === 'blocked') {
        task = board.blockTask(taskId, note)
      }

      const counts = board.planCounts()
      return {
        taskId,
        status,
        factId: task?.resultFact || null,
        planProgress: {
          total: board.plan.length,
          tested: counts['tested'] || 0,
          skipped: counts['skipped'] || 0,
          blocked: counts['blocked'] || 0,
          pending: counts['pending'] || 0,
        },
      }
    },
  })
}

/**
 * getPlan tool — Brain reads current plan status.
 */
export function createGetPlanTool(board: Blackboard) {
  return createTool({
    id: 'getPlan',
    description: 'Read the current plan status: tasks, progress, and what remains.',
    inputSchema: z.object({}),
    outputSchema: z.object({
      total: z.number(),
      counts: z.record(z.string(), z.number()),
      nextTask: z.object({
        id: z.string(),
        endpoint: z.string(),
        technique: z.string(),
        priority: z.number(),
      }).nullable(),
      summary: z.string(),
    }),
    execute: async () => {
      const next = board.nextTask()
      return {
        total: board.plan.length,
        counts: board.planCounts(),
        nextTask: next ? {
          id: next.id,
          endpoint: next.endpoint,
          technique: next.technique,
          priority: next.priority,
        } : null,
        summary: board.planSummary(),
      }
    },
  })
}
