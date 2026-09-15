/**
 * Task Summarizer — executive task briefs for the LLM.
 *
 * Instead of showing raw tool calls, provides:
 *   - Plan brief on submit: "3 tasks planned: (1) recon, (2) injection test, (3) auth bypass"
 *   - Step brief before each batch: "Task 2/3: Testing SQL injection on /api/users"
 *   - Suppress duplicate briefs
 *
 * Adapted from PWN TaskSummarizer.
 */

export interface TaskBrief {
  taskIndex: number
  totalTasks: number
  description: string
  timestamp: string
}

export interface TaskPlan {
  id: string
  goals: string[]
  createdAt: string
}

export class TaskSummarizer {
  private currentPlan: TaskPlan | null = null
  private lastBrief: string | null = null

  /** Emit a plan brief when a new plan is submitted. */
  emitPlan(goals: string[]): TaskBrief | null {
    if (goals.length === 0) return null

    const plan: TaskPlan = {
      id: `plan-${Date.now()}`,
      goals,
      createdAt: new Date().toISOString(),
    }
    this.currentPlan = plan

    const brief: TaskBrief = {
      taskIndex: 0,
      totalTasks: goals.length,
      description: goals.map((g, i) => `(${i + 1}) ${g}`).join(', '),
      timestamp: new Date().toISOString(),
    }

    this.lastBrief = `Plan: ${brief.totalTasks} tasks — ${brief.description}`
    return brief
  }

  /** Emit a step brief before each tool batch. Returns null if duplicate. */
  emitStep(taskIndex: number, description: string): TaskBrief | null {
    if (!this.currentPlan) return null

    const key = `${taskIndex}:${description}`
    if (key === this.lastBrief) return null // suppress duplicate

    const brief: TaskBrief = {
      taskIndex,
      totalTasks: this.currentPlan.goals.length,
      description,
      timestamp: new Date().toISOString(),
    }

    this.lastBrief = key
    return brief
  }

  /** Format a brief for display. */
  static formatBrief(brief: TaskBrief): string {
    if (brief.taskIndex === 0) {
      return `[plan] ${brief.totalTasks} tasks — ${brief.description}`
    }
    return `[task ${brief.taskIndex}/${brief.totalTasks}] ${brief.description}`
  }

  /** Get current plan. */
  getCurrentPlan(): TaskPlan | null {
    return this.currentPlan
  }

  /** Reset. */
  reset(): void {
    this.currentPlan = null
    this.lastBrief = null
  }
}
