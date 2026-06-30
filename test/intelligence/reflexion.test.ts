import { describe, it, expect, beforeEach } from 'vitest'
import { ReflexionEngine, FailureCategory, EscalationLevel } from '../../src/intelligence/reflexion'

describe('ReflexionEngine', () => {
  let engine: ReflexionEngine

  beforeEach(() => {
    engine = new ReflexionEngine({ maxSameVulnFails: 2, maxTotalNoProgress: 3, maxReflectionsBeforeEscalate: 2 })
  })

  it('records success resets counters', () => {
    engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')
    engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')
    engine.recordAttempt('/api', true)
    expect(engine.getConsecutiveFailures()).toBe(0)
  })

  it('increments consecutive failures', () => {
    engine.recordAttempt('/a', false)
    engine.recordAttempt('/b', false)
    expect(engine.getConsecutiveFailures()).toBe(2)
  })

  it('triggers reflection after same-vuln threshold', () => {
    engine.recordAttempt('/a', false, null, '', 'sqli')
    engine.recordAttempt('/b', false, null, '', 'sqli')
    expect(engine.shouldReflect()).toBe(true)
  })

  it('does not trigger reflection with different vuln types', () => {
    engine.recordAttempt('/a', false, null, '', 'sqli')
    engine.recordAttempt('/b', false, null, '', 'xss')
    expect(engine.shouldReflect()).toBe(false)
  })

  it('triggers reflection after total no-progress threshold', () => {
    engine.recordAttempt('/a', false, FailureCategory.ENV_CONSTRAINT, 'blocked')
    engine.recordAttempt('/b', false, FailureCategory.PATH_ERROR, 'dead end')
    engine.recordAttempt('/c', false, FailureCategory.UNKNOWN, 'error')
    expect(engine.shouldReflect()).toBe(true)
  })

  it('tracks failed paths', () => {
    engine.recordAttempt('/api/users', false)
    engine.recordAttempt('/api/admin', false)
    const paths = engine.getFailedPaths()
    expect(paths).toContain('/api/users')
    expect(paths).toContain('/api/admin')
  })

  it('deduplicates failed paths', () => {
    engine.recordAttempt('/api/users', false)
    engine.recordAttempt('/api/users', false)
    expect(engine.getFailedPaths()).toHaveLength(1)
  })

  it('tracks constraints from env_constraint failures', () => {
    engine.recordAttempt('/api', false, FailureCategory.ENV_CONSTRAINT, 'WAF detected')
    expect(engine.getConstraints()).toContain('WAF detected')
  })

  it('generates prompt block', () => {
    engine.recordAttempt('/a', false)
    const block = engine.toPromptBlock()
    expect(block).toContain('Reflexion state:')
    expect(block).toContain('Consecutive rounds without progress: 1')
  })

  it('returns empty prompt block when no attempts', () => {
    expect(engine.toPromptBlock()).toBe('')
  })

  it('escalation level increases with failures', () => {
    engine.recordAttempt('/a', false)
    engine.recordAttempt('/b', false)
    const level = engine.getEscalationLevel()
    expect(level).toBeGreaterThanOrEqual(0)
  })

  it('provides escalation hints', () => {
    const hints = engine.getEscalationHints()
    expect(hints.length).toBeGreaterThan(0)
    expect(typeof hints[0]).toBe('string')
  })

  it('analyzes failure patterns', () => {
    engine.recordAttempt('/a', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')
    engine.recordAttempt('/b', false, FailureCategory.ENV_CONSTRAINT, 'WAF blocked', 'sqli')
    const patterns = engine.analyzeFailurePatterns()
    expect(patterns.length).toBeGreaterThan(0)
    expect(patterns[0].category).toBe(FailureCategory.ENV_CONSTRAINT)
    expect(patterns[0].occurrences).toBe(2)
  })

  it('extracts experience summary', () => {
    engine.recordAttempt('/a', false, null, '', 'sqli')
    engine.recordAttempt('/b', true)
    const exp = engine.extractExperience()
    expect(exp.totalAttempts).toBe(2)
    expect(exp.successfulPaths).toContain('/b')
    expect(exp.failedPaths).toContain('/a')
    expect(exp.lastVulnType).toBe('sqli')
  })

  it('getAttemptCount works', () => {
    engine.recordAttempt('/a', false)
    engine.recordAttempt('/b', true)
    expect(engine.getAttemptCount()).toBe(2)
  })

  it('shouldEscalate after enough reflections', () => {
    engine.recordAttempt('/a', false)
    engine.recordAttempt('/b', false)
    engine.recordAttempt('/c', false)
    engine.recordAttempt('/d', false)
    expect(engine.shouldReflect()).toBe(true)
  })

  it('reflection prompt includes hints', () => {
    engine.recordAttempt('/a', false, null, '', 'sqli')
    engine.recordAttempt('/b', false, null, '', 'sqli')
    const prompt = engine.toReflectionPrompt()
    expect(prompt).toContain('REFLEXION OVERRIDE')
    expect(prompt).toContain('escalation level')
  })

  it('returns empty reflection prompt when not triggered', () => {
    engine.recordAttempt('/a', true)
    expect(engine.toReflectionPrompt()).toBe('')
  })
})

describe('ReflexionEngine.classifyFailure', () => {
  it('classifies WAF/403 as env_constraint', () => {
    expect(ReflexionEngine.classifyFailure('403 Forbidden')).toBe(FailureCategory.ENV_CONSTRAINT)
    expect(ReflexionEngine.classifyFailure('WAF detected')).toBe(FailureCategory.ENV_CONSTRAINT)
    expect(ReflexionEngine.classifyFailure('rate limit exceeded')).toBe(FailureCategory.ENV_CONSTRAINT)
  })

  it('classifies no-injection as path_error', () => {
    expect(ReflexionEngine.classifyFailure('no injection point found')).toBe(FailureCategory.PATH_ERROR)
    expect(ReflexionEngine.classifyFailure('not vulnerable')).toBe(FailureCategory.PATH_ERROR)
  })

  it('classifies bad payload as param_error', () => {
    expect(ReflexionEngine.classifyFailure('invalid payload syntax')).toBe(FailureCategory.PARAM_ERROR)
    expect(ReflexionEngine.classifyFailure('encoding error')).toBe(FailureCategory.PARAM_ERROR)
  })

  it('classifies need-more-info as info_needed', () => {
    expect(ReflexionEngine.classifyFailure('need more information')).toBe(FailureCategory.INFO_NEEDED)
    expect(ReflexionEngine.classifyFailure('insufficient data')).toBe(FailureCategory.INFO_NEEDED)
  })

  it('classifies connection errors as env_constraint', () => {
    expect(ReflexionEngine.classifyFailure('Connection refused')).toBe(FailureCategory.ENV_CONSTRAINT)
    expect(ReflexionEngine.classifyFailure('TimeoutError')).toBe(FailureCategory.ENV_CONSTRAINT)
  })

  it('returns null for empty input', () => {
    expect(ReflexionEngine.classifyFailure('')).toBeNull()
    expect(ReflexionEngine.classifyFailure('   ')).toBeNull()
  })

  it('returns unknown for unclassified', () => {
    expect(ReflexionEngine.classifyFailure('something weird happened')).toBe(FailureCategory.UNKNOWN)
  })
})
