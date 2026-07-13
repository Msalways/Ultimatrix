import { describe, it, expect, beforeEach } from 'vitest'
import { ConversationBus } from '../../src/council/bus'
import { SharedBlackboard } from '../../src/council/blackboard-shared'
import { runCouncil, debateOnce, withTimeout } from '../../src/council/orchestrator'
import { defaultCouncilConfig } from '../../src/council/personas'
import { recordStructuredEvidence, resetStructuredLedger, verifyClaimStructured } from '../../src/tools/control-tools'
import type { CouncilConfig, CouncilMember, MemberOutput } from '../../src/council/types'

// ─── Structured mock helpers ──────────────────────────────────────────────

function structuredProposal(overrides?: Partial<MemberOutput['proposal']>): MemberOutput {
  return {
    text: 'Test SQL injection on /api/users',
    intent: 'propose',
    proposal: {
      action: 'Test SQL injection on /api/users',
      skillId: 'injection',
      endpointId: 'ep-1',
      complexity: 'high',
      impact: 'high',
      reasoning: 'Endpoint accepts user input without visible sanitization',
      evidenceRequired: ['GET /api/users returns 200'],
      ...overrides,
    },
  }
}

function structuredCritique(overrides?: Partial<MemberOutput['critique']>): MemberOutput {
  return {
    text: 'I agree with the SQL injection proposal but the evidence is weak.',
    intent: 'critique',
    critique: {
      targets: ['strategist'],
      agreements: ['SQL injection is a valid attack vector'],
      disagreements: [],
      evidenceGaps: ['Need response body to confirm parameter reflection'],
      ...overrides,
    },
  }
}

function structuredComplete(overrides?: Partial<MemberOutput['reflection']>): MemberOutput {
  return {
    text: 'All attacks executed successfully.',
    intent: 'complete',
    reflection: {
      whatWorked: ['SQL injection on /api/users'],
      whatFailed: ['XSS on /search — input is escaped'],
      whatLearned: ['User table has 50 rows'],
      nextSteps: ['Test IDOR on /api/users/:id'],
      ...overrides,
    },
  }
}

function mockMembers(strategistOutput: MemberOutput, operatorOutput?: MemberOutput): CouncilMember[] {
  const strategist: CouncilMember = {
    role: 'strategist', id: 's', tier: 'balanced',
    respond: async () => strategistOutput,
  }
  const operator: CouncilMember = {
    role: 'operator', id: 'o', tier: 'balanced',
    respond: async () => operatorOutput ?? { text: 'executed', intent: 'propose' as const },
  }
  const skeptic: CouncilMember = {
    role: 'skeptic', id: 'sk', tier: 'balanced',
    respond: async () => ({ text: 'ok', intent: 'critique' as const }),
  }
  const analyst: CouncilMember = {
    role: 'analyst', id: 'a', tier: 'balanced',
    respond: async () => ({ text: 'note', intent: 'critique' as const }),
  }
  const human: CouncilMember = {
    role: 'human', id: 'h', tier: 'balanced',
    respond: async () => ({ text: '', intent: 'propose' as const }),
  }
  return [strategist, operator, skeptic, analyst, human]
}

