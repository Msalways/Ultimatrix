import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ graphStore: null as any }))

vi.mock('@mastra/core/tools', () => ({ createTool: (tool: any) => tool }))
vi.mock('../../src/graph/store', () => ({ getGlobalGraphStore: () => mocks.graphStore }))
vi.mock('../../src/research/workflow-extractor', () => ({ extractWorkflows: () => [] }))
vi.mock('../../src/research/entity-extractor', () => ({ extractEntities: () => [] }))
vi.mock('../../src/tools/report-tools', () => ({ getForensicLog: () => null }))

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
      upsertNode: (node: any) => { nodes.set(node.id, node); return node },
      save: vi.fn(async () => undefined),
    }
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
})
