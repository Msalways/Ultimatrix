import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createRunPrimitiveTool } from '../../src/primitives/index'
import { resolvePrimitivesForSkills } from '../../src/solver/skills/tool-filter'

// Mock the primitive framework to avoid side effects
vi.mock('../../src/primitives/framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/primitives/framework')>()
  return {
    ...actual,
    // Keep real getPrimitive/listPrimitives so validation works
  }
})

describe('createRunPrimitiveTool', () => {
  it('creates a tool with scoped primitive IDs in schema', () => {
    const tool = createRunPrimitiveTool(['authBypass', 'idorSwapper', 'authzMatrix'])
    expect(tool.id).toBe('runPrimitive')
    // The schema should be a Zod object with primitiveId enum
    const schema = (tool as any).inputSchema
    expect(schema).toBeDefined()
  })

  it('throws when no valid primitives are provided', () => {
    expect(() => createRunPrimitiveTool([])).toThrow('No authorized primitives')
    expect(() => createRunPrimitiveTool(['nonExistent123'])).toThrow('No authorized primitives')
  })

  it('filters out invalid primitive IDs and creates with valid ones', () => {
    // 'authBypass' and 'idorSwapper' exist; 'fakePrimitive' does not
    const tool = createRunPrimitiveTool(['authBypass', 'fakePrimitive', 'idorSwapper'])
    expect(tool.id).toBe('runPrimitive')
    // Should not throw — valid IDs were found
  })
})

describe('resolvePrimitivesForSkills', () => {
  it('returns primitives declared by a skill', () => {
    const primitives = resolvePrimitivesForSkills(['authorization'])
    expect(primitives).toContain('authBypass')
    expect(primitives).toContain('idorSwapper')
    expect(primitives).toContain('authzMatrix')
    expect(primitives).toContain('tenantIsolation')
    expect(primitives.length).toBe(4)
  })

  it('returns empty array for skills without primitives', () => {
    // 'reporting' skill has no primitives declared
    const primitives = resolvePrimitivesForSkills(['reporting'])
    expect(primitives).toEqual([])
  })

  it('unions primitives from multiple skills', () => {
    const primitives = resolvePrimitivesForSkills(['authorization', 'exploitation'])
    // authorization: authBypass, idorSwapper, authzMatrix, tenantIsolation
    // exploitation: classicInjection, rceClass
    expect(primitives).toContain('authBypass')
    expect(primitives).toContain('classicInjection')
    expect(primitives.length).toBeGreaterThanOrEqual(5)
  })

  it('deduplicates primitives across skills', () => {
    // Both api-security and authorization declare idorSwapper
    const primitives = resolvePrimitivesForSkills(['authorization', 'api-security'])
    const idorCount = primitives.filter(p => p === 'idorSwapper').length
    expect(idorCount).toBe(1)
  })

  it('throws for unknown skill IDs', () => {
    expect(() => resolvePrimitivesForSkills(['nonExistentSkill'])).toThrow('Skill not found')
  })
})

describe('Phase 1 integration: scoped runPrimitive from skill primitives', () => {
  it('authorization skill gets exactly 4 scoped primitives', () => {
    const allowedPrimitives = resolvePrimitivesForSkills(['authorization'])
    expect(allowedPrimitives.length).toBe(4)

    const tool = createRunPrimitiveTool(allowedPrimitives)
    expect(tool.id).toBe('runPrimitive')
    // Description should list only the 4 allowed primitives
    const desc = (tool as any).description as string
    expect(desc).toContain('authBypass')
    expect(desc).toContain('idorSwapper')
    expect(desc).toContain('authzMatrix')
    expect(desc).toContain('tenantIsolation')
    expect(desc).not.toContain('classicInjection')
    expect(desc).not.toContain('ssrfOast')
  })

  it('exploitation skill gets only injection primitives', () => {
    const allowedPrimitives = resolvePrimitivesForSkills(['exploitation'])
    expect(allowedPrimitives).toContain('classicInjection')
    expect(allowedPrimitives).toContain('rceClass')
    expect(allowedPrimitives).not.toContain('authBypass')
    expect(allowedPrimitives).not.toContain('idorSwapper')
  })

  it('skills without primitives get empty allowed list', () => {
    const allowedPrimitives = resolvePrimitivesForSkills(['reporting'])
    expect(allowedPrimitives.length).toBe(0)
    // createRunPrimitiveTool should throw for empty list
    expect(() => createRunPrimitiveTool(allowedPrimitives)).toThrow('No authorized primitives')
  })
})
