import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

import { Blackboard, TaskStatus } from '../../src/solver/blackboard'
import { createCreatePlanTool, createUpdatePlanTool, createGetPlanTool } from '../../src/solver/plan-tools'

describe('Plan Tools', () => {
  let board: Blackboard

  beforeEach(() => {
    board = new Blackboard({ origin: 'https://example.com', goal: 'Find vulnerabilities' })
  })

  describe('createPlan', () => {
    it('creates plan tasks on the board', async () => {
      const tool = createCreatePlanTool(board)
      const result = await (tool as any).execute({
        tasks: [
          { endpoint: '/api/users', technique: 'sqli', priority: 1 },
          { endpoint: '/login', technique: 'auth_bypass', priority: 2 },
        ],
      })
      expect(result.taskCount).toBe(2)
      expect(result.tasks).toHaveLength(2)
      expect(result.tasks[0].id).toBe('t001')
      expect(result.tasks[1].id).toBe('t002')
      expect(board.plan).toHaveLength(2)
    })

    it('deduplicates by endpoint+technique', async () => {
      const tool = createCreatePlanTool(board)
      const result = await (tool as any).execute({
        tasks: [
          { endpoint: '/api/users', technique: 'sqli', priority: 1 },
          { endpoint: '/api/users', technique: 'sqli', priority: 1 },
          { endpoint: '/api/users', technique: 'xss', priority: 2 },
        ],
      })
      expect(result.taskCount).toBe(2)
      expect(board.plan).toHaveLength(2)
    })

    it('skips already-tested combinations', async () => {
      board.addTask('/api/users', 'sqli', 1)
      board.completeTask('t001', 'Already done')

      const tool = createCreatePlanTool(board)
      const result = await (tool as any).execute({
        tasks: [
          { endpoint: '/api/users', technique: 'sqli', priority: 1 },
        ],
      })
      expect(result.taskCount).toBe(0)
    })
  })

  describe('updatePlan', () => {
    it('marks task as tested', async () => {
      board.addTask('/api/users', 'sqli', 1)
      const tool = createUpdatePlanTool(board)
      const result = await (tool as any).execute({ taskId: 't001', status: 'tested', note: 'Found SQL error messages' })
      expect(result.status).toBe('tested')
      expect(result.factId).toBeTruthy()
      expect(result.planProgress.tested).toBe(1)
    })

    it('marks task as skipped', async () => {
      board.addTask('/api/users', 'xss', 1)
      const tool = createUpdatePlanTool(board)
      const result = await (tool as any).execute({ taskId: 't001', status: 'skipped', note: 'No reflection point' })
      expect(result.status).toBe('skipped')
      expect(result.planProgress.skipped).toBe(1)
    })

    it('marks task as blocked', async () => {
      board.addTask('/api/admin', 'idor', 1)
      const tool = createUpdatePlanTool(board)
      const result = await (tool as any).execute({ taskId: 't001', status: 'blocked', note: 'WAF blocks all requests' })
      expect(result.status).toBe('blocked')
      expect(result.planProgress.blocked).toBe(1)
    })

    it('returns correct progress counts', async () => {
      board.addTask('/a', 'sqli', 1)
      board.addTask('/b', 'xss', 2)
      board.addTask('/c', 'idor', 3)
      const tool = createUpdatePlanTool(board)

      await (tool as any).execute({ taskId: 't001', status: 'tested', note: 'Found' })
      const result = await (tool as any).execute({ taskId: 't002', status: 'skipped', note: 'Skip' })

      expect(result.planProgress).toEqual({ total: 3, tested: 1, skipped: 1, blocked: 0, pending: 1 })
    })
  })

  describe('getPlan', () => {
    it('returns plan status', async () => {
      board.addTask('/api/users', 'sqli', 1)
      board.addTask('/login', 'auth_bypass', 2)
      const tool = createGetPlanTool(board)
      const result = await (tool as any).execute({ context: {} })
      expect(result.total).toBe(2)
      expect(result.nextTask?.id).toBe('t001')
      expect(result.summary).toContain('t001')
      expect(result.summary).toContain('t002')
    })

    it('returns null nextTask when all done', async () => {
      board.addTask('/api/users', 'sqli', 1)
      board.completeTask('t001', 'Done')
      const tool = createGetPlanTool(board)
      const result = await (tool as any).execute({ context: {} })
      expect(result.nextTask).toBeNull()
    })

    it('returns empty plan', async () => {
      const tool = createGetPlanTool(board)
      const result = await (tool as any).execute({ context: {} })
      expect(result.total).toBe(0)
      expect(result.nextTask).toBeNull()
      expect(result.summary).toBe('(no plan)')
    })
  })
})
