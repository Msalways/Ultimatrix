import { describe, it, expect } from 'vitest'
import { buildGoalPrompt } from '../../src/council/orchestrator'
import type { IntelligenceContext } from '../../src/council/types'

describe('Council Intelligence Context wiring', () => {
  const baseGoal = 'Find SQL injection on https://target.com'

  it('buildGoalPrompt includes reflexion block when provided', () => {
    const ctx: IntelligenceContext = {
      reflexionBlock: 'L0: SQLi on /login failed — error-based not reflected. Escalate to blind.',
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('## Intelligence Context')
    expect(prompt).toContain('### Failure History')
    expect(prompt).toContain('L0: SQLi on /login failed')
  })

  it('buildGoalPrompt includes stale warning when antiLoopStale is true', () => {
    const ctx: IntelligenceContext = {
      antiLoopStale: true,
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('### Loop Detection')
    expect(prompt).toContain('Stale: true')
    expect(prompt).toContain('Switch strategy')
  })

  it('buildGoalPrompt includes blocked targets list', () => {
    const ctx: IntelligenceContext = {
      blockedTargets: ['unreachable.example.com', 'timeout.example.com'],
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('Blocked targets: unreachable.example.com, timeout.example.com')
  })

  it('buildGoalPrompt includes attack path history', () => {
    const ctx: IntelligenceContext = {
      attackPathHistory: ['error_based_sqli', 'blind_boolean_sqli'],
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('Attack paths attempted: error_based_sqli, blind_boolean_sqli')
  })

  it('buildGoalPrompt includes escalation level when > 0', () => {
    const ctx: IntelligenceContext = {
      escalationLevel: 3,
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).toContain('Escalation level: L3')
  })

  it('buildGoalPrompt omits escalation level when 0', () => {
    const ctx: IntelligenceContext = {
      escalationLevel: 0,
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', ctx)
    expect(prompt).not.toContain('Escalation level')
  })

  it('buildGoalPrompt omits intelligence section entirely when ctx is undefined', () => {
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', undefined)
    expect(prompt).not.toContain('## Intelligence Context')
  })

  it('buildGoalPrompt omits intelligence section when ctx is empty object', () => {
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'strategist', {})
    expect(prompt).not.toContain('## Intelligence Context')
  })

  it('buildGoalPrompt includes all fields when all are provided', () => {
    const ctx: IntelligenceContext = {
      reflexionBlock: 'L1: time-based SQLi confirmed on /search',
      antiLoopStale: false,
      blockedTargets: ['bad.example.com'],
      attackPathHistory: ['error_based', 'time_based'],
      escalationLevel: 2,
      consecutiveFailures: 3,
    }
    const prompt = buildGoalPrompt(baseGoal, '', undefined, undefined, 'operator', ctx)
    expect(prompt).toContain('### Failure History')
    expect(prompt).toContain('Blocked targets: bad.example.com')
    expect(prompt).toContain('Attack paths attempted: error_based, time_based')
    expect(prompt).toContain('Escalation level: L2')
  })

  it('buildGoalPrompt includes previous results section when provided', () => {
    const prompt = buildGoalPrompt(
      baseGoal,
      '',
      'Previous run: HTTP 500 on /login with payload \'.',
      undefined,
      'strategist',
      undefined,
    )
    expect(prompt).toContain('Previous execution results:')
    expect(prompt).toContain('HTTP 500 on /login')
    expect(prompt).toContain('Analyze what worked and what failed')
  })
})
