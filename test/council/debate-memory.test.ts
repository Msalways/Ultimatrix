import { describe, it, expect } from 'vitest'
import {
  createDebateMemory,
  extractStances,
  extractFailedApproaches,
  extractProvenFindings,
  buildMemoryPrompt,
  detectContradictions,
} from '../../src/council/debate-memory'
import type { MemberOutput, DebateMemory, Stance } from '../../src/council/types'

describe('Debate Memory', () => {
  describe('createDebateMemory', () => {
    it('creates empty memory', () => {
      const mem = createDebateMemory()
      expect(mem.stances).toEqual([])
      expect(mem.failedApproaches).toEqual([])
      expect(mem.provenFindings).toEqual([])
    })
  })

  describe('extractStances', () => {
    it('extracts for-stance from proposal', () => {
      const output: MemberOutput = {
        text: 'Test SQLi',
        intent: 'propose',
        proposal: {
          action: 'SQL injection on /api',
          skillId: 'injection',
          complexity: 'high',
          impact: 'high',
          reasoning: 'Parameter looks injectable',
          evidenceRequired: [],
        },
      }
      const stances = extractStances(output, 'strategist', 1)
      expect(stances).toHaveLength(1)
      expect(stances[0].position).toBe('for')
      expect(stances[0].member).toBe('strategist')
      expect(stances[0].target).toBe('SQL injection on /api')
    })

    it('extracts against-stance from critique', () => {
      const output: MemberOutput = {
        text: 'Disagree',
        intent: 'critique',
        critique: {
          targets: ['strategist'],
          agreements: [],
          disagreements: ['SQL injection requires auth we dont have'],
          evidenceGaps: [],
        },
      }
      const stances = extractStances(output, 'skeptic', 1)
      expect(stances).toHaveLength(1)
      expect(stances[0].position).toBe('against')
      expect(stances[0].member).toBe('skeptic')
    })

    it('extracts alternative-stance from critique with alternative', () => {
      const output: MemberOutput = {
        text: 'Better idea',
        intent: 'critique',
        critique: {
          targets: ['strategist'],
          agreements: [],
          disagreements: [],
          evidenceGaps: [],
          alternative: 'Try IDOR instead',
        },
      }
      const stances = extractStances(output, 'analyst', 2)
      expect(stances).toHaveLength(1)
      expect(stances[0].position).toBe('alternative')
    })

    it('returns empty for complete intent', () => {
      const output: MemberOutput = {
        text: 'Done',
        intent: 'complete',
        reflection: { whatWorked: [], whatFailed: [], whatLearned: [], nextSteps: [] },
      }
      const stances = extractStances(output, 'operator', 1)
      expect(stances).toHaveLength(0)
    })
  })

  describe('extractFailedApproaches', () => {
    it('extracts failures from reflection', () => {
      const output: MemberOutput = {
        text: 'Failed',
        intent: 'complete',
        reflection: {
          whatWorked: [],
          whatFailed: ['SQLi on /api/users — 403 forbidden'],
          whatLearned: [],
          nextSteps: [],
        },
      }
      const failed = extractFailedApproaches(output, 3)
      expect(failed).toHaveLength(1)
      expect(failed[0].technique).toContain('SQLi')
      expect(failed[0].round).toBe(3)
    })

    it('returns empty when no failures', () => {
      const output: MemberOutput = {
        text: 'Success',
        intent: 'complete',
        reflection: { whatWorked: ['XSS found'], whatFailed: [], whatLearned: [], nextSteps: [] },
      }
      const failed = extractFailedApproaches(output, 1)
      expect(failed).toHaveLength(0)
    })
  })

  describe('extractProvenFindings', () => {
    it('extracts successes from reflection', () => {
      const output: MemberOutput = {
        text: 'Found it',
        intent: 'complete',
        reflection: {
          whatWorked: ['XSS on /search confirmed'],
          whatFailed: [],
          whatLearned: [],
          nextSteps: [],
        },
      }
      const findings = extractProvenFindings(output, 2)
      expect(findings).toHaveLength(1)
      expect(findings[0].finding).toContain('XSS')
    })
  })

  describe('buildMemoryPrompt', () => {
    it('returns empty string for empty memory', () => {
      const mem = createDebateMemory()
      const prompt = buildMemoryPrompt(mem, 'strategist')
      expect(prompt).toBe('')
    })

    it('builds prompt with past positions', () => {
      const mem: DebateMemory = {
        stances: [
          { member: 'strategist', round: 1, position: 'for', target: 'SQLi on /api', reasoning: 'Looks injectable' },
          { member: 'skeptic', round: 1, position: 'against', target: 'SQLi on /api', reasoning: 'No evidence' },
        ],
        failedApproaches: [],
        provenFindings: [],
      }
      const prompt = buildMemoryPrompt(mem, 'strategist')
      expect(prompt).toContain('Your Past Positions')
      expect(prompt).toContain('[for]')
      expect(prompt).toContain('Other Members\' Positions')
      expect(prompt).toContain('skeptic')
    })

    it('includes failed approaches warning', () => {
      const mem: DebateMemory = {
        stances: [],
        failedApproaches: [
          { round: 2, technique: 'SQLi on /admin', endpoint: '/admin', reason: '403 forbidden' },
        ],
        provenFindings: [],
      }
      const prompt = buildMemoryPrompt(mem, 'strategist')
      expect(prompt).toContain('Failed Approaches')
      expect(prompt).toContain('DO NOT repeat')
    })

    it('includes proven findings', () => {
      const mem: DebateMemory = {
        stances: [],
        failedApproaches: [],
        provenFindings: [
          { round: 3, finding: 'XSS on /search confirmed', evidence: 'alert() fired' },
        ],
      }
      const prompt = buildMemoryPrompt(mem, 'analyst')
      expect(prompt).toContain('Proven Findings')
      expect(prompt).toContain('XSS on /search')
    })
  })

  describe('detectContradictions', () => {
    it('detects for → against contradiction', () => {
      const mem: DebateMemory = {
        stances: [
          { member: 'strategist', round: 1, position: 'for', target: 'SQLi test', reasoning: '' },
        ],
        failedApproaches: [],
        provenFindings: [],
      }
      const newStance: Stance = {
        member: 'strategist', round: 3, position: 'against', target: 'SQLi test', reasoning: 'No injection point',
      }
      const contradiction = detectContradictions(mem, newStance)
      expect(contradiction).toContain('previously supported')
      expect(contradiction).toContain('SQLi test')
    })

    it('detects against → for contradiction', () => {
      const mem: DebateMemory = {
        stances: [
          { member: 'skeptic', round: 1, position: 'against', target: 'XSS on /search', reasoning: '' },
        ],
        failedApproaches: [],
        provenFindings: [],
      }
      const newStance: Stance = {
        member: 'skeptic', round: 3, position: 'for', target: 'XSS on /search', reasoning: 'Found reflection',
      }
      const contradiction = detectContradictions(mem, newStance)
      expect(contradiction).toContain('previously opposed')
    })

    it('returns null when no contradiction', () => {
      const mem: DebateMemory = {
        stances: [
          { member: 'strategist', round: 1, position: 'for', target: 'SQLi test', reasoning: '' },
        ],
        failedApproaches: [],
        provenFindings: [],
      }
      const newStance: Stance = {
        member: 'strategist', round: 2, position: 'for', target: 'XSS test', reasoning: 'New idea',
      }
      expect(detectContradictions(mem, newStance)).toBeNull()
    })
  })
})
