import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => ({
    nodes: new Map(),
    queryNodes: () => [],
  }),
}))

import { createSpawnWorkerTool } from '../../src/manager/tools/spawn-worker'
import { createSpawnSwarmTool } from '../../src/manager/tools/spawn-swarm'
import { createWorkerTaskCoordinator } from '../../src/runtime/worker-pool-executor'
import { WorkflowStore } from '../../src/workflow/store'
import type { UltimatrixConfig } from '../../src/config'
import { WorkerPool } from '../../src/workers/pool'

const dirs: string[] = []
const config = {
  provider: 'groq',
  model: 'test-model',
  target: 'https://worker-wiring.example',
  browser: { provider: 'stagehand' },
} as UltimatrixConfig
const skills = { has: () => true } as any

async function runtime(pool: object) {
  const dir = await mkdtemp(join(tmpdir(), 'ultimatrix-worker-wiring-'))
  dirs.push(dir)
  const workflow = await WorkflowStore.loadOrCreate(join(dir, 'workflow.json'), { target: config.target! })
  return { workflow, coordinator: createWorkerTaskCoordinator(workflow, pool as any) }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('production worker tool wiring', () => {
  it('keeps raw worker execution behind the coordinator adapter', async () => {
    const [sessionSource, poolSource] = await Promise.all([
      readFile(join(process.cwd(), 'src/session.ts'), 'utf8'),
      readFile(join(process.cwd(), 'src/workers/pool.ts'), 'utf8'),
    ])

    expect(sessionSource).not.toContain('.dispatchSlices(')
    expect(poolSource).not.toMatch(/\n\s+async execute\(/)
    expect(poolSource).not.toContain('dispatchSlices(')
    expect(poolSource).toMatch(/private spawn\(/)
  })

  it('passes AbortSignal into Mastra generation and removes the finished attempt', async () => {
    const pool = new WorkerPool(config, skills)
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    ;(pool as any).factory.create = () => ({
      id: 'worker-managed',
      name: 'Managed Worker',
      generate: async (_task: string, options: { abortSignal?: AbortSignal }) => {
        receivedSignal = options.abortSignal
        return { text: 'done' }
      },
    })

    const result = await pool.executeManaged({ skillId: 'recon', task: 'managed' }, { signal: controller.signal })

    expect(result.workerId).toBe('worker-managed')
    expect(receivedSignal).toBe(controller.signal)
    expect(pool.list()).toEqual([])
  })

  it('routes spawnWorker through managed execution and persists the actual attempt', async () => {
    const executeManaged = vi.fn(async (workerConfig, options) => {
      await options.onStarted({ workerId: 'worker-real-1', workerName: 'Recon Specialist' })
      expect(options.signal).toBeInstanceOf(AbortSignal)
      return { workerId: 'worker-real-1', workerName: 'Recon Specialist', result: { text: 'compact result' }, durationMs: 4 }
    })
    const { workflow, coordinator } = await runtime({ executeManaged })
    const tool = createSpawnWorkerTool(config, skills, coordinator)

    const output = await (tool as any).execute({ skillId: 'recon', task: 'inspect target', complexity: 'medium' }, {})
    const value = output.value ?? output

    expect(value).toMatchObject({ workerId: 'worker-real-1', status: 'completed', result: { text: 'compact result' } })
    expect(executeManaged).toHaveBeenCalledOnce()
    expect(workflow.state.tasks[0]).toMatchObject({
      skillId: 'recon', workerId: 'worker-real-1', status: 'completed', resultSummary: 'compact result',
    })
  })

  it('propagates parent cancellation and retains worker attribution', async () => {
    const parent = new AbortController()
    let started!: () => void
    const assigned = new Promise<void>((resolve) => { started = resolve })
    const executeManaged = vi.fn(async (_workerConfig, options) => {
      await options.onStarted({ workerId: 'worker-cancelled', workerName: 'Worker' })
      started()
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
      })
    })
    const { workflow, coordinator } = await runtime({ executeManaged })
    const tool = createSpawnWorkerTool(config, skills, coordinator)

    const pending = (tool as any).execute(
      { skillId: 'recon', task: 'long task', complexity: 'medium' },
      { abortSignal: parent.signal },
    )
    await assigned
    parent.abort(new Error('parent stopped'))
    const output = await pending
    const value = output.value ?? output

    expect(value).toMatchObject({ workerId: 'worker-cancelled', status: 'cancelled', error: 'parent stopped' })
    expect(workflow.state.tasks[0]).toMatchObject({ workerId: 'worker-cancelled', status: 'cancelled' })
  })

  it('routes every parallel swarm item through managed execution and durable tasks', async () => {
    let sequence = 0
    const executeManaged = vi.fn(async (workerConfig, options) => {
      const workerId = `worker-${++sequence}`
      await options.onStarted({ workerId, workerName: `${workerConfig.skillId} Specialist` })
      return { workerId, workerName: `${workerConfig.skillId} Specialist`, result: { text: workerConfig.task }, durationMs: 2 }
    })
    const { workflow, coordinator } = await runtime({ executeManaged })
    const tool = createSpawnSwarmTool(config, skills, coordinator)

    const output = await (tool as any).execute({
      tasks: [
        { skillId: 'recon', task: 'first', tier: 'fast', complexity: 'low' },
        { skillId: 'web-pentest', task: 'second', tier: 'balanced', complexity: 'medium' },
      ],
      parallel: true,
      maxWorkers: 2,
    }, {})
    const value = output.value ?? output

    expect(value.workers).toHaveLength(2)
    expect(value.workers.every((worker: any) => worker.status === 'completed')).toBe(true)
    expect(executeManaged).toHaveBeenCalledTimes(2)
    expect(workflow.state.tasks).toHaveLength(2)
    expect(workflow.state.tasks.every((task) => task.status === 'completed' && Boolean(task.workerId))).toBe(true)
  })
})
