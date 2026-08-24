import { describe, expect, it, vi } from 'vitest'
import { AgentManager } from '../../src/lib/agent-manager'

describe('legacy AgentManager runtime ownership', () => {
  it('uses an injected engagement graph instead of process-global state', async () => {
    const finding = { id: 'finding:owned', type: 'Finding', properties: {} }
    const runtime = {
      target: 'https://owned.example',
      graph: { queryNodes: vi.fn(() => [finding]) },
    }
    const manager = AgentManager.forRuntime(runtime as any)

    expect(manager.getRuntime()).toBe(runtime)
    expect(await manager.getFindingsFromGraph()).toEqual([finding])
    expect(runtime.graph.queryNodes).toHaveBeenCalledOnce()
  })
})
