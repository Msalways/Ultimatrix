import type { ModelCapabilities, BudgetPolicy } from '../config'
import { DEFAULTS } from '../config'
import { resolveProviderAlias } from '../config'
import { getGlobalQuotaTracker } from './quota-tracker'
import { createProviderLimiter } from './limiter-factory'
import type { UltimatrixConfig } from '../config'
import { COMPLEXITY_TIER_MAP, resolveModelRef, type ModelRole } from './routing'

// ─── Types ────────────────────────────────────────────────────────

export interface WorkerTask {
  skillId: string
  taskDescription: string
  endpointId?: string
  complexity: 'low' | 'medium' | 'high' | 'critical'
  requiredCapabilities?: string[]
  graphState?: GraphSummary
}

export interface GraphSummary {
  totalEndpoints: number
  totalFindings: number
  totalTests: number
}

export interface TaskBudget {
  estimatedModelCalls: number
  estimatedInputTokens: number
  estimatedOutputTokens: number
  maxAllowedModelCalls: number
  maxAllowedTokens: number
  toolSet: string[]
  prunedTools: string[]
}

export interface ModelSelection {
  tier: string
  provider: string
  modelId: string
  reasoning: string
  budget: TaskBudget
  estimatedTokens: number
  estimatedDuration: number
}

interface _ScoredModel {
  provider: string
  modelId: string
  tier: string
  score: number
  reasoning: string[]
}

// ─── Complexity weights ────────────────────────────────────────────

// Complexity → model tier mapping for the DYNAMIC WORKER ENGINE (multi-model).
// This is the engine's own source of truth for per-scenario tier selection and
// must not be coupled to the council add-on's separate mapping.
const COMPLEXITY_TOKEN_ESTIMATE: Record<string, { input: number; output: number }> = {
  low: { input: 500, output: 500 },
  medium: { input: 2000, output: 1500 },
  high: { input: 5000, output: 3000 },
  critical: { input: 8000, output: 5000 },
}

// ─── ModelSelector ─────────────────────────────────────────────────

export class ModelSelector {
  private capabilities: ModelCapabilities
  private budgetPolicy: BudgetPolicy
  private config: UltimatrixConfig
  private providerUsedByBrain: string | null = null
  private successHistory: Map<string, number> = new Map()

  constructor(capabilities: ModelCapabilities | undefined, budgetPolicy: BudgetPolicy | undefined, config: UltimatrixConfig) {
    this.capabilities = capabilities ?? {}
    this.budgetPolicy = budgetPolicy ?? DEFAULTS.budgetPolicy
    this.config = config
  }

  setBrainProvider(provider: string): void {
    this.providerUsedByBrain = provider
  }

  recordSuccess(provider: string, modelId: string): void {
    const key = `${provider}/${modelId}`
    const prev = this.successHistory.get(key) ?? 0
    this.successHistory.set(key, prev + 1)
  }

  recordFailure(provider: string, modelId: string): void {
    const key = `${provider}/${modelId}`
    const prev = this.successHistory.get(key) ?? 0
    this.successHistory.set(key, Math.max(0, prev - 1))
  }

  selectForTask(task: WorkerTask, agentRole: ModelRole): ModelSelection {
    const budget = this.calculateBudget(task, agentRole)
    const explicit = this.selectConfiguredRoleModel(task, agentRole, budget)
    if (explicit) return explicit

    const candidates = this.getAvailableModels()

    if (candidates.length === 0) {
      return this.fallbackSelection(task, agentRole)
    }

    const scored = candidates.map(c => ({
      ...c,
      score: this.scoreModel(c, task, budget),
      reasoning: this.getScoreReasons(c, task, budget),
    }))

    scored.sort((a, b) => b.score - a.score)
    const best = scored[0]

    if (best.score <= 0) {
      return this.fallbackSelection(task, agentRole)
    }

    const _cap = this.capabilities[best.modelId] ?? this.capabilities[best.modelId.replace(best.provider + '/', '')]
    const estimatedTokens = COMPLEXITY_TOKEN_ESTIMATE[task.complexity] ?? COMPLEXITY_TOKEN_ESTIMATE.medium

    return {
      tier: best.tier,
      provider: best.provider,
      modelId: best.modelId,
      reasoning: best.reasoning.join('; '),
      budget,
      estimatedTokens: estimatedTokens.input + estimatedTokens.output,
      estimatedDuration: this.estimateDuration(best.provider, estimatedTokens.input + estimatedTokens.output),
    }
  }

  selectTierForSkill(skillId: string, taskComplexity: string): string {
    // Default: map complexity to tier
    return COMPLEXITY_TIER_MAP[taskComplexity as keyof typeof COMPLEXITY_TIER_MAP] ?? 'balanced'
  }

