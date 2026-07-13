import { describe, it, expect } from 'vitest'
import { bridgeWorkerToolCall, bridgeWorkerEvidence, extractProposedTasks } from '../../src/council/evidence-bridge'
import { EvidenceLedger } from '../../src/intelligence/evidence-ledger'
import type { WorkerToolCall } from '../../src/council/evidence-bridge'
import type { MemberOutput } from '../../src/council/types'

describe('Evidence Bridge', () => {
  describe('bridgeWorkerToolCall', () => {
    it('extracts structured evidence from httpRequest result', () => {
      const tc: WorkerToolCall = {
        toolName: 'httpRequest',
        args: { url: 'https://example.com/api', method: 'GET' },
        result: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"users":[]}' },
      }
      const item = bridgeWorkerToolCall(tc)
      expect(item).not.toBeNull()
      expect(item!.observed?.method).toBe('GET')
      expect(item!.observed?.url).toBe('https://example.com/api')
      expect(item!.observed?.status).toBe(200)
      expect(item!.observed?.responseHeaders?.['content-type']).toBe('application/json')
      expect(item!.label).toContain('GET')
      expect(item!.label).toContain('200')
    })

    it('extracts structured evidence from stagehand_navigate result', () => {
      const tc: WorkerToolCall = {
        toolName: 'stagehand_navigate',
        args: { url: 'https://example.com' },
        result: { url: 'https://example.com' }, // no status → matches url branch
      }
      const item = bridgeWorkerToolCall(tc)
      expect(item).not.toBeNull()
      expect(item!.observed?.method).toBe('GET')
      expect(item!.observed?.url).toBe('https://example.com')
    })

    it('returns null for non-HTTP tool results', () => {
      const tc: WorkerToolCall = {
        toolName: 'updateGraph',
        args: { node: 'test' },
        result: { ok: true },
      }
      const item = bridgeWorkerToolCall(tc)
      expect(item).toBeNull()
    })

    it('returns null for empty results', () => {
      const tc: WorkerToolCall = { toolName: 'httpRequest', args: {}, result: undefined }
      const item = bridgeWorkerToolCall(tc)
      expect(item).toBeNull()
    })

    it('uses fallback method from args when result has no method', () => {
      const tc: WorkerToolCall = {
        toolName: 'httpRequest',
        args: { url: 'https://example.com', method: 'POST' },
        result: { status: 201 },
      }
      const item = bridgeWorkerToolCall(tc)
      expect(item).not.toBeNull()
      expect(item!.observed?.method).toBe('POST')
    })

    it('truncates long body to 500 chars', () => {
      const longBody = 'x'.repeat(1000)
      const tc: WorkerToolCall = {
        toolName: 'httpRequest',
        args: { url: 'https://example.com' },
        result: { status: 200, body: longBody },
      }
      const item = bridgeWorkerToolCall(tc)
      expect(item).not.toBeNull()
      expect(item!.data.length).toBeLessThanOrEqual(500)
    })
  })

  describe('bridgeWorkerEvidence', () => {
    it('records multiple evidence items in the ledger', () => {
      const ledger = new EvidenceLedger()
      const toolCalls: WorkerToolCall[] = [
        { toolName: 'httpRequest', args: { url: 'https://a.com' }, result: { status: 200 } },
        { toolName: 'httpRequest', args: { url: 'https://b.com' }, result: { status: 404 } },
        { toolName: 'updateGraph', args: {}, result: { ok: true } }, // non-HTTP — skipped
      ]
      const count = bridgeWorkerEvidence(toolCalls, ledger)
      expect(count).toBe(2) // Only HTTP tool calls produce evidence
      expect(ledger.all().length).toBe(2)
    })

    it('returns 0 for empty input', () => {
      const ledger = new EvidenceLedger()
      const count = bridgeWorkerEvidence([], ledger)
      expect(count).toBe(0)
    })
  })

  describe('extractProposedTasks', () => {
    it('extracts tasks from structured proposals', () => {
      const outputs: MemberOutput[] = [
        {
          text: 'SQLi test',
          intent: 'propose',
          proposal: {
            action: 'Test SQL injection',
            skillId: 'injection',
            endpointId: 'ep-1',
            complexity: 'high',
            impact: 'high',
            reasoning: 'Test',
            evidenceRequired: [],
          },
        },
        {
          text: 'XSS test',
          intent: 'propose',
          proposal: {
            action: 'Test XSS',
            skillId: 'web-pentest',
            complexity: 'medium',
            impact: 'medium',
            reasoning: 'Test',
            evidenceRequired: [],
          },
        },
      ]
      const tasks = extractProposedTasks(outputs)
      expect(tasks.length).toBe(2)
      expect(tasks[0].skillId).toBe('injection')
      expect(tasks[0].task).toBe('Test SQL injection')
      expect(tasks[0].endpointId).toBe('ep-1')
      expect(tasks[1].skillId).toBe('web-pentest')
    })

    it('filters out non-propose intents', () => {
      const outputs: MemberOutput[] = [
        { text: 'agree', intent: 'critique', critique: { targets: [], agreements: ['test'], disagreements: [], evidenceGaps: [] } },
        { text: 'done', intent: 'complete', reflection: { whatWorked: [], whatFailed: [], whatLearned: [], nextSteps: [] } },
      ]
      const tasks = extractProposedTasks(outputs)
      expect(tasks.length).toBe(0)
    })

    it('handles missing proposal gracefully', () => {
      const outputs: MemberOutput[] = [
        { text: 'propose', intent: 'propose' }, // proposal is undefined
      ]
      const tasks = extractProposedTasks(outputs)
      expect(tasks.length).toBe(0)
    })
  })
})
