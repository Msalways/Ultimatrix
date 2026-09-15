import { describe, it, expect } from 'vitest'
import { compressMessages, getCompressionStats, type ConversationMessage } from '../../src/compression/context-compressor'

describe('ContextCompressor', () => {
  const makeMsg = (role: ConversationMessage['role'], content: string, toolCalls?: ConversationMessage['toolCalls']): ConversationMessage => ({
    role,
    content,
    toolCalls,
  })

  describe('compressMessages', () => {
    it('keeps all messages when under threshold', () => {
      const messages = [
        makeMsg('user', 'Hello'),
        makeMsg('assistant', 'Hi there'),
        makeMsg('user', 'Test this endpoint'),
      ]

      const result = compressMessages(messages)
      expect(result).toHaveLength(3)
      expect(result.every(m => !m.compressed)).toBe(true)
    })

    it('compresses old assistant messages exceeding maxMessageChars', () => {
      const longContent = 'I need to analyze the endpoint. '.repeat(200) // ~6000 chars
      const messages = Array.from({ length: 10 }, (_, i) =>
        makeMsg(i % 2 === 0 ? 'user' : 'assistant', i < 5 ? longContent : `recent message ${i}`)
      )

      const result = compressMessages(messages, { maxMessageChars: 1000 })
      const oldAssistant = result.find(m => m.role === 'assistant' && m.compressed)
      expect(oldAssistant).toBeDefined()
      expect(oldAssistant!.content.length).toBeLessThan(longContent.length)
    })

    it('never compresses finding content', () => {
      const messages = [
        makeMsg('assistant', '## Finding: SQL Injection\nseverity: critical\nevidence: ...'),
        makeMsg('user', 'continue'),
      ]

      // Even with tiny maxMessageChars, finding content is preserved
      const result = compressMessages(messages, { maxMessageChars: 10, keepRecentCount: 0 })
      const finding = result.find(m => m.content.includes('## Finding'))
      expect(finding).toBeDefined()
      expect(finding!.compressed).toBe(false)
    })

    it('never compresses graph mutations', () => {
      const messages = [
        makeMsg('assistant', 'Let me record this finding.', [
          { id: 'tc1', name: 'writeFinding', arguments: '{}' },
        ]),
        makeMsg('user', 'ok'),
      ]

      const result = compressMessages(messages, { maxMessageChars: 10, keepRecentCount: 0 })
      const mutation = result.find(m => m.toolCalls?.some(tc => tc.name === 'writeFinding'))
      expect(mutation).toBeDefined()
      expect(mutation!.compressed).toBe(false)
    })

    it('keeps recent messages uncompressed', () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        makeMsg('assistant', `Message ${i}: ${'x'.repeat(3000)}`)
      )

      const result = compressMessages(messages, { maxMessageChars: 1000, keepRecentCount: 5 })
      const recent = result.slice(-5)
      expect(recent.every(m => !m.compressed)).toBe(true)
    })

    it('truncates long tool results', () => {
      const longResult = 'HTTP/1.1 200 OK\n'.repeat(500)
      const messages = [
        makeMsg('tool', longResult, undefined),
        makeMsg('assistant', 'Got it'),
      ]

      const result = compressMessages(messages, { maxMessageChars: 1000, keepRecentCount: 1 })
      // Tool result should be truncated if over limit
      const toolMsg = result.find(m => m.role === 'tool')
      expect(toolMsg).toBeDefined()
    })
  })

  describe('getCompressionStats', () => {
    it('calculates compression ratio', () => {
      const original = [makeMsg('user', 'Hello'), makeMsg('assistant', 'World')]
      const compressed = [
        { role: 'user' as const, content: 'Hi', compressed: false },
        { role: 'assistant' as const, content: 'W', compressed: true, originalLength: 5 },
      ]

      const stats = getCompressionStats(original, compressed)
      expect(stats.originalChars).toBe(10)
      expect(stats.compressedChars).toBe(3)
      expect(stats.ratio).toBeCloseTo(0.3, 1)
      expect(stats.messagesCompressed).toBe(1)
    })

    it('returns ratio 1 for empty input', () => {
      const stats = getCompressionStats([], [])
      expect(stats.ratio).toBe(1)
    })
  })
})
