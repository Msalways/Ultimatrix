import { describe, it, expect } from 'vitest'
import { analyzeHar, identifyPatterns, generateHypotheses } from '../../src/analysis/har-analyzer'
import type { HarArchive } from '../../src/capture/har-parser'

const mockHar: HarArchive = {
  log: {
    version: '1.2',
    creator: { name: 'test', version: '1.0' },
    entries: [
      {
        startedDateTime: '2026-01-01T00:00:00.000Z',
        time: 100,
        request: {
          method: 'GET',
          url: 'https://api.example.com/users/123?filter=active',
          cookies: [],
          headers: [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.abc123' }],
          queryString: [{ name: 'filter', value: 'active' }],
        },
        response: {
          status: 200,
          cookies: [{ name: 'session_id', value: 'abc123def456', path: '/' }],
          headers: [],
          content: { size: 100, mimeType: 'application/json', text: '{"id":123,"name":"test"}' },
        },
      },
      {
        startedDateTime: '2026-01-01T00:00:01.000Z',
        time: 50,
        request: {
          method: 'POST',
          url: 'https://api.example.com/users',
          cookies: [{ name: 'session_id', value: 'abc123def456' }],
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          queryString: [],
          postData: { mimeType: 'application/json', text: '{"name":"new user"}' },
        },
        response: {
          status: 201,
          cookies: [],
          headers: [],
          content: { size: 50, mimeType: 'application/json', text: '{"id":124}' },
        },
      },
      {
        startedDateTime: '2026-01-01T00:00:02.000Z',
        time: 200,
        request: {
          method: 'GET',
          url: 'https://api.example.com/admin',
          cookies: [],
          headers: [],
          queryString: [],
        },
        response: {
          status: 403,
          cookies: [],
          headers: [],
          content: { size: 0, mimeType: 'text/html' },
        },
      },
    ],
  },
}

describe('HAR Analyzer', () => {
  describe('analyzeHar', () => {
    it('should analyze HAR data', () => {
      const result = analyzeHar(mockHar)
      expect(result.endpoints.length).toBeGreaterThan(0)
      expect(result.hosts).toContain('api.example.com')
    })

    it('should detect secrets', () => {
      const result = analyzeHar(mockHar)
      expect(result.secrets.some(s => s.type === 'token')).toBe(true)
    })

    it('should track data flows', () => {
      const result = analyzeHar(mockHar)
      expect(result.dataFlows.some(f => f.type === 'cookie')).toBe(true)
    })

    it('should build summary', () => {
      const result = analyzeHar(mockHar)
      expect(result.summary).toContain('endpoints')
      expect(result.summary).toContain('secrets')
    })
  })

  describe('identifyPatterns', () => {
    it('should identify URL parameters', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      expect(patterns.some(p => p.type === 'url-parameters')).toBe(true)
    })

    it('should identify JSON API', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      expect(patterns.some(p => p.type === 'json-api')).toBe(true)
    })

    it('should identify authentication', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      expect(patterns.some(p => p.type === 'authentication')).toBe(true)
    })

    it('should identify cookie sessions', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      expect(patterns.some(p => p.type === 'cookie-session')).toBe(true)
    })

    it('should identify error responses', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      expect(patterns.some(p => p.type === 'error-responses')).toBe(true)
    })
  })

  describe('generateHypotheses', () => {
    it('should generate IDOR hypothesis', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      const endpoints = analyzeHar(mockHar).endpoints
      const hypotheses = generateHypotheses(patterns, endpoints)
      expect(hypotheses.some(h => h.id === 'idor-potential')).toBe(true)
    })

    it('should generate missing auth hypothesis', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      const endpoints = analyzeHar(mockHar).endpoints
      const hypotheses = generateHypotheses(patterns, endpoints)
      expect(hypotheses.some(h => h.id === 'missing-auth')).toBe(true)
    })

    it('should generate info disclosure hypothesis', () => {
      const patterns = identifyPatterns(mockHar.log.entries)
      const endpoints = analyzeHar(mockHar).endpoints
      const hypotheses = generateHypotheses(patterns, endpoints)
      expect(hypotheses.some(h => h.id === 'info-disclosure')).toBe(true)
    })
  })
})
