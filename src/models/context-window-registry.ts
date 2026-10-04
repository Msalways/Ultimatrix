/**
 * Resolves model limits from explicit config, then the canonical model registry.
 * Unknown models stay unknown so callers can fail closed.
 */

import type { UltimatrixConfig, ModelCapability } from '../config'
import { getGlobalModelRegistry } from './registry'

export interface ContextWindowEntry {
  contextWindow: number
  maxOutputTokens: number
  reservedMargin: number
}

const DEFAULT_RESERVED_MARGIN = 1024

export class ContextWindowRegistry {
  private capabilities: Record<string, ModelCapability>
  private provider: string

  constructor(config: UltimatrixConfig) {
    this.capabilities = config.modelCapabilities ?? {}
    this.provider = config.provider ?? ''
  }

  /**
   * Resolve context window entry for a model.
   * Config values override the shared model profile. Returns null for unknown
   * models; callers must not guess a context size.
   */
  resolve(modelId: string): ContextWindowEntry | null {
    const slash = modelId.indexOf('/')
    const provider = slash < 0 ? this.provider : modelId.slice(0, slash)
    const model = slash < 0 ? modelId : modelId.slice(slash + 1)
    // Some providers (notably OpenRouter) use a provider-qualified model slug,
    // e.g. `nvidia/model-name`, while the configured provider is `openrouter`.
    // `fullModelId()` preserves that slug, so check the selected route's key
    // before interpreting its first segment as the API provider.
    const routeModelId = this.provider ? `${this.provider}/${modelId}` : modelId
    const cap = this.capabilities[modelId] ?? this.capabilities[routeModelId] ?? this.capabilities[model]
    const profile = cap ? undefined : (
      getGlobalModelRegistry().getProfile(this.provider, modelId) ??
      getGlobalModelRegistry().getProfile(provider, model)
    )
    const contextWindow = cap?.contextWindow ?? profile?.contextWindow
    const maxOutputTokens = cap?.maxOutputTokens ?? profile?.maxOutputTokens
    if (contextWindow == null || maxOutputTokens == null) return null
    return {
      contextWindow,
      maxOutputTokens,
      reservedMargin: cap?.reservedMargin ?? DEFAULT_RESERVED_MARGIN,
    }
  }

  /**
   * Get context window size for a model. Returns 0 when unknown.
   */
  getContextWindow(modelId: string): number {
    return this.resolve(modelId)?.contextWindow ?? 0
  }

  /**
   * Get max output tokens for a model. Returns 0 when unknown.
   */
  getMaxOutput(modelId: string): number {
    return this.resolve(modelId)?.maxOutputTokens ?? 0
  }

  /**
   * Check whether `inputTokens` + `outputTokens` fit within the model's
   * context window (minus reserved margin). Returns false for unknown models.
   */
  fitsInContext(modelId: string, inputTokens: number, outputTokens: number): boolean {
    const entry = this.resolve(modelId)
    if (!entry) return false
    return inputTokens + outputTokens <= entry.contextWindow - entry.reservedMargin
  }
}
