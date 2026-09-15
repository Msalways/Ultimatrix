import { describe, it, expect, beforeEach } from 'vitest'
import { TaskSummarizer } from '../../src/runtime/task-summarizer'

describe('TaskSummarizer', () => {
  let summarizer: TaskSummarizer

  beforeEach(() => {
    summarizer = new TaskSummarizer()
  })

  describe('emitPlan', () => {
    it('returns a brief for the plan', () => {
      const brief = summarizer.emitPlan(['recon', 'inject', 'report'])
      expect(brief).not.toBeNull()
      expect(brief!.totalTasks).toBe(3)
      expect(brief!.taskIndex).toBe(0)
      expect(brief!.description).toContain('(1) recon')
    })

    it('returns null for empty goals', () => {
      expect(summarizer.emitPlan([])).toBeNull()
    })

    it('stores the current plan', () => {
      summarizer.emitPlan(['recon', 'inject'])
      const plan = summarizer.getCurrentPlan()
      expect(plan).not.toBeNull()
      expect(plan!.goals).toHaveLength(2)
    })
  })

  describe('emitStep', () => {
    it('returns a step brief', () => {
      summarizer.emitPlan(['recon', 'inject'])
      const brief = summarizer.emitStep(1, 'Testing SQL injection on /api/users')
      expect(brief).not.toBeNull()
      expect(brief!.taskIndex).toBe(1)
      expect(brief!.totalTasks).toBe(2)
    })

    it('suppresses duplicate briefs', () => {
      summarizer.emitPlan(['recon', 'inject'])
      summarizer.emitStep(1, 'Testing SQL injection')
      const second = summarizer.emitStep(1, 'Testing SQL injection')
      expect(second).toBeNull()
    })

    it('allows different steps', () => {
      summarizer.emitPlan(['recon', 'inject'])
      summarizer.emitStep(1, 'Step 1')
      const step2 = summarizer.emitStep(2, 'Step 2')
      expect(step2).not.toBeNull()
    })

    it('returns null without a plan', () => {
      expect(summarizer.emitStep(1, 'test')).toBeNull()
    })
  })

  describe('formatBrief', () => {
    it('formats plan brief', () => {
      const brief = { taskIndex: 0, totalTasks: 3, description: 'recon, inject, report', timestamp: '' }
      expect(TaskSummarizer.formatBrief(brief)).toContain('[plan] 3 tasks')
    })

    it('formats step brief', () => {
      const brief = { taskIndex: 2, totalTasks: 3, description: 'Testing injection', timestamp: '' }
      expect(TaskSummarizer.formatBrief(brief)).toContain('[task 2/3]')
    })
  })

  describe('reset', () => {
    it('clears the plan', () => {
      summarizer.emitPlan(['recon'])
      summarizer.reset()
      expect(summarizer.getCurrentPlan()).toBeNull()
    })
  })
})
