import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from './store'
import { NodeType } from './schema'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'

/**
 * Single source of truth for `updateGraph` dispatch actions. Both the Mastra
 * tool definition (mastra/tools.ts) and the graph tool definition import this
 * array so the z.enum and the prose description can never diverge. Adding a
 * new graph mutation means adding it here AND the switch below — one place.
 */
export const GRAPH_ACTIONS = [
  'upsertPage',
  'addAction',
  'addInput',
  'addEndpoint',
  'addTest',
  'addFinding',
  'addAuthFlow',
  'addRBACRole',
  'addAttack',
  'addRenderedElement',
  'chainFindings',
] as const

export const graphActionEnum = z.enum(GRAPH_ACTIONS)

// ─── Query Tools ───────────────────────────────────────────────

export const queryGraph = createTool({
  id: 'queryGraph',
  description:
    'Query the knowledge graph for nodes by type and filters. Returns the matching nodes (never a truncated summary). ' +
    'Discover the valid node types via getGraphSchema before filtering by `type`. ' +
    'When at least one filter (type/url/method/tags) is supplied, results are scoped by that filter — set `limit: 0` to return the entire scoped result set with no cap. ' +
    'Use this to pull the full set of nodes you need to reason over; do not rely on a pre-summarized view.',
  inputSchema: z.object({
    type: z.nativeEnum(NodeType).optional().describe('Node type to filter by. Discover valid values via getGraphSchema.'),
    url: z.string().optional(),
    method: z.string().optional(),
    tags: z.array(z.string()).optional(),
    origin: z.enum(['target', 'self']).optional().describe('Filter endpoints by traffic origin: target = app under test, self = our own tooling (e.g. OAST callbacks).'),
    limit: z.number().optional().default(50).describe('Max nodes to return. 0 = unbounded (returns the entire scoped result set).'),
  }),
  execute: async ({ type, url, method, tags, origin, limit }) => {
    try {
      const store = getGlobalGraphStore()
      const filters: Record<string, unknown> = {}
      if (url !== undefined) filters.url = url
      if (method !== undefined) filters.method = method
      if (tags !== undefined) filters.tags = tags
      if (origin !== undefined) filters.origin = origin
      const result = store.queryNodes(type, Object.keys(filters).length > 0 ? filters : undefined)
      const cap = limit === 0 ? result.length : (limit ?? 50)
      return { ok: true, value: result.slice(0, cap) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getTargetSummary = createTool({
  id: 'getTargetSummary',
  description: 'Get a full summary of the current target: endpoints, findings, tests, auth flows, RBAC roles, and untested actions. Use this FIRST before deciding what to test next.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      return { ok: true, value: store.getTargetSummary() }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const getEndpointsWithParams = createTool({
  id: 'getEndpointsWithParams',
  description: 'Get all discovered endpoints that have parameters (query params, body params, path params). These are the high-value targets for security testing.',
  inputSchema: z.object({
    authRequired: z.boolean().optional().describe('Filter by auth requirement'),
  }),
  execute: async ({ authRequired }) => {
    try {
      const store = getGlobalGraphStore()
      let endpoints = store.getEndpointsWithParams()
      if (authRequired !== undefined) {
        endpoints = endpoints.filter(e => e.properties.authRequired === authRequired)
      }
      return { ok: true, value: endpoints }
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

// ─── Mutation Tools (focused, one action each) ─────────────────

export const upsertPage = createTool({
  id: 'upsertPage',
  description: 'Record or update a page in the knowledge graph. Call this after navigating to a URL.',
  inputSchema: z.object({
    url: z.string().describe('The page URL'),
    title: z.string().optional().describe('Page title'),
    method: z.string().optional().describe('HTTP method (default GET)'),
    tags: z.array(z.string()).optional().describe('Semantic tags'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.upsertPage(input.url, input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'upsertPage', args: input, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addAction = createTool({
  id: 'addAction',
  description: 'Record a user interaction (click, fill, submit) on a page.',
  inputSchema: z.object({
    pageId: z.string().describe('Page node ID (format: page:<url>)'),
    actionType: z.string().describe('Action type: click, fill, submit, navigate, scroll'),
    selector: z.string().optional().describe('CSS selector or description'),
    url: z.string().optional().describe('Action URL if different from page'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addAction(input.pageId, input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addAction', args: input, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addInput = createTool({
  id: 'addInput',
  description: 'Record a form field or input element discovered on a page.',
  inputSchema: z.object({
    actionId: z.string().describe('Parent action node ID'),
    selector: z.string().describe('CSS selector or element description'),
    inputType: z.string().optional().describe('Input type: text, password, email, checkbox, etc.'),
    name: z.string().optional().describe('Input name attribute'),
    placeholder: z.string().optional().describe('Placeholder text'),
    required: z.boolean().optional().describe('Whether the field is required'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addInput(input.actionId, input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addInput', args: input, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addEndpoint = createTool({
  id: 'addEndpoint',
  description: 'Record a discovered API endpoint with its parameters. Use this for every unique URL/endpoint found during crawling or testing.',
  inputSchema: z.object({
    url: z.string().describe('Full endpoint URL'),
    method: z.string().describe('HTTP method: GET, POST, PUT, DELETE, PATCH'),
    params: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      location: z.string().optional().describe('query, body, path, header'),
      required: z.boolean().optional(),
    })).optional().describe('Endpoint parameters'),
    authRequired: z.boolean().optional().describe('Whether auth is needed'),
    authType: z.string().optional().describe('Auth type: Bearer, Cookie, Basic, API-Key'),
    tags: z.array(z.string()).optional().describe('Semantic tags'),
    description: z.string().optional().describe('Endpoint description'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addEndpoint(input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addEndpoint', args: { url: input.url, method: input.method }, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addFinding = createTool({
  id: 'addFinding',
  description: 'Record a confirmed security finding with evidence and severity.',
  inputSchema: z.object({
    endpoint: z.string().describe('Affected endpoint URL'),
    technique: z.string().describe('Vulnerability technique (e.g., SQL Injection, XSS)'),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    confidence: z.number().min(0).max(1).describe('Confidence level 0-1'),
    description: z.string().describe('Detailed description'),
    evidence: z.array(z.string()).optional().describe('Evidence items'),
    remediation: z.string().optional().describe('How to fix'),
    cwe: z.string().optional().describe('CWE ID'),
    tags: z.array(z.string()).optional().describe('Tags'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addFinding(input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addFinding', args: { endpoint: input.endpoint, technique: input.technique, severity: input.severity }, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addAuthFlow = createTool({
  id: 'addAuthFlow',
  description: 'Record an authentication flow (login, logout, token refresh, OAuth).',
  inputSchema: z.object({
    flowType: z.string().describe('Flow type: login, logout, token_refresh, oauth, registration'),
    steps: z.array(z.union([z.string(), z.object({ action: z.string(), url: z.string().optional(), selector: z.string().optional(), value: z.string().optional() })])).optional().describe('Flow steps — strings or structured step objects'),
    reusable: z.boolean().optional().describe('Whether this flow is reusable'),
    startUrl: z.string().optional().describe('Starting URL'),
    endUrl: z.string().optional().describe('Ending URL after flow'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addAuthFlow(input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addAuthFlow', args: { flowType: input.flowType }, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addRBACRole = createTool({
  id: 'addRBACRole',
  description: 'Record an RBAC role with its accessible/inaccessible endpoints.',
  inputSchema: z.object({
    roleName: z.string().describe('Role name'),
    accessibleEndpoints: z.array(z.string()).optional().describe('Endpoints this role can access'),
    inaccessibleEndpoints: z.array(z.string()).optional().describe('Endpoints this role cannot access'),
    visibleUIElements: z.array(z.string()).optional().describe('UI elements visible to this role'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addRBACRole(input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addRBACRole', args: { roleName: input.roleName }, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const addAttack = createTool({
  id: 'addAttack',
  description: 'Record an attack attempt with its technique, payload, and result.',
  inputSchema: z.object({
    technique: z.string().describe('Attack technique'),
    payload: z.string().describe('Payload used'),
    vulnerable: z.boolean().describe('Whether the target was vulnerable'),
    confidence: z.number().min(0).max(1).describe('Confidence level'),
    endpoint: z.string().optional().describe('Target endpoint'),
    response: z.string().optional().describe('Response snippet'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const result = store.addAttack(input)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'addAttack', args: { technique: input.technique, vulnerable: input.vulnerable }, result: { nodeId: result.id } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

export const chainFindings = createTool({
  id: 'chainFindings',
  description: 'Chain two findings together to build an attack path.',
  inputSchema: z.object({
    fromId: z.string().describe('Source finding ID'),
    toId: z.string().describe('Target finding ID'),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      store.chainFindings(input.fromId, input.toId)
      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'chainFindings', args: input, result: { chained: true } })
      return { ok: true, value: { chained: true, fromId: input.fromId, toId: input.toId } }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})

// ─── Backward-compatible wrapper ───────────────────────────────

export const updateGraph = createTool({
  id: 'updateGraph',
  description: 'Write data to the knowledge graph. Prefer the focused single-purpose graph mutation tools, which expose clearer per-action schemas.',
  inputSchema: z.object({
    action: graphActionEnum,
    pageUrl: z.string().optional(),
    pageData: z.record(z.string(), z.unknown()).optional(),
    pageId: z.string().optional(),
    actionData: z.record(z.string(), z.unknown()).optional(),
    inputData: z.record(z.string(), z.unknown()).optional(),
    endpointData: z.record(z.string(), z.unknown()).optional(),
    testData: z.record(z.string(), z.unknown()).optional(),
    findingData: z.record(z.string(), z.unknown()).optional(),
    authFlowData: z.record(z.string(), z.unknown()).optional(),
    rbacData: z.record(z.string(), z.unknown()).optional(),
    attackData: z.record(z.string(), z.unknown()).optional(),
    renderedEndpointId: z.string().optional(),
    renderedData: z.record(z.string(), z.unknown()).optional(),
    fromId: z.string().optional(),
    toId: z.string().optional(),
  }),
  execute: async (input) => {
    try {
      const store = getGlobalGraphStore()
      const { action, pageUrl, pageData, pageId, actionData, inputData, endpointData, testData, findingData, authFlowData, rbacData, attackData, renderedEndpointId, renderedData, fromId, toId } = input

      let result: unknown

      switch (action) {
        case 'upsertPage':
          if (!pageUrl) return { ok: false, error: 'pageUrl required for upsertPage. Use the upsertPage tool instead — it has a clearer schema.' }
          result = store.upsertPage(pageUrl, pageData as any)
          break

        case 'addAction':
          if (!pageId || !actionData) return { ok: false, error: 'pageId and actionData required. Use the addAction tool instead.' }
          result = store.addAction(pageId, actionData as any)
          break

        case 'addInput':
          if (!pageId || !inputData) return { ok: false, error: 'pageId and inputData required. Use the addInput tool instead.' }
          result = store.addInput(pageId, inputData as any)
          break

        case 'addEndpoint':
          if (!endpointData) return { ok: false, error: 'endpointData required (url, method). Use the addEndpoint tool instead.' }
          result = store.addEndpoint(endpointData as any)
          break

        case 'addTest':
          if (!pageId || !testData) return { ok: false, error: 'pageId and testData required' }
          result = store.addTest(pageId, testData as any)
          break

        case 'addFinding':
          if (!findingData) return { ok: false, error: 'findingData required. Use the addFinding tool instead.' }
          result = store.addFinding(findingData as any)
          break

        case 'addAuthFlow':
          if (!authFlowData) return { ok: false, error: 'authFlowData required. Use the addAuthFlow tool instead.' }
          result = store.addAuthFlow(authFlowData as any)
          break

        case 'addRBACRole':
          if (!rbacData) return { ok: false, error: 'rbacData required. Use the addRBACRole tool instead.' }
          result = store.addRBACRole(rbacData as any)
          break

        case 'addAttack':
          if (!attackData) return { ok: false, error: 'attackData required. Use the addAttack tool instead.' }
          result = store.addAttack(attackData as any)
          break

        case 'addRenderedElement':
          if (!renderedData) return { ok: false, error: 'renderedData required (selector, tag).' }
          result = store.addRenderedElement(renderedEndpointId, renderedData as any)
          break

        case 'chainFindings':
          if (!fromId || !toId) return { ok: false, error: 'fromId and toId required. Use the chainFindings tool instead.' }
          store.chainFindings(fromId, toId)
          result = { chained: true }
          break

        default:
          return { ok: false, error: `Unknown action: ${action}` }
      }

      await store.save()
      getForensicLog()?.log({ type: 'graph-mutation', agent: 'worker', tool: 'updateGraph', args: { action }, result: { nodeId: (result as any)?.id, action } })
      return { ok: true, value: result }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
