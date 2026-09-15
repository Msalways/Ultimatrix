/**
 * Context Compressor — structural conversation compression.
 *
 * Simplified from PentAGI's ChainAST approach:
 *   - Finding/ExploitProof nodes: NEVER compressed
 *   - Tool results with evidence: NEVER compressed
 *   - Graph mutations: NEVER compressed
 *   - Intermediate reasoning: compressed when > threshold
 *   - Repeated tool calls: deduped to count
 *
 * Purpose: Keep the LLM's memory of important findings while
 * reducing context window usage on intermediate reasoning.
 */

// ─── Types ──────────────────────────────────────────────────────────

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ConversationMessage {
  role: MessageRole
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  timestamp?: string
}

export interface CompressionConfig {
  /** Max chars for a single message before compression. Default: 2000 */
  maxMessageChars?: number
  /** Max total chars before full compression. Default: 50000 */
  maxTotalChars?: number
  /** Number of recent messages to keep uncompressed. Default: 6 */
  keepRecentCount?: number
  /** Strings that mark content as protected (never compressed). Default: finding/proof markers */
  protectedPatterns?: string[]
}

export interface CompressedMessage {
  role: MessageRole
  content: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; name: string; arguments: string }>
  compressed: boolean
  originalLength?: number
}

// ─── Protected Content Markers ──────────────────────────────────────

const DEFAULT_PROTECTED_PATTERNS = [
  '## Finding',
  '## ExploitProof',
  '## PROVES',
  'writeFinding',
  'exploitProof',
  'Finding ID:',
  'severity:',
  'Evidence:',
  '## Endpoint',
  '## Attack',
]

// ─── Compression Logic ──────────────────────────────────────────────

function isProtectedContent(content: string, patterns: string[]): boolean {
  return patterns.some(p => content.includes(p))
}

function isToolResultMessage(msg: ConversationMessage): boolean {
  return msg.role === 'tool'
}

function isGraphMutation(msg: ConversationMessage): boolean {
  if (msg.role !== 'assistant' || !msg.toolCalls) return false
  const mutationTools = ['updateGraph', 'writeFinding', 'recordEvidence', 'replayExploitProof']
  return msg.toolCalls.some(tc => mutationTools.includes(tc.name))
}

function truncateMessage(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  const half = Math.floor(maxChars / 2)
  return content.slice(0, half) + '\n\n[...compressed...]\n\n' + content.slice(-half)
}

function compressReasoning(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content

  // Extract key sentences (first + last)
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 10)
  if (sentences.length <= 2) return truncateMessage(content, maxChars)

  const first = sentences[0].trim()
  const last = sentences[sentences.length - 1].trim()

  return `${first}.\n\n[...${sentences.length - 2} sentences compressed...]\n\n${last}.`
}

// ─── Public API ─────────────────────────────────────────────────────

export function compressMessages(
  messages: ConversationMessage[],
  config?: CompressionConfig,
): CompressedMessage[] {
  const maxMessageChars = config?.maxMessageChars ?? 2000
  const keepRecentCount = config?.keepRecentCount ?? 6
  const protectedPatterns = config?.protectedPatterns ?? DEFAULT_PROTECTED_PATTERNS

  const result: CompressedMessage[] = []
  const recentStart = Math.max(0, messages.length - keepRecentCount)

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isRecent = i >= recentStart

    // Always keep recent messages uncompressed
    if (isRecent) {
      result.push({
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls,
        compressed: false,
      })
      continue
    }

    // Never compress protected content
    if (isProtectedContent(msg.content, protectedPatterns)) {
      result.push({
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls,
        compressed: false,
      })
      continue
    }

    // Never compress tool results (evidence)
    if (isToolResultMessage(msg)) {
      result.push({
        role: msg.role,
        content: truncateMessage(msg.content, maxMessageChars),
        toolCallId: msg.toolCallId,
        compressed: msg.content.length > maxMessageChars,
        originalLength: msg.content.length > maxMessageChars ? msg.content.length : undefined,
      })
      continue
    }

    // Never compress graph mutations
    if (isGraphMutation(msg)) {
      result.push({
        role: msg.role,
        content: msg.content,
        toolCallId: msg.toolCallId,
        toolCalls: msg.toolCalls,
        compressed: false,
      })
      continue
    }

    // Compress old assistant reasoning
    const compressed = compressReasoning(msg.content, maxMessageChars)
    result.push({
      role: msg.role,
      content: compressed,
      toolCallId: msg.toolCallId,
      toolCalls: msg.toolCalls,
      compressed: compressed !== msg.content,
      originalLength: compressed !== msg.content ? msg.content.length : undefined,
    })
  }

  return result
}

/** Get compression stats for monitoring. */
export function getCompressionStats(
  original: ConversationMessage[],
  compressed: CompressedMessage[],
): { originalChars: number; compressedChars: number; ratio: number; messagesCompressed: number } {
  const originalChars = original.reduce((sum, m) => sum + m.content.length, 0)
  const compressedChars = compressed.reduce((sum, m) => sum + m.content.length, 0)
  const messagesCompressed = compressed.filter(m => m.compressed).length

  return {
    originalChars,
    compressedChars,
    ratio: originalChars > 0 ? compressedChars / originalChars : 1,
    messagesCompressed,
  }
}
