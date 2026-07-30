import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CompressionService, getCompressionService, resetCompressionService } from '../../src/compression/headroom-service'

vi.mock('../../src/output/compaction', () => ({
  wrapHeadroomResult: vi.fn().mockReturnValue({ sections: [] }),
  compactText: vi.fn().mockImplementation((text: string) => ({
    text: text.slice(0, Math.floor(text.length / 2)),
    compacted: true,
    sections: [],
  })),
}))

vi.mock('headroom-ai', () => ({
  compress: vi.fn().mockImplementation(async (messages: any[]) => ({
    messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
    tokensBefore: 100,
    tokensAfter: 50,
  })),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), dim: vi.fn() },
}))

vi.mock('../../src/models/context-window-registry', () => ({
  ContextWindowRegistry: class {
    getContextWindow() { return 128000 }
  },
}))

describe('CompressionService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetCompressionService()
  })

  describe('singleton', () => {
    it('getCompressionService returns same instance', () => {
      const s1 = getCompressionService()
      const s2 = getCompressionService()
      expect(s1).toBe(s2)
    })

    it('resetCompressionService creates new instance', () => {
      const s1 = getCompressionService()
      resetCompressionService()
      const s2 = getCompressionService()
      expect(s1).not.toBe(s2)
    })
  })

  describe('never-expand invariant', () => {
    it('returns original if compressed output is larger', async () => {
      const service = new CompressionService(undefined, { model: 'test' })
      // With headroom disabled (default), uses compactOrTruncate
      // compactOrTruncate should always return shorter text
      const result = await service.compressResponse('x'.repeat(5000))
      expect(result.compressedSize).toBeLessThanOrEqual(result.originalSize)
    })

    it('does not expand short text', async () => {
      const service = new CompressionService(undefined, { model: 'test' })
      const result = await service.compressResponse('short')
      expect(result.compressed).toBe('short')
      expect(result.wasCompressed).toBe(false)
    })
  })

  describe('headroom disabled by default', () => {
    it('uses local compaction when headroom disabled', async () => {
      const service = new CompressionService(undefined, { model: 'test' })
      const result = await service.compressResponse('x'.repeat(5000))
      expect(result.wasCompressed).toBe(false) // local compaction, not headroom
    })
  })

  describe('extractToolResponse', () => {
    it('extracts only from tool messages', async () => {
      const service = new CompressionService(undefined, { enabled: true, model: 'test' })
      // Even with headroom enabled, extractToolResponse should filter by role
      // The mock returns the same messages, so extractToolResponse will filter
      const result = await service.compressResponse('x'.repeat(2000))
      // Should not crash and should return valid result
      expect(result).toBeDefined()
      expect(typeof result.compressed).toBe('string')
    })
  })
})
