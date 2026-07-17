/**
 * Extension discovery tools (Phase 3): `listTools` and `loadTool`.
 *
 * Pure-discovery by design — the LLM/brain never auto-loads tools; it must
 * explicitly call `loadTool`. `listTools` enumerates all available tools
 * (built-in, MCP, plugin) with their source and a discovery hint. No substring
 * scanning of free-form text.
 *
 * Acquired extension tools are tracked in a module-level set so the runner can
 * merge exactly those into the agent's active tool pack.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { getGlobalToolRegistry } from './tool-registry.js'

const acquired = new Map<string, unknown>()

export function getAcquiredTools(): string[] {
  return [...acquired.keys()]
}

/** Returns the resolved tool instances acquired via loadTool (synchronous). */
export function getAcquiredToolMap(): Record<string, unknown> {
  return Object.fromEntries(acquired)
}

export function acquireTool(id: string, tool?: unknown): void {
  acquired.set(id, tool)
}

export function resetAcquiredTools(): void {
  acquired.clear()
}

const listTools = createTool({
  id: 'listTools',
  description:
    'List every available tool across sources: builtin (core), mcp__<server>__<tool>, plugin__<id>__<tool>. ' +
    'Use this to discover what is installed before explicitly loading any extension tool with loadTool.',
  inputSchema: z.object({
    prefix: z.string().optional().describe('Optional id prefix filter, e.g. "mcp__" or "plugin__".'),
  }),
  execute: async ({ prefix }) => {
    const reg = getGlobalToolRegistry()
    const all = await reg.list()
    const filtered = prefix ? all.filter((t) => t.id.startsWith(prefix)) : all
    const grouped = {
      builtin: filtered.filter((t) => t.source === 'builtin').map((t) => t.id),
      mcp: filtered.filter((t) => t.source === 'mcp').map((t) => ({ id: t.id, server: t.server })),
      plugin: filtered.filter((t) => t.source === 'plugin').map((t) => t.id),
    }
    return { content: { type: 'text', text: JSON.stringify(grouped, null, 2) }, tools: grouped }
  },
})

const loadTool = createTool({
  id: 'loadTool',
  description:
    'Explicitly acquire a tool by id (e.g. "mcp__github__search" or "plugin__myplugin__run"). ' +
    'Connects to the server/plugin if needed and adds it to the active tool set. Nothing is loaded without an explicit call.',
  inputSchema: z.object({
    id: z.string().describe('Tool id to load. Use listTools to discover ids.'),
    acquire: z.boolean().default(true).describe('If false, only test connectivity without acquiring.'),
  }),
  execute: async ({ id, acquire }) => {
    const reg = getGlobalToolRegistry()
    const tool = await reg.resolve(id)
    if (!tool) {
      return { content: { type: 'text', text: `Tool "${id}" not found or not reachable.` }, ok: false }
    }
    if (acquire) acquireTool(id, tool)
    return {
      content: { type: 'text', text: `Tool "${id}" ${acquire ? 'acquired' : 'reachable'} and ready.` },
      ok: true,
      id,
    }
  },
})

export const listToolsTool = listTools
export const loadToolTool = loadTool
