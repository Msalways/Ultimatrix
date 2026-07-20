import { compress } from 'headroom-ai'
import type { UltimatrixConfig } from '../config'
import { log } from '../utils/logger'
import { wrapHeadroomResult, compactText, type CompactionResult } from '../output/compaction'

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
const DEFAULT_HEADROOM_BUDGET = 100_000
const DEFAULT_MODEL = 'gpt-4o'
const MIN_SIZE_TO_COMPRESS = 1_000

export class CompressionService {
  private maxResponseSize: number
  private headroomBudget: number
  private fallbackToTruncation: boolean
  private model: string
  private enabled: boolean

  constructor(config?: UltimatrixConfig, options?: CompressionOptions) {
    const cfg = config?.compression?.headroom ?? {}
    this.maxResponseSize = options?.maxResponseSize
      ?? cfg.maxResponseSize
      ?? config?.truncation?.maxResponseSize
      ?? DEFAULT_MAX_RESPONSE_SIZE
    this.headroomBudget = options?.tokenBudget ?? cfg.tokenBudget ?? DEFAULT_HEADROOM_BUDGET
    this.fallbackToTruncation = options?.fallbackToTruncation ?? cfg.fallbackToTruncation ?? true
    this.model = options?.model ?? cfg.model ?? DEFAULT_MODEL
    this.enabled = cfg.enabled ?? true
  }

  /**
   * Extract plain text from Headroom's returned messages (never an envelope).
   * Headroom returns OpenAIMessage[] with `.content` (string or parts).
   */
  private extractText(messages: Array<{ content?: unknown }>): string {
    const parts: string[] = []
    for (const m of messages) {
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

  async compressResponse(response: string): Promise<CompressionResult> {
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

    // Hard cap: if the response exceeds the max we will ever handle, the
    // local section-aware compaction (or truncation fallback) takes over.
    if (originalSize > this.maxResponseSize) {
      if (this.enabled && this.fallbackToTruncation) {
        log.dim(`[compression] ${originalSize} chars exceeds limit ${this.maxResponseSize}, compacting`)
        return this.compactOrTruncate(response)
      }
      return this.compactOrTruncate(response)
    }

    // Headroom disabled (or no key) → local compaction, no network call.
    if (!this.enabled) {
      return this.compactOrTruncate(response)
    }

    try {
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
        model: this.model,
        tokenBudget: this.headroomBudget,
      })

      const compressedText = this.extractText(result.messages)
      const compressedSize = compressedText.length
      const compressionRatio = compressedSize / originalSize
      const tokensSaved = result.tokensBefore - result.tokensAfter

      log.dim(`[compression] ${originalSize} → ${compressedSize} chars (${(compressionRatio * 100).toFixed(1)}%), saved ${tokensSaved} tokens`)

      const compaction = wrapHeadroomResult(response, compressedText)
      return {
        compressed: compressedText,
        wasCompressed: true,
        wasTruncated: false,
        compressionRatio,
        tokensSaved,
        originalSize,
        compressedSize,
        compaction,
      }
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
    const tokenBudget = Math.max(1, Math.floor(this.maxResponseSize / 4))
    const res = compactText(response, { tokenBudget, strategy: 'section-aware' })
    return {
      compressed: res.text,
      wasCompressed: false,
      wasTruncated: res.compacted,
      compressionRatio: res.text.length / response.length || 1,
      originalSize: response.length,
      compressedSize: res.text.length,
      compaction: res,
      error,
    }
  }
}
