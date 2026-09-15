import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { persistEvidence, loadEvidence, listEngagements } from '../../src/intelligence/evidence-persistence'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import type { EvidenceItem } from '../../src/intelligence/evidence-ledger'

const TEST_DIR = resolve('.test-evidence-persistence')

const makeItem = (id: string, url: string): EvidenceItem => ({
  id,
  type: 'raw_request',
  data: `GET ${url}`,
  label: `request to ${url}`,
  timestamp: Date.now(),
  observed: { method: 'GET', url, status: 200 },
})

describe('EvidencePersistence', () => {
  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true })
  })

  describe('persistEvidence', () => {
    it('writes items to a file', () => {
      const items = [makeItem('ev1', 'https://a.com/1'), makeItem('ev2', 'https://a.com/2')]
      const path = persistEvidence(items, 'eng-1', TEST_DIR)
      expect(existsSync(path)).toBe(true)

      const raw = JSON.parse(readFileSync(path, 'utf-8'))
      expect(raw.version).toBe(1)
      expect(raw.items).toHaveLength(2)
      expect(raw.engagementId).toBe('eng-1')
    })

    it('creates the directory if missing', () => {
      const nested = resolve(TEST_DIR, 'sub', 'dir')
      persistEvidence([makeItem('ev1', 'https://a.com')], 'eng-2', nested)
      expect(existsSync(resolve(nested, 'eng-2.json'))).toBe(true)
    })
  })

  describe('loadEvidence', () => {
    it('loads persisted items', () => {
      const items = [makeItem('ev1', 'https://a.com'), makeItem('ev2', 'https://b.com')]
      persistEvidence(items, 'eng-load', TEST_DIR)
      const loaded = loadEvidence('eng-load', TEST_DIR)
      expect(loaded).toHaveLength(2)
      expect(loaded[0].id).toBe('ev1')
    })

    it('returns empty for missing engagement', () => {
      expect(loadEvidence('nonexistent', TEST_DIR)).toEqual([])
    })
  })

  describe('listEngagements', () => {
    it('lists persisted engagement ids', () => {
      persistEvidence([makeItem('ev1', 'https://a.com')], 'eng-a', TEST_DIR)
      persistEvidence([makeItem('ev2', 'https://b.com')], 'eng-b', TEST_DIR)
      const list = listEngagements(TEST_DIR)
      expect(list).toContain('eng-a')
      expect(list).toContain('eng-b')
    })

    it('returns empty for missing dir', () => {
      rmSync(TEST_DIR, { recursive: true, force: true })
      expect(listEngagements(TEST_DIR)).toEqual([])
    })
  })
})
