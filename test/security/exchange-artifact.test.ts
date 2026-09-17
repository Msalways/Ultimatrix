/**
 * Tests for ExchangeArtifact (Phase F: Cross-linking all sinks)
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createExchangeArtifact,
  getExchangeArtifact,
  findExchangesByLink,
  findExchangesByTimeRange,
  clearExchangeArtifacts,
  type ExchangeArtifact,
} from '../../src/security/artifacts'

describe('ExchangeArtifact', () => {
  beforeEach(() => {
    clearExchangeArtifacts()
  })

  describe('createExchangeArtifact()', () => {
    it('creates an exchange with a unique ID', () => {
      const ex = createExchangeArtifact({})
      expect(ex.exchangeId).toMatch(/^ex-/)
      expect(ex.createdAt).toBeGreaterThan(0)
    })

    it('stores all provided links', () => {
      const ex = createExchangeArtifact({
        capturedRequestId: 'cap-42',
        evidenceId: 'ev-abc',
        forensicTimestamp: 1234567890,
        resultRef: 'tool-result:httpRequest:123:abc',
        note: 'IDOR test response',
      })
      expect(ex.capturedRequestId).toBe('cap-42')
      expect(ex.evidenceId).toBe('ev-abc')
      expect(ex.forensicTimestamp).toBe(1234567890)
      expect(ex.resultRef).toBe('tool-result:httpRequest:123:abc')
      expect(ex.note).toBe('IDOR test response')
    })

    it('generates unique IDs', () => {
      const ex1 = createExchangeArtifact({})
      const ex2 = createExchangeArtifact({})
      expect(ex1.exchangeId).not.toBe(ex2.exchangeId)
    })
  })

  describe('getExchangeArtifact()', () => {
    it('retrieves by ID', () => {
      const ex = createExchangeArtifact({ capturedRequestId: 'cap-1' })
      const found = getExchangeArtifact(ex.exchangeId)
      expect(found).toEqual(ex)
    })

    it('returns undefined for unknown ID', () => {
      expect(getExchangeArtifact('ex-nonexistent')).toBeUndefined()
    })
  })

  describe('findExchangesByLink()', () => {
    it('finds by capturedRequestId', () => {
      const ex = createExchangeArtifact({ capturedRequestId: 'cap-5' })
      const results = findExchangesByLink('capturedRequestId', 'cap-5')
      expect(results).toHaveLength(1)
      expect(results[0].exchangeId).toBe(ex.exchangeId)
    })

    it('finds by evidenceId', () => {
      const ex = createExchangeArtifact({ evidenceId: 'ev-xyz' })
      const results = findExchangesByLink('evidenceId', 'ev-xyz')
      expect(results).toHaveLength(1)
    })

    it('finds by resultRef', () => {
      const ex = createExchangeArtifact({ resultRef: 'tool-result:worker:w1:123' })
      const results = findExchangesByLink('resultRef', 'tool-result:worker:w1:123')
      expect(results).toHaveLength(1)
    })

    it('finds by artifactId', () => {
      const ex = createExchangeArtifact({ artifactId: 'artifact:finding:abc' })
      const results = findExchangesByLink('artifactId', 'artifact:finding:abc')
      expect(results).toHaveLength(1)
    })

    it('returns empty for unmatched link', () => {
      expect(findExchangesByLink('capturedRequestId', 'cap-999')).toHaveLength(0)
    })

    it('finds multiple exchanges for same link', () => {
      const ex1 = createExchangeArtifact({ capturedRequestId: 'cap-1' })
      const ex2 = createExchangeArtifact({ capturedRequestId: 'cap-1' })
      const results = findExchangesByLink('capturedRequestId', 'cap-1')
      expect(results).toHaveLength(2)
    })
  })

  describe('findExchangesByTimeRange()', () => {
    it('finds exchanges within timestamp range', () => {
      const now = Date.now()
      createExchangeArtifact({ forensicTimestamp: now - 5000 })
      createExchangeArtifact({ forensicTimestamp: now - 1000 })
      createExchangeArtifact({ forensicTimestamp: now + 1000 })
      createExchangeArtifact({ forensicTimestamp: now + 5000 })

      const results = findExchangesByTimeRange(now - 2000, now + 2000)
      expect(results).toHaveLength(2)
    })

    it('excludes exchanges without forensicTimestamp', () => {
      createExchangeArtifact({}) // no forensicTimestamp
      const results = findExchangesByTimeRange(0, Date.now() + 10000)
      expect(results).toHaveLength(0)
    })
  })

  describe('clearExchangeArtifacts()', () => {
    it('removes all exchanges', () => {
      createExchangeArtifact({ capturedRequestId: 'cap-1' })
      createExchangeArtifact({ capturedRequestId: 'cap-2' })
      clearExchangeArtifacts()
      expect(findExchangesByLink('capturedRequestId', 'cap-1')).toHaveLength(0)
    })
  })

  describe('cross-sink traceability', () => {
    it('full trace: captured request → evidence → forensic → result', () => {
      const ex = createExchangeArtifact({
        capturedRequestId: 'cap-12',
        evidenceId: 'ev-42',
        forensicTimestamp: 1700000000000,
        resultRef: 'tool-result:worker:w1:abc',
        note: 'IDOR: user A accessing user B resource',
      })

      // Reverse lookups from any sink
      const byCap = findExchangesByLink('capturedRequestId', 'cap-12')
      expect(byCap).toHaveLength(1)
      expect(byCap[0].evidenceId).toBe('ev-42')
      expect(byCap[0].resultRef).toBe('tool-result:worker:w1:abc')

      const byEvidence = findExchangesByLink('evidenceId', 'ev-42')
      expect(byEvidence).toHaveLength(1)
      expect(byEvidence[0].capturedRequestId).toBe('cap-12')

      const byResult = findExchangesByLink('resultRef', 'tool-result:worker:w1:abc')
      expect(byResult).toHaveLength(1)
      expect(byResult[0].capturedRequestId).toBe('cap-12')

      // Time-based lookup
      const byTime = findExchangesByTimeRange(1699999999000, 1700000001000)
      expect(byTime).toHaveLength(1)
      expect(byTime[0].exchangeId).toBe(ex.exchangeId)
    })
  })
})
