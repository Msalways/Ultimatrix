import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { VectorStore, serializeNode, hashEmbed, cosineSimilarity } from '../../src/memory/vector-store'
import { NodeType } from '../../src/graph/schema'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { randomBytes } from 'crypto'

const TEST_DIR = resolve('output', 'test-vector')

function makeDbPath(): string {
  return resolve(TEST_DIR, `vec-${randomBytes(4).toString('hex')}.db`)
}

describe('VectorStore', () => {
  let store: VectorStore
  let dbPath: string

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true })
    dbPath = makeDbPath()
    store = new VectorStore({ dbPath, dimension: 64 })
  })

  afterEach(() => {
    store.close()
    try { rmSync(dbPath, { force: true }) } catch { /* best effort */ }
    try { rmSync(dbPath + '-wal', { force: true }) } catch { /* best effort */ }
    try { rmSync(dbPath + '-shm', { force: true }) } catch { /* best effort */ }
  })

  describe('hashEmbed', () => {
    it('returns fixed-dimension vector', () => {
      const vec = hashEmbed('SQL injection on /api/users', 64)
      expect(vec).toHaveLength(64)
    })

    it('is L2-normalized', () => {
      const vec = hashEmbed('test query', 32)
      const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0))
      expect(norm).toBeCloseTo(1.0, 5)
    })

    it('produces different vectors for different text', () => {
      const a = hashEmbed('SQL injection vulnerability', 64)
      const b = hashEmbed('cross-site scripting XSS', 64)
      expect(a).not.toEqual(b)
    })

    it('produces same vector for same text', () => {
      const a = hashEmbed('SQL injection on /api/users', 64)
      const b = hashEmbed('SQL injection on /api/users', 64)
      expect(a).toEqual(b)
    })
  })

  describe('cosineSimilarity', () => {
    it('returns 1.0 for identical vectors', () => {
      const v = [1, 2, 3]
      expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5)
    })

    it('returns 0.0 for orthogonal vectors', () => {
      expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    })

    it('returns negative for opposite vectors', () => {
      expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0, 5)
    })

    it('returns 0 for mismatched dimensions', () => {
      expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0)
    })
  })

  describe('serializeNode', () => {
    it('serializes a Finding node', () => {
      const text = serializeNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQL Injection',
        properties: {
          title: 'SQL Injection in users endpoint',
          severity: 'critical',
          technique: 'classicInjection',
          endpoint: '/api/users',
          evidence: ['raw_request: SELECT * FROM users', 'raw_response: error'],
        },
      })
      expect(text).toContain('Finding')
      expect(text).toContain('SQL Injection in users endpoint')
      expect(text).toContain('critical')
      expect(text).toContain('classicInjection')
      expect(text).toContain('/api/users')
    })

    it('serializes an Endpoint node', () => {
      const text = serializeNode({
        id: 'e1',
        type: NodeType.ENDPOINT,
        label: 'POST /api/users',
        properties: {
          url: '/api/users',
          method: 'POST',
          params: ['username', 'password'],
          tags: ['auth', 'login'],
        },
      })
      expect(text).toContain('Endpoint')
      expect(text).toContain('/api/users')
      expect(text).toContain('POST')
      expect(text).toContain('auth')
    })

    it('serializes an Attack node', () => {
      const text = serializeNode({
        id: 'a1',
        type: NodeType.ATTACK,
        label: 'SQLi attempt',
        properties: {
          technique: 'classicInjection',
          payload: "' OR 1=1 --",
          vulnerable: true,
        },
      })
      expect(text).toContain('Attack')
      expect(text).toContain('classicInjection')
      expect(text).toContain('vulnerable')
    })

    it('serializes generic node type', () => {
      const text = serializeNode({
        id: 'h1',
        type: NodeType.HEADER_SEMANTIC,
        label: 'X-Custom',
        properties: { header: 'X-Custom', role: 'identity', confidence: 0.9 },
      })
      expect(text).toContain('HeaderSemantic')
      expect(text).toContain('identity')
    })
  })

  describe('VectorStore indexing and search', () => {
    it('indexes a finding node', async () => {
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQL Injection',
        properties: {
          title: 'SQL Injection in /api/users',
          severity: 'critical',
          technique: 'classicInjection',
          endpoint: '/api/users',
          evidence: [],
        },
      })

      const count = await store.count()
      expect(count).toBe(1)
    })

    it('finds similar findings', async () => {
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQL Injection',
        properties: {
          title: 'SQL Injection in /api/users endpoint',
          severity: 'critical',
          technique: 'classicInjection',
          endpoint: '/api/users',
          evidence: [],
        },
      })

      await store.indexNode({
        id: 'f2',
        type: NodeType.FINDING,
        label: 'XSS',
        properties: {
          title: 'Cross-site scripting in search parameter',
          severity: 'high',
          technique: 'reflectedXSS',
          endpoint: '/search',
          evidence: [],
        },
      })

      const results = await store.search('SQL injection database query', {
        threshold: 0.1,
      })

      expect(results.length).toBeGreaterThan(0)
      expect(results[0].document.nodeId).toBe('f1')
      expect(results[0].score).toBeGreaterThan(0)
    })

    it('filters by node type', async () => {
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQL Injection',
        properties: { title: 'SQLi vulnerability', severity: 'critical', evidence: [] },
      })

      await store.indexNode({
        id: 'e1',
        type: NodeType.ENDPOINT,
        label: 'GET /api',
        properties: { url: '/api', method: 'GET', params: [], tags: [] },
      })

      const results = await store.search('SQL injection', {
        nodeType: NodeType.FINDING,
        threshold: 0.1,
      })

      expect(results.every(r => r.document.nodeType === NodeType.FINDING)).toBe(true)
    })

    it('removes a node', async () => {
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQL Injection',
        properties: { title: 'SQLi vuln', severity: 'critical', evidence: [] },
      })

      expect(await store.count()).toBe(1)

      await store.removeNode('f1')
      expect(await store.count()).toBe(0)
    })

    it('clears engagement', async () => {
      await store.indexNode(
        { id: 'f1', type: NodeType.FINDING, label: 'SQLi', properties: { title: 'SQLi', severity: 'critical', evidence: [] } },
        'eng-1',
      )
      await store.indexNode(
        { id: 'f2', type: NodeType.FINDING, label: 'XSS', properties: { title: 'XSS', severity: 'high', evidence: [] } },
        'eng-2',
      )

      await store.clearEngagement('eng-1')
      expect(await store.count()).toBe(1)
    })

    it('upserts on re-index', async () => {
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQLi',
        properties: { title: 'SQLi v1', severity: 'medium', evidence: [] },
      })
      await store.indexNode({
        id: 'f1',
        type: NodeType.FINDING,
        label: 'SQLi',
        properties: { title: 'SQLi v2 critical', severity: 'critical', evidence: [] },
      })

      expect(await store.count()).toBe(1)
    })
  })
})
