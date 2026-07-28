import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ForensicLog } from '../logging/forensic-log'
import type { FindingNode, EndpointNode } from '../graph/schema'

let _forensicLog: ForensicLog | null = null

export function setForensicLog(log: ForensicLog): void {
  _forensicLog = log
}

export function getForensicLog(): ForensicLog | null {
  return _forensicLog
}

export const readReportTool = createTool({
  id: 'readReport',
  description: 'Read the forensic report of all actions taken during this session. Sections: summary, findings, timeline, endpoints, all.',
  inputSchema: z.object({
    section: z.enum(['summary', 'findings', 'timeline', 'endpoints', 'all']).default('summary')
      .describe('Report section to read'),
    limit: z.number().int().positive().default(50)
      .describe('Maximum number of events to return for timeline section'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.any(),
  }),
  execute: async ({ section, limit }) => {

    if (!_forensicLog) {
      return {
        ok: false,
        value: { error: 'No forensic log active. Start a session first.' },
      }
    }

    const { getGlobalGraphStore } = await import('../graph/store')
    const store = getGlobalGraphStore()

    switch (section) {
      case 'summary': {
        return {
          ok: true,
          value: {
            summary: _forensicLog.getSummary(),
            index: _forensicLog.getIndex(),
          },
        }
      }

      case 'findings': {
        const allNodes = store?.queryNodes() || []
        const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
        return {
          ok: true,
          value: {
            findings: findings.map(f => ({
              id: f.id,
              type: f.properties.technique,
              endpoint: f.properties.endpoint,
              severity: f.properties.severity,
              confidence: f.properties.confidence,
              evidence: f.properties.evidence,
              createdAt: f.createdAt,
            })),
            count: findings.length,
          },
        }
      }

      case 'timeline': {
        const events = _forensicLog.getEvents({ limit })
        return {
          ok: true,
          value: {
            timeline: events.map(e => ({
              timestamp: new Date(e.timestamp).toISOString(),
              type: e.type,
              tool: e.tool,
              duration: e.duration,
              error: e.error,
              argsSummary: e.args ? summarizeArgs(e.args) : undefined,
            })),
            total: _forensicLog.getIndex().totalEvents,
            returned: events.length,
          },
        }
      }

      case 'endpoints': {
        const allNodes = store?.queryNodes() || []
        const endpoints = allNodes.filter(n => n.type === 'Endpoint') as EndpointNode[]
        return {
          ok: true,
          value: {
            endpoints: endpoints.map(e => ({
              id: e.id,
              url: e.properties.url,
              method: e.properties.method,
              params: e.properties.params,
              authRequired: e.properties.authRequired,
              authType: e.properties.authType,
              headerCount: e.properties.headers ? Object.keys(e.properties.headers).length : 0,
            })),
            count: endpoints.length,
          },
        }
      }

      case 'all': {
        const idx = _forensicLog.getIndex()
        const allNodes = store?.queryNodes() || []
        const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]
        const endpoints = allNodes.filter(n => n.type === 'Endpoint') as EndpointNode[]
        const timeline = _forensicLog.getEvents({ limit: 200 })

        return {
          ok: true,
          value: {
            summary: _forensicLog.getSummary(),
            findings: findings.map(f => ({
              id: f.id,
              type: f.properties.technique,
              endpoint: f.properties.endpoint,
              severity: f.properties.severity,
            })),
            endpoints: endpoints.map(e => ({
              url: e.properties.url,
              method: e.properties.method,
            })),
            timeline: timeline.map(e => ({
              timestamp: new Date(e.timestamp).toISOString(),
              type: e.type,
              tool: e.tool,
              duration: e.duration,
            })),
            stats: {
              totalEvents: idx.totalEvents,
              toolCalls: idx.toolCalls,
              httpRequests: idx.httpRequests,
              graphMutations: idx.graphMutations,
              errors: idx.errors,
            },
          },
        }
      }
    }
  },
})

function summarizeArgs(args: Record<string, unknown>): string {
  const summary: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      summary.push(`${key}: ${value.length > 100 ? value.substring(0, 100) + '...' : value}`)
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      summary.push(`${key}: ${value}`)
    } else {
      summary.push(`${key}: [object]`)
    }
  }
  return summary.join(', ')
}
