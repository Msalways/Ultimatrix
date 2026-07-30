/**
 * Tool Result Ref-Store — Graph-as-database pattern.
 *
 * Stores full tool results as graph nodes (EntityType), returns compact
 * references to the LLM context. The LLM can fetch full data on demand
 * via the `getToolResult` brain tool.
 *
 * This fixes V3 (worker results) + V4 (individual tool results) context
 * bloat vectors.
 */

import type { GraphStore } from './store'
import { NodeType } from './schema'

export interface ToolResultRef {
  graphNodeId: string
  tool: string
  summary: string
  sizeBytes: number
}

export class ToolResultStore {
  constructor(private graph: GraphStore) {}

  /**
   * Store a full tool result in the graph. Returns a compact reference.
   * Uses NodeType.ENTITY with `kind: 'toolResult'` discriminator.
   */
  store(toolName: string, data: unknown, metadata?: Record<string, unknown>): ToolResultRef {
    const serialized = typeof data === 'string' ? data : JSON.stringify(data)
    const sizeBytes = serialized.length
    const id = `tool-result:${toolName}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

    const summary = this.buildSummary(data, toolName)

    this.graph.upsertNode({
      id,
      type: NodeType.ENTITY,
      properties: {
        name: id,
        kind: 'toolResult',
        tool: toolName,
        data: serialized,
        summary,
        sizeBytes,
        ...(metadata ?? {}),
      },
    } as any)

    return { graphNodeId: id, tool: toolName, summary, sizeBytes }
  }

  /**
   * Retrieve full data from a stored tool result by graph node ID.
   * Returns the original data (parsed from JSON if possible).
   */
  get(graphNodeId: string): unknown {
    const nodes = this.graph.queryNodes(undefined, { id: graphNodeId } as any)
    const node = nodes[0]
    if (!node) return null

    const props = node.properties as any
    if (props.kind !== 'toolResult') return null

    const rawData = props.data
    if (typeof rawData !== 'string') return rawData

    try {
      return JSON.parse(rawData)
    } catch {
      return rawData
    }
  }

  /**
   * Build a short summary of the tool result for the LLM context.
   * Kept under ~200 chars to minimize context usage.
   */
  private buildSummary(data: unknown, toolName: string): string {
    if (data === null || data === undefined) return `${toolName}: empty`
    if (typeof data === 'string') {
      return data.length > 200 ? `${toolName}: ${data.slice(0, 197)}...` : `${toolName}: ${data}`
    }
    if (typeof data === 'object') {
      const keys = Object.keys(data as Record<string, unknown>)
      const preview = keys.slice(0, 5).join(', ')
      const extra = keys.length > 5 ? ` +${keys.length - 5} more` : ''
      return `${toolName}: {${preview}${extra}}`
    }
    return `${toolName}: ${String(data).slice(0, 200)}`
  }
}

let _instance: ToolResultStore | null = null

/**
 * Get or create the global ToolResultStore singleton.
 * Must be called after graph store is initialized.
 */
export function getToolResultStore(graph: GraphStore): ToolResultStore {
  if (!_instance) {
    _instance = new ToolResultStore(graph)
  }
  return _instance
}

/** Reset singleton (for tests). */
export function resetToolResultStore(): void {
  _instance = null
}
