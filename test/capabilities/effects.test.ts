import { describe, it, expect } from 'vitest'
import { TOOL_EFFECTS, aggregateEffects, getToolEffects } from '../../src/capabilities/effects'

describe('TOOL_EFFECTS', () => {
  it('has effects for all worker-universal tools', () => {
    const workerUniversal = ['queryGraph', 'getTargetSummary', 'getEndpointsWithParams', 'getCapturedHeaders', 'encodeDecode', 'askUser', 'getOastUrlTool']
    for (const tool of workerUniversal) {
      expect(TOOL_EFFECTS[tool], `missing effects for ${tool}`).toBeDefined()
    }
  })

  it('has effects for execution tools', () => {
    const executionTools = ['writeFinding', 'runPrimitive', 'runCampaign', 'runRecon']
    for (const tool of executionTools) {
      expect(TOOL_EFFECTS[tool], `missing effects for ${tool}`).toBeDefined()
    }
  })

  it('marks network tools correctly', () => {
    expect(TOOL_EFFECTS.httpRequest?.network).toBe(true)
    expect(TOOL_EFFECTS.stagehand_navigate?.network).toBe(true)
    expect(TOOL_EFFECTS.queryGraph?.network).toBeFalsy()
  })

  it('marks mutatesTarget correctly', () => {
    expect(TOOL_EFFECTS.runPrimitive?.mutatesTarget).toBe(true)
    expect(TOOL_EFFECTS.runCampaign?.mutatesTarget).toBe(true)
    expect(TOOL_EFFECTS.httpRequest?.mutatesTarget).toBeFalsy()
  })

  it('marks readsSecrets correctly', () => {
    expect(TOOL_EFFECTS.getCapturedHeaders?.readsSecrets).toBe(true)
    expect(TOOL_EFFECTS.extractSessionCookie?.readsSecrets).toBe(true)
    expect(TOOL_EFFECTS.httpRequest?.readsSecrets).toBeFalsy()
  })
})

describe('aggregateEffects', () => {
  it('returns empty effects for empty tool list', () => {
    const effects = aggregateEffects([])
    expect(effects.network).toBe(false)
    expect(effects.mutatesTarget).toBe(false)
    expect(effects.estimatedLatencyMs).toBe(0)
  })

  it('aggregates boolean flags (any true → true)', () => {
    const effects = aggregateEffects(['queryGraph', 'httpRequest'])
    expect(effects.network).toBe(true) // httpRequest has network
    expect(effects.externallyVisible).toBe(true) // httpRequest has externallyVisible
  })

  it('sums numeric values', () => {
    const effects = aggregateEffects(['httpRequest', 'stagehand_navigate'])
    expect(effects.estimatedLatencyMs).toBe(7000) // 2000 + 5000
  })

  it('picks worst reversibility', () => {
    const effects = aggregateEffects(['httpRequest', 'runPrimitive'])
    expect(effects.reversibility).toBe('irreversible') // runPrimitive is irreversible
  })

  it('handles unknown tools gracefully', () => {
    const effects = aggregateEffects(['httpRequest', 'unknownTool', 'runPrimitive'])
    expect(effects.network).toBe(true)
    expect(effects.mutatesTarget).toBe(true)
  })

  it('aggregates authorization skill tool set', () => {
    const authTools = ['httpRequest', 'writeFinding', 'queryGraph', 'runPrimitive']
    const effects = aggregateEffects(authTools)
    expect(effects.network).toBe(true)
    expect(effects.writesState).toBe(true)
    expect(effects.mutatesTarget).toBe(true)
    expect(effects.externallyVisible).toBe(true)
    expect(effects.reversibility).toBe('irreversible')
  })

  it('distinguishes read-only tool set', () => {
    const readOnlyTools = ['queryGraph', 'getTargetSummary', 'getEndpointsWithParams', 'encodeDecode']
    const effects = aggregateEffects(readOnlyTools)
    expect(effects.network).toBeFalsy()
    expect(effects.mutatesTarget).toBeFalsy()
    expect(effects.reversibility).toBe('read-only')
  })
})

describe('getToolEffects', () => {
  it('returns effects for known tool', () => {
    const effects = getToolEffects('httpRequest')
    expect(effects.network).toBe(true)
  })

  it('returns empty object for unknown tool', () => {
    const effects = getToolEffects('nonexistent')
    expect(effects).toEqual({})
  })
})
