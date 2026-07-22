import { describe, it, expect } from 'vitest'
import { compactMessages, estimateMessagesTokens } from '../../src/models/message-compactor'

function systemMsg(text: string) {
  return { role: 'system', content: text }
}
function userMsg(text: string) {
  return { role: 'user', content: text }
}
function assistantMsg(text: string) {
  return { role: 'assistant', content: text }
}
function toolMsg(text: string, toolCallId = 'tc-1') {
  return { role: 'tool', content: text, toolCallId }
}
function assistantToolCall(toolName: string, args: any, toolCallId = 'tc-1') {
  return {
    role: 'assistant',
    content: [{ type: 'tool-call', toolName, toolCallId, args }],
  }
}

describe('MessageCompactor', () => {
  describe('estimateMessagesTokens', () => {
    it('returns 0 for empty array', () => {
      expect(estimateMessagesTokens([])).toBe(0)
    })

    it('estimates tokens for system message', () => {
      const tokens = estimateMessagesTokens([systemMsg('You are a security agent.')])
      expect(tokens).toBeGreaterThan(3)
      expect(tokens).toBeLessThan(20)
    })

    it('estimates more tokens for longer messages', () => {
      const short = estimateMessagesTokens([userMsg('hi')])
      const long = estimateMessagesTokens([userMsg('word '.repeat(1000))])
      expect(long).toBeGreaterThan(short)
    })

    it('handles tool-call content parts', () => {
      const msgs = [
        assistantToolCall('httpRequest', { url: 'https://example.com' }),
        toolMsg('Status 200 OK'),
      ]
      const tokens = estimateMessagesTokens(msgs)
      expect(tokens).toBeGreaterThan(5)
    })
  })

  describe('compactMessages', () => {
    it('returns unchanged when already under budget', () => {
      const messages = [systemMsg('Short system'), userMsg('Short goal')]
      const result = compactMessages(messages, 100000)
      expect(result.messages).toEqual(messages)
      expect(result.passes).toHaveLength(0)
      expect(result.totalTokensSaved).toBe(0)
    })

    it('L1: compacts large tool results', () => {
      const largeToolOutput = 'response data '.repeat(5000) // ~6500 tokens
      const messages = [
        systemMsg('Short system'),
        userMsg('Test goal'),
        assistantToolCall('httpRequest', { url: 'https://example.com' }),
        toolMsg(largeToolOutput),
      ]
      const result = compactMessages(messages, 1000)
      expect(result.passes.length).toBeGreaterThanOrEqual(1)
      expect(result.passes[0].label).toBe('L1')
      expect(result.totalTokensSaved).toBeGreaterThan(0)
      // Tool message should be compacted
      const toolContent = result.messages.find(m => m.role === 'tool')?.content
      expect(typeof toolContent).toBe('string')
      expect(toolContent!.length).toBeLessThan(largeToolOutput.length)
    })

    it('L1: does not touch system/user messages', () => {
      const largeToolOutput = 'response data '.repeat(5000)
      const messages = [
        systemMsg('Important system instructions'),
        userMsg('Find XSS vulnerabilities'),
        assistantToolCall('httpRequest', { url: 'https://example.com' }),
        toolMsg(largeToolOutput),
      ]
      const result = compactMessages(messages, 1000)
      // System and user messages should be untouched
      expect(result.messages.find(m => m.role === 'system')?.content).toBe('Important system instructions')
      expect(result.messages.find(m => m.role === 'user')?.content).toBe('Find XSS vulnerabilities')
    })

    it('L2: summarizes old turns when L1 insufficient', () => {
      // Create many turn pairs to trigger L2
      const messages: any[] = [systemMsg('System')]
      for (let i = 0; i < 10; i++) {
        messages.push(userMsg(`User question ${i}: ${'word '.repeat(200)}`))
        messages.push(assistantMsg(`Assistant answer ${i}: ${'word '.repeat(200)}`))
      }
      messages.push(userMsg('Final question'))

      const result = compactMessages(messages, 500, { maxPasses: 3 })
      // Should have done some compaction
      expect(result.passes.length).toBeGreaterThanOrEqual(1)
      expect(result.totalTokensSaved).toBeGreaterThan(0)
    })

    it('L3: compacts goal when L1+L2 insufficient', () => {
      // Large goal with many sections
      const sections = Array.from({ length: 20 }, (_, i) =>
        `## Section ${i}\n${'content '.repeat(300)}`
      ).join('\n\n')

      const messages = [
        systemMsg('System'),
        userMsg(sections),
      ]

      const result = compactMessages(messages, 500, { maxPasses: 3 })
      expect(result.passes.length).toBeGreaterThanOrEqual(1)
      expect(result.totalTokensSaved).toBeGreaterThan(0)
    })

    it('progressive: stops when under budget', () => {
      const messages = [
        systemMsg('Short'),
        userMsg('Goal'),
      ]
      const result = compactMessages(messages, 100000)
      expect(result.passes).toHaveLength(0)
    })

    it('respects maxPasses limit', () => {
      const messages: any[] = [systemMsg('System')]
      for (let i = 0; i < 20; i++) {
        messages.push(userMsg(`Q${i}: ${'word '.repeat(500)}`))
        messages.push(assistantMsg(`A${i}: ${'word '.repeat(500)}`))
      }

      const result = compactMessages(messages, 100, { maxPasses: 1 })
      expect(result.passes.length).toBeLessThanOrEqual(1)
    })

    it('handles empty messages array', () => {
      const result = compactMessages([], 1000)
      expect(result.messages).toHaveLength(0)
      expect(result.passes).toHaveLength(0)
      expect(result.totalTokensSaved).toBe(0)
    })

    it('handles all system messages (no compaction possible — no tool results, no user message, few turns)', () => {
      const messages = [
        systemMsg('System 1'),
        systemMsg('System 2'),
        systemMsg('System 3'),
      ]
      const result = compactMessages(messages, 100)
      // L1 has no tool results, L2 needs >keepRecent*2 messages, L3 needs a user message
      // When none apply, the result passes through unchanged
      expect(result.passes).toHaveLength(0)
      expect(result.messages).toHaveLength(3)
      expect(result.totalTokensSaved).toBe(0)
    })

    it('preserves message structure after compaction', () => {
      const largeToolOutput = 'response data '.repeat(5000)
      const messages = [
        systemMsg('System'),
        assistantToolCall('httpRequest', { url: 'https://example.com' }),
        toolMsg(largeToolOutput),
        userMsg('What did you find?'),
      ]
      const result = compactMessages(messages, 1000)
      // All messages should still have roles
      for (const msg of result.messages) {
        expect(msg.role).toBeDefined()
        expect(['system', 'user', 'assistant', 'tool']).toContain(msg.role)
      }
    })

    it('forensic passes array tracks what was done', () => {
      const largeToolOutput = 'response data '.repeat(5000)
      const messages = [
        systemMsg('System'),
        userMsg('Goal'),
        assistantToolCall('httpRequest', { url: 'https://example.com' }),
        toolMsg(largeToolOutput),
      ]
      const result = compactMessages(messages, 1000)
      for (const pass of result.passes) {
        expect(pass.strategy).toBeTruthy()
        expect(pass.label).toBeTruthy()
        expect(pass.compactedTokens).toBeGreaterThan(0)
      }
    })
  })
})
