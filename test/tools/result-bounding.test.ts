/**
 * Tests for result-bounding (Phase E: Result Bounding)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock graph store with upsertNode/queryNodes
const mockNodes = new Map<string, any>()
vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: vi.fn(() => ({
    upsertNode: vi.fn((node: any) => { mockNodes.set(node.id, node) }),
    queryNodes: vi.fn((_type: any, filter: any) => {
      if (filter?.id) {
        const node = mockNodes.get(filter.id)
        return node ? [node] : []
      }
      return []
    }),
  })),
}))

describe('result-bounding', () => {
  let boundResult: typeof import('../../src/tools/result-bounding').boundResult
  let retrieveBoundedResult: typeof import('../../src/tools/result-bounding').retrieveBoundedResult

  beforeEach(async () => {
    vi.clearAllMocks()
    mockNodes.clear()
    const mod = await import('../../src/tools/result-bounding')
    boundResult = mod.boundResult
    retrieveBoundedResult = mod.retrieveBoundedResult
  })

  describe('boundResult()', () => {
    it('returns small results inline without storage', () => {
      const data = { status: 200, body: 'hello' }
      const result = boundResult('httpRequest', data)
      expect(result.truncated).toBe(false)
      expect(result.data).toEqual(data)
      expect(result.resultRef).toBeUndefined()
      expect(result.tool).toBe('httpRequest')
      expect(result.sizeChars).toBeGreaterThan(0)
    })

    it('returns string results inline', () => {
      const result = boundResult('httpRequest', 'short response')
      expect(result.truncated).toBe(false)
      expect(result.data).toBe('short response')
      expect(result.preview).toBe('short response')
    })

    it('truncates large objects and stores in graph', () => {
      // Create data larger than 2000 chars
      const largeData = { items: Array.from({ length: 100 }, (_, i) => ({
        id: i,
        name: `item-${i}`,
        description: 'A'.repeat(30),
      }))}

      const result = boundResult('queryGraph', largeData)
      expect(result.truncated).toBe(true)
      expect(result.data).toBeUndefined()
      expect(result.resultRef).toBeDefined()
      expect(result.resultRef).toMatch(/^tool-result:/)
      expect(result.sizeChars).toBeGreaterThan(2000)
    })

    it('respects custom previewChars', () => {
      const data = { a: 'long value '.repeat(10), b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }
      const result = boundResult('test', data, { previewChars: 50 })
      expect(result.truncated).toBe(true)
    })

    it('builds array preview with first 3 items', () => {
      const data = Array.from({ length: 10 }, (_, i) => ({ id: i }))
      const result = boundResult('test', data, { previewChars: 2000 })
      expect(result.truncated).toBe(false)
      expect(result.preview).toContain('"id": 0')
      expect(result.preview).toContain('"id": 2')
    })

    it('builds object preview with first 5 keys', () => {
      const data: Record<string, number> = {}
      for (let i = 0; i < 20; i++) data[`key${i}`] = i
      const result = boundResult('test', data, { previewChars: 2000 })
      expect(result.truncated).toBe(false)
      expect(result.preview).toContain('key0')
      expect(result.preview).toContain('key4')
    })

    it('handles null data', () => {
      const result = boundResult('test', null)
      expect(result.truncated).toBe(false)
      expect(result.data).toBeNull()
      expect(result.preview).toBe('null')
    })

    it('handles undefined data', () => {
      const result = boundResult('test', undefined)
      expect(result.truncated).toBe(false)
      expect(result.data).toBeUndefined()
    })

    it('includes metadata in store call', () => {
      const data = 'x'.repeat(3000)
      const result = boundResult('test', data, {
        metadata: { taskId: 't1', skillId: 's1' },
      })
      expect(result.truncated).toBe(true)
      expect(result.resultRef).toBeDefined()
    })
  })

  describe('buildPreview edge cases', () => {
    it('truncates long strings at previewChars', () => {
      const data = 'A'.repeat(5000)
      const result = boundResult('test', data, { previewChars: 100 })
      expect(result.truncated).toBe(true)
      expect(result.preview.length).toBeLessThanOrEqual(110)
    })
  })
})
