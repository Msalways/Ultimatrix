import { compress } from 'headroom-ai'
import type { UltimatrixConfig } from '../config'
import { log } from '../utils/logger'
import { wrapHeadroomResult, compactText, type CompactionResult } from '../output/compaction'
import { ContextWindowRegistry } from '../models/context-window-registry'

export interface CompressionResult {
  /** Plain-text compressed output (NEVER an SDK envelope). */
  compressed: string
  wasCompressed: boolean
  wasTruncated: boolean
  compressionRatio: number
  tokensSaved?: number
  originalSize: number
  compressedSize: number
  error?: string
  /** Provenance of any omitted content. */
  compaction?: CompactionResult
}

export interface CompressionOptions {
  tokenBudget?: number
  maxResponseSize?: number
  fallbackToTruncation?: boolean
  model?: string
}

const DEFAULT_MAX_RESPONSE_SIZE = 50_000
const DEFAULT_MODEL = 'gpt-4o'
const MIN_SIZE_TO_COMPRESS = 1_000
/** Per-response budget as fraction of context window (10%). */
const RESPONSE_BUDGET_FRACTION = 0.10

// ─── Singleton ───────────────────────────────────────────────────────────

let _singleton: CompressionService | null = null
let _singletonConfigHash = ''

/**
 * Module-level singleton. Reuses the same instance when config hasn't changed.
 * Config change is detected by hashing the relevant fields.
 */
export function getCompressionService(config?: UltimatrixConfig): CompressionService {
  const hash = config
    ? `${config.compression?.headroom?.enabled ?? false}:${config.compression?.headroom?.maxResponseSize ?? 50000}:${config.truncation?.maxResponseSize ?? 50000}`
    : 'default'
  if (!_singleton || _singletonConfigHash !== hash) {
    _singleton = new CompressionService(config)
    _singletonConfigHash = hash
  }
  return _singleton
}

/** Reset singleton (for tests). */
export function resetCompressionService(): void {
  _singleton = null
  _singletonConfigHash = ''
}

// ─── Service ─────────────────────────────────────────────────────────────

export class CompressionService {
  private maxResponseSize: number
  private fallbackToTruncation: boolean
  private model: string
  private enabled: boolean
  private config?: UltimatrixConfig

  constructor(config?: UltimatrixConfig, options?: CompressionOptions) {
    const cfg = config?.compression?.headroom ?? {}
    this.maxResponseSize = options?.maxResponseSize
      ?? cfg.maxResponseSize
      ?? config?.truncation?.maxResponseSize
      ?? DEFAULT_MAX_RESPONSE_SIZE
    this.fallbackToTruncation = options?.fallbackToTruncation ?? cfg.fallbackToTruncation ?? true
    this.model = options?.model ?? cfg.model ?? DEFAULT_MODEL
    this.enabled = cfg.enabled ?? false
    this.config = config
  }

  /**
   * Resolve per-response token budget from the model's context window.
   * Returns 10% of context window, or a sensible default if the model is unknown.
   */
  private resolveTokenBudget(): number {
    if (!this.config) return Math.floor(this.maxResponseSize / 4)
    const registry = new ContextWindowRegistry(this.config)
    const contextWindow = registry.getContextWindow(this.model)
    if (contextWindow > 0) {
      return Math.floor(contextWindow * RESPONSE_BUDGET_FRACTION)
    }
    // Unknown model — fall back to a reasonable char-based estimate
    return Math.floor(this.maxResponseSize / 4)
  }

