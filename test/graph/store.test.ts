import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import { mkdtempSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { GraphStore } from '../../src/graph/store'
import { NodeType, EdgeType } from '../../src/graph/schema'

describe('GraphStore', () => {
  let tmpDir: string
  const origCwd = process.cwd()

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'graph-test-'))
    process.chdir(tmpDir)
  })

  afterAll(() => {
    process.chdir(origCwd)
  })

  afterEach(() => {
    process.chdir(origCwd)
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true })
  })

  function createStore(): GraphStore {
    return new GraphStore(join(tmpDir, 'test-graph.json'))
  }

  describe('upsertPage', () => {
    it('creates a new page node', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      expect(page.type).toBe(NodeType.PAGE)
      expect(page.properties.url).toBe('http://example.com')
      expect(page.properties.method).toBe('GET')
      expect(page.createdAt).toBeGreaterThan(0)
    })

    it('updates existing page node', () => {
      const store = createStore()
      const page1 = store.upsertPage('http://example.com', { status: 200 })
      const page2 = store.upsertPage('http://example.com', { status: 404, contentType: 'text/html' })
      expect(page1.id).toBe(page2.id)
      expect(page2.properties.status).toBe(404)
      expect(page2.properties.contentType).toBe('text/html')
      expect(page2.updatedAt).toBeGreaterThanOrEqual(page2.createdAt)
    })
  })

  describe('addAction and edge creation', () => {
    it('creates an action node and HAS_ACTION edge', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'click', selector: '#btn' })
      expect(action.type).toBe(NodeType.ACTION)
      expect(action.properties.actionType).toBe('click')
      expect(action.properties.selector).toBe('#btn')
    })
  })

  describe('addInput', () => {
    it('creates input node and HAS_INPUT edge', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'fill' })
      const input = store.addInput(action.id, { selector: '#email', inputType: 'email' })
      expect(input.type).toBe(NodeType.INPUT)
      expect(input.properties.selector).toBe('#email')
      expect(input.properties.inputType).toBe('email')
    })

    it('uses defaults when data is minimal', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'fill' })
      const input = store.addInput(action.id, {})
      expect(input.properties.selector).toBe('')
      expect(input.properties.inputType).toBe('text')
    })
  })

  describe('addTest', () => {
    it('creates test node and HAS_TEST edge', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'fill' })
      const test = store.addTest(action.id, { testType: 'xss', status: 'pass', endpoint: '/search' })
      expect(test.type).toBe(NodeType.TEST)
      expect(test.properties.testType).toBe('xss')
    })
  })

  describe('addFinding', () => {
    it('creates finding node with defaults', () => {
      const store = createStore()
      const finding = store.addFinding({ technique: 'xss', endpoint: '/search', severity: 'high', evidence: ['alert(1)'] })
      expect(finding.type).toBe(NodeType.FINDING)
      expect(finding.properties.severity).toBe('high')
      expect(finding.properties.technique).toBe('xss')
      expect(finding.properties.endpoint).toBe('/search')
      expect(finding.properties.evidence).toEqual(['alert(1)'])
    })

    it('uses default severity when not provided', () => {
      const store = createStore()
      const finding = store.addFinding({ technique: 'info' })
      expect(finding.properties.severity).toBe('medium')
    })
  })

  describe('addAuthFlow', () => {
    it('creates auth flow node', () => {
      const store = createStore()
      const flow = store.addAuthFlow({ flowType: 'login', steps: [{ action: 'goto', url: '/login' }] })
      expect(flow.type).toBe(NodeType.AUTH_FLOW)
      expect(flow.properties.flowType).toBe('login')
      expect(flow.properties.reusable).toBe(true)
    })
  })

  describe('addRBACRole (idempotent)', () => {
    it('creates a new role', () => {
      const store = createStore()
      const role = store.addRBACRole({ roleName: 'admin', accessibleEndpoints: ['/admin'] })
      expect(role.type).toBe(NodeType.RBAC_ROLE)
      expect(role.properties.roleName).toBe('admin')
    })

    it('updates existing role with same roleName', () => {
      const store = createStore()
      const r1 = store.addRBACRole({ roleName: 'admin', accessibleEndpoints: ['/admin'] })
      const r2 = store.addRBACRole({ roleName: 'admin', accessibleEndpoints: ['/admin', '/users'] })
      expect(r1.id).toBe(r2.id)
      expect(r2.properties.accessibleEndpoints).toEqual(['/admin', '/users'])
    })
  })

  describe('addAttack', () => {
    it('creates attack node with defaults', () => {
      const store = createStore()
      const attack = store.addAttack({ technique: 'xss', payload: '<script>alert(1)</script>', vulnerable: true })
      expect(attack.type).toBe(NodeType.ATTACK)
      expect(attack.properties.technique).toBe('xss')
      expect(attack.properties.vulnerable).toBe(true)
      expect(attack.properties.confidence).toBe(0)
    })
  })

  describe('chainFindings', () => {
    it('creates CHAINED_FROM edge between findings', () => {
      const store = createStore()
      const f1 = store.addFinding({ technique: 'xss', endpoint: '/search', evidence: ['x'] })
      const f2 = store.addFinding({ technique: 'session-hijack', endpoint: '/search', evidence: ['y'] })
      store.chainFindings(f1.id, f2.id)

      const path = store.getAttackPath(f2.id)
      expect(path).toHaveLength(2)
      expect(path[0].id).toBe(f1.id)
      expect(path[1].id).toBe(f2.id)
    })
  })

  describe('queryNodes', () => {
    it('returns all nodes when no filters', () => {
      const store = createStore()
      store.upsertPage('http://a.com')
      store.upsertPage('http://b.com')
      expect(store.queryNodes()).toHaveLength(2)
    })

    it('filters by type', () => {
      const store = createStore()
      store.upsertPage('http://a.com')
      store.upsertPage('http://b.com')
      const page = store.upsertPage('http://c.com')
      store.addAction(page.id, { actionType: 'click' })

      const pages = store.queryNodes(NodeType.PAGE)
      expect(pages).toHaveLength(3)
      const actions = store.queryNodes(NodeType.ACTION)
      expect(actions).toHaveLength(1)
    })

    it('filters by url', () => {
      const store = createStore()
      store.upsertPage('http://example.com/page1')
      store.upsertPage('http://other.com')
      const result = store.queryNodes(NodeType.PAGE, { url: 'example' })
      expect(result).toHaveLength(1)
    })

    it('filters by method', () => {
      const store = createStore()
      store.upsertPage('http://a.com', { method: 'GET' })
      store.upsertPage('http://b.com', { method: 'POST' })
      const result = store.queryNodes(NodeType.PAGE, { method: 'POST' })
      expect(result).toHaveLength(1)
      expect((result[0] as any).properties.url).toBe('http://b.com')
    })

    it('filters by tags', () => {
      const store = createStore()
      store.upsertPage('http://a.com', { tags: ['api', 'public'] })
      store.upsertPage('http://b.com', { tags: ['admin'] })
      const result = store.queryNodes(NodeType.PAGE, { tags: ['api'] })
      expect(result).toHaveLength(1)
    })

    it('filters by multiple tags (OR)', () => {
      const store = createStore()
      store.upsertPage('http://a.com', { tags: ['api'] })
      store.upsertPage('http://b.com', { tags: ['admin'] })
      store.upsertPage('http://c.com', { tags: ['other'] })
      const result = store.queryNodes(NodeType.PAGE, { tags: ['api', 'admin'] })
      expect(result).toHaveLength(2)
    })
  })

  describe('getTestCoverage', () => {
    it('returns tests for a specific endpoint', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'fill' })
      store.addTest(action.id, { testType: 'xss', endpoint: action.id })
      store.addTest(action.id, { testType: 'sqli', endpoint: action.id })

      const coverage = store.getTestCoverage(action.id)
      expect(coverage).toHaveLength(2)
    })

    it('returns empty array for endpoint with no tests', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action = store.addAction(page.id, { actionType: 'click' })
      expect(store.getTestCoverage(action.id)).toEqual([])
    })
  })

  describe('getUntestedActions', () => {
    it('returns actions with no tests', () => {
      const store = createStore()
      const page = store.upsertPage('http://example.com')
      const action1 = store.addAction(page.id, { actionType: 'click' })
      const action2 = store.addAction(page.id, { actionType: 'fill' })
      store.addTest(action2.id, { testType: 'xss', endpoint: action2.id })

      const untested = store.getUntestedActions()
      expect(untested).toHaveLength(1)
      expect(untested[0].id).toBe(action1.id)
    })
  })

  describe('getAuthFlows', () => {
    it('returns all auth flow nodes', () => {
      const store = createStore()
      store.addAuthFlow({ flowType: 'login', steps: [] })
      store.addAuthFlow({ flowType: 'logout', steps: [] })
      const flows = store.getAuthFlows()
      expect(flows).toHaveLength(2)
    })

    it('returns empty array when no auth flows', () => {
      const store = createStore()
      expect(store.getAuthFlows()).toEqual([])
    })
  })

  describe('getRBACMatrix', () => {
    it('returns matrix with role and endpoints', () => {
      const store = createStore()
      store.addRBACRole({
        roleName: 'admin',
        accessibleEndpoints: ['/admin', '/users'],
        inaccessibleEndpoints: [],
        visibleUIElements: [],
      })
      store.addRBACRole({
        roleName: 'user',
        accessibleEndpoints: ['/profile'],
        inaccessibleEndpoints: ['/admin'],
        visibleUIElements: [],
      })

      const matrix = store.getRBACMatrix()
      expect(matrix).toHaveLength(2)
      const adminRow = matrix.find(m => m.role === 'admin')!
      expect(adminRow.endpoints).toContain('/admin')
      const userRow = matrix.find(m => m.role === 'user')!
      expect(userRow.endpoints).toContain('/admin (denied)')
    })
  })

  describe('getAttackPath', () => {
    it('returns single node when finding has no chains', () => {
      const store = createStore()
      const finding = store.addFinding({ technique: 'xss', endpoint: '/search', evidence: ['x'] })
      const path = store.getAttackPath(finding.id)
      expect(path).toHaveLength(1)
      expect(path[0].id).toBe(finding.id)
    })

    it('returns empty array for non-existent finding', () => {
      const store = createStore()
      const path = store.getAttackPath('nonexistent')
      expect(path).toEqual([])
    })
  })

  describe('save and load persistence', () => {
    it('save writes to file and load restores state', async () => {
      const store1 = createStore()
      store1.upsertPage('http://example.com')
      store1.addFinding({ technique: 'xss', endpoint: '/search', evidence: ['x'] })
      await store1.save()

      const store2 = createStore()
      await store2.load()
      const pages = store2.queryNodes(NodeType.PAGE)
      const findings = store2.queryNodes(NodeType.FINDING)
      expect(pages).toHaveLength(1)
      expect(findings).toHaveLength(1)
    })

    it('save/load preserves edges', async () => {
      const store1 = createStore()
      const page = store1.upsertPage('http://example.com')
      store1.addAction(page.id, { actionType: 'click' })
      await store1.save()

      const store2 = createStore()
      await store2.load()
      const actions = store2.queryNodes(NodeType.ACTION)
      expect(actions).toHaveLength(1)
    })

    it('load handles missing file gracefully', async () => {
      const store = createStore()
      await store.load()
      expect(store.queryNodes()).toHaveLength(0)
    })

    it('load handles corrupt file gracefully', async () => {
      const { writeFileSync } = require('node:fs')
      writeFileSync(join(tmpDir, 'test-graph.json'), 'not-json')
      const store = createStore()
      await store.load()
      expect(store.queryNodes()).toHaveLength(0)
    })
  })
})

describe('getGlobalGraphStore', () => {
  it('creates singleton instance', async () => {
    const { getGlobalGraphStore, setGlobalGraphStore } = await import('../../src/graph/store')
    setGlobalGraphStore(null as any)
    const s1 = getGlobalGraphStore()
    const s2 = getGlobalGraphStore()
    expect(s1).toBe(s2)
  })
})
