/**
 * Reflexion Engine — Adaptive retry with progressive escalation.
 *
 * When attacks fail, this engine:
 * 1. Classifies the failure (WAF? wrong path? bad payload? need more info?)
 * 2. Tracks per-vuln-type fail count
 * 3. After threshold, triggers reflection (switch strategy entirely)
 * 4. Escalates payload complexity from L0 (raw) to L4 (multi-layer obfuscation)
 *
 * All signals and prompts are in English.
 */

export enum FailureCategory {
  ENV_CONSTRAINT = 'env_constraint',
  PATH_ERROR = 'path_error',
  PARAM_ERROR = 'param_error',
  INFO_NEEDED = 'info_needed',
  UNKNOWN = 'unknown',
}

export enum EscalationLevel {
  L0 = 0,
  L1 = 1,
  L2 = 2,
  L3 = 3,
  L4 = 4,
}

export interface Attempt {
  path: string
  success: boolean
  category: FailureCategory | null
  details: string
  vulnType: string
  timestamp: string
}

export interface FailurePattern {
  category: string
  occurrences: number
  affectedPaths: string[]
  exampleDetails: string[]
  suggestedAction: string
}

export interface ExperienceSummary {
  totalAttempts: number
  successfulPaths: string[]
  failedPaths: string[]
  constraints: string[]
  lastVulnType: string
  escalationLevel: number
}

export interface ReflexionConfig {
  maxSameVulnFails: number
  maxTotalNoProgress: number
  maxReflectionsBeforeEscalate: number
  escalationMaxLevel: number
}

const DEFAULT_CONFIG: ReflexionConfig = {
  maxSameVulnFails: 2,
  maxTotalNoProgress: 5,
  maxReflectionsBeforeEscalate: 3,
  escalationMaxLevel: 4,
}

import { FAILED_ACCESS_PATTERNS, ESCALATION_HINTS } from './constants'

export class ReflexionEngine {
  private attempts: Attempt[] = []
  private consecutiveFailures = 0
  private vulnTypeFailCount = 0
  private lastVulnType = ''
  private failedPaths: string[] = []
  private constraints: string[] = []
  private reflections: Array<{ oldPath: string; newPath: string; reasoning: string; timestamp: string }> = []
  private config: ReflexionConfig

  constructor(config: Partial<ReflexionConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  recordAttempt(
    path: string,
    success: boolean,
    category: FailureCategory | null = null,
    details = '',
    vulnType = '',
  ): void {
    this.attempts.push({
      path,
      success,
      category,
      details,
      vulnType,
      timestamp: new Date().toISOString(),
    })

    if (success) {
      this.consecutiveFailures = 0
      this.vulnTypeFailCount = 0
      if (vulnType) this.lastVulnType = vulnType
      return
    }

    this.consecutiveFailures++
    if (path && path !== 'unknown') {
      if (!this.failedPaths.includes(path)) {
        this.failedPaths.push(path)
      }
    }

    if (vulnType) {
      if (vulnType === this.lastVulnType) {
        this.vulnTypeFailCount++
      } else {
        this.lastVulnType = vulnType
        this.vulnTypeFailCount = 1
      }
    }

    if (category && category !== FailureCategory.UNKNOWN && details) {
      if (!this.constraints.includes(details)) {
        this.constraints.push(details)
      }
    }
  }

  shouldReflect(): boolean {
    return (
      this.vulnTypeFailCount >= this.config.maxSameVulnFails ||
      this.consecutiveFailures >= this.config.maxTotalNoProgress
    )
  }

  shouldEscalate(): boolean {
    return this.reflections.length >= this.config.maxReflectionsBeforeEscalate
  }

  getEscalationLevel(): EscalationLevel {
    const level = Math.floor(this.consecutiveFailures / 2) + this.reflections.length
    return Math.min(this.config.escalationMaxLevel, Math.max(0, level)) as EscalationLevel
  }

  getEscalationHints(): string[] {
    return ESCALATION_HINTS[this.getEscalationLevel()] || ESCALATION_HINTS[0]
  }

  getFailedPaths(): string[] {
    return [...this.failedPaths]
  }

  getConstraints(): string[] {
    return [...this.constraints]
  }

  toPromptBlock(): string {
    if (this.attempts.length === 0 && this.reflections.length === 0) return ''

    const lines = [
      'Reflexion state:',
      `- Consecutive rounds without progress: ${this.consecutiveFailures}`,
      `- Same vulnerability type failures: ${this.vulnTypeFailCount}`,
      `- Current escalation level: L${this.getEscalationLevel()}`,
    ]

    if (this.failedPaths.length > 0) {
      lines.push(`- Failed paths (do NOT retry): ${this.failedPaths.slice(0, 8).join(', ')}`)
    }

    return lines.join('\n')
  }

  toReflectionPrompt(): string {
    if (!this.shouldReflect()) return ''

    const lines = [
      'REFLEXION OVERRIDE (same attack failed repeatedly — change strategy immediately):',
      '- Stop trying different payloads on the same attack path.',
      '- Review failure record. Identify which assumption was likely wrong.',
      '- Choose a fundamentally different attack vector or vulnerability class.',
      `- Current escalation level: L${this.getEscalationLevel()}`,
    ]

    if (this.shouldEscalate()) {
      lines.push('- FORCE ESCALATE: Switch to an entirely different vulnerability class or attack surface.')
    }

    const patterns = this.analyzeFailurePatterns()
    if (patterns.length > 0) {
      lines.push('- Failure patterns:')
      for (const p of patterns.slice(0, 3)) {
        lines.push(`  - ${p.category} x${p.occurrences}: ${p.suggestedAction}`)
      }
    }

    const hints = this.getEscalationHints()
    if (hints.length > 0) {
      lines.push(`- L${this.getEscalationLevel()} bypass hints:`)
      for (const h of hints) {
        lines.push(`  - ${h}`)
      }
    }

    return lines.join('\n')
  }

  analyzeFailurePatterns(): FailurePattern[] {
    const patterns: Record<string, { count: number; paths: Set<string>; examples: string[] }> = {}

    for (const attempt of this.attempts) {
      if (attempt.success) continue
      const cat = attempt.category || FailureCategory.UNKNOWN
      if (!patterns[cat]) {
        patterns[cat] = { count: 0, paths: new Set(), examples: [] }
      }
      patterns[cat].count++
      if (attempt.path) patterns[cat].paths.add(attempt.path)
      if (attempt.details && patterns[cat].examples.length < 3) {
        patterns[cat].examples.push(attempt.details.slice(0, 200))
      }
    }

    return Object.entries(patterns)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([category, info]) => ({
        category,
        occurrences: info.count,
        affectedPaths: [...info.paths],
        exampleDetails: info.examples,
        suggestedAction: this.suggestForCategory(category),
      }))
  }

