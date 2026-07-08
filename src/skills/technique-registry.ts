/**
 * TechniqueRegistry — Single source of truth for attack techniques, tool mappings,
 * chain rules, and all domain-specific data. Derives from skill YAML + registry.json.
 *
 * Replaces 60+ hardcoded arrays across the codebase.
 */

import { readFileSync } from 'fs'
import { initSkillIndex, type SkillMeta } from '../solver/skills/loader'
import type { ChainSeverity } from '../types/shared'
import { REGISTRY_PATH } from '../lib/project-root'

// ─── Config types ───────────────────────────────────────────────────

export interface ChainRule {
  name: string
  source: string
  target: string
  description: string
  severity: ChainSeverity
}

export interface ToolInferenceRule {
  keywords: string[]
  tools: string[]
  priority: 'high' | 'medium' | 'low'
}

export interface TechStackFingerprint {
  name: string
  pattern: string
  evidence: string
}

export interface WafSignature {
  vendor: string
  patterns: string[]
}

export interface WorkflowKeyword {
  pattern: string
  name: string
  stateChange?: string
}

export interface EntityFields {
  owner: string[]
  role: string[]
  sensitive: string[]
  states: string[]
}

export interface FailurePatterns {
  envConstraint: string[]
  pathError: string[]
  paramError: string[]
  infoNeeded: string[]
}

export interface RegistryConfig {
  chainRules: ChainRule[]
  entityFields: EntityFields
  workflowKeywords: WorkflowKeyword[]
  techStackFingerprints: TechStackFingerprint[]
  wafSignatures: WafSignature[]
  failurePatterns: FailurePatterns
  failedAccessPatterns: string[]
  deadEndMarkers: string[]
  meaningfulProgress: string[]
  meaningfulFailures: string[]
  escalationHints: Record<string, string[]>
  sensitiveFields: string[]
  loginUrlPatterns: string[]
  suspiciousFields: string[]
  validationGapBooleans: string[]
  validationGapNumerics: string[]
  rateLimitPatterns: string[]
  ignoreKeys: string[]
  conversationalGoals: string[]
  attackPathKeywords: Record<string, string[]>
  toolInferenceRules: ToolInferenceRule[]
}

// ─── TechniqueRegistry ──────────────────────────────────────────────

let _instance: TechniqueRegistry | null = null

export class TechniqueRegistry {
  private config: RegistryConfig
  private skills: Map<string, SkillMeta>

  // Derived from skills
  private _attackPaths: string[]
  private _attackPathKeywords: Map<string, string[]>
  private _toolsByKeyword: Map<string, string[]>
  private _toolsByPriority: { high: string[]; medium: string[]; low: string[] }

  constructor(configPath?: string) {
    const path = configPath || REGISTRY_PATH
    this.config = JSON.parse(readFileSync(path, 'utf-8'))
    this.skills = initSkillIndex()

    this._attackPaths = this.deriveAttackPaths()
    this._attackPathKeywords = this.deriveAttackPathKeywords()
    this._toolsByKeyword = this.deriveToolKeywordMap()
    this._toolsByPriority = this.deriveToolPriorityMap()
  }

  // ─── Derived data builders ──────────────────────────────────────

  private deriveAttackPaths(): string[] {
    const paths = new Set<string>()
    // Add all keyword values from attackPathKeywords (the actual descriptive terms)
    for (const keywords of Object.values(this.config.attackPathKeywords)) {
      for (const kw of keywords) {
        paths.add(kw)
      }
    }
    // Also add all keys as canonical path names
    for (const key of Object.keys(this.config.attackPathKeywords)) {
      paths.add(key)
    }
    return [...paths].sort()
  }

  private deriveAttackPathKeywords(): Map<string, string[]> {
    const map = new Map<string, string[]>()
    for (const [path, keywords] of Object.entries(this.config.attackPathKeywords)) {
      map.set(path, keywords)
    }
    return map
  }

  private deriveToolKeywordMap(): Map<string, string[]> {
    const map = new Map<string, string[]>()
    for (const rule of this.config.toolInferenceRules) {
      for (const kw of rule.keywords) {
        const existing = map.get(kw) || []
        map.set(kw, [...existing, ...rule.tools])
      }
    }
    return map
  }

  private deriveToolPriorityMap(): { high: string[]; medium: string[]; low: string[] } {
    const result = { high: [] as string[], medium: [] as string[], low: [] as string[] }
    for (const rule of this.config.toolInferenceRules) {
      for (const tool of rule.tools) {
        if (!result[rule.priority].includes(tool)) {
          result[rule.priority].push(tool)
        }
      }
    }
    return result
  }

  // ─── Public API: Attack paths ──────────────────────────────────

  /** All known attack paths (derived from skills + config) */
  getAttackPaths(): string[] {
    return this._attackPaths
  }

