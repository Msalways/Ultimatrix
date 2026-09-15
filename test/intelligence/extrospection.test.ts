import { describe, it, expect, beforeEach } from 'vitest'
import { ExtrospectionManager } from '../../src/intelligence/extrospection'

describe('ExtrospectionManager', () => {
  let manager: ExtrospectionManager

  beforeEach(() => {
    manager = new ExtrospectionManager()
  })

  it('records a check', () => {
    const check = manager.record({
      findingId: 'f1',
      endpoint: '/api/users',
      checkType: 'refetch',
      result: 'confirmed',
      details: 'Vulnerability still present',
    })
    expect(check.findingId).toBe('f1')
    expect(check.timestamp).toBeDefined()
  })

  it('gets checks by finding', () => {
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: 'ok' })
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'replay', result: 'volatile', details: 'changed' })
    manager.record({ findingId: 'f2', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: 'ok' })

    expect(manager.getByFinding('f1')).toHaveLength(2)
    expect(manager.getByFinding('f2')).toHaveLength(1)
  })

  it('computes confidence as ratio of confirmed checks', () => {
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: '' })
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'replay', result: 'confirmed', details: '' })

    expect(manager.getConfidence('f1')).toBe(1.0)
  })

  it('returns 0.5 confidence for unknown finding', () => {
    expect(manager.getConfidence('unknown')).toBe(0.5)
  })

  it('detects volatile findings', () => {
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: '' })
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'replay', result: 'volatile', details: 'state changed' })

    expect(manager.isVolatile('f1')).toBe(true)
  })

  it('non-volatile when all confirmed', () => {
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: '' })

    expect(manager.isVolatile('f1')).toBe(false)
  })

  it('returns all checks', () => {
    manager.record({ findingId: 'f1', endpoint: '/api', checkType: 'refetch', result: 'confirmed', details: '' })
    manager.record({ findingId: 'f2', endpoint: '/api', checkType: 'replay', result: 'volatile', details: '' })

    expect(manager.getAll()).toHaveLength(2)
  })
})
