import { afterEach, describe, it, expect, vi } from 'vitest'
import { createExtensionTools } from '../../src/extensions/tool-tools'
import { DynamicToolRegistry } from '../../src/extensions/tool-registry'
import type { McpClient, McpServerConfig } from '../../src/extensions/types'
import { setExternalToolsConfig } from '../../src/safety/scope-guard'

afterEach(() => setExternalToolsConfig(null))

function setup() {
  const connected: string[] = []
  const factory = (config: McpServerConfig): McpClient => ({
    async connect() { connected.push(config.name) },
    async close() {},
    async listTools() { return { tools: [{ name: 'search', description: 'search' }] } },
    async callTool({ name }) { return { content: [{ type: 'text', text: `called ${name}` }] } },
  })
  const registry = new DynamicToolRegistry(factory)
  registry.registerBuiltins({ writeFinding: { id: 'writeFinding', description: 'finding', execute: vi.fn() } } as any)
  registry.registerMcp({ name: 'github', command: 'gh-mcp' })
  return { ...createExtensionTools(registry), registry, connected }
}

describe('extension discovery tools', () => {
  it('lists builtins and registered connectors without connecting', async () => {
    const { listTools, connected } = setup()
    const res: any = await (listTools.execute as any)({})
    expect(res.tools.builtin).toContainEqual(expect.objectContaining({ id: 'writeFinding', description: 'finding' }))
    expect(res.connectors).toContainEqual({ id: 'mcp:github', source: 'mcp', state: 'registered' })
    expect(connected).toEqual([])
  })

  it('discovers only an explicitly named connector', async () => {
    const { listTools, connected } = setup()
    const res: any = await (listTools.execute as any)({ connector: 'mcp:github' })
    expect(res.tools.mcp).toContainEqual(expect.objectContaining({ id: 'mcp__github__search', description: 'search', server: 'github' }))
    expect(connected).toEqual(['github'])
  })

  it('loads one exact extension tool into the native active toolset', async () => {
    const { loadTool, registry } = setup()
    expect(await (loadTool.execute as any)({ id: 'mcp__github__search' })).toEqual(expect.objectContaining({ ok: true }))
    expect(registry.getActiveToolset()).toHaveProperty('mcp__github__search')
    setExternalToolsConfig({ enabled: true } as any)
    const res: any = await registry.getActiveToolset().mcp__github__search.execute?.({ q: 'x' }, {})
    expect(res.content.text).toBe('called search')
  })

  it('resets active schemas without discarding initialized capabilities', async () => {
    const { loadTool, registry } = setup()
    await (loadTool.execute as any)({ id: 'writeFinding' })
    expect(registry.getActiveBuiltinIds()).toEqual(['writeFinding'])
    registry.resetTurn()
    expect(registry.getActiveBuiltinIds()).toEqual([])
    await (loadTool.execute as any)({ id: 'writeFinding' })
    expect(registry.getActiveBuiltinIds()).toEqual(['writeFinding'])
  })
})
