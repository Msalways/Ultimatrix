import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { TypedEventEmitter } from '../../src/events/emitter'
import { WebEngine } from '../../src/web/engine'

function engine(target: string): WebEngine {
  const instance = new WebEngine(target)
  ;(instance as any).runtime = { services: { events: new TypedEventEmitter() } }
  ;(instance as any).attachWorkerEventTracking()
  return instance
}

describe('Web event isolation', () => {
  it('keeps worker history on the owning engine bus', () => {
    const left = engine('https://left.example')
    const right = engine('https://right.example')

    left.getEvents().emit('worker:spawned', {
      workerId: 'left-worker', workerName: 'left', skillId: 'test', task: 'left-task', timestamp: 1,
    })

    expect(left.getWorkerEventSnapshot().workers.map(worker => worker.workerId)).toEqual(['left-worker'])
    expect(right.getWorkerEventSnapshot().workers).toEqual([])
  })

  it('keeps all event-serving routes target-addressed', async () => {
    const routes = await Promise.all(['solve', 'workers', 'swarm-events'].map(name =>
      readFile(join(process.cwd(), `src/app/api/${name}/route.ts`), 'utf8'),
    ))

    for (const source of routes) expect(source).not.toContain('getGlobalEmitter')
    expect(routes[1]).toContain("searchParams.get('target')")
    expect(routes[2]).toContain("searchParams.get('target')")
    expect(routes[0]).toContain('engine.getEvents()')
  })
})