  explainSelection(selection: ModelSelection, task: WorkerTask): string {
    return `Selected ${selection.modelId} (${selection.tier}) for ${task.complexity} complexity task "${task.skillId}": ${selection.reasoning}`
  }

  private selectConfiguredRoleModel(
    task: WorkerTask,
    agentRole: ModelRole,
    budget: TaskBudget,
  ): ModelSelection | undefined {
    if (
      (agentRole === 'brain' && !this.config.modelRoles?.brain)
      || (agentRole === 'spider' && !this.config.modelRoles?.spider)
      || (agentRole === 'crawlSummarizer' && !this.config.modelRoles?.crawlSummarizer)
      || (agentRole === 'verifier' && !this.config.modelRoles?.verifier)
      || (agentRole === 'reporter' && !this.config.modelRoles?.reporter)
      || (agentRole === 'council' && !this.config.modelRoles?.council)
      || (agentRole === 'worker' && !this.config.modelRoles?.worker?.[task.complexity])
    ) {
      return undefined
    }

    const route = resolveModelRef(this.config, { role: agentRole, complexity: task.complexity })
    const estimatedTokens = COMPLEXITY_TOKEN_ESTIMATE[task.complexity] ?? COMPLEXITY_TOKEN_ESTIMATE.medium
    const cap = this.capabilities[route.modelId] ?? this.capabilities[route.model]
    const capReason = cap
      ? `context ${cap.contextWindow}, max output ${route.maxOutputTokens ?? cap.maxOutputTokens}`
      : route.maxOutputTokens
        ? `max output ${route.maxOutputTokens}`
        : 'no capability data'

    return {
      tier: route.tier,
      provider: route.provider,
      modelId: route.modelId,
      reasoning: `${route.reason}; ${task.complexity} complexity maps to ${route.tier}; ${capReason}`,
      budget,
      estimatedTokens: estimatedTokens.input + estimatedTokens.output,
      estimatedDuration: this.estimateDuration(route.provider, estimatedTokens.input + estimatedTokens.output),
    }
  }

  // ─── Scoring ────────────────────────────────────────────────────

  private scoreModel(
    candidate: { provider: string; modelId: string; tier: string },
    task: WorkerTask,
    _budget: TaskBudget,
  ): number {
    let score = 0
    // Look up capabilities by full modelId, or try provider-prefixed version.
    // Tier-only candidates (from config.modelTiers) have no capability entry —
    // they are still scored on deterministic signals (alignment, rate-limit,
    // diversity) so the explicit tier config is actually used instead of
    // falling back to config.model with a cosmetic tier label.
    const cap = this.capabilities[candidate.modelId] ?? this.capabilities[candidate.modelId.replace(candidate.provider + '/', '')]

    // Capability match: +20 per matching strength
    if (cap && task.requiredCapabilities) {
      for (const req of task.requiredCapabilities) {
        if (cap.strengths.includes(req)) score += 20
      }
    }

    // Context headroom: +10 if >20k, +5 if >5k (only when capability data exists)
    if (cap) {
      const estInput = COMPLEXITY_TOKEN_ESTIMATE[task.complexity]?.input ?? 2000
      const headroom = cap.contextWindow - estInput
      if (headroom > 20_000) score += 10
      else if (headroom > 5_000) score += 5
    }

    // Rate limit headroom: +10 if RPM available > estimated × 2
    const limiter = createProviderLimiter(candidate.provider, this.config)
    const available = limiter.getAvailable()
    if (available > 10) score += 10
    else if (available > 5) score += 5

    // Exhaustion penalty: -30 if provider is in cooldown
    const quotaTracker = getGlobalQuotaTracker()
    if (quotaTracker.isExhausted(candidate.provider)) score -= 30

    // Complexity alignment: +15 if model complexity matches task
    const expectedTier = COMPLEXITY_TIER_MAP[task.complexity]
    if (candidate.tier === expectedTier) score += 15

    // Provider diversity: +5 if not used by brain
    if (candidate.provider !== this.providerUsedByBrain) score += 5

    // Empirical success rate: +0-20
    const key = `${candidate.provider}/${candidate.modelId}`
    const successes = this.successHistory.get(key) ?? 0
    score += Math.min(20, successes * 5)

    return score
  }

  private getScoreReasons(
    candidate: { provider: string; modelId: string; tier: string },
    task: WorkerTask,
    _budget: TaskBudget,
  ): string[] {
    const reasons: string[] = []
    const cap = this.capabilities[candidate.modelId] ?? this.capabilities[candidate.modelId.replace(candidate.provider + '/', '')]
    if (!cap) return ['no capability data']

    if (task.requiredCapabilities) {
      const matches = task.requiredCapabilities.filter(r => cap.strengths.includes(r))
      if (matches.length > 0) reasons.push(`capabilities: ${matches.join(', ')}`)
    }

    const estInput = COMPLEXITY_TOKEN_ESTIMATE[task.complexity]?.input ?? 2000
    const headroom = cap.contextWindow - estInput
    if (headroom > 5_000) reasons.push(`context headroom: ${headroom}`)

    const expectedTier = COMPLEXITY_TIER_MAP[task.complexity]
    if (candidate.tier === expectedTier) reasons.push(`complexity match: ${candidate.tier}`)

    if (candidate.provider !== this.providerUsedByBrain) reasons.push('provider diversity')

    const quotaTracker = getGlobalQuotaTracker()
    if (quotaTracker.isExhausted(candidate.provider)) reasons.push('EXHAUSTED (penalized)')

    return reasons
  }