  /**
   * Extract tool response text from Headroom's returned messages.
   * Only extracts from role='tool' messages, never from system prompts.
   */
  private extractToolResponse(messages: Array<{ role?: string; content?: unknown }>): string {
    const parts: string[] = []
    for (const m of messages) {
      // Only extract from tool messages — skip system/user/assistant
      if (m.role !== 'tool') continue
      const c = m.content
      if (typeof c === 'string') parts.push(c)
      else if (Array.isArray(c)) {
        for (const p of c) {
          if (p && typeof p === 'object' && 'text' in p && typeof (p as { text: unknown }).text === 'string') {
            parts.push((p as { text: string }).text)
          }
        }
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Never-expand invariant: if compressed output is larger than the input,
   * return the original unchanged. Compression must always reduce size.
   */
  private enforceNeverExpand(original: string, compressed: string, result: CompressionResult): CompressionResult {
    if (compressed.length >= original.length) {
      log.dim(`[compression] never-expand: ${compressed.length} >= ${original.length}, returning original`)
      return {
        compressed: original,
        wasCompressed: false,
        wasTruncated: false,
        compressionRatio: 1,
        originalSize: original.length,
        compressedSize: original.length,
        error: result.error,
      }
    }
    return result
  }

  async compressResponse(response: string, modelOverride?: string): Promise<CompressionResult> {
    const originalSize = response.length

    if (originalSize < MIN_SIZE_TO_COMPRESS) {
      return {
        compressed: response,
        wasCompressed: false,
        wasTruncated: false,
        compressionRatio: 1,
        originalSize,
        compressedSize: originalSize,
      }
    }

    // Use model override if provided (from tool call sites that know the model)
    const effectiveModel = modelOverride ?? this.model

    // Hard cap: if the response exceeds the max we will ever handle, the
    // local section-aware compaction (or truncation fallback) takes over.
    if (originalSize > this.maxResponseSize) {
      log.dim(`[compression] ${originalSize} chars exceeds limit ${this.maxResponseSize}, compacting`)
      return this.compactOrTruncate(response)
    }

    // Headroom disabled (or no key) → local compaction, no network call.
    if (!this.enabled) {
      return this.compactOrTruncate(response)
    }

    try {
      const tokenBudget = this.resolveTokenBudget()
      const messages = [
        {
          role: 'system' as const,
          content: 'You are analyzing security testing results. Preserve all important information including errors, anomalies, and security findings.',
        },
        {
          role: 'tool' as const,
          content: response,
          tool_call_id: 'security_test_result',
        },
      ]

      const result = await compress(messages, {
        model: effectiveModel,
        tokenBudget,
      })

      // Extract ONLY from tool messages — never from system prompt
      const compressedText = this.extractToolResponse(result.messages)

      // If extractToolResponse found nothing (all messages were system), fall back
      if (!compressedText) {
        log.dim(`[compression] extractToolResponse found no tool messages, falling back`)
        return this.compactOrTruncate(response)
      }

      const compressedSize = compressedText.length
      const compressionRatio = compressedSize / originalSize
      const tokensSaved = result.tokensBefore - result.tokensAfter

      log.dim(`[compression] ${originalSize} → ${compressedSize} chars (${(compressionRatio * 100).toFixed(1)}%), saved ${tokensSaved} tokens`)

      const compaction = wrapHeadroomResult(response, compressedText)
      const rawResult: CompressionResult = {
        compressed: compressedText,
        wasCompressed: true,
        wasTruncated: false,
        compressionRatio,
        tokensSaved,
        originalSize,
        compressedSize,
        compaction,
      }

      // Never-expand invariant
      return this.enforceNeverExpand(response, compressedText, rawResult)
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.dim(`[compression] Headroom failed: ${errMsg}`)

      if (this.fallbackToTruncation) {
        return this.compactOrTruncate(response, errMsg)
      }

      return {
        compressed: response,
        wasCompressed: false,
        wasTruncated: false,
        compressionRatio: 1,
        originalSize,
        compressedSize: originalSize,
        error: errMsg,
      }
    }
  }

  /** Local fallback: section-aware compaction targeting the char cap. */
  private compactOrTruncate(response: string, error?: string): CompressionResult {
    const tokenBudget = this.resolveTokenBudget()
    const res = compactText(response, { tokenBudget, strategy: 'section-aware' })
    const result: CompressionResult = {
      compressed: res.text,
      wasCompressed: false,
      wasTruncated: res.compacted,
      compressionRatio: res.text.length / response.length || 1,
      originalSize: response.length,
      compressedSize: res.text.length,
      compaction: res,
      error,
    }
    // Never-expand invariant
    return this.enforceNeverExpand(response, res.text, result)
  }
}
