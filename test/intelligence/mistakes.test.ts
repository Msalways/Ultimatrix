import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MistakeManager } from '../../src/intelligence/mistakes'
import { existsSync, unlinkSync, mkdirSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'

const TEST_DIR = resolve('output', 'test-mistakes')

describe('MistakeManager', () => {
  let manager: MistakeManager
  let testPath: string

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    testPath = resolve(TEST_DIR, `mistakes-${randomBytes(4).toString('hex')}.json`)
    manager = new MistakeManager(testPath)
  })

  afterEach(() => {
    try { unlinkSync(testPath) } catch { /* best effort */ }
  })

  describe('record', () => {
    it('records a mistake and returns fingerprint', () => {
      const fp = manager.record('httpRequest', 'Connection timeout after 30s')
      expect(fp).toMatch(/^[0-9a-f]{16}$/)
      expect(manager.getAllMistakes()).toHaveLength(1)
    })

    it('increments occurrences for same error', () => {
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', 'Connection timeout')

      const mistakes = manager.getAllMistakes()
      expect(mistakes).toHaveLength(1)
      expect(mistakes[0].occurrences).toBe(3)
    })

    it('creates separate fingerprints for different errors', () => {
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', '403 Forbidden')

      expect(manager.getAllMistakes()).toHaveLength(2)
    })

    it('normalizes timestamps in error strings', () => {
      const fp1 = manager.record('httpRequest', 'Error at 2026-09-13T12:00:00Z')
      const fp2 = manager.record('httpRequest', 'Error at 2026-09-14T15:30:00Z')

      // Same fingerprint because timestamp is stripped
      expect(fp1).toBe(fp2)
    })

    it('normalizes numeric IDs', () => {
      const fp1 = manager.record('httpRequest', 'User 12345 not found')
      const fp2 = manager.record('httpRequest', 'User 67890 not found')

      expect(fp1).toBe(fp2)
    })
  })

  describe('resolve', () => {
    it('marks a mistake as resolved', () => {
      const fp = manager.record('httpRequest', 'Connection timeout')
      manager.resolve(fp)

      const mistake = manager.get(fp)
      expect(mistake?.resolved).toBe(true)
      expect(manager.getActiveMistakes()).toHaveLength(0)
    })

    it('removes regressed tag on resolve', () => {
      const fp = manager.record('httpRequest', 'Connection timeout')
      manager.resolve(fp)

      // Simulate regression
      manager.record('httpRequest', 'Connection timeout')
      const mistake = manager.get(fp)
      expect(mistake?.tags).toContain('regressed')

      // Resolve again
      manager.resolve(fp)
      const fixed = manager.get(fp)
      expect(fixed?.tags).not.toContain('regressed')
    })
  })

  describe('regression detection', () => {
    it('tags [regressed] when resolved error reappears', () => {
      const fp = manager.record('httpRequest', '403 Forbidden')
      manager.resolve(fp)

      // Same error reappears
      manager.record('httpRequest', '403 Forbidden')

      const mistake = manager.get(fp)
      expect(mistake?.tags).toContain('regressed')
    })

    it('does not tag regressed for non-resolved errors', () => {
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', 'Connection timeout')

      const mistake = manager.getAllMistakes()[0]
      expect(mistake.tags).not.toContain('regressed')
    })
  })

  describe('getByTool', () => {
    it('filters mistakes by tool name', () => {
      manager.record('httpRequest', 'Error 1')
      manager.record('queryGraph', 'Error 2')
      manager.record('httpRequest', 'Error 3')

      expect(manager.getByTool('httpRequest')).toHaveLength(2)
      expect(manager.getByTool('queryGraph')).toHaveLength(1)
      expect(manager.getByTool('nonexistent')).toHaveLength(0)
    })
  })

  describe('getMistakesPromptBlock', () => {
    it('returns empty for no mistakes', () => {
      expect(manager.getMistakesPromptBlock()).toBe('')
    })

    it('generates prompt block with active mistakes', () => {
      manager.record('httpRequest', 'Connection timeout', 'Add retry with backoff')
      manager.record('httpRequest', 'Rate limited 429', 'Add delay between requests')

      const block = manager.getMistakesPromptBlock()
      expect(block).toContain('## KNOWN MISTAKES')
      expect(block).toContain('httpRequest')
      expect(block).toContain('Add retry with backoff')
    })

    it('excludes resolved mistakes', () => {
      const fp = manager.record('httpRequest', 'Connection timeout')
      manager.resolve(fp)

      const block = manager.getMistakesPromptBlock()
      expect(block).toBe('')
    })

    it('includes occurrence count', () => {
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', 'Connection timeout')
      manager.record('httpRequest', 'Connection timeout')

      const block = manager.getMistakesPromptBlock()
      expect(block).toContain('×3')
    })
  })

  describe('persistence', () => {
    it('saves to file and reloads', () => {
      manager.record('httpRequest', 'Connection timeout', 'Add retry')
      manager.resolve(manager.getAllMistakes()[0].fingerprint)

      // Create new manager from same file
      const manager2 = new MistakeManager(testPath)
      const mistakes = manager2.getAllMistakes()
      expect(mistakes).toHaveLength(1)
      expect(mistakes[0].resolved).toBe(true)
      expect(mistakes[0].fix).toBe('Add retry')
    })
  })
})
