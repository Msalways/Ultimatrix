import { describe, it, expect, beforeEach, vi } from 'vitest'
import { listToolsTool, loadToolTool, getAcquiredTools, resetAcquiredTools } from '../../src/extensions/tool-tools'
import { getGlobalToolRegistry } from '../../src/extensions/tool-registry'

function fakeBuiltins() {
  return {
    listTools: { id: 'listTools', description: 'list', inputSchema: {}, execute: vi.fn() },
    loadTool: { id: 'loadTool', description: 'load', inputSchema: {}, execute: vi.fn() },
    writeFinding: { id: 'writeFinding', description: 'finding', inputSchema: {}, execute: vi.fn() },
  }
}

beforeEach(() => {
  resetAcquiredTools()
  const reg = getGlobalToolRegistry()
  reg.registerBuiltins(fakeBuiltins() as any)
})

describe('extension discovery tools', () => {
  it('listTools enumerates builtin tools', async () => {
    const res: any = await (listToolsTool.execute as any)({ prefix: undefined })
    expect(res.tools.builtin).toContain('writeFinding')
    expect(res.tools.builtin).toContain('listTools')
    expect(res.tools.builtin).toContain('loadTool')
  })

  it('listTools honors prefix filter', async () => {
    const res: any = await (listToolsTool.execute as any)({ prefix: 'load' })
    expect(res.tools.builtin).toContain('loadTool')
    expect(res.tools.builtin).not.toContain('writeFinding')
  })

  it('loadTool acquires a tool and records it', async () => {
    const res: any = await (loadToolTool.execute as any)({ id: 'writeFinding', acquire: true })
    expect(res.ok).toBe(true)
    expect(getAcquiredTools()).toContain('writeFinding')
  })

  it('loadTool does not acquire when acquire=false', async () => {
    const res: any = await (loadToolTool.execute as any)({ id: 'writeFinding', acquire: false })
    expect(res.ok).toBe(true)
    expect(getAcquiredTools()).not.toContain('writeFinding')
  })

  it('loadTool reports failure for unknown tool', async () => {
    const res: any = await (loadToolTool.execute as any)({ id: 'mcp__ghost__x', acquire: true })
    expect(res.ok).toBe(false)
    expect(getAcquiredTools()).not.toContain('mcp__ghost__x')
  })
})
