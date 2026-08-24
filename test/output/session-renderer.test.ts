import { describe, it, expect, vi, afterEach } from 'vitest'
import { createSolverRenderer } from '../../src/session'

describe('createSolverRenderer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('streams reasoning when interaction.showReasoning is true without requiring a debug env var', () => {
    const oldEnv = process.env.ULTIMATRIX_DEBUG_REASONING
    delete process.env.ULTIMATRIX_DEBUG_REASONING
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      writes.push(String(chunk))
      return true
    })

    const render = createSolverRenderer({}, { prompt: 'hi' }, { interaction: { showReasoning: true } })
    render({ kind: 'reasoning', text: 'visible thinking', index: 0 })
    render.final()
    render.flush()
    render.exit()

    if (oldEnv === undefined) delete process.env.ULTIMATRIX_DEBUG_REASONING
    else process.env.ULTIMATRIX_DEBUG_REASONING = oldEnv
    expect(writes.join('')).toContain('visible thinking')
  })
})
