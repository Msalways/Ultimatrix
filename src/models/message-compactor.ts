/**
 * Progressive compaction of AI SDK messages[] arrays.
 *
 * When a provider rejects a request for exceeding context limits, this module
 * compacts the messages array from least to most destructive:
 *   L1: Compress large tool results
 *   L2: Summarize old conversation turns
 *   L3: Compress the enriched goal (most recent user message)
 *
 * Uses existing `compactText()` from output/compaction.ts — no new text
 * reduction logic. Every pass records forensic provenance.
 */

import { compactText, estimateTokens } from '../output/compaction'

export interface CompactionPass {
  strategy: string
  label: string
  compactedTokens: number
}

export interface CompactionResult {
  messages: any[]
  passes: CompactionPass[]
  totalTokensSaved: number
  originalEstimate: number
  finalEstimate: number
}

export interface CompactMessagesOptions {
  /** Max compaction passes before returning. Default 3. */
  maxPasses?: number
  /** Number of recent turn pairs to preserve untouched in L2. Default 4. */
  keepRecent?: number
  /** Token threshold for L1 tool result compaction. Default 2000. */
  toolResultThreshold?: number
}

/** Rough token estimate for a messages array. */
export function estimateMessagesTokens(messages: any[]): number {
  let total = 0
  for (const msg of messages) {
    total += estimateMessageTokens(msg)
  }
  return total
}

function estimateMessageTokens(msg: any): number {
  if (!msg) return 0
  const role = msg.role ?? ''
  // Base overhead for role + structure
  let tokens = 4
  const content = msg.content
  if (typeof content === 'string') {
    tokens += estimateTokens(content)
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part) continue
      if (typeof part === 'string') {
        tokens += estimateTokens(part)
      } else if (part.type === 'text' && typeof part.text === 'string') {
        tokens += estimateTokens(part.text)
      } else if (part.type === 'tool-call') {
        // Tool call: name + serialized args
        tokens += estimateTokens(part.toolName ?? '')
        tokens += estimateTokens(JSON.stringify(part.args ?? {}))
      } else if (part.type === 'tool-result') {
        tokens += estimateTokens(typeof part.content === 'string' ? part.content : JSON.stringify(part.content ?? ''))
      }
    }
  }
  return tokens
}

/** Extract text content from a message for compaction. */
function getMessageText(msg: any): string {
  const content = msg.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
      .map((p: any) => p.text)
      .join('\n')
  }
  return ''
}

/** Replace text content in a message, preserving structure. */
function setMessageText(msg: any, text: string): any {
  const content = msg.content
  if (typeof content === 'string') {
    return { ...msg, content: text }
  }
  if (Array.isArray(content)) {
    const newParts = content.map((p: any) => {
      if (p?.type === 'text' && typeof p.text === 'string') {
        return { ...p, text }
      }
      return p
    })
    return { ...msg, content: newParts }
  }
  return msg
}

/**
 * Compact a messages[] array to fit within a token budget.
 * Applies L1 → L2 → L3 progressively, stopping when under budget.
 */
export function compactMessages(
  messages: any[],
  tokenBudget: number,
  options: CompactMessagesOptions = {},
): CompactionResult {
  const maxPasses = options.maxPasses ?? 3
  const keepRecent = options.keepRecent ?? 4
  const toolResultThreshold = options.toolResultThreshold ?? 2000

  const originalEstimate = estimateMessagesTokens(messages)
  if (originalEstimate <= tokenBudget) {
    return {
      messages,
      passes: [],
      totalTokensSaved: 0,
      originalEstimate,
      finalEstimate: originalEstimate,
    }
  }

  let current = [...messages]
  const passes: CompactionPass[] = []
  let passCount = 0

  // L1: Compact large tool results
  if (passCount < maxPasses) {
    const before = estimateMessagesTokens(current)
    const { messages: afterL1, tokensSaved } = compactToolResults(current, tokenBudget, toolResultThreshold)
    if (tokensSaved > 0) {
      current = afterL1
      passes.push({ strategy: 'tool-results', label: 'L1', compactedTokens: tokensSaved })
      passCount++
    }
    if (estimateMessagesTokens(current) <= tokenBudget) {
      return buildResult(current, passes, originalEstimate)
    }
  }

  // L2: Summarize old turns
  if (passCount < maxPasses) {
    const { messages: afterL2, tokensSaved } = summarizeOldTurns(current, tokenBudget, keepRecent)
    if (tokensSaved > 0) {
      current = afterL2
      passes.push({ strategy: 'old-turns', label: 'L2', compactedTokens: tokensSaved })
      passCount++
    }
    if (estimateMessagesTokens(current) <= tokenBudget) {
      return buildResult(current, passes, originalEstimate)
    }
  }

  // L3: Compress the enriched goal (most recent user message)
  if (passCount < maxPasses) {
    const { messages: afterL3, tokensSaved } = compactGoalContext(current, tokenBudget)
    if (tokensSaved > 0) {
      current = afterL3
      passes.push({ strategy: 'goal-context', label: 'L3', compactedTokens: tokensSaved })
    }
  }

  return buildResult(current, passes, originalEstimate)
}

