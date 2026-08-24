import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskCoordinator, type TaskExecutor } from '../../src/runtime/task-coordinator'
import { TaskGraphRunner, validateTaskGraph } from '../../src/runtime/task-graph'
import { createRunTaskGraphTool } from '../../src/manager/tools/run-task-graph'
import { WorkflowStore } from '../../src/workflow/store'
import { GraphStore } from '../../src/graph/store'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'

const dirs: string[] = []
const skills = { has: (id: string) => ['recon', 'analysis'].includes(id) }

async function setup(executor: TaskExecutor) {
  const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-task-graph-'))
  dirs.push(dir)
  const workflow = await WorkflowStore.loadOrCreate(join(dir, 'workflow.json'), { target: 'https://task-graph.example' })
  const coordinator = new TaskCoordinator(workflow, executor)
  return { workflow, coordinator, runner: new TaskGraphRunner(coordinator, skills as any) }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('TaskGraphRunner', () => {
  it('persists the whole graph first, runs ready tasks concurrently, then unlocks dependencies', async () => {
    let active = 0
    let maxActive = 0
    const events: string[] = []
    const { workflow, runner } = await setup(async (task, _signal, control) => {
      expect(workflow.state.tasks).toHaveLength(3)
      active++
      maxActive = Math.max(maxActive, active)
      events.push(`start:${task.taskId}`)
      await control.assignWorker({ workerId: `worker-${task.taskId}`, workerName: task.taskId })
      await new Promise((resolve) => setTimeout(resolve, 10))
      events.push(`end:${task.taskId}`)
      active--
      return { summary: `completed ${task.taskId}` }
    })

    const result = await runner.run({
      maxParallel: 2,
      tasks: [
        { taskId: 'a', objective: 'root a', skillId: 'recon', acceptanceCriteria: [{ id: 'a-summary', description: 'summary', type: 'summary_present' }] },
        { taskId: 'b', objective: 'root b', skillId: 'recon' },
        { taskId: 'c', objective: 'dependent', skillId: 'analysis', dependencyTaskIds: ['a', 'b'] },
      ],
    })

    expect(result.status).toBe('completed')
    expect(maxActive).toBe(2)
    expect(events.indexOf('start:c')).toBeGreaterThan(events.indexOf('end:a'))
    expect(events.indexOf('start:c')).toBeGreaterThan(events.indexOf('end:b'))
    expect(workflow.state.tasks.find((task) => task.taskId === 'a')?.acceptanceResults[0].passed).toBe(true)
  })

  it('marks unmet acceptance partial, blocks dependents, and returns replan reasons', async () => {
    const executor = vi.fn(async () => ({ summary: 'observed response', evidence: [] }))
    const { workflow, runner } = await setup(executor)

    const result = await runner.run({ tasks: [
      {
        taskId: 'capture', objective: 'capture proof', skillId: 'recon',
        acceptanceCriteria: [{ id: 'proof', description: 'two evidence refs', type: 'evidence_count', minCount: 2 }],
      },
      { taskId: 'analyze', objective: 'analyze proof', skillId: 'analysis', dependencyTaskIds: ['capture'] },
    ] })

    expect(result.status).toBe('needs_replan')
    expect(result.replan.required).toBe(true)
    expect(result.replan.unresolvedTaskIds).toEqual(['capture', 'analyze'])
    expect(workflow.state.tasks.find((task) => task.taskId === 'capture')?.status).toBe('partial')
    expect(workflow.state.tasks.find((task) => task.taskId === 'analyze')).toMatchObject({ status: 'blocked', error: 'Dependency capture ended as partial' })
    expect(executor).toHaveBeenCalledOnce()
  })

  it('rejects cycles, missing dependencies, unknown skills, and existing IDs before persistence', async () => {
    const { workflow, coordinator } = await setup(async () => ({ summary: '' }))
    await coordinator.plan({ taskId: 'existing', objective: 'already there', skillId: 'recon' })
    const validation = validateTaskGraph({ tasks: [
      { taskId: 'a', objective: 'a', skillId: 'missing', dependencyTaskIds: ['b'] },
      { taskId: 'b', objective: 'b', skillId: 'recon', dependencyTaskIds: ['a', 'absent'] },
      { taskId: 'existing', objective: 'replace', skillId: 'recon' },
    ] }, coordinator, skills as any)

    expect(validation.valid).toBe(false)
    expect(new Set(validation.errors.map((error) => error.code))).toEqual(new Set(['unknown_skill', 'existing_id', 'missing_dependency', 'cycle']))
    expect(workflow.state.tasks).toHaveLength(1)
  })

  it('public tool applies model routing and returns a schema-valid compact graph result', async () => {
    const { workflow, coordinator } = await setup(async (task) => ({ workerId: `worker-${task.taskId}`, summary: 'done' }))
    const selector = { selectForTask: vi.fn(() => ({ modelId: 'provider/model', provider: 'provider', tier: 'powerful', reasoning: 'capability fit' })) }
    const tool = createRunTaskGraphTool(coordinator, skills as any, selector as any)

    const output = await (tool as any).execute({
      tasks: [{ taskId: 'routed', objective: 'reason deeply', skillId: 'analysis', complexity: 'high' }],
      maxParallel: 1,
    }, {})

    expect(output).toMatchObject({
      status: 'completed',
      tasks: [{
        taskId: 'routed', status: 'completed', modelId: 'provider/model',
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, reportedCalls: 0 },
      }],
    })
    expect(workflow.state.tasks[0]).toMatchObject({ modelId: 'provider/model', provider: 'provider', tier: 'powerful' })
    expect(selector.selectForTask).toHaveBeenCalledOnce()
  })

  it('public tool rejects an invalid graph before model routing or persistence', async () => {
    const { workflow, coordinator } = await setup(async () => ({ summary: 'unused' }))
    const selector = { selectForTask: vi.fn() }
    const tool = createRunTaskGraphTool(coordinator, skills as any, selector as any)

    const output = await (tool as any).execute({
      tasks: [{ taskId: 'invalid', objective: 'bad dependency', skillId: 'recon', dependencyTaskIds: ['missing'] }],
      maxParallel: 1,
    }, {})

    expect(output.status).toBe('invalid')
    expect(output.validationErrors[0].code).toBe('missing_dependency')
    expect(selector.selectForTask).not.toHaveBeenCalled()
    expect(workflow.state.tasks).toEqual([])
  })

  it('keeps concurrent task evidence and graph references attributed to their task', async () => {
    const graph = new GraphStore(join(tmpdir(), `attribution-${Date.now()}.json`))
    const evidence = new EvidenceLedger()
    const { workflow, runner } = await setup(async (task) => {
      await new Promise((resolve) => setTimeout(resolve, task.taskId === 'left' ? 5 : 1))
      graph.upsertPage(`https://task-graph.example/${task.taskId}`)
      evidence.record({ id: `evidence-${task.taskId}`, type: 'raw_response', data: task.taskId, label: task.taskId })
      return { summary: task.taskId }
    })

    await runner.run({ maxParallel: 2, tasks: [
      { taskId: 'left', objective: 'left', skillId: 'recon' },
      { taskId: 'right', objective: 'right', skillId: 'recon' },
    ] })

    expect(workflow.state.tasks.find((task) => task.taskId === 'left')).toMatchObject({ evidenceRefs: ['evidence-left'], graphRefs: ['page:https://task-graph.example/left'] })
    expect(workflow.state.tasks.find((task) => task.taskId === 'right')).toMatchObject({ evidenceRefs: ['evidence-right'], graphRefs: ['page:https://task-graph.example/right'] })
  })

  it('resumes a persisted dependency graph without repeating completed tasks', async () => {
    const executor = vi.fn(async (task) => ({ summary: `done:${task.taskId}` }))
    const { workflow, coordinator, runner } = await setup(executor)
    const done = await coordinator.run({ taskId: 'done', objective: 'done', skillId: 'recon' })
    const pending = await coordinator.plan({ taskId: 'pending', objective: 'pending', skillId: 'analysis', dependencyTaskIds: ['done'] })
    expect(done.status).toBe('completed')
    expect(pending.status).toBe('planned')
    executor.mockClear()

    const result = await runner.resume(undefined, 2)

    expect(result.status).toBe('completed')
    expect(executor).toHaveBeenCalledOnce()
    expect(executor.mock.calls[0][0].taskId).toBe('pending')
    expect(workflow.state.tasks.find((task) => task.taskId === 'done')?.attempts).toBe(1)
  })
})
