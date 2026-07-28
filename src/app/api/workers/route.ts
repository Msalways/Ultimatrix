import { NextResponse } from 'next/server'
import { getGlobalEmitter } from '@/events/emitter'

export const dynamic = 'force-dynamic'

const recentWorkerEvents: Array<{
  workerId: string
  workerName: string
  skillId: string
  task: string
  status: string
  startedAt: number
  completedAt?: number
  durationMs?: number
  toolCalls: number
}> = []

try {
  const bus = getGlobalEmitter()
  const maxRecent = 50

  bus.on('worker:spawned', (e) => {
    recentWorkerEvents.push({
      workerId: e.workerId,
      workerName: e.workerName,
      skillId: e.skillId,
      task: e.task,
      status: 'running',
      startedAt: e.timestamp,
      toolCalls: 0,
    })
    if (recentWorkerEvents.length > maxRecent) {
      recentWorkerEvents.splice(0, recentWorkerEvents.length - maxRecent)
    }
  })

  bus.on('worker:completed', (e) => {
    const w = recentWorkerEvents.find(w => w.workerId === e.workerId)
    if (w) {
      w.status = 'completed'
      w.completedAt = e.timestamp
      w.durationMs = e.durationMs
    }
  })

  bus.on('worker:error', (e) => {
    const w = recentWorkerEvents.find(w => w.workerId === e.workerId)
    if (w) {
      w.status = 'error'
      w.completedAt = e.timestamp
      w.durationMs = e.durationMs
    }
  })

  bus.on('worker:tool-call', (e) => {
    const w = recentWorkerEvents.find(w => w.workerId === e.workerId)
    if (w) w.toolCalls++
  })
} catch {
  // Bus not initialized
}

export async function GET() {
  try {
    const running = recentWorkerEvents.filter(w => w.status === 'running')

    return NextResponse.json({
      workers: running,
      recent: recentWorkerEvents.slice(-20),
      count: running.length,
    })
  } catch (err) {
    return NextResponse.json({ workers: [], error: (err as Error).message }, { status: 500 })
  }
}
