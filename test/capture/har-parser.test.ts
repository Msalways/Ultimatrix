import { describe, it, expect } from 'vitest'
import {
  parseHar,
  parseHarFromObject,
  getEntries,
  getEndpoints,
  getSecrets,
  getDataFlows,
  createEmptyHar,
  addEntry,
  filterEntries,
  getUniqueHosts,
  getUniquePaths,
  getRequestMethods,
  type HarArchive,
  type HarEntry,
} from '../../src/capture/har-parser'

const validHar: HarArchive = {
  log: {
    version: '1.2',
    creator: { name: 'test', version: '1.0' },
    entries: [
      {
        startedDateTime: '2026-01-01T00:00:00.000Z',
        time: 100,
        request: {
          method: 'GET',
          url: 'https://api.example.com/users',
          cookies: [],
          headers: [{ name: 'Authorization', value: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.abc123' }],
          queryString: [],
        },
        response: {
          status: 200,
          cookies: [{ name: 'session_id', value: 'abc123def456', path: '/' }],
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          content: { size: 100, mimeType: 'application/json', text: '{"users":[]}' },
        },
        timings: { send: 10, wait: 80, receive: 10 },
      },
      {
        startedDateTime: '2026-01-01T00:00:01.000Z',
        time: 50,
        request: {
          method: 'POST',
          url: 'https://api.example.com/users?token=secret123',
          cookies: [{ name: 'session_id', value: 'abc123def456' }],
          headers: [{ name: 'Content-Type', value: 'application/json' }],
          queryString: [{ name: 'token', value: 'secret123' }],
          postData: { mimeType: 'application/json', text: '{"name":"test"}' },
        },
        response: {
          status: 201,
          cookies: [],
          headers: [],
          content: { size: 50, mimeType: 'application/json', text: '{"id":1}' },
        },
        timings: { send: 5, wait: 40, receive: 5 },
      },
    ],
  },
}

describe('HAR Parser', () => {
  describe('parseHar', () => {
    it('should parse valid HAR string', () => {
      const result = parseHar(JSON.stringify(validHar))
      expect(result.log.version).toBe('1.2')
      expect(result.log.entries).toHaveLength(2)
    })

    it('should throw on invalid JSON', () => {
      expect(() => parseHar('not json')).toThrow()
    })

    it('should throw on invalid HAR structure', () => {
      expect(() => parseHar(JSON.stringify({ log: {} }))).toThrow()
    })
  })

  describe('parseHarFromObject', () => {
    it('should parse valid HAR object', () => {
      const result = parseHarFromObject(validHar)
      expect(result.log.entries).toHaveLength(2)
    })

    it('should throw on invalid object', () => {
      expect(() => parseHarFromObject({ invalid: true })).toThrow()
    })
  })

  describe('getEntries', () => {
    it('should return all entries', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      expect(entries).toHaveLength(2)
    })
  })

  describe('getEndpoints', () => {
    it('should extract unique endpoints', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const endpoints = getEndpoints(entries)
      expect(endpoints).toHaveLength(2)
    })

    it('should group same endpoints', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      // Add duplicate entry
      entries.push(entries[0])
      const endpoints = getEndpoints(entries)
      expect(endpoints).toHaveLength(2)
      const usersEndpoint = endpoints.find(e => e.path === '/users')
      expect(usersEndpoint?.requestCount).toBe(2)
    })

    it('should parse query params', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const endpoints = getEndpoints(entries)
      const postEndpoint = endpoints.find(e => e.method === 'POST')
      expect(postEndpoint?.queryParams.token).toBe('secret123')
    })
  })

  describe('getSecrets', () => {
    it('should detect tokens in headers', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const secrets = getSecrets(entries)
      expect(secrets.some(s => s.type === 'token')).toBe(true)
    })

    it('should detect session cookies', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const secrets = getSecrets(entries)
      expect(secrets.some(s => s.type === 'session')).toBe(true)
    })

    it('should detect query param secrets', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const secrets = getSecrets(entries)
      expect(secrets.some(s => s.location === 'header' || s.location === 'url')).toBe(true)
    })
  })

  describe('getDataFlows', () => {
    it('should track cookie flows', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const flows = getDataFlows(entries)
      expect(flows.some(f => f.type === 'cookie')).toBe(true)
    })
  })

  describe('createEmptyHar', () => {
    it('should create empty archive', () => {
      const archive = createEmptyHar()
      expect(archive.log.version).toBe('1.2')
      expect(archive.log.entries).toHaveLength(0)
    })
  })

  describe('addEntry', () => {
    it('should add entry to archive', () => {
      const archive = createEmptyHar()
      const entry: HarEntry = {
        startedDateTime: '2026-01-01T00:00:00.000Z',
        time: 100,
        request: {
          method: 'GET',
          url: 'https://example.com',
          cookies: [],
          headers: [],
          queryString: [],
        },
        response: {
          status: 200,
          cookies: [],
          headers: [],
          content: { size: 0, mimeType: 'text/html' },
        },
      }
      const result = addEntry(archive, entry)
      expect(result.log.entries).toHaveLength(1)
    })
  })

  describe('filterEntries', () => {
    it('should filter by method', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const getEntries2 = filterEntries(entries, e => e.request.method === 'GET')
      expect(getEntries2).toHaveLength(1)
    })

    it('should filter by status', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const successEntries = filterEntries(entries, e => e.response.status < 300)
      expect(successEntries).toHaveLength(2)
    })
  })

  describe('getUniqueHosts', () => {
    it('should return unique hosts', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const hosts = getUniqueHosts(entries)
      expect(hosts).toHaveLength(1)
      expect(hosts[0]).toBe('api.example.com')
    })
  })

  describe('getUniquePaths', () => {
    it('should return unique paths', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const paths = getUniquePaths(entries)
      expect(paths).toHaveLength(1)
      expect(paths[0]).toBe('/users')
    })
  })

  describe('getRequestMethods', () => {
    it('should count methods', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const methods = getRequestMethods(entries)
      expect(methods['GET']).toBe(1)
      expect(methods['POST']).toBe(1)
    })
  })
})
