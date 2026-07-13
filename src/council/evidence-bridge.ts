/**
 * Evidence Bridge — converts worker execution results into structured EvidenceItems.
 *
 * Root cause (from gap analysis G4): Workers return `GenerateResult` with text +
 * toolCalls, but the EvidenceLedger needs structured `EvidenceItem`s with typed
 * observed facts. Nobody was converting between these formats.
 *
 * This module bridges the gap: it takes worker toolCall results and extracts
 * structured evidence (method, URL, status, response headers) that the council's
 * skeptic can verify against.
 *
 * Design principle: typed extraction from structured toolCall objects, never
 * substring scanning of free text.
 */

import type { EvidenceItem, ObservedFacts } from '../intelligence/evidence-ledger'
import { EvidenceLedger } from '../intelligence/evidence-ledger'

/** A worker tool call result — what the worker returns after execution. */
export interface WorkerToolCall {
  toolName: string
  args?: Record<string, unknown>
  result?: unknown
}

/** Parsed HTTP response data from a tool call result. */
interface ParsedHttpResponse {
  method?: string
  url?: string
  status?: number
  requestHeaders?: Record<string, string>
  responseHeaders?: Record<string, string>
  bodyPreview?: string
}

// ─── Extraction functions (typed, not regex) ──────────────────────────────

/**
 * Extract structured HTTP response data from a tool call result.
 * Reads typed fields from the result object — no substring scanning.
 */
function extractHttpResponse(toolCall: WorkerToolCall): ParsedHttpResponse | null {
  const result = toolCall.result as Record<string, unknown> | undefined
  if (!result || typeof result !== 'object') return null

  // httpRequest tool returns { status, headers, body, ... }
  if ('status' in result && typeof (result as any).status === 'number') {
    return {
      method: typeof (result as any).method === 'string' ? (result as any).method : toolCall.args?.method as string | undefined,
      url: typeof (result as any).url === 'string' ? (result as any).url : toolCall.args?.url as string | undefined,
      status: (result as any).status as number,
      requestHeaders: typeof (result as any).requestHeaders === 'object' ? (result as any).requestHeaders as Record<string, string> : undefined,
      responseHeaders: typeof (result as any).headers === 'object' ? (result as any).headers as Record<string, string> : undefined,
      bodyPreview: typeof (result as any).body === 'string' ? String((result as any).body).slice(0, 500) : undefined,
    }
  }

  // stagehand_navigate returns { url, status, ... }
  if ('url' in result && typeof (result as any).url === 'string') {
    return {
      method: 'GET',
      url: (result as any).url as string,
      status: typeof (result as any).status === 'number' ? (result as any).status as number : undefined,
      responseHeaders: typeof (result as any).headers === 'object' ? (result as any).headers as Record<string, string> : undefined,
    }
  }

  return null
}

/**
 * Build a label for the evidence item from the tool call.
 * Uses typed fields, not text parsing.
 */
function buildEvidenceLabel(toolCall: WorkerToolCall, parsed: ParsedHttpResponse): string {
  const method = parsed.method ?? 'EXEC'
  const url = parsed.url ?? toolCall.toolName
  const status = parsed.status != null ? ` ${parsed.status}` : ''
  return `${method} ${url}${status}`
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Convert a single worker tool call into a structured EvidenceItem.
 * Returns null if the tool call doesn't produce extractable evidence.
 */
export function bridgeWorkerToolCall(toolCall: WorkerToolCall): Omit<EvidenceItem, 'id' | 'timestamp'> | null {
  const parsed = extractHttpResponse(toolCall)
  if (!parsed) return null

  const observed: ObservedFacts = {}
  if (parsed.method) observed.method = parsed.method
  if (parsed.url) observed.url = parsed.url
  if (parsed.status != null) observed.status = parsed.status
  if (parsed.requestHeaders) observed.requestHeaders = parsed.requestHeaders
  if (parsed.responseHeaders) observed.responseHeaders = parsed.responseHeaders

  const data = parsed.bodyPreview ?? JSON.stringify(toolCall.result ?? {}).slice(0, 500)

  return {
    type: 'text',
    data,
    label: buildEvidenceLabel(toolCall, parsed),
    observed,
  }
}

/**
 * Convert multiple worker tool calls into structured EvidenceItems and record
 * them in the ledger. Returns the number of items recorded.
 */
export function bridgeWorkerEvidence(
  toolCalls: WorkerToolCall[],
  ledger: EvidenceLedger,
): number {
  let recorded = 0
  for (const tc of toolCalls) {
    const item = bridgeWorkerToolCall(tc)
    if (item) {
      ledger.record(item)
      recorded++
    }
  }
  return recorded
}

/**
 * Extract proposed tasks from council member outputs.
 * Uses structured fields, not text parsing.
 */
export function extractProposedTasks(
  outputs: Array<{ intent?: string; proposal?: { action: string; skillId: string; endpointId?: string; complexity?: string } }>,
): Array<{ skillId: string; task: string; endpointId?: string; complexity: string }> {
  return outputs
    .filter(o => o.intent === 'propose' && o.proposal)
    .map(o => ({
      skillId: o.proposal!.skillId,
      task: o.proposal!.action,
      endpointId: o.proposal!.endpointId,
      complexity: o.proposal!.complexity ?? 'medium',
    }))
}
