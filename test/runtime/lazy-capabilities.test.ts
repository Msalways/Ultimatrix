import { describe, expect, it, vi } from 'vitest'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import { buildRuntimeEnvelope, runtimeEnvelopeTokenBudget, sanitizeDurableContext } from '../../src/runtime/context-envelope'

const descriptor = {
  id: 'coldTool',
  description: 'cold',
  namespace: 'test',
  source: 'builtin' as const,
  requirements: ['test-service'],
  readOnly: true,
}

describe('lazy capability registry', () => {
  it('coalesces concurrent initialization and keeps the service reusable across turns', async () => {
    const registry = new DynamicToolRegistry()
    const resolve = vi.fn(async () => ({ id: 'coldTool', execute: async () => ({ ok: true }) }))
    registry.registerLazyBuiltin(descriptor, resolve)
    await Promise.all([registry.activate('coldTool'), registry.activate('coldTool')])
    expect(resolve).toHaveBeenCalledTimes(1)
    registry.resetTurn()
    expect(registry.getActiveToolset()).toEqual({})
    await registry.activate('coldTool')
    expect(resolve).toHaveBeenCalledTimes(1)
  })

  it('reports initialization failure and remains retryable', async () => {
    const registry = new DynamicToolRegistry()
    let attempts = 0
    registry.registerLazyBuiltin(descriptor, async () => {
      if (++attempts === 1) throw new Error('temporary failure')
      return { id: 'coldTool' }
    })
    await expect(registry.activate('coldTool')).rejects.toMatchObject({ retryable: true, capabilityId: 'coldTool' })
    await expect(registry.activate('coldTool')).resolves.toMatchObject({ id: 'coldTool' })
  })

  it('enforces a turn policy before initialization', async () => {
    const registry = new DynamicToolRegistry()
    const resolve = vi.fn(async () => ({ id: 'coldTool' }))
    registry.registerLazyBuiltin({ ...descriptor, readOnly: false }, resolve)
    registry.setActivationPolicy(item => item.readOnly === true)
    await expect(registry.activate('coldTool')).rejects.toThrow('not permitted')
    expect(resolve).not.toHaveBeenCalled()
  })
})

describe('bounded runtime context', () => {
  it('uses the configured two-percent envelope bounds', () => {
    expect(runtimeEnvelopeTokenBudget(8_000)).toBe(500)
    expect(runtimeEnvelopeTokenBudget(128_000)).toBe(2000)
  })

  it('indexes state without raw reasoning or bodies', () => {
    const envelope = buildRuntimeEnvelope({ target: 'https://example.com', contextWindow: 8_000 })
    expect(envelope).toContain('<runtime-index>')
    expect(envelope).not.toContain('reasoning')
    expect(sanitizeDurableContext({ ok: 1, reasoning: 'scratch', requestBody: 'secret', nested: { tool_output: 'large' } }))
      .toEqual({ ok: 1, nested: {} })
  })
})