  extractExperience(): ExperienceSummary {
    return {
      totalAttempts: this.attempts.length,
      successfulPaths: this.attempts.filter(a => a.success).map(a => a.path),
      failedPaths: this.getFailedPaths(),
      constraints: this.getConstraints(),
      lastVulnType: this.lastVulnType,
      escalationLevel: this.getEscalationLevel(),
    }
  }

  getAttemptCount(): number {
    return this.attempts.length
  }

  getConsecutiveFailures(): number {
    return this.consecutiveFailures
  }

  private suggestForCategory(category: string): string {
    const suggestions: Record<string, string> = {
      [FailureCategory.ENV_CONSTRAINT]: 'WAF/filter detected. Use encoding/obfuscation, switch protocol or endpoint.',
      [FailureCategory.PATH_ERROR]: 'Wrong attack vector. Lower priority on this path, try a different vulnerability class.',
      [FailureCategory.PARAM_ERROR]: 'Bad payload syntax. Adjust parameter name, delimiter, or injection position.',
      [FailureCategory.INFO_NEEDED]: 'Need more recon. Gather more info before retrying.',
    }
    return suggestions[category] || 'Review failure record and try a fundamentally different approach.'
  }

  static classifyFailure(responseText: string): FailureCategory | null {
    if (!responseText || !responseText.trim()) return null

    const text = responseText.toLowerCase()

    if (FAILED_ACCESS_PATTERNS.some(p => responseText.includes(p))) {
      return FailureCategory.ENV_CONSTRAINT
    }

    const envPatterns = ['waf', '403', 'forbidden', 'blocked', 'filtered', 'rate limit', 'timeout', 'unauthorized']
    if (envPatterns.some(p => text.includes(p))) return FailureCategory.ENV_CONSTRAINT

    const pathPatterns = ['not vulnerable', 'no injection', 'dead end', 'does not exist', 'not injectable', 'false positive']
    if (pathPatterns.some(p => text.includes(p))) return FailureCategory.PATH_ERROR

    const paramPatterns = ['invalid payload', 'syntax error', 'bad parameter', 'encoding error', 'malformed']
    if (paramPatterns.some(p => text.includes(p))) return FailureCategory.PARAM_ERROR

    const infoPatterns = ['need more information', 'insufficient', 'unknown parameter', 'fingerprint first', 'enumerate first']
    if (infoPatterns.some(p => text.includes(p))) return FailureCategory.INFO_NEEDED

    return FailureCategory.UNKNOWN
  }
}
