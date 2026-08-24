import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { DynamicToolRegistry } from './tool-registry'

export function createExtensionTools(registry: DynamicToolRegistry) {
  const listTools = createTool({
    id: 'listTools',
    description: 'List known tool metadata and connector health. Pass one exact connector id to discover its tools on demand.',
    inputSchema: z.object({
      prefix: z.string().optional(),
      connector: z.string().optional().describe('Exact connector id, such as mcp:github or plugin:protocol-surface.'),
    }),
    execute: async ({ prefix, connector }) => {
      if (connector) await registry.discover(connector)
      const known = await registry.list()
      const filtered = prefix ? known.filter((tool) => tool.id.startsWith(prefix)) : known
      const summarize = (tool: typeof filtered[number]) => ({
        id: tool.id,
        description: tool.description,
        namespace: tool.namespace,
        source: tool.source,
        requirements: tool.requirements,
        ...(tool.activity ? { activity: tool.activity } : {}),
        ...(tool.readOnly !== undefined ? { readOnly: tool.readOnly } : {}),
      })
      const tools = {
        builtin: filtered.filter((tool) => tool.source === 'builtin').map(summarize),
        mcp: filtered.filter((tool) => tool.source === 'mcp').map((tool) => ({ ...summarize(tool), server: tool.server })),
        plugin: filtered.filter((tool) => tool.source === 'plugin').map(summarize),
      }
      return { content: { type: 'text', text: JSON.stringify({ tools, connectors: registry.listConnectors() }, null, 2) }, tools, connectors: registry.listConnectors() }
    },
  })

  const loadTool = createTool({
    id: 'loadTool',
    description: 'Resolve one exact extension tool id on demand and verify that it is ready. This does not scan free-form text.',
    inputSchema: z.object({ id: z.string() }),
    execute: async ({ id }) => {
      try {
        await registry.activate(id)
        const metadata = await registry.describe(id)
        return { content: { type: 'text', text: JSON.stringify(metadata ?? { id }, null, 2) }, ok: true, tool: metadata ?? { id } }
      } catch (error) {
        const failure = {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          code: 'CAPABILITY_INITIALIZATION_FAILED',
          capabilityId: id,
          retryable: true,
        }
        return { content: { type: 'text', text: JSON.stringify(failure, null, 2) }, ...failure }
      }
    },
  })

  return { listTools, loadTool }
}
