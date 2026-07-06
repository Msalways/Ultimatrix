import { compress } from 'headroom-ai'
import type { UltimatrixConfig } from '../config'
import { log } from '../utils/logger'

export interface CompressionResult {
  compressed: string
  wasCompressed: boolean
  wasTruncated: boolean
  compressionRatio: number
  tokensSaved?: number
  originalSize: number
  compressedSize: number
  error?: string
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

  constructor(config?: UltimatrixConfig, options?: CompressionOptions) {
    const cfg = config?.compression?.headroom ?? {}
    this.maxResponseSize = options?.maxResponseSize
      ?? cfg.maxResponseSize
      ?? config?.truncation?.maxResponseSize
      ?? DEFAULT_MAX_RESPONSE_SIZE
    this.headroomBudget = options?.tokenBudget ?? cfg.tokenBudget ?? DEFAULT_HEADROOM_BUDGET
    this.fallbackToTruncation = options?.fallbackToTruncation ?? cfg.fallbackToTruncation ?? true
    this.model = options?.model ?? cfg.model ?? DEFAULT_MODEL
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

    if (originalSize > this.maxResponseSize) {
      if (this.fallbackToTruncation) {
        log.dim(`[compression] ${originalSize} chars exceeds limit ${this.maxResponseSize}, truncating`)
        return this.truncateResponse(response)
      }
      return {
        compressed: response,
        wasCompressed: false,
        wasTruncated: false,
        compressionRatio: 1,
        originalSize,
        compressedSize: originalSize,
      }
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

      const compressedSize = result.messages.reduce((total, msg) => total + msg.content.length, 0)
      const compressionRatio = compressedSize / originalSize
      const tokensSaved = result.tokensBefore - result.tokensAfter

      log.dim(`[compression] ${originalSize} → ${compressedSize} chars (${(compressionRatio * 100).toFixed(1)}%), saved ${tokensSaved} tokens`)

      return {
        compressed: JSON.stringify(result.messages),
        wasCompressed: true,
        wasTruncated: false,
        compressionRatio,
        tokensSaved,
        originalSize,
        compressedSize,
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      log.dim(`[compression] Headroom failed: ${errMsg}`)

      if (this.fallbackToTruncation) {
        return this.truncateResponse(response)
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

  private truncateResponse(response: string): CompressionResult {
    const originalSize = response.length
    const limit = this.maxResponseSize

    if (originalSize <= limit) {
      return {
        compressed: response,
        wasCompressed: false,
        wasTruncated: false,
        compressionRatio: 1,
        originalSize,
        compressedSize: originalSize,
      }
    }

    const truncated = response.slice(0, limit)
    const suffix = `\n\n[truncated — showing first ${limit} of ${originalSize} chars total]`

    return {
      compressed: truncated + suffix,
      wasCompressed: false,
      wasTruncated: true,
      compressionRatio: (truncated.length + suffix.length) / originalSize,
      originalSize,
      compressedSize: truncated.length + suffix.length,
    }
  }
}
