/**
 * Result Bounding (Strix Adaptation Phase E) — bounded previews + full result storage.
 *
 * Every tool that may return large data should wrap its result through
 * `boundResult()`. This stores the full result in the ToolResultStore and
 * returns a bounded preview (capped chars) plus a resultRef for retrieval.
 *
 * The LLM sees the preview inline and can call `getToolResult(resultRef)`
 * to inspect the full data on demand.
 */

import type { ToolResultRef } from '../graph/tool-result-store'
import { getToolResultStore, getToolResultStore as _getToolResultStore } from '../graph/tool-result-store'
import { getGlobalGraphStore } from '../graph/store'

/** Maximum preview characters for any bounded result */
const DEFAULT_PREVIEW_CHARS = 2000

/** Bounded result envelope — what the LLM sees inline */
export interface BoundedResult<T = unknown> {
  /** Whether the preview is a truncated subset of the full result */
  truncated: boolean
  /** Short inline preview (first N chars or structured summary) */
  preview: string
  /** Reference to full result — pass to getToolResult() for retrieval */
  resultRef?: string
  /** Original result size in characters */
  sizeChars: number
  /** Tool name for metadata */
  tool: string
  /** The full result data (only returned when under the preview cap) */
  data?: T
}

/**
 * Bound a tool result: store full data, return preview + ref.
 *
 * When the serialized result is under `previewChars`, the full `data` field
 * is included in the output (no need for a separate getToolResult call).
 * When it exceeds the cap, only the preview and resultRef are returned.
 */
export function boundResult<T>(
  toolName: string,
  data: T,
  options?: { previewChars?: number; metadata?: Record<string, unknown> },
): BoundedResult<T> {
  const previewChars = options?.previewChars ?? DEFAULT_PREVIEW_CHARS
  const serialized = JSON.stringify(data)
  const sizeChars = serialized?.length ?? 0

  // Small result: return inline without storage
  if (sizeChars <= previewChars) {
    return {
      truncated: false,
      preview: buildPreview(data, previewChars),
      sizeChars,
      tool: toolName,
      data,
    }
  }

  // Large result: store in ToolResultStore, return preview + ref
  const graph = getGlobalGraphStore()
  const store = getToolResultStore(graph)
  const ref: ToolResultRef = store.store(toolName, data, options?.metadata)

  return {
    truncated: true,
    preview: buildPreview(data, previewChars),
    resultRef: ref.graphNodeId,
    sizeChars,
    tool: toolName,
  }
}

/**
 * Build a preview string from any data value.
 * - Strings: first N chars
 * - Objects: first N keys + their values (truncated)
 * - Arrays: first 3 items
 */
function buildPreview(data: unknown, maxChars: number): string {
  if (data === null || data === undefined) return String(data)
  if (typeof data === 'string') return data.slice(0, maxChars)
  if (typeof data === 'object') {
    const str = JSON.stringify(data, null, 2)
    if (str.length <= maxChars) return str
    // Structured preview
    if (Array.isArray(data)) {
      const items = data.slice(0, 3)
      const preview = JSON.stringify(items, null, 2)
      const more = data.length - 3
      return preview + (more > 0 ? `\n... +${more} more items` : '')
    }
    // Object: first 5 keys
    const entries = Object.entries(data as Record<string, unknown>).slice(0, 5)
    const partial = Object.fromEntries(entries)
    const preview = JSON.stringify(partial, null, 2)
    const more = Object.keys(data as object).length - 5
    return preview + (more > 0 ? `\n... +${more} more fields` : '')
  }
  return String(data).slice(0, maxChars)
}

/**
 * Re-retrieve a full bounded result by its resultRef.
 * Returns undefined if not found.
 */
export function retrieveBoundedResult(resultRef: string): unknown | undefined {
  const graph = getGlobalGraphStore()
  const store = getToolResultStore(graph)
  return store.get(resultRef)
}
