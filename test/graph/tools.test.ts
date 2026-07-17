import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@mastra/core/tools', () => ({
  createTool: (config: any) => config,
}))

const mockStore = {
  queryNodes: vi.fn(),
  upsertPage: vi.fn(),
  addAction: vi.fn(),
  addInput: vi.fn(),
  addEndpoint: vi.fn(),
  addTest: vi.fn(),
  addFinding: vi.fn(),
  addAuthFlow: vi.fn(),
  addRBACRole: vi.fn(),
  addAttack: vi.fn(),
  chainFindings: vi.fn(),
  getTestCoverage: vi.fn(),
  getUntestedActions: vi.fn(),
  getAuthFlows: vi.fn(),
  getAttackPath: vi.fn(),
  getEndpointsWithParams: vi.fn(),
  getTargetSummary: vi.fn(),
  save: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/graph/store', () => ({
  getGlobalGraphStore: () => mockStore,
}))

async function callTool(tool: any, args: any, ctx?: any) {
  return tool.execute(args, ctx ?? {})
}

describe('graph tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('queryGraph', () => {
    it('returns ok with nodes', async () => {
      const { queryGraph } = await import('../../src/graph/tools')
      const nodes = [{ id: 'n1', type: 'Page', label: 'Test' }]
      mockStore.queryNodes.mockReturnValue(nodes)

      const result = await callTool(queryGraph, { type: 'Page', url: 'http://test.com', tags: ['api'], limit: 10 })
      expect(result.ok).toBe(true)
      expect(result.value).toEqual(nodes)
      expect(mockStore.queryNodes).toHaveBeenCalledWith('Page', { url: 'http://test.com', method: undefined, tags: ['api'] })
    })

    it('returns error on exception', async () => {
      const { queryGraph } = await import('../../src/graph/tools')
      mockStore.queryNodes.mockImplementation(() => { throw new Error('store error') })
      const result = await callTool(queryGraph, {})
      expect(result.ok).toBe(false)
      expect(result.error).toBe('store error')
    })

    it('defaults limit to 50', async () => {
      const { queryGraph } = await import('../../src/graph/tools')
      const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}` }))
      mockStore.queryNodes.mockReturnValue(nodes)

      const result = await callTool(queryGraph, {})
      expect(result.value).toHaveLength(50)
    })

    it('passes origin filter through to the store query', async () => {
      const { queryGraph } = await import('../../src/graph/tools')
      const nodes = [{ id: 'ep1', type: 'Endpoint', properties: { origin: 'target' } }]
      mockStore.queryNodes.mockReturnValue(nodes)

      const result = await callTool(queryGraph, { type: 'Endpoint', origin: 'target' })
      expect(result.ok).toBe(true)
      expect(mockStore.queryNodes).toHaveBeenCalledWith('Endpoint', { origin: 'target' })
    })

    it('omits origin filter when not provided', async () => {
      const { queryGraph } = await import('../../src/graph/tools')
      mockStore.queryNodes.mockReturnValue([])

      await callTool(queryGraph, { type: 'Endpoint' })
      expect(mockStore.queryNodes).toHaveBeenCalledWith('Endpoint', undefined)
    })
  })

  describe('updateGraph', () => {
    it('upsertPage action with pageUrl', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.upsertPage.mockReturnValue({ id: 'page:http://test.com' })

      const result = await callTool(updateGraph, { action: 'upsertPage', pageUrl: 'http://test.com', pageData: { status: 200 } })
      expect(result.ok).toBe(true)
      expect(mockStore.upsertPage).toHaveBeenCalledWith('http://test.com', { status: 200 })
    })

    it('upsertPage returns error without pageUrl', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      const result = await callTool(updateGraph, { action: 'upsertPage' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('pageUrl required')
    })

    it('addAction action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addAction.mockReturnValue({ id: 'action:1' })

      const result = await callTool(updateGraph, { action: 'addAction', pageId: 'p1', actionData: { actionType: 'click' } })
      expect(result.ok).toBe(true)
      expect(mockStore.addAction).toHaveBeenCalledWith('p1', { actionType: 'click' })
    })

    it('addAction returns error without pageId', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      const result = await callTool(updateGraph, { action: 'addAction', actionData: {} })
      expect(result.ok).toBe(false)
    })

    it('addInput action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addInput.mockReturnValue({ id: 'input:1' })

      const result = await callTool(updateGraph, { action: 'addInput', pageId: 'p1', inputData: { selector: '#email' } })
      expect(result.ok).toBe(true)
      expect(mockStore.addInput).toHaveBeenCalledWith('p1', { selector: '#email' })
    })

    it('addTest action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addTest.mockReturnValue({ id: 'test:1' })

      const result = await callTool(updateGraph, { action: 'addTest', pageId: 'p1', testData: { testType: 'xss' } })
      expect(result.ok).toBe(true)
    })

    it('addFinding action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addFinding.mockReturnValue({ id: 'finding:1' })

      const result = await callTool(updateGraph, { action: 'addFinding', findingData: { technique: 'xss', endpoint: '/search' } })
      expect(result.ok).toBe(true)
      expect(mockStore.addFinding).toHaveBeenCalledWith({ technique: 'xss', endpoint: '/search' })
    })

    it('addFinding returns error without findingData', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      const result = await callTool(updateGraph, { action: 'addFinding' })
      expect(result.ok).toBe(false)
    })

    it('addAuthFlow action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addAuthFlow.mockReturnValue({ id: 'auth:1' })

      const result = await callTool(updateGraph, { action: 'addAuthFlow', authFlowData: { flowType: 'login' } })
      expect(result.ok).toBe(true)
    })

    it('addRBACRole action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addRBACRole.mockReturnValue({ id: 'rbac:admin' })

      const result = await callTool(updateGraph, { action: 'addRBACRole', rbacData: { roleName: 'admin' } })
      expect(result.ok).toBe(true)
    })

    it('addAttack action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.addAttack.mockReturnValue({ id: 'attack:1' })

      const result = await callTool(updateGraph, { action: 'addAttack', attackData: { technique: 'xss', payload: '<script>' } })
      expect(result.ok).toBe(true)
    })

    it('chainFindings action', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.chainFindings.mockReturnValue(undefined)

      const result = await callTool(updateGraph, { action: 'chainFindings', fromId: 'f1', toId: 'f2' })
      expect(result.ok).toBe(true)
      expect(result.value?.chained).toBe(true)
      expect(mockStore.chainFindings).toHaveBeenCalledWith('f1', 'f2')
    })

    it('chainFindings returns error without fromId or toId', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      const result = await callTool(updateGraph, { action: 'chainFindings', fromId: 'f1' })
      expect(result.ok).toBe(false)
    })

    it('unknown action returns error', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      const result = await callTool(updateGraph, { action: 'unknown' })
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Unknown')
    })

    it('returns error on exception', async () => {
      const { updateGraph } = await import('../../src/graph/tools')
      mockStore.upsertPage.mockImplementation(() => { throw new Error('fail') })
      const result = await callTool(updateGraph, { action: 'upsertPage', pageUrl: 'http://test.com' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('fail')
    })
  })

  describe('getTestCoverage', () => {
    it('returns test coverage', async () => {
      const { getTestCoverage } = await import('../../src/graph/tools')
      mockStore.getTestCoverage.mockReturnValue([{ id: 't1' }])

      const result = await callTool(getTestCoverage, { endpointId: 'action:1' })
      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(1)
    })

    it('returns error on exception', async () => {
      const { getTestCoverage } = await import('../../src/graph/tools')
      mockStore.getTestCoverage.mockImplementation(() => { throw new Error('fail') })
      const result = await callTool(getTestCoverage, { endpointId: 'x' })
      expect(result.ok).toBe(false)
    })
  })

  describe('getUntestedActions', () => {
    it('returns untested actions', async () => {
      const { getUntestedActions } = await import('../../src/graph/tools')
      mockStore.getUntestedActions.mockReturnValue([{ id: 'a1' }, { id: 'a2' }])

      const result = await callTool(getUntestedActions, {})
      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })

    it('returns error on exception', async () => {
      const { getUntestedActions } = await import('../../src/graph/tools')
      mockStore.getUntestedActions.mockImplementation(() => { throw new Error('fail') })
      const result = await callTool(getUntestedActions, {})
      expect(result.ok).toBe(false)
    })
  })

  describe('getAuthFlows', () => {
    it('returns auth flows', async () => {
      const { getAuthFlows } = await import('../../src/graph/tools')
      mockStore.getAuthFlows.mockReturnValue([{ id: 'flow1' }])

      const result = await callTool(getAuthFlows, {})
      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(1)
    })

    it('returns error on exception', async () => {
      const { getAuthFlows } = await import('../../src/graph/tools')
      mockStore.getAuthFlows.mockImplementation(() => { throw new Error('fail') })
      const result = await callTool(getAuthFlows, {})
      expect(result.ok).toBe(false)
    })
  })

  describe('getAttackPath', () => {
    it('returns attack path', async () => {
      const { getAttackPath } = await import('../../src/graph/tools')
      mockStore.getAttackPath.mockReturnValue([{ id: 'f1' }, { id: 'f2' }])

      const result = await callTool(getAttackPath, { findingId: 'f2' })
      expect(result.ok).toBe(true)
      expect(result.value).toHaveLength(2)
    })

    it('returns error on exception', async () => {
      const { getAttackPath } = await import('../../src/graph/tools')
      mockStore.getAttackPath.mockImplementation(() => { throw new Error('fail') })
      const result = await callTool(getAttackPath, { findingId: 'x' })
      expect(result.ok).toBe(false)
    })
  })

  describe('focused mutation tools', () => {
    it('upsertPage records page and saves', async () => {
      const { upsertPage } = await import('../../src/graph/tools')
      mockStore.upsertPage.mockReturnValue({ id: 'page:http://test.com' })

      const result = await callTool(upsertPage, { url: 'http://test.com', title: 'Test' })
      expect(result.ok).toBe(true)
      expect(mockStore.upsertPage).toHaveBeenCalledWith('http://test.com', { url: 'http://test.com', title: 'Test' })
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addAction records action and saves', async () => {
      const { addAction } = await import('../../src/graph/tools')
      mockStore.addAction.mockReturnValue({ id: 'action:1' })

      const result = await callTool(addAction, { pageId: 'page:http://test.com', actionType: 'click', selector: '#btn' })
      expect(result.ok).toBe(true)
      expect(mockStore.addAction).toHaveBeenCalledWith('page:http://test.com', { pageId: 'page:http://test.com', actionType: 'click', selector: '#btn' })
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addInput records input and saves', async () => {
      const { addInput } = await import('../../src/graph/tools')
      mockStore.addInput.mockReturnValue({ id: 'input:1' })

      const result = await callTool(addInput, { actionId: 'action:1', selector: '#email', inputType: 'email', name: 'email' })
      expect(result.ok).toBe(true)
      expect(mockStore.addInput).toHaveBeenCalledWith('action:1', { actionId: 'action:1', selector: '#email', inputType: 'email', name: 'email' })
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addEndpoint records endpoint and saves', async () => {
      const { addEndpoint } = await import('../../src/graph/tools')
      mockStore.addEndpoint.mockReturnValue({ id: 'endpoint:1' })

      const result = await callTool(addEndpoint, { url: 'http://test.com/api', method: 'GET', authRequired: true })
      expect(result.ok).toBe(true)
      expect(mockStore.addEndpoint).toHaveBeenCalledWith({ url: 'http://test.com/api', method: 'GET', authRequired: true })
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addFinding records finding and saves', async () => {
      const { addFinding } = await import('../../src/graph/tools')
      mockStore.addFinding.mockReturnValue({ id: 'finding:1' })

      const result = await callTool(addFinding, { endpoint: '/api', technique: 'SQLi', severity: 'high', confidence: 0.9, description: 'Test' })
      expect(result.ok).toBe(true)
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addAuthFlow records auth flow and saves', async () => {
      const { addAuthFlow } = await import('../../src/graph/tools')
      mockStore.addAuthFlow.mockReturnValue({ id: 'auth:1' })

      const result = await callTool(addAuthFlow, { flowType: 'login', startUrl: '/login' })
      expect(result.ok).toBe(true)
      expect(mockStore.addAuthFlow).toHaveBeenCalledWith({ flowType: 'login', startUrl: '/login' })
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addRBACRole records role and saves', async () => {
      const { addRBACRole } = await import('../../src/graph/tools')
      mockStore.addRBACRole.mockReturnValue({ id: 'rbac:admin' })

      const result = await callTool(addRBACRole, { roleName: 'admin', accessibleEndpoints: ['/admin'] })
      expect(result.ok).toBe(true)
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('addAttack records attack and saves', async () => {
      const { addAttack } = await import('../../src/graph/tools')
      mockStore.addAttack.mockReturnValue({ id: 'attack:1' })

      const result = await callTool(addAttack, { technique: 'XSS', payload: '<script>', vulnerable: true, confidence: 0.8 })
      expect(result.ok).toBe(true)
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('chainFindings chains and saves', async () => {
      const { chainFindings } = await import('../../src/graph/tools')
      mockStore.chainFindings.mockReturnValue(undefined)

      const result = await callTool(chainFindings, { fromId: 'f1', toId: 'f2' })
      expect(result.ok).toBe(true)
      expect(mockStore.chainFindings).toHaveBeenCalledWith('f1', 'f2')
      expect(mockStore.save).toHaveBeenCalled()
    })

    it('focused tools return error on exception', async () => {
      const { upsertPage } = await import('../../src/graph/tools')
      mockStore.upsertPage.mockImplementation(() => { throw new Error('store exploded') })

      const result = await callTool(upsertPage, { url: 'http://test.com' })
      expect(result.ok).toBe(false)
      expect(result.error).toBe('store exploded')
    })
  })
})
