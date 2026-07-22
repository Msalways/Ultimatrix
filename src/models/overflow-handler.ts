/**
 * Context overflow detection and recovery.
 *
 * When a provider returns HTTP 400 and our pre-send token estimate suggests
 * the messages exceeded the context window, this module compacts the messages
 * and retries. Detection is typed (HTTP status + estimate comparison), not
 * substring-based.
 *
 * Max 2 compaction retries to prevent infinite loops.
 */

import type { UltimatrixConfig } from '../config'
import type { ContextWindowRegistry } from './context-window-registry'
import { compactMessages, estimateMessagesTokens } from './message-compactor'
import { log } from '../utils/logger'
import { getForensicLog } from '../tools/report-tools'

export interface OverflowClassification {
  isOverflow: boolean
  reason: string
}

const MAX_COMPACTION_RETRIES = 2

/**
 * Classify whether an error is a context overflow.
 *
 * Detection is based on:
 * 1. HTTP 400 status (all providers use this for invalid requests)
 * 2. Pre-send token estimate vs context window
 *
 * No message text parsing. No regex. No substring matching.
 */
export function classifyOverflow(
  err: any,
  estimatedTokens: number,
  contextWindow: number | null,
): OverflowClassification {
  const status = err?.status ?? err?.statusCode ?? 0
  if (status !== 400) {
    return { isOverflow: false, reason: `non-400 status: ${status}` }
  }

  // Unknown model (contextWindow null) — 400 is likely overflow for large prompts
  if (contextWindow === null) {
    return {
      isOverflow: true,
      reason: 'HTTP 400 with unknown model context window — attempting compaction',
    }
  }

  // Known model — check if estimate exceeds window
  if (estimatedTokens > contextWindow) {
    return {
      isOverflow: true,
      reason: `estimated ${estimatedTokens} tokens exceeds context window ${contextWindow}`,
    }
  }

  return {
    isOverflow: false,
    reason: `HTTP 400 but estimated ${estimatedTokens} tokens is within context window ${contextWindow}`,
  }
}

/**
 * Wraps a doStream/doGenerate call with overflow detection and recovery.
 *
 * Flow:
 * 1. Pre-send: estimate total tokens in messages
 * 2. If estimate > contextWindow: compact messages before sending
 * 3. If provider returns 400 + classifyOverflow = true: compact + retry
 * 4. Max 2 compaction retries
 * 5. Log every compaction event to forensic log
 */
export async function withOverflowRecovery<T>(
  originalCall: (args: any) => Promise<T>,
  args: { messages?: any[]; [key: string]: any },
  modelId: string,
  registry: ContextWindowRegistry,
  config: UltimatrixConfig,
): Promise<T> {
  const entry = registry.resolve(modelId)
  const contextWindow = entry?.contextWindow ?? null
  const reservedMargin = entry?.reservedMargin ?? 1024
  const effectiveBudget = contextWindow ? contextWindow - reservedMargin : null

  let currentArgs = args
  let estimatedTokens = args.messages ? estimateMessagesTokens(args.messages) : 0

  // Pre-send: compact if estimate exceeds budget
  if (effectiveBudget !== null && estimatedTokens > effectiveBudget && args.messages) {
    log.dim(`[overflow] pre-send: ${estimatedTokens} tokens exceeds budget ${effectiveBudget}, compacting`)
    const compacted = compactMessages(args.messages, effectiveBudget)
    currentArgs = { ...args, messages: compacted.messages }
    estimatedTokens = compacted.finalEstimate
    logForensic(modelId, 'pre-send', compacted.totalTokensSaved, compacted.passes.map(p => p.label))
  }

  // Try the call, with compaction retry on overflow
  let lastError: any
  for (let attempt = 0; attempt <= MAX_COMPACTION_RETRIES; attempt++) {
    try {
      return await originalCall(currentArgs)
    } catch (err: any) {
      lastError = err
      const classification = classifyOverflow(err, estimatedTokens, contextWindow)

      if (!classification.isOverflow || !currentArgs.messages) {
        throw err
      }

      if (attempt >= MAX_COMPACTION_RETRIES) {
        log.warn(`[overflow] ${MAX_COMPACTION_RETRIES} compaction retries exhausted, throwing`)
        throw err
      }

      log.dim(`[overflow] attempt ${attempt + 1}: ${classification.reason}, compacting`)
      const compacted = compactMessages(currentArgs.messages, effectiveBudget ?? Math.floor(estimatedTokens * 0.8))
      currentArgs = { ...currentArgs, messages: compacted.messages }
      estimatedTokens = compacted.finalEstimate
      logForensic(modelId, `retry-${attempt + 1}`, compacted.totalTokensSaved, compacted.passes.map(p => p.label))
    }
  }

  throw lastError
}

function logForensic(modelId: string, phase: string, tokensSaved: number, strategies: string[]) {
  getForensicLog()?.log({
    type: 'tool-result',
    agent: 'overflow-handler',
    tool: 'compact-messages',
    metadata: { modelId, phase, tokensSaved, strategies },
  })
}
