import { describe, it, expect } from 'vitest'
import { registerAllTools } from '../../src/tools/registry'

describe('registry', () => {
  it('registerAllTools returns all tools', () => {
    const tools = registerAllTools()
    const keys = Object.keys(tools)
    expect(keys).toContain('httpRequest')
    expect(keys).toContain('recordTestCase')
    expect(keys).toContain('parseResponse')
    expect(keys).toContain('evaluateRendered')
    expect(keys).toContain('extractSessionCookie')
    expect(keys).toContain('recordEvidence')
    expect(keys).toContain('writeFinding')
    expect(keys).toContain('queryGraph')
    expect(keys).toContain('updateGraph')
    // Focused graph mutation tools
    expect(keys).toContain('upsertPage')
    expect(keys).toContain('addAction')
    expect(keys).toContain('addInput')
    expect(keys).toContain('addEndpoint')
    expect(keys).toContain('addFinding')
    expect(keys).toContain('addAuthFlow')
    expect(keys).toContain('addRBACRole')
    expect(keys).toContain('addAttack')
    expect(keys).toContain('chainFindings')
    expect(keys).toContain('readAppModelSection')
    expect(keys).toContain('writeAppModelSection')
    expect(keys).toContain('runRecon')
    expect(keys).toContain('askUser')
    expect(keys).toContain('getOastUrlTool')
    expect(keys).toContain('checkOastCallbacks')
    expect(keys.length).toBeGreaterThanOrEqual(31)
  })

  it('each tool has id, description, inputSchema', () => {
    const tools = registerAllTools()
    for (const [id, tool] of Object.entries(tools)) {
      expect(tool.id).toBe(id)
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })
})