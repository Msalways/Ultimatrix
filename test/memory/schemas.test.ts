import { describe, it, expect } from 'vitest'
import { buildDedupKey, WorkingMemoryStateSchema, EndpointTestSchema, FindingSchema, TargetSchema } from '../../src/memory/schemas'

describe('memory/schemas', () => {
  describe('buildDedupKey', () => {
    it('builds key from technique, endpoint, and param', () => {
      expect(buildDedupKey('xss', '/api', 'q')).toBe('xss::/api::q')
    })

    it('uses wildcard for missing param', () => {
      expect(buildDedupKey('sqli', '/login')).toBe('sqli::/login::*')
    })
  })

  describe('TargetSchema', () => {
    it('parses valid target', () => {
      const result = TargetSchema.parse({ url: 'http://test.com' })
      expect(result.url).toBe('http://test.com')
      expect(result.status).toBe('idle')
      expect(result.startedAt).toBeGreaterThan(0)
    })

    it('rejects invalid url', () => {
      expect(() => TargetSchema.parse({ url: 'not-a-url' })).toThrow()
    })
  })

  describe('EndpointTestSchema', () => {
    it('parses valid endpoint test', () => {
      const result = EndpointTestSchema.parse({
        url: '/api',
        technique: 'xss',
        result: 'vulnerable',
      })
      expect(result.result).toBe('vulnerable')
      expect(result.testedAt).toBeGreaterThan(0)
    })

    it('rejects invalid result value', () => {
      expect(() => EndpointTestSchema.parse({
        url: '/api',
        technique: 'xss',
        result: 'maybe',
      })).toThrow()
    })
  })

  describe('FindingSchema', () => {
    it('parses valid finding', () => {
      const result = FindingSchema.parse({
        id: 'F-001',
        type: 'xss',
        endpoint: '/search',
        severity: 'high',
        confidence: 0.85,
        confirmed: false,
      })
      expect(result.confidence).toBe(0.85)
      expect(result.discoveredAt).toBeGreaterThan(0)
    })

    it('defaults confirmed to false', () => {
      const result = FindingSchema.parse({
        id: 'F-002', type: 'sqli', endpoint: '/login',
        severity: 'critical', confidence: 0.95, confirmed: false,
      })
      expect(result.confirmed).toBe(false)
    })
  })

  describe('WorkingMemoryStateSchema', () => {
    it('parses empty state with defaults', () => {
      const result = WorkingMemoryStateSchema.parse({})
      expect(result.endpointsTested).toEqual([])
      expect(result.findings).toEqual([])
      expect(result.dedupSet).toEqual([])
      expect(result.currentPhase).toBe('idle')
    })

    it('parses full state', () => {
      const result = WorkingMemoryStateSchema.parse({
        target: { url: 'http://test.com', status: 'testing', startedAt: 100 },
        endpointsTested: [{ url: '/api', technique: 'xss', result: 'not-vulnerable', testedAt: 200 }],
        findings: [{ id: 'F-1', type: 'sqli', endpoint: '/login', severity: 'high', confidence: 0.9, confirmed: false, discoveredAt: 300 }],
        dedupSet: ['xss::/api::*'],
        currentPhase: 'attacking',
      })
      expect(result.target?.url).toBe('http://test.com')
      expect(result.target?.status).toBe('testing')
      expect(result.endpointsTested).toHaveLength(1)
      expect(result.findings).toHaveLength(1)
      expect(result.dedupSet).toEqual(['xss::/api::*'])
      expect(result.currentPhase).toBe('attacking')
    })
  })
})
