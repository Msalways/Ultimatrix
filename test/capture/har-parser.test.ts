import { describe, it, expect } from 'vitest'
import {
  parseHar,
  parseHarFromObject,
  getEntries,
  getEndpoints,
  getSecrets,
  nameMatchesSecretType,
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

    it('preserves RAW value for evidence while exposing a maskedValue for display', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const secrets = getSecrets(entries)
      const jwt = secrets.find(s => s.type === 'jwt')
      expect(jwt).toBeDefined()
      // Raw value must be the full token — the evidence graph must stay precise/lethal.
      expect(jwt!.value).toBe('Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyX2lkIjoxfQ.abc123')
      // Display form is masked and must NOT equal the raw value.
      expect(jwt!.maskedValue).not.toBe(jwt!.value)
      expect(jwt!.maskedValue).not.toContain('eyJhbGci')
    })

    it('ignores bare bundle keywords and keeps assigned body secrets', () => {
      const archive = structuredClone(validHar)
      archive.log.entries[0].response.content.text = 'const token = "placeholder"; const apiKey = "real-secret-value-123";'
      const bodySecrets = getSecrets(getEntries(archive)).filter(secret => secret.location === 'body')
      expect(bodySecrets).toHaveLength(1)
      expect(bodySecrets[0].name).toBe('apiKey')
      expect(bodySecrets[0].value).toBe('real-secret-value-123')
    })
  })

  describe('getDataFlows', () => {
    it('should track cookie flows', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const flows = getDataFlows(entries)
      expect(flows.some(f => f.type === 'cookie')).toBe(true)
    })

    it('preserves RAW value for evidence while exposing a maskedValue for display', () => {
      const archive = parseHarFromObject(validHar)
      const entries = getEntries(archive)
      const flows = getDataFlows(entries)
      const cookieFlow = flows.find(f => f.type === 'cookie')
      expect(cookieFlow).toBeDefined()
      // Raw value must be the full captured cookie value, not truncated.
      expect(cookieFlow!.value).toBe('abc123def456')
      expect(cookieFlow!.maskedValue).not.toBe(cookieFlow!.value)
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

/**
 * WHY — the canned "Secret Exposure" false positives.
 *
 * Secret classes were matched by SUBSTRING regex on a name: `/sid/i`,
 * `/token/i`, `/password/i`. `/sid/i` matches "considered", "outside",
 * "residual" and "provided". Names are a structured, closed vocabulary and
 * need no regex at all, so matching is now TOKEN EQUALITY.
 *
 * Known limitation, measured live 2026-10-02 and NOT fixed by this change: a
 * body key named exactly `sid`, `csrf` or `key` still matches its class. Token
 * equality removes substring noise; it cannot tell a credential from a field
 * that happens to be called "key". See har-secret-false-positives memory.
 */
describe('nameMatchesSecretType', () => {
  it('matches real secret names by token', () => {
    expect(nameMatchesSecretType('api_key', 'X-Api-Key')).toBe(true)
    expect(nameMatchesSecretType('api_key', 'apiKey')).toBe(true)
    expect(nameMatchesSecretType('token', 'Authorization')).toBe(true)
    expect(nameMatchesSecretType('token', 'access_token')).toBe(true)
    expect(nameMatchesSecretType('password', 'X-Db-Password')).toBe(true)
    expect(nameMatchesSecretType('session', 'JSESSIONID')).toBe(true)
    expect(nameMatchesSecretType('session', 'session_id')).toBe(true)
    expect(nameMatchesSecretType('csrf', 'X-CSRF-Token')).toBe(true)
  })

  it('REJECTS names that merely CONTAIN a secret substring', () => {
    // Every one of these matched the old /sid/i or /token/i regexes.
    expect(nameMatchesSecretType('session', 'considered')).toBe(false)
    expect(nameMatchesSecretType('session', 'outside')).toBe(false)
    expect(nameMatchesSecretType('session', 'residual')).toBe(false)
    expect(nameMatchesSecretType('session', 'provided')).toBe(false)
    expect(nameMatchesSecretType('token', 'tokenizer')).toBe(false)
    expect(nameMatchesSecretType('password', 'passwordless')).toBe(false)
  })

  it('does not sweep in ordinary transport headers', () => {
    for (const name of ['accept', 'content-type', 'user-agent', 'referer',
      'sec-fetch-mode', 'sec-ch-ua-platform', 'host', 'connection']) {
      expect(nameMatchesSecretType('session', name)).toBe(false)
      expect(nameMatchesSecretType('token', name)).toBe(false)
      expect(nameMatchesSecretType('password', name)).toBe(false)
    }
  })

  it('has no vocabulary for an unknown secret class', () => {
    expect(nameMatchesSecretType('nonexistent_class', 'X-Api-Key')).toBe(false)
  })
})