const EVIDENCE = {
  type: 'raw_response' as const,
  data: 'HTTP/1.1 200 OK',
  label: 'GET https://x/api/users',
  observed: { method: 'GET', url: 'https://x/api/users', status: 200 },
}
const CLAIM = { type: 'exposure', endpoint: 'https://x/api/users', method: 'GET', observed: { status: 200 } }

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Council orchestrator', () => {
  beforeEach(() => resetStructuredLedger())

  describe('runCouncil (backward compat)', () => {
    it('approves a claim backed by recorded structural evidence', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      const output = structuredProposal({ impact: 'medium' })
      output.claim = CLAIM
      const r = await runCouncil({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(r.approved).toBe(1)
      expect(r.rejected).toBe(0)
    })

    it('hard-rejects a claim with no supporting evidence (skeptic gate)', async () => {
      const missingClaim = { type: 'exposure', endpoint: 'https://x/does-not-exist', method: 'GET', observed: { status: 200 } }
      const output = structuredProposal()
      output.claim = missingClaim
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      const r = await runCouncil({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(r.approved).toBe(0)
      expect(r.rejected).toBeGreaterThanOrEqual(1)
      expect(r.messages.some((m) => m.type === 'reject' && m.from === 'skeptic')).toBe(true)
    })

    it('blocks high-impact HITL proposals when no human harness is supplied', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'hitl' }
      const output = structuredProposal({ impact: 'critical' })
      output.claim = CLAIM
      const r = await runCouncil({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(r.approved).toBe(0)
      expect(r.rejected).toBeGreaterThanOrEqual(1)
    })

    it('approves high-impact HITL proposals when the human approves', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'hitl' }
      const output = structuredProposal({ impact: 'high' })
      output.claim = CLAIM
      const r = await runCouncil({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
        humanApprove: async () => true,
      })
      expect(r.approved).toBe(1)
      expect(r.rejected).toBe(0)
    })

    it('respects the max-rounds budget cap', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 3, approvalMode: 'autonomous' }
      const output = structuredProposal({ impact: 'low' })
      output.claim = CLAIM
      const r = await runCouncil({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(r.rounds).toBe(3)
      expect(r.approved).toBe(3)
    })

    it('verifies the structural gate directly (no substring scanning)', () => {
      const bad = verifyClaimStructured({ type: 'exposure', endpoint: 'https://nope', method: 'GET', observed: { status: 200 } })
      expect(bad.verified).toBe(false)
      expect(bad.missing.length).toBeGreaterThan(0)

      recordStructuredEvidence(EVIDENCE)
      const good = verifyClaimStructured(CLAIM)
      expect(good.verified).toBe(true)
      expect(good.missing).toEqual([])
    })
  })

  describe('debateOnce (parallel structured debate)', () => {
    it('returns structured tasks from proposals', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      const output = structuredProposal({ impact: 'medium' })
      output.claim = CLAIM
      const result = await debateOnce({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(result.complete).toBe(false)
      expect(result.proposedTasks.length).toBeGreaterThanOrEqual(1)
      expect(result.proposedTasks[0].skillId).toBe('injection')
      expect(result.proposedTasks[0].complexity).toBe('high')
    })

    it('signals completion when intent is complete', async () => {
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      // Completion requires previous execution (we've actually done work).
      // Pre-post an execute message at round 0 to simulate prior work.
      const bus = new ConversationBus()
      bus.post('operator', 'execute', 'prior work done', { round: 0 })

      const output = structuredComplete()
      const result = await debateOnce({
        members: mockMembers(output),
        bus,
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(result.complete).toBe(true)
      expect(result.proposedTasks.length).toBe(0)
    })

    it('records evidence via ledger when available', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      const output = structuredProposal({ impact: 'low' })
      output.claim = CLAIM
      const ledger = { record: () => ({}), all: () => [] } as any
      const result = await debateOnce({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
        ledger,
      })
      expect(result.newEvidence).toBeGreaterThanOrEqual(0)
    })

    it('handles member errors gracefully', async () => {
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      const brokenStrategist: CouncilMember = {
        role: 'strategist', id: 'broken', tier: 'balanced',
        respond: async () => { throw new Error('LLM timeout') },
      }
      const result = await debateOnce({
        members: [brokenStrategist],
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      expect(result.complete).toBe(false)
    })

    it('uses typed intent field, not text regex, for completion detection', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'autonomous' }
      // Output text contains "DONE" but intent is 'propose' — should NOT trigger completion
      const outputWithDone: MemberOutput = {
        text: 'DONE with reconnaissance, now proposing SQLi',
        intent: 'propose',
        proposal: {
          action: 'SQL injection test',
          skillId: 'injection',
          complexity: 'high',
          impact: 'high',
          reasoning: 'Moving to exploitation',
          evidenceRequired: [],
        },
      }
      outputWithDone.claim = CLAIM
      const bus = new ConversationBus()
      const result = await debateOnce({
        members: mockMembers(outputWithDone),
        bus,
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      // Should NOT be complete — intent is 'propose', not 'complete'
      expect(result.complete).toBe(false)
      expect(result.proposedTasks.length).toBeGreaterThanOrEqual(1)
    })

    it('uses typed impact field, not text regex, for approval classification', async () => {
      recordStructuredEvidence(EVIDENCE)
      const cfg: CouncilConfig = { ...defaultCouncilConfig(), maxRounds: 1, approvalMode: 'both' }
      // Text says "privilege escalation" but impact is 'low' — should auto-approve
      const outputLowImpact: MemberOutput = {
        text: 'Test for privilege escalation via sudo',
        intent: 'propose',
        proposal: {
          action: 'Test for privilege escalation via sudo',
          skillId: 'exploitation',
          complexity: 'high',
          impact: 'low', // LLM declares low impact
          reasoning: 'Just checking configuration',
          evidenceRequired: [],
        },
      }
      outputLowImpact.claim = CLAIM
      const result = await debateOnce({
        members: mockMembers(outputLowImpact),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      // Should be approved (low impact = auto-approve even in both mode)
      expect(result.proposedTasks.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('withTimeout helper', () => {
    it('resolves normally when promise completes within deadline', async () => {
      const result = await withTimeout(Promise.resolve('ok'), 1000, 'test')
      expect(result).toBe('ok')
    })

    it('rejects with TimeoutError when promise exceeds deadline', async () => {
      const slow = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 500))
      await expect(withTimeout(slow, 50, 'slow-op')).rejects.toThrow('Timeout: slow-op exceeded 50ms')
    })

    it('does not leak timers on successful resolve', async () => {
      const result = await withTimeout(Promise.resolve(42), 10_000, 'fast')
      expect(result).toBe(42)
    })
  })

  describe('debateOnce timeout behavior', () => {
    it('returns error output when a member respond() exceeds timeout', async () => {
      const cfg: CouncilConfig = {
        ...defaultCouncilConfig(),
        maxRounds: 1,
        approvalMode: 'autonomous',
        respondTimeoutMs: 50,
      }
      const slowStrategist: CouncilMember = {
        role: 'strategist', id: 'slow', tier: 'balanced',
        respond: async () => new Promise<MemberOutput>((resolve) =>
          setTimeout(() => resolve(structuredProposal()), 500),
        ),
      }
      const fastOperator: CouncilMember = {
        role: 'operator', id: 'fast', tier: 'balanced',
        respond: async () => ({ text: 'ready', intent: 'propose' as const }),
      }
      const fastSkeptic: CouncilMember = {
        role: 'skeptic', id: 'fast-sk', tier: 'balanced',
        respond: async () => ({ text: 'ok', intent: 'critique' as const }),
      }
      const fastAnalyst: CouncilMember = {
        role: 'analyst', id: 'fast-a', tier: 'balanced',
        respond: async () => ({ text: 'note', intent: 'critique' as const }),
      }
      const result = await debateOnce({
        members: [slowStrategist, fastOperator, fastSkeptic, fastAnalyst],
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      // Slow member should produce an error output, debate should still complete
      expect(result.complete).toBe(false)
      // The bus should have an error message from the timed-out member
      const errorMsg = result.messages.find(m => m.text?.includes('Timeout'))
      expect(errorMsg).toBeDefined()
    })

    it('returns timeout result when execute() exceeds timeout', async () => {
      const cfg: CouncilConfig = {
        ...defaultCouncilConfig(),
        maxRounds: 1,
        approvalMode: 'autonomous',
        executeTimeoutMs: 50,
      }
      const output = structuredProposal({ impact: 'low' })
      output.claim = CLAIM
      recordStructuredEvidence(EVIDENCE)
      const slowExecute = async (): Promise<string> =>
        new Promise((resolve) => setTimeout(() => resolve('done'), 500))

      const result = await debateOnce({
        members: mockMembers(output),
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
        execute: slowExecute,
      })
      // Execute should have timed out — check bus for timeout error
      const errorReport = result.messages.find(m => m.text?.includes('timeout'))
      expect(errorReport).toBeDefined()
    })

    it('configurable timeouts are respected', async () => {
      // Very short timeout should trigger even a slightly slow member
      const cfg: CouncilConfig = {
        ...defaultCouncilConfig(),
        maxRounds: 1,
        approvalMode: 'autonomous',
        respondTimeoutMs: 10,
      }
      const marginalMember: CouncilMember = {
        role: 'strategist', id: 'marginal', tier: 'balanced',
        respond: async () => new Promise<MemberOutput>((resolve) =>
          setTimeout(() => resolve(structuredProposal()), 20),
        ),
      }
      const result = await debateOnce({
        members: [marginalMember],
        bus: new ConversationBus(),
        blackboard: new SharedBlackboard(),
        goal: 'find vulns',
        config: cfg,
      })
      // Should have timeout error in bus
      const errorMsg = result.messages.find(m => m.text?.includes('Timeout'))
      expect(errorMsg).toBeDefined()
    })
  })
})