// ─── L1: Tool result compaction ────────────────────────────────────

function compactToolResults(
  messages: any[],
  budget: number,
  threshold: number,
): { messages: any[]; tokensSaved: number } {
  let tokensSaved = 0
  const result = messages.map((msg) => {
    if (msg.role !== 'tool') return msg
    const text = getMessageText(msg)
    const msgTokens = estimateTokens(text)
    if (msgTokens <= threshold) return msg

    // Budget per tool result: proportional share of remaining budget
    const perResultBudget = Math.max(500, Math.floor(budget / Math.max(1, messages.filter(m => m.role === 'tool').length)))
    const before = estimateTokens(text)
    const compacted = compactText(text, { tokenBudget: perResultBudget, strategy: 'section-aware' })
    const after = estimateTokens(compacted.text)
    const saved = before - after
    if (saved > 0) tokensSaved += saved
    return setMessageText(msg, compacted.text)
  })
  return { messages: result, tokensSaved }
}

// ─── L2: Old turn summarization ────────────────────────────────────

function summarizeOldTurns(
  messages: any[],
  budget: number,
  keepRecent: number,
): { messages: any[]; tokensSaved: number } {
  if (messages.length <= keepRecent * 2) {
    return { messages, tokensSaved: 0 }
  }

  const before = estimateMessagesTokens(messages)

  // Split: old turns (to summarize) + recent turns (keep intact)
  // Keep the last keepRecent * 2 messages intact (roughly keepRecent turn pairs)
  const splitIndex = Math.max(1, messages.length - keepRecent * 2)
  const oldTurns = messages.slice(0, splitIndex)
  const recentTurns = messages.slice(splitIndex)

  // Build summary from old turns
  const oldText = oldTurns.map((m) => {
    const text = getMessageText(m)
    return `[${m.role}]: ${text.slice(0, 500)}`
  }).join('\n')

  const summaryBudget = Math.max(500, Math.floor(budget * 0.1)) // 10% of budget for summary
  const compacted = compactText(oldText, { tokenBudget: summaryBudget, strategy: 'head-tail' })

  const summaryMessage = {
    role: 'system',
    content: `[Previous context: ${oldTurns.length} messages summarized]\n${compacted.text}`,
  }

  const after = estimateMessagesTokens([summaryMessage, ...recentTurns])
  const tokensSaved = before - after

  return { messages: [summaryMessage, ...recentTurns], tokensSaved: Math.max(0, tokensSaved) }
}

// ─── L3: Goal/context compaction ───────────────────────────────────

function compactGoalContext(
  messages: any[],
  budget: number,
): { messages: any[]; tokensSaved: number } {
  // Find the most recent user message (the enriched goal)
  let goalIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      goalIndex = i
      break
    }
  }
  if (goalIndex === -1) return { messages, tokensSaved: 0 }

  const goalMsg = messages[goalIndex]
  const goalText = getMessageText(goalMsg)
  const before = estimateTokens(goalText)

  // Budget: remaining budget after accounting for all other messages
  const otherTokens = estimateMessagesTokens(messages.filter((_, i) => i !== goalIndex))
  const goalBudget = Math.max(1000, budget - otherTokens)

  const compacted = compactText(goalText, { tokenBudget: goalBudget, strategy: 'section-aware' })
  const after = estimateTokens(compacted.text)
  const saved = before - after

  if (saved <= 0) return { messages, tokensSaved: 0 }

  const newMessages = [...messages]
  newMessages[goalIndex] = setMessageText(goalMsg, compacted.text)
  return { messages: newMessages, tokensSaved: saved }
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildResult(messages: any[], passes: CompactionPass[], originalEstimate: number): CompactionResult {
  const totalTokensSaved = passes.reduce((sum, p) => sum + p.compactedTokens, 0)
  return {
    messages,
    passes,
    totalTokensSaved,
    originalEstimate,
    finalEstimate: estimateMessagesTokens(messages),
  }
}
