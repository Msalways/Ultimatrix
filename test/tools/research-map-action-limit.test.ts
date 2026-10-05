import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ graphStore: null as any, observerActions: [] as any[] }))

vi.mock('@mastra/core/tools', () => ({ createTool: (tool: any) => tool }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => mocks.graphStore }))
vi.mock('../../src/research/workflow-extractor', () => ({
  extractWorkflows: (store: any) => store.queryNodes('Workflow').map((node: any) => ({ id: node.id, ...node.properties })),
}))
vi.mock('../../src/research/entity-extractor', () => ({ extractEntities: () => [] }))
vi.mock('../../src/tools/report-tools', () => ({ getForensicLog: () => null }))
vi.mock('../../src/capture/human-observer', () => ({ getGlobalObserver: () => ({ getActions: () => mocks.observerActions }) }))

import { NodeType } from '../../src/graph/schema'
import { coreEvidenceLedger } from '../../src/core/evidence'
import { getCapturedRequestStore } from '../../src/capture/captured-request-store'
import { buildResearchMap } from '../../src/tools/research-tools'

describe('buildResearchMap action-limit evidence', () => {
  const nodes = new Map<string, any>()

  beforeEach(() => {
    nodes.clear()
    const endpoint = {
      id: 'coupon-redeem', type: NodeType.ENDPOINT,
      properties: { url: 'https://app.test/api/coupon/redeem', method: 'POST', params: [], tags: ['har-capture'] },
      createdAt: 1, updatedAt: 1,
    }
    nodes.set(endpoint.id, endpoint)
    mocks.graphStore = {
      queryNodes: (type: string) => [...nodes.values()].filter(node => node.type === type),
      addEndpoint: (properties: any) => {
        const url = new URL(properties.url)
        const existing = [...nodes.values()].find(node => node.type === NodeType.ENDPOINT
          && node.properties.method === properties.method
          && new URL(node.properties.url).pathname === url.pathname)
        if (existing) return existing
        const node = { id: `endpoint:${properties.method}:${url.pathname}`, type: NodeType.ENDPOINT, properties, createdAt: 1, updatedAt: 1 }
        nodes.set(node.id, node)
        return node
      },
      upsertNode: (node: any) => { nodes.set(node.id, node); return node },
      addEdge: vi.fn(),
      save: vi.fn(async () => undefined),
    }
    mocks.observerActions = []
    getCapturedRequestStore().clear()
    coreEvidenceLedger.clear()
  })

  it('imports the exact source response and persists the captured limit hypothesis', async () => {
    const captures = getCapturedRequestStore()
    const rule = captures.record({
      method: 'GET', url: 'https://app.test/api/coupon/redeem', status: 200,
      responseBody: '<p>This offer may only be used once.</p>', source: 'browser',
    })
    const action = captures.record({
      method: 'POST', url: 'https://app.test/api/coupon/redeem', status: 200,
      headers: { 'content-type': 'application/json' }, body: '{"code":"WELCOME"}',
      responseBody: '{"balance":10}', source: 'browser',
    })

    const result = await buildResearchMap.execute({ maxHypotheses: 25 }) as any

    expect(result.ok).toBe(true)
    expect(coreEvidenceLedger.all()).toContainEqual(expect.objectContaining({
      type: 'raw_response',
      data: rule.responseBody,
      observed: expect.objectContaining({ captureId: rule.id, url: rule.url, status: 200 }),
    }))
    expect([...nodes.values()].find(node => node.type === NodeType.HYPOTHESIS && node.properties.kind === 'action_limit')?.properties.businessRule)
      .toMatchObject({ allowedCount: 1, actionRequestId: action.id, ruleCaptureId: rule.id })
  })

  it('turns an observed browser interaction and request sequence into grounded workflow hypotheses', async () => {
    const captures = getCapturedRequestStore()
    const now = Date.now()
    const rule = captures.record({
      method: 'GET', url: 'https://app.test/api/coupon/redeem', status: 200,
      responseBody: '<p>This offer may only be used once.</p>', source: 'browser', capturedAt: now - 2,
    })
    const action = captures.record({
      method: 'POST', url: 'https://app.test/api/coupon/redeem', status: 200,
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'code=SYNTHETIC',
      responseBody: '{"balance":10}', source: 'browser', capturedAt: now + 2,
    })
    mocks.observerActions = [
      { type: 'fill', url: 'https://app.test/api/coupon/redeem', selector: 'input[name="code"]', timestamp: now - 1 },
      { type: 'submit', url: 'https://app.test/api/coupon/redeem', selector: 'form', timestamp: now + 1 },
    ]

    const result = await buildResearchMap.execute({ maxHypotheses: 25 }) as any
    const workflow = [...nodes.values()].find(node => node.type === NodeType.WORKFLOW)
    const hypotheses = [...nodes.values()].filter(node => node.type === NodeType.HYPOTHESIS)

    expect(result.ok).toBe(true)
    expect(workflow?.properties).toMatchObject({
      source: 'browser-observation', sequenceObserved: true,
      capturedRequestIds: [rule.id, action.id],
    })
    expect(hypotheses.some(node => node.properties.kind === 'workflow_bypass'
      && node.properties.relatedWorkflowIds.includes(workflow.id))).toBe(true)
    expect(hypotheses.some(node => node.properties.kind === 'action_limit'
      && node.properties.relatedWorkflowIds.includes(workflow.id)
      && node.properties.targetEndpoints.includes('coupon-redeem'))).toBe(true)
  })
})