  // ─── Budget ─────────────────────────────────────────────────────

  private calculateBudget(task: WorkerTask, agentRole: ModelRole): TaskBudget {
    // Config uses plural keys: 'workers' not 'worker'
    const allocationKey = agentRole === 'worker' ? 'workers' : agentRole === 'crawlSummarizer' ? 'spider' : agentRole
    const allocation = this.budgetPolicy.allocation[allocationKey as keyof typeof this.budgetPolicy.allocation] ?? 0.3
    const maxModelCalls = Math.floor(this.budgetPolicy.maxModelCallsPerTask * allocation)
    const maxTokens = this.budgetPolicy.maxTokensPerSession
      ? Math.floor(this.budgetPolicy.maxTokensPerSession * allocation)
      : Infinity

    const estInput = COMPLEXITY_TOKEN_ESTIMATE[task.complexity]?.input ?? 2000
    const estOutput = COMPLEXITY_TOKEN_ESTIMATE[task.complexity]?.output ?? 1500

    return {
      estimatedModelCalls: maxModelCalls,
      estimatedInputTokens: estInput,
      estimatedOutputTokens: estOutput,
      maxAllowedModelCalls: maxModelCalls,
      maxAllowedTokens: maxTokens,
      toolSet: [],
      prunedTools: [],
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────

  private getAvailableModels(): Array<{ provider: string; modelId: string; tier: string }> {
    const result: Array<{ provider: string; modelId: string; tier: string }> = []
    const creds = this.config.creds

    for (const [modelId, cap] of Object.entries(this.capabilities)) {
      let provider: string
      let fullModelId: string

      const slashIdx = modelId.indexOf('/')
      if (slashIdx === -1) {
        // No provider prefix — use the primary provider from config
        provider = this.config.provider
        fullModelId = `${provider}/${modelId}`
      } else {
        provider = modelId.slice(0, slashIdx)
        fullModelId = modelId
      }

      // Resolve aliases (e.g., "groq-free" → "groq")
      const baseProvider = resolveProviderAlias(provider)

      // Check creds for either the original or base provider
      if (creds[provider] || creds[baseProvider]) {
        const tier = this.inferTier(cap.contextWindow)
        result.push({ provider: baseProvider, modelId: fullModelId, tier })
      }
    }

    // Deterministic tier→model mapping from explicit config (single source of truth
    // for the user's configured tiers). A model-id present here is always a
    // usable candidate, so the powerful tier is actually reachable instead of
    // being a cosmetic label when modelCapabilities is unset.
    const tiers = this.config.modelTiers
    if (tiers) {
      for (const t of ['fast', 'balanced', 'powerful'] as const) {
        const tc = (tiers as Record<string, { provider?: string; model?: string } | undefined>)[t]
        if (!tc?.model) continue
        const modelId = String(tc.model).includes('/')
          ? String(tc.model)
          : `${tc.provider}/${tc.model}`
        if (!result.some(r => r.modelId === modelId)) {
          result.push({ provider: tc.provider ?? this.config.provider, modelId, tier: t })
        }
      }
    }
    return result
  }

  private inferTier(contextWindow: number): string {
    if (contextWindow <= 8192) return 'fast'
    if (contextWindow <= 32000) return 'balanced'
    return 'powerful'
  }

  private fallbackSelection(task: WorkerTask, agentRole: ModelRole): ModelSelection {
    const budget = this.calculateBudget(task, agentRole)
    const provider = this.config.provider
    const modelId = this.config.model

    return {
      tier: COMPLEXITY_TIER_MAP[task.complexity] ?? 'balanced',
      provider,
      modelId,
      reasoning: 'Fallback: using default config model (no suitable candidate found)',
      budget,
      estimatedTokens: 2000,
      estimatedDuration: 5000,
    }
  }

  private estimateDuration(provider: string, totalTokens: number): number {
    // Rough heuristic: tokens per second varies by provider
    const tps: Record<string, number> = {
      groq: 200,
      openai: 100,
      anthropic: 80,
      google: 150,
      nvidia: 120,
    }
    const tokensPerSec = tps[provider] ?? 100
    return Math.round((totalTokens / tokensPerSec) * 1000)
  }
}
