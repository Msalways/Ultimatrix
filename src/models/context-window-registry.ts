/**
 * Config-driven model context window registry.
 *
 * Single source of truth for model limits. Resolves from `config.modelCapabilities`
 * (user-configured). Returns null for unknown models — the reactive overflow
 * handler catches those at runtime.
 *
 * No hardcoded model names. No frozen fallback maps.
 */

import type { UltimatrixConfig, ModelCapability } from '../config'

export interface ContextWindowEntry {
  contextWindow: number
  maxOutputTokens: number
  reservedMargin: number
}

const DEFAULT_RESERVED_MARGIN = 1024

export class ContextWindowRegistry {
  private capabilities: Record<string, ModelCapability>

  constructor(config: UltimatrixConfig) {
    this.capabilities = config.modelCapabilities ?? {}
  }

  /**
   * Resolve context window entry for a model.
   * Returns null when the model is not in `modelCapabilities` — the caller
   * should fall back to reactive overflow handling, not assume a default.
   */
  resolve(modelId: string): ContextWindowEntry | null {
    const cap = this.capabilities[modelId]
    if (!cap) return null
    return {
      contextWindow: cap.contextWindow,
      maxOutputTokens: cap.maxOutputTokens,
      reservedMargin: cap.reservedMargin ?? DEFAULT_RESERVED_MARGIN,
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
