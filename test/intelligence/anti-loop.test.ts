import { describe, it, expect, beforeEach } from 'vitest'
import { LoopDetector, extractAttackPath, detectDeadEnd, isMeaningfulStep } from '../../src/intelligence/anti-loop'

describe('LoopDetector', () => {
  let detector: LoopDetector

  beforeEach(() => {
    detector = new LoopDetector()
  })

  it('tracks rounds since last finding', () => {
    detector.recordRound(false)
    detector.recordRound(false)
    detector.recordRound(false)
    expect(detector.roundsSinceLastFindings).toBe(3)
  })

  it('resets on finding', () => {
    detector.recordRound(false)
    detector.recordRound(false)
    detector.recordRound(true)
    expect(detector.roundsSinceLastFindings).toBe(0)
  })

  it('detects stale rounds', () => {
    for (let i = 0; i < 5; i++) detector.recordRound(false)
    expect(detector.isStale(5)).toBe(true)
    expect(detector.isStale(6)).toBe(false)
  })

  it('tracks failed targets', () => {
    const blocked = detector.trackFailedTarget('https://example.com', 'Connection refused')
    expect(blocked).toBeNull()
    expect(detector.failedTargets.get('example.com')).toBe(1)
  })

  it('blocks target after 3 failures', () => {
    detector.trackFailedTarget('https://example.com', 'SSLError')
    detector.trackFailedTarget('https://example.com', 'TimeoutError')
    const blocked = detector.trackFailedTarget('https://example.com', 'Connection refused')
    expect(blocked).toBe('example.com')
    expect(detector.isTargetBlocked('example.com')).toBe(true)
  })

  it('does not track non-access failures', () => {
    detector.trackFailedTarget('https://example.com', 'some random error')
    expect(detector.failedTargets.size).toBe(0)
  })

  it('resets correctly', () => {
    detector.recordRound(false)
    detector.recordRound(false)
    detector.trackFailedTarget('https://test.com', 'SSLError')
    detector.recordAttackPath('sqli')
    detector.reset()
    expect(detector.roundsSinceLastFindings).toBe(0)
    expect(detector.failedTargets.size).toBe(0)
    expect(detector.blockedTargets.size).toBe(0)
    expect(detector.getAttackPathHistory()).toHaveLength(0)
  })

  it('tracks attack path history (explicit only)', () => {
    detector.recordAttackPath('sqli')
    detector.recordAttackPath('xss')
    detector.recordAttackPath('sqli') // duplicate ignored
    expect(detector.getAttackPathHistory()).toEqual(['sqli', 'xss'])
  })
})

describe('extractAttackPath', () => {
  it('extracts valid path tag from LLM output', () => {
    expect(extractAttackPath('Now testing [PATH: sqli] for injection points')).toBe('sqli')
    expect(extractAttackPath('Switching to [PATH: xss] payload')).toBe('xss')
    expect(extractAttackPath('[PATH: ssrf] via internal network')).toBe('ssrf')
  })

  it('is case insensitive for tag', () => {
    expect(extractAttackPath('[PATH: SQLI]')).toBe('sqli')
    expect(extractAttackPath('[PATH: Sqli]')).toBe('sqli')
  })

  it('returns null when no tag present', () => {
    expect(extractAttackPath('Testing for SQL injection vulnerabilities')).toBeNull()
    expect(extractAttackPath('No attack path declared here')).toBeNull()
  })

  it('accepts any declared tag — diversity tracking is structural, not a closed vocabulary', () => {
    // The agent declares what it is doing; we record it verbatim. Unrecognized
    // tags are NOT rejected (rejecting them silently drops anti-loop signal).
    expect(extractAttackPath('[PATH: invalid_path]')).toBe('invalid_path')
    expect(extractAttackPath('[PATH: random]')).toBe('random')
    expect(extractAttackPath('[PATH: some_novel_class]')).toBe('some_novel_class')
  })

  it('handles empty/null input', () => {
    expect(extractAttackPath('')).toBeNull()
    expect(extractAttackPath(null as any)).toBeNull()
  })

  it('accepts canonical attack paths as declared', () => {
    const paths = [
      'sqli', 'xss', 'ssrf', 'rce', 'ssti', 'idor', 'auth_bypass',
      'info_leak', 'race_condition', 'file_upload', 'xxe', 'deserialization',
      'business_logic', 'crypto', 'config',
    ]
    for (const p of paths) {
      expect(extractAttackPath(`[PATH: ${p}]`)).toBe(p)
    }
  })
})

describe('detectDeadEnd', () => {
  it('detects dead end signals', () => {
    expect(detectDeadEnd('does not exist')).toBe(true)
    expect(detectDeadEnd('cannot access')).toBe(true)
    expect(detectDeadEnd('not vulnerable')).toBe(true)
    expect(detectDeadEnd('blocked by firewall')).toBe(true)
  })

  it('does not false positive on progress', () => {
    expect(detectDeadEnd('Found SQL injection on /api')).toBe(false)
    expect(detectDeadEnd('200 OK with user data')).toBe(false)
  })

  it('handles empty input', () => {
    expect(detectDeadEnd('')).toBe(false)
    expect(detectDeadEnd(null as any)).toBe(false)
  })
})

describe('isMeaningfulStep', () => {
  it('detects meaningful progress', () => {
    expect(isMeaningfulStep('discovered /admin endpoint')).toBe(true)
    expect(isMeaningfulStep('found SQL injection')).toBe(true)
    expect(isMeaningfulStep('flag{abc123}')).toBe(true)
  })

  it('detects failure-only steps', () => {
    expect(isMeaningfulStep('SSLError connection failed')).toBe(false)
    expect(isMeaningfulStep('ReadTimeout on port 443')).toBe(false)
  })

  it('defaults to meaningful for ambiguous', () => {
    expect(isMeaningfulStep('something happened')).toBe(true)
  })
})
