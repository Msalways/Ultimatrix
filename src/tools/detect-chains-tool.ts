import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalGraphStore } from '../graph/store'
import { detectChains } from '../intelligence/chaining'
import type { FindingNode } from '../graph/schema'

export const detectChainsTool = createTool({
  id: 'detectChains',
  description: 'Detect potential attack chains between findings in the knowledge graph. Returns linked findings that could be combined for higher-impact exploits.',
  inputSchema: z.object({}),
  outputSchema: z.object({
    ok: z.boolean(),
    value: z.object({
      chains: z.array(z.object({
        source: z.string(),
        target: z.string(),
        rule: z.string(),
        severity: z.string(),
        description: z.string(),
      })),
      count: z.number(),
    }),
  }),
  execute: async () => {
    try {
      const store = getGlobalGraphStore()
      const allNodes = store.queryNodes()
      const findings = allNodes.filter(n => n.type === 'Finding') as FindingNode[]

      if (findings.length === 0) {
        return {
          ok: true,
          value: { chains: [], count: 0 },
        }
      }

      const chains = detectChains(findings)

      return {
        ok: true,
        value: {
          chains: chains.map(c => ({
            source: c.source.properties.technique,
            target: c.target.properties.technique,
            rule: c.rule.name,
            severity: c.rule.severity,
            description: c.rule.description,
          })),
          count: chains.length,
        },
      }
    } catch (error) {
      return {
        ok: false,
        value: { chains: [], count: 0 },
      }
    }
  },
})
