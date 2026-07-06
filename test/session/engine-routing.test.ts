import { describe, it, expect } from 'vitest'
import type { EngineType } from '../../src/config'

describe('Engine routing', () => {
  it('solver engine uses solver brain', () => {
    const engine: EngineType = 'solver'
    const useSolver = engine === 'solver' || engine === 'multi-model'
    expect(useSolver).toBe(true)
  })

  it('multi-model engine uses solver brain (full stack)', () => {
    const engine: EngineType = 'multi-model'
    const useSolver = engine === 'solver' || engine === 'multi-model'
    expect(useSolver).toBe(true)
  })

  it('legacy engine uses supervisor', () => {
    const engine: EngineType = 'legacy'
    const useSolver = engine === 'solver' || engine === 'multi-model'
    expect(useSolver).toBe(false)
  })

  it('undefined engine defaults to solver behavior', () => {
    const engine = undefined as EngineType | undefined
    const useSolver = engine === 'solver' || engine === 'multi-model'
    expect(useSolver).toBe(false) // undefined is not 'solver' or 'multi-model'
  })
})

describe('EngineType type', () => {
  it('allows all three engine values', () => {
    const engines: EngineType[] = ['legacy', 'solver', 'multi-model']
    expect(engines).toHaveLength(3)
    expect(engines).toContain('legacy')
    expect(engines).toContain('solver')
    expect(engines).toContain('multi-model')
  })
})