  /** Keywords associated with an attack path */
  getKeywordsForPath(path: string): string[] {
    return this._attackPathKeywords.get(path) || []
  }

  /** Match text against attack paths, return matched paths */
  matchAttackPaths(text: string): string[] {
    const lower = text.toLowerCase()
    const matched: string[] = []
    for (const [path, keywords] of this._attackPathKeywords) {
      if (keywords.some(kw => lower.includes(kw))) {
        matched.push(path)
      }
    }
    return matched
  }

  // ─── Public API: Tool inference ────────────────────────────────

  /** Infer tools from a task description using skill-derived rules */
  inferToolsFromTask(taskDescription: string): string[] {
    const input = taskDescription.toLowerCase()
    const tools = new Set<string>()

    // Sort rules: high priority first
    const sorted = [...this.config.toolInferenceRules].sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 }
      return order[a.priority] - order[b.priority]
    })

    for (const rule of sorted) {
      if (rule.keywords.some(kw => input.includes(kw))) {
        for (const tool of rule.tools) {
          tools.add(tool)
        }
      }
    }

    return [...tools]
  }

  /** Get tools for a specific attack technique */
  getToolsForTechnique(technique: string): string[] {
    const lower = technique.toLowerCase()
    const tools = new Set<string>()

    // Check tool inference rules
    for (const rule of this.config.toolInferenceRules) {
      if (rule.keywords.some(kw => lower.includes(kw))) {
        for (const tool of rule.tools) {
          tools.add(tool)
        }
      }
    }

    // Check skill toolRefs
    for (const skill of this.skills.values()) {
      const keywords = this.config.attackPathKeywords[skill.domain] || []
      if (keywords.some(kw => lower.includes(kw)) || skill.triggers.some(t => lower.includes(t.toLowerCase()))) {
        for (const tool of skill.toolRefs) {
          tools.add(tool)
        }
      }
    }

    return [...tools]
  }

  /** Get tools grouped by priority */
  getToolsByPriority(): { high: string[]; medium: string[]; low: string[] } {
    return this._toolsByPriority
  }

  // ─── Public API: Chain rules ───────────────────────────────────

  /** All chain rules (from config + skill composition) */
  getChainRules(): ChainRule[] {
    return this.config.chainRules
  }

  /** Get chain rules where a technique is the source */
  getChainsFromSource(technique: string): ChainRule[] {
    const lower = technique.toLowerCase()
    return this.config.chainRules.filter(r => lower.includes(r.source))
  }

  /** Get follow-up suggestions for a finding technique */
  getFollowUps(technique: string): string[] {
    const lower = technique.toLowerCase()
    const suggestions: string[] = []

    // From chain rules
    for (const rule of this.config.chainRules) {
      if (lower.includes(rule.source)) {
        suggestions.push(rule.description)
      }
    }

    // From skill triggers
    for (const skill of this.skills.values()) {
      if (skill.triggers.some(t => lower.includes(t.toLowerCase()))) {
        // Look at what this skill enhances
        if (skill.compositionRules?.enhances) {
          for (const enhanced of skill.compositionRules.enhances) {
            suggestions.push(`Try ${enhanced} methodology after this`)
          }
        }
      }
    }

    return [...new Set(suggestions)]
  }

  // ─── Public API: Workflow classification ───────────────────────

  /** All workflow keywords */
  getWorkflowKeywords(): WorkflowKeyword[] {
    return this.config.workflowKeywords
  }

  /** Classify a URL/method into a workflow */
  classifyWorkflow(url: string, method?: string, tags?: string[]): { name: string; stateChanges: string[] } {
    const haystack = [url, method || '', ...(tags || [])].join(' ').toLowerCase()
    for (const kw of this.config.workflowKeywords) {
      const regex = new RegExp(kw.pattern, 'i')
      if (regex.test(haystack)) {
        return { name: kw.name, stateChanges: kw.stateChange ? [kw.stateChange] : [] }
      }
    }
    return { name: url.split('/').filter(Boolean).pop() || 'unknown', stateChanges: [] }
  }

  // ─── Public API: Entity fields ─────────────────────────────────

  /** Entity field patterns */
  getEntityFields(): EntityFields {
    return this.config.entityFields
  }

  /** Check if a field name matches a category */
  categorizeField(fieldName: string): 'owner' | 'role' | 'sensitive' | 'state' | null {
    const lower = fieldName.toLowerCase()
    if (this.config.entityFields.owner.some(f => lower.includes(f.toLowerCase()))) return 'owner'
    if (this.config.entityFields.role.some(f => lower.includes(f.toLowerCase()))) return 'role'
    if (this.config.entityFields.sensitive.some(f => lower.includes(f.toLowerCase()))) return 'sensitive'
    if (this.config.entityFields.states.some(f => lower === f.toLowerCase())) return 'state'
    return null
  }

  // ─── Public API: Failure classification ────────────────────────

  /** Classify a failure response into a category */
  classifyFailure(text: string, responseText?: string): 'envConstraint' | 'pathError' | 'paramError' | 'infoNeeded' | 'unknown' {
    const combined = (text + ' ' + (responseText || '')).toLowerCase()

    // Check failed access patterns first (infrastructure)
    if (this.config.failedAccessPatterns.some(p => combined.includes(p.toLowerCase()))) {
      return 'envConstraint'
    }

    // Check each failure category
    for (const [category, patterns] of Object.entries(this.config.failurePatterns)) {
      if (patterns.some(p => combined.includes(p.toLowerCase()))) {
        return category as 'envConstraint' | 'pathError' | 'paramError' | 'infoNeeded'
      }
    }

    return 'unknown'
  }

  /** Dead end markers */
  getDeadEndMarkers(): string[] {
    return this.config.deadEndMarkers
  }

  /** Meaningful progress signals */
  getMeaningfulProgress(): string[] {
    return this.config.meaningfulProgress
  }

  /** Meaningful failure signals */
  getMeaningfulFailures(): string[] {
    return this.config.meaningfulFailures
  }

  /** Failed access patterns */
  getFailedAccessPatterns(): string[] {
    return this.config.failedAccessPatterns
  }

  // ─── Public API: Escalation ────────────────────────────────────

  /** Escalation hints for a given level (0-4) */
  getEscalationHints(level: number): string[] {
    return this.config.escalationHints[String(level)] || []
  }

  // ─── Public API: Detection patterns ────────────────────────────

  /** WAF signatures */
  getWafSignatures(): WafSignature[] {
    return this.config.wafSignatures
  }

  /** Tech stack fingerprints */
  getTechStackFingerprints(): TechStackFingerprint[] {
    return this.config.techStackFingerprints
  }

  /** Sensitive field patterns for masking */
  getSensitiveFields(): string[] {
    return this.config.sensitiveFields
  }

  /** Login URL patterns */
  getLoginUrlPatterns(): string[] {
    return this.config.loginUrlPatterns
  }

  /** Suspicious field names in API responses */
  getSuspiciousFields(): string[] {
    return this.config.suspiciousFields
  }

  /** Boolean fields for validation gap detection */
  getValidationGapBooleans(): string[] {
    return this.config.validationGapBooleans
  }

  /** Numeric fields for validation gap detection */
  getValidationGapNumerics(): string[] {
    return this.config.validationGapNumerics
  }

  /** Rate limit error patterns */
  getRateLimitPatterns(): string[] {
    return this.config.rateLimitPatterns
  }

  /** Keys to ignore in JSON comparison */
  getIgnoreKeys(): string[] {
    return this.config.ignoreKeys
  }

  /** Conversational goal signals */
  getConversationalGoals(): string[] {
    return this.config.conversationalGoals
  }

  // ─── Public API: Skill queries ─────────────────────────────────

  /** Get all loaded skills */
  getSkills(): Map<string, SkillMeta> {
    return this.skills
  }

  /** Get skills for a domain */
  getSkillsByDomain(domain: string): SkillMeta[] {
    return [...this.skills.values()].filter(s => s.domain === domain)
  }

  /** Get skills matching a text query (keyword-based) */
  searchSkills(query: string): SkillMeta[] {
    const lower = query.toLowerCase()
    const results: Array<{ skill: SkillMeta; score: number }> = []

    for (const skill of this.skills.values()) {
      let score = 0
      if (skill.id.toLowerCase().includes(lower)) score += 10
      if (skill.name.toLowerCase().includes(lower)) score += 8
      if (skill.description.toLowerCase().includes(lower)) score += 5
      if (skill.triggers.some(t => t.toLowerCase().includes(lower))) score += 7
      if (skill.contextBoosts.some(b => b.toLowerCase().includes(lower))) score += 4
      if (skill.toolRefs.some(t => t.toLowerCase().includes(lower))) score += 3
      if (score > 0) results.push({ skill, score })
    }

    return results.sort((a, b) => b.score - a.score).map(r => r.skill)
  }

  // ─── Raw config access ─────────────────────────────────────────

  /** Get the full registry config */
  getConfig(): RegistryConfig {
    return this.config
  }
}

// ─── Singleton ──────────────────────────────────────────────────────

export function getTechniqueRegistry(configPath?: string): TechniqueRegistry {
  if (!_instance) {
    _instance = new TechniqueRegistry(configPath)
  }
  return _instance
}

/** Reset singleton (for testing) */
export function resetTechniqueRegistry(): void {
  _instance = null
}
