import { describe, it, expect } from 'vitest'
import { shapeOf, mutationsFor, type RelationSeed } from '../../src/primitives/constraint-mutators'

describe('constraint-mutators: shapeOf (value shape, no name inspection)', () => {
  it('classifies a pure-numeric value as numeric', () => {
    expect(shapeOf('123')).toBe('numeric')
    expect(shapeOf('999999')).toBe('numeric')
    expect(shapeOf('0')).toBe('numeric')
  })

  it('classifies an alnum-token value as enum', () => {
    expect(shapeOf('abc123')).toBe('enum')
    expect(shapeOf('admin')).toBe('enum')
    expect(shapeOf('foreign')).toBe('enum')
  })

  it('classifies a uuid-shaped value as uuid', () => {
    expect(shapeOf('8c2b4f10-1a2b-4c3d-9e8f-0123456789ab')).toBe('uuid')
    expect(shapeOf('00000000-0000-0000-0000-000000000001')).toBe('uuid')
  })

  it('classifies free-text/long/space-bearing value as unknown', () => {
    expect(shapeOf('some long text with spaces')).toBe('unknown')
  })

  it('trims whitespace before classifying', () => {
    expect(shapeOf('  42  ')).toBe('numeric')
  })
})

describe('constraint-mutators: mutationsFor', () => {
  const numericSeed: RelationSeed = {
    relationType: 'REINGESTS',
    sourceValue: '42',
    sinkParam: 'id',
    sourceKind: 'response-field',
  }
  const uuidSeed: RelationSeed = {
    relationType: 'REINGESTS',
    sourceValue: '8c2b4f10-1a2b-4c3d-9e8f-0123456789ab',
    sinkParam: 'token',
    sourceKind: 'response-field',
  }
  const enumSeed: RelationSeed = {
    relationType: 'VALUE_ORIGIN',
    sourceValue: 'admin',
    sinkParam: 'role',
    sourceKind: 'header',
  }

  it('always includes an omit mutation for the sink param (any shape)', () => {
    for (const seed of [numericSeed, uuidSeed, enumSeed]) {
      const ms = mutationsFor(seed)
      const omit = ms.find((m) => m.kind === 'omit')
      expect(omit).toBeDefined()
      expect(omit!.param).toBe(seed.sinkParam)
      expect(omit!.value).toBe('')
    }
  })

  it('for a numeric source, foreign mutations carry OTHER numeric values (none equal sourceValue)', () => {
    const ms = mutationsFor(numericSeed)
    const foreign = ms.filter((m) => m.kind === 'foreign')
    expect(foreign.length).toBeGreaterThan(0)
    for (const f of foreign) {
      expect(f.value).not.toBe(numericSeed.sourceValue)
      expect(f.value).toMatch(/^\d+$/)
    }
  })

  it('for a uuid source, foreign mutations carry a DIFFERENT uuid', () => {
    const ms = mutationsFor(uuidSeed)
    const foreign = ms.filter((m) => m.kind === 'foreign')
    expect(foreign.length).toBeGreaterThan(0)
    for (const f of foreign) {
      expect(f.value).not.toBe(uuidSeed.sourceValue)
      expect(shapeOf(f.value)).toBe('uuid')
    }
  })

  it('returns at least 3 mutations for a typical seed', () => {
    expect(mutationsFor(numericSeed).length).toBeGreaterThanOrEqual(3)
    expect(mutationsFor(uuidSeed).length).toBeGreaterThanOrEqual(3)
    expect(mutationsFor(enumSeed).length).toBeGreaterThanOrEqual(3)
  })

  it('does not rely on a hardcoded field name — only value shape drives foreign values', () => {
    const renamed: RelationSeed = { ...numericSeed, sinkParam: 'completelyDifferentName' }
    const ms = mutationsFor(renamed)
    const foreign = ms.filter((m) => m.kind === 'foreign')
    // All foreign values are numeric regardless of param name.
    for (const f of foreign) expect(f.value).toMatch(/^\d+$/)
    // Omit targets the (renamed) param, proving param is data-driven not baked in.
    expect(ms.find((m) => m.kind === 'omit')!.param).toBe('completelyDifferentName')
  })
})
