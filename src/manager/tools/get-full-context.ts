import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../../graph/store'
import { NodeType } from '../../graph/schema'
import type { EndpointNode, FindingNode } from '../../graph/schema'

export const getFullContext = createTool({
  id: 'getFullContext',
  description: 'Get complete context for a target: all endpoints with headers, all findings, all tests. Use this FIRST before spawning workers.',
  inputSchema: z.object({}),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const endpoints = store.queryNodes(NodeType.ENDPOINT) as EndpointNode[]
      const findings = store.queryNodes(NodeType.FINDING) as FindingNode[]
      const summary = store.getTargetSummary()

      const endpointDetails = endpoints.map(e => ({
        id: e.id,
        url: e.properties.url,
        method: e.properties.method,
        params: e.properties.params || [],
        authRequired: e.properties.authRequired,
        authType: e.properties.authType,
        headers: (e.properties.headers || []).slice(0, 10),
        tags: e.properties.tags || [],
      }))

      const findingDetails = findings.map(f => ({
        id: f.id,
        endpoint: f.properties.endpoint,
        technique: f.properties.technique,
        severity: f.properties.severity,
        confidence: f.properties.confidence,
        description: f.properties.description,
      }))

      return {
        ok: true,
        value: {
          summary,
          endpoints: endpointDetails,
          findings: findingDetails,
        },
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  },
})
