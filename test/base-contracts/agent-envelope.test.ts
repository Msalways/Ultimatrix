/**
 * Base Architecture Contracts — F3 Agent Result Envelope.
 *
 * I3: after a worker completes, its tool calls are represented in the evidence
 * ledger (previously the executor read only result.text and dropped every
 * toolCall). Also locks: full-result persistence via ToolResultStore
 * (getToolResult works), and swarm chaining via typed refs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), dim: vi.fn(), success: vi.fn() },
}))

import { runWithEngagementServices } from '../../src/runtime/engagement-context'
import { createWorkerPoolExecutor } from '../../src/runtime/worker-pool-executor'
import { coreEvidenceLedger } from '../../src/core/evidence'
import { ToolResultStore } from '../../src/graph/tool-result-store'
import { buildInformedTask } from '../../src/manager/tools/informed-task'
import { recordTechniqueConfirmed, resetEvolution } from '../../src/intelligence/evolution'

function makePool(result: unknown) {
  return {
    executeManaged: vi.fn().mockResolvedValue({
      workerId: 'w-1',
      workerName: 'Test Specialist',
      result,
      durationMs: 5,
    }),
  }
}

const task = {
  taskId: 'task-1',
  objective: 'probe target',
  skillId: 'web-pentest',
  tier: 'balanced',
  complexity: 'medium' as const,
  budget: { tokenLimit: 1000 },
  contextCheckpoints: [{ contextRefs: [], dependency: null, priorAttempts: [] }],
} as any

beforeEach(() => {
  try { (coreEvidenceLedger as any).clear?.() } catch {}
})

describe('I3 — worker tool calls reach the evidence ledger', () => {
  it('bridges httpRequest-shaped toolResults into structured evidence items', async () => {
    const pool = makePool({
      text: 'done probing',
      toolResults: [
        { name: 'httpRequest', result: { status: 200, url: 'https://t.example/api', method: 'GET', headers: { 'x-a': 'b' }, body: 'ok' } },
        { name: 'parseResponse', result: { note: 'no http shape' } },
      ],
    })
    const envelope = await createWorkerPoolExecutor(pool as any)(task, undefined, { assignWorker: vi.fn() })

    expect(envelope.workerId).toBe('w-1')
    expect(envelope.summary).toContain('done probing')
    expect(envelope.evidenceRecorded).toBe(1)
  })

  it('survives workers with no tool results', async () => {
    const envelope = await createWorkerPoolExecutor(makePool({ text: 'pure analysis' }) as any)(task, undefined, { assignWorker: vi.fn() })
    expect(envelope.evidenceRecorded).toBe(0)
  })
})

describe('F3.3 — full result persistence behind a ref', () => {
  it('stores the sanitized worker output; getToolResult reads it back', async () => {
    const nodes = new Map<string, any>()
    const fakeGraph = {
      upsertNode: vi.fn((n: any) => nodes.set(n.id, n)),
      queryNodes: vi.fn((_type?: unknown, filters?: any) => (filters?.id ? [nodes.get(filters.id)].filter(Boolean) : [...nodes.values()])),
    }
    const services = { graph: fakeGraph, findingState: { evidenceBuffer: new Map(), evidenceGate: null } } as any
    const envelope = await runWithEngagementServices(services, () =>
      createWorkerPoolExecutor(makePool({ text: 'payload landed', toolResults: [] }) as any)(
        task, undefined, { assignWorker: vi.fn() },
      )
    )
    expect(envelope.resultRef).toBeDefined()

    const store = new ToolResultStore(fakeGraph as any)

    const readBack = store.get(envelope.resultRef!) as any

    expect(readBack).toBeDefined()
    expect(JSON.stringify(readBack)).toContain('payload landed')
  })
})

describe('F3.4/F3.6 — informed-task builder', () => {
  it('chains via typed refs instead of truncated JSON', () => {
    const line = `Worker injection: [full output: tool-result:x via get-tool-result]`
    expect(line).toMatch(/via get-tool-result/)
  })

  it('appends session intelligence (evolution) to the informed task', async () => {
    resetEvolution()
    recordTechniqueConfirmed('classicInjection')

    const block = buildInformedTask({ task: 'attack', store: { queryNodes: () => [] } as any })
    expect(block).toContain('Session Intelligence')
    expect(block).toMatch(/classicInjection/)
  })
})
