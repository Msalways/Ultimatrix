import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskCoordinator } from '../../src/runtime/task-coordinator'
import { attributeModelCall } from '../../src/runtime/task-attribution'
import { WorkflowStore } from '../../src/workflow/store'

const dirs: string[] = []

async function createStore(name: string): Promise<{ path: string; store: WorkflowStore }> {
  const dir = await mkdtemp(join(tmpdir(), `ultimatrix-runtime-${name}-`))
  dirs.push(dir)
  const path = join(dir, 'workflow.json')
  return { path, store: await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' }) }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('TaskCoordinator lifecycle proof', () => {
  it('persists a stable task separately from its worker and keeps evidence as references', async () => {
    const { path, store } = await createStore('complete')
    const seen: string[] = []
    const coordinator = new TaskCoordinator(store, async (task) => {
      seen.push(task.status)
      return {
        workerId: 'worker-attempt-1',
        summary: 'bounded result',
        evidence: [{ id: 'evidence-1', kind: 'response', recordedAt: 10 }],
      }
    }, () => 10)

    const result = await coordinator.run({ taskId: 'task-1', objective: 'inspect endpoint', skillId: 'recon' })
    const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' })

    expect(seen).toEqual(['running'])
    expect(result).toMatchObject({ taskId: 'task-1', workerId: 'worker-attempt-1', status: 'completed' })
    expect(reloaded.state.tasks[0]).toMatchObject({ taskId: 'task-1', workerId: 'worker-attempt-1', evidenceRefs: ['evidence-1'] })
    expect(reloaded.state.evidenceRefs).toEqual([{ id: 'evidence-1', kind: 'response', recordedAt: 10 }])
  })

  it('propagates a deadline through AbortSignal and persists timed_out', async () => {
    const { store } = await createStore('timeout')
    let observedAbort = false
    const coordinator = new TaskCoordinator(store, (_task, signal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true
        reject(signal.reason)
      }, { once: true })
    }))

    const result = await coordinator.run({ taskId: 'task-timeout', objective: 'wait', timeoutMs: 5 })

    expect(observedAbort).toBe(true)
    expect(result.status).toBe('timed_out')
    expect(store.state.tasks[0].status).toBe('timed_out')
  })

  it('cancels a running executor by stable task ID', async () => {
    const { store } = await createStore('cancel')
    const coordinator = new TaskCoordinator(store, (task, signal) => new Promise((_, reject) => {
      queueMicrotask(() => coordinator.cancel(task.taskId, 'operator stopped task'))
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    }))

    const result = await coordinator.run({ taskId: 'task-cancel', objective: 'run until stopped' })

    expect(result.status).toBe('cancelled')
    expect(result.error).toBe('operator stopped task')
  })

  it('reconciles persisted queued and running tasks after restart', async () => {
    const { path, store } = await createStore('recover')
    const base = {
      objective: 'unfinished', dependencyTaskIds: [], contextRefs: [], requiredCapabilities: [],
      acceptanceCriteria: [], acceptanceResults: [], budget: {}, attempts: 1, evidenceRefs: [], createdAt: 1, updatedAt: 1,
    }
    store.recordTask({ ...base, taskId: 'queued', status: 'queued' })
    store.recordTask({ ...base, taskId: 'running', status: 'running' })
    store.recordTask({ ...base, taskId: 'done', status: 'completed' })
    await store.save()

    const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' })
    const coordinator = new TaskCoordinator(reloaded, async () => ({ summary: '' }), () => 20)
    const recovered = await coordinator.recoverInterrupted()

    expect(recovered.map((task) => task.taskId)).toEqual(['queued', 'running'])
    expect(reloaded.state.tasks.find((task) => task.taskId === 'done')?.status).toBe('completed')
    expect(reloaded.state.tasks.filter((task) => task.status === 'failed')).toHaveLength(2)
  })

  it('rejects duplicate task IDs instead of overwriting durable state', async () => {
    const { store } = await createStore('duplicate')
    const coordinator = new TaskCoordinator(store, async () => ({ summary: 'done' }))
    await coordinator.run({ taskId: 'stable-task', objective: 'first assignment' })

    await expect(coordinator.run({ taskId: 'stable-task', objective: 'replacement' }))
      .rejects.toThrow('already exists')
    expect(store.state.tasks).toHaveLength(1)
    expect(store.state.tasks[0].objective).toBe('first assignment')
  })

  it('records every attempt and retries only typed configured statuses', async () => {
    const { path, store } = await createStore('retry')
    let calls = 0
    const coordinator = new TaskCoordinator(store, async (_task, _signal, control) => {
      calls++
      await control.assignWorker({ workerId: `worker-${calls}`, workerName: 'Worker' })
      if (calls === 1) throw new Error('provider unavailable')
      return { summary: 'recovered', graphRefs: ['graph-node-2'] }
    })

    const result = await coordinator.run({
      taskId: 'retryable', objective: 'retry once', maxAttempts: 2, retryOn: ['failed'],
    })
    const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' })

    expect(result).toMatchObject({ status: 'completed', attempts: 2, workerId: 'worker-2', graphRefs: ['graph-node-2'] })
    expect(result.attemptHistory).toMatchObject([
      { attemptId: 'retryable:attempt:1', status: 'failed', workerId: 'worker-1' },
      { attemptId: 'retryable:attempt:2', status: 'completed', workerId: 'worker-2', graphRefs: ['graph-node-2'] },
    ])
    expect(reloaded.state.tasks[0].attemptHistory).toHaveLength(2)
  })

  it('enforces one cumulative token budget across retries and persists usage', async () => {
    const { path, store } = await createStore('token-budget')
    let calls = 0
    const coordinator = new TaskCoordinator(store, async () => {
      calls++
      const budgetError = attributeModelCall(calls === 1
        ? { inputTokens: 50, outputTokens: 10 }
        : { inputTokens: 30, outputTokens: 10 })
      if (budgetError) throw budgetError
      throw new Error('retryable provider failure')
    })

    const result = await coordinator.run({
      taskId: 'budgeted', objective: 'bounded work', tokenLimit: 100,
      maxAttempts: 3, retryOn: ['failed'],
    })
    const persisted = (await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' })).state.tasks[0]

    expect(calls).toBe(2)
    expect(result).toMatchObject({
      status: 'budget_exceeded', attempts: 2,
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, modelCalls: 2, reportedCalls: 2 },
    })
    expect(persisted.attemptHistory.map((attempt) => attempt.usage.totalTokens)).toEqual([60, 40])
  })

  it('fails a budgeted task closed when a model call has no provider usage', async () => {
    const { store } = await createStore('token-unverifiable')
    const coordinator = new TaskCoordinator(store, async () => {
      attributeModelCall()
      return { summary: 'cannot verify usage' }
    })

    const result = await coordinator.run({ taskId: 'unverifiable', objective: 'bounded work', tokenLimit: 100 })

    expect(result).toMatchObject({
      status: 'budget_unverifiable',
      usage: { totalTokens: 0, modelCalls: 1, reportedCalls: 0 },
    })
  })

  it('persists waiting state and resumes explicitly with a new bounded context checkpoint', async () => {
    const { store } = await createStore('waiting')
    let calls = 0
    const checkpoints: any[] = []
    const coordinator = new TaskCoordinator(store, async (task, _signal, control) => {
      calls++
      checkpoints.push(task.contextCheckpoints.at(-1))
      if (calls === 1) {
        await control.waitForInput({ reason: 'Authentication required', inputKey: 'session' })
        return { summary: '' }
      }
      return { summary: 'continued' }
    })

    const waiting = await coordinator.run({ taskId: 'waiter', objective: 'continue after login' })
    expect(waiting).toMatchObject({ status: 'waiting', wait: { reason: 'Authentication required', inputKey: 'session' } })

    await coordinator.resumeWaiting('waiter', 'session-ref-1')
    const completed = await coordinator.executePlanned('waiter')
    expect(completed).toMatchObject({ status: 'completed', attempts: 2 })
    expect(checkpoints[1]).toMatchObject({ contextRefs: ['session-ref-1'], priorAttempts: [{ attemptId: 'waiter:attempt:1', status: 'waiting' }] })
  })

  it('requeues only interrupted work whose typed policy permits it', async () => {
    const { path, store } = await createStore('recover-policy')
    const coordinator = new TaskCoordinator(store, async () => ({ summary: 'resumed' }))
    const retryable = await coordinator.plan({ taskId: 'retry-interrupted', objective: 'retry', maxAttempts: 2, retryOn: ['interrupted'] })
    const terminal = await coordinator.plan({ taskId: 'fail-interrupted', objective: 'fail' })
    for (const task of [retryable, terminal]) {
      task.status = 'running'
      task.attempts = 1
      task.attemptHistory.push({
        attemptId: `${task.taskId}:attempt:1`, number: 1, status: 'running', evidenceRefs: [], graphRefs: [],
        usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, modelCalls: 0, reportedCalls: 0 },
      })
      store.recordTask(task)
    }
    await store.save()

    const reloaded = await WorkflowStore.loadOrCreate(path, { target: 'https://runtime.example' })
    const resumed = new TaskCoordinator(reloaded, async () => ({ summary: 'resumed' }))
    await resumed.recoverInterrupted()

    expect(resumed.getTask('retry-interrupted')).toMatchObject({ status: 'planned', attempts: 1, workerId: undefined })
    expect(resumed.getTask('fail-interrupted')).toMatchObject({ status: 'failed', error: 'Execution interrupted before a terminal checkpoint' })
    expect(resumed.getTask('retry-interrupted')?.attemptHistory[0].status).toBe('interrupted')
  })
})
