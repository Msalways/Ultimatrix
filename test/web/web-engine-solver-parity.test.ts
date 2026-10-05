import { afterEach, describe, expect, it, vi } from 'vitest'
import * as solverModule from '../../src/solver/solver'
import { WebEngine } from '../../src/web/engine'
import type { SolveResult } from '../../src/solver/solver'

describe('WebEngine solver parity', () => {
  afterEach(() => vi.restoreAllMocks())

  it('passes its engagement-owned discovery services into the shared solver', async () => {
    const lazyServices = { setTurnObservers: vi.fn(), crawlState: undefined }
    const engine = new WebEngine('https://target.example')
    const solve = vi.spyOn(solverModule, 'solve').mockResolvedValue({
      steps: 0,
      toolCalls: 0,
      tokensUsed: 0,
      newFindings: 0,
    } as SolveResult)

    Object.assign(engine as any, {
      runtime: { services: {}, run: (operation: () => unknown) => operation() },
      _initialized: true,
      _workflow: { state: { workflowId: 'web-workflow-test' } },
      config: {},
      engineServices: {
        solverBrain: {},
        sessionBlackboard: {},
        sessionEvidence: {},
        sessionLoopDetector: {},
        sessionReflexion: {},
        lazyServices,
      },
    })

    await engine.solve({ goal: 'map the observed workflow', interactionMode: 'run' })

    expect(solve).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      interactionMode: 'run',
      lazyServices,
    }))
  })
})
