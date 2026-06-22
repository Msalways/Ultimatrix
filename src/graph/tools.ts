import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from './store'
import { NodeType, EdgeType } from './schema'

export const queryGraph = createTool({
  id: 'queryGraph',
  description: 'Query the knowledge graph for nodes by type and filters. Types: Page, Action, Input, Test, Finding, AuthFlow, RBACRole, Attack.',
  inputSchema: z.object({
    type: z.nativeEnum(NodeType).optional(),
    url: z.string().optional(),
    method: z.string().optional(),
    tags: z.array(z.string()).optional(),
    limit: z.number().optional().default(50),
  }),
  execute: async ({ type, url, method, tags, limit }) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.queryNodes(type, { url, method, tags } as any)
      return { ok: true, value: result.slice(0, limit || 50) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const updateGraph = createTool({
  id: 'updateGraph',
  description: 'Write data to the knowledge graph. Actions: upsertPage, addAction, addInput, addTest, addFinding, addAuthFlow, addRBACRole, addAttack, chainFindings.',
  inputSchema: z.object({
    action: z.enum(['upsertPage', 'addAction', 'addInput', 'addTest', 'addFinding', 'addAuthFlow', 'addRBACRole', 'addAttack', 'chainFindings']),
    pageUrl: z.string().optional(),
    pageData: z.record(z.string(), z.unknown()).optional(),
    pageId: z.string().optional(),
    actionData: z.record(z.string(), z.unknown()).optional(),
    inputData: z.record(z.string(), z.unknown()).optional(),
    testData: z.record(z.string(), z.unknown()).optional(),
    findingData: z.record(z.string(), z.unknown()).optional(),
    authFlowData: z.record(z.string(), z.unknown()).optional(),
    rbacData: z.record(z.string(), z.unknown()).optional(),
    attackData: z.record(z.string(), z.unknown()).optional(),
    fromId: z.string().optional(),
    toId: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const { action, pageUrl, pageData, pageId, actionData, inputData, testData, findingData, authFlowData, rbacData, attackData, fromId, toId } = input

      switch (action) {
        case 'upsertPage':
          if (!pageUrl) return { ok: false, error: 'pageUrl required' }
          return { ok: true, value: store.upsertPage(pageUrl, pageData as any) }

        case 'addAction':
          if (!pageId || !actionData) return { ok: false, error: 'pageId and actionData required' }
          return { ok: true, value: store.addAction(pageId, actionData as any) }

    case 'addInput':
      if (!pageId || !inputData) return { ok: false, error: 'pageId/actionId and inputData required' }
      return { ok: true, value: store.addInput(pageId, inputData as any) }

        case 'addTest':
          if (!pageId || !testData) return { ok: false, error: 'pageId and testData required' }
          return { ok: true, value: store.addTest(pageId, testData as any) }

        case 'addFinding':
          if (!findingData) return { ok: false, error: 'findingData required' }
          return { ok: true, value: store.addFinding(findingData as any) }

        case 'addAuthFlow':
          if (!authFlowData) return { ok: false, error: 'authFlowData required' }
          return { ok: true, value: store.addAuthFlow(authFlowData as any) }

        case 'addRBACRole':
          if (!rbacData) return { ok: false, error: 'rbacData required' }
          return { ok: true, value: store.addRBACRole(rbacData as any) }

        case 'addAttack':
          if (!attackData) return { ok: false, error: 'attackData required' }
          return { ok: true, value: store.addAttack(attackData as any) }

        case 'chainFindings':
          if (!fromId || !toId) return { ok: false, error: 'fromId and toId required' }
          store.chainFindings(fromId, toId)
          return { ok: true, value: { chained: true } }

        default:
          return { ok: false, error: `Unknown action: ${action}` }
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getTestCoverage = createTool({
  id: 'getTestCoverage',
  description: 'Get test coverage for a specific endpoint by ID.',
  inputSchema: z.object({ endpointId: z.string() }),
  execute: async ({ endpointId }) => {
    try {
      const store = getGlobalGraphStore()
      return { ok: true, value: store.getTestCoverage(endpointId) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getAttackPath = createTool({
  id: 'getAttackPath',
  description: 'Traverse CHAINED_FROM edges from a finding to find root cause.',
  inputSchema: z.object({ findingId: z.string() }),
  execute: async ({ findingId }) => {
    try {
      const store = getGlobalGraphStore()
      return { ok: true, value: store.getAttackPath(findingId) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getUntestedActions = createTool({
  id: 'getUntestedActions',
  description: 'Get all actions that do not have any test coverage.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      return { ok: true, value: store.getUntestedActions() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getAuthFlows = createTool({
  id: 'getAuthFlows',
  description: 'Get all recorded reusable auth flows.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      return { ok: true, value: store.getAuthFlows() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})