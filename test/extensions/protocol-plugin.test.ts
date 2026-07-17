import { describe, it, expect } from 'vitest'
import { register } from '../../plugins/protocol-surface/index'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'

describe('protocol-surface plugin (P3 example)', () => {
  it('registers as a plugin and exposes its tools via the dynamic registry', async () => {
    const reg = new DynamicToolRegistry()
    reg.registerPlugin('protocol-surface', register)

    const tools = await reg.list()
    const ids = tools.filter((t) => t.source === 'plugin').map((t) => t.id)
    expect(ids).toContain('plugin__protocol-surface__detectSmuggling')
    expect(ids).toContain('plugin__protocol-surface__probeCachePoisoning')
    expect(ids).toContain('plugin__protocol-surface__graphqlIntrospect')
  })

  it('resolves a plugin tool lazily without executing network calls', async () => {
    const reg = new DynamicToolRegistry()
    reg.registerPlugin('protocol-surface', register)
    const tool = await reg.resolve('plugin__protocol-surface__graphqlIntrospect')
    expect(tool).toBeDefined()
    expect(typeof (tool as any).execute).toBe('function')
  })
})
