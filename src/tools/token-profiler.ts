import type { ToolTokenProfile } from '../config'

export interface ToolExecutionResult {
  toolId: string
  modelCalls: number
  inputTokens: number
  outputTokens: number
  externalApiCalls: number
  durationMs: number
  success: boolean
  modelId?: string
  skillId?: string
}

interface ToolProfileInternal {
  avgModelCalls: number
  avgInputTokens: number
  avgOutputTokens: number
  sampleCount: number
  lastUpdated: string
}

const DEFAULT_PROFILES: Record<string, Partial<ToolTokenProfile>> = {
  httpRequest: { avgModelCalls: 1.5, avgInputTokens: 800, avgOutputTokens: 400 },
  checkWaf: { avgModelCalls: 2.0, avgInputTokens: 1200, avgOutputTokens: 600 },
  measureTiming: { avgModelCalls: 1.2, avgInputTokens: 600, avgOutputTokens: 300 },
  evaluateRendered: { avgModelCalls: 1.8, avgInputTokens: 2000, avgOutputTokens: 800 },
  stagehand_navigate: { avgModelCalls: 1.0, avgInputTokens: 400, avgOutputTokens: 200 },
  stagehand_act: { avgModelCalls: 1.3, avgInputTokens: 600, avgOutputTokens: 300 },
  writeFinding: { avgModelCalls: 1.0, avgInputTokens: 500, avgOutputTokens: 300 },
  queryGraph: { avgModelCalls: 1.0, avgInputTokens: 300, avgOutputTokens: 200 },
  spawnWorker: { avgModelCalls: 2.5, avgInputTokens: 1500, avgOutputTokens: 800 },
  executeDirect: { avgModelCalls: 1.0, avgInputTokens: 400, avgOutputTokens: 200 },
}

/**
 * Tracks empirical token usage per tool via Exponential Moving Average.
 * Falls back to heuristic defaults when no empirical data exists.
 */
export class TokenProfiler {
  private profiles = new Map<string, ToolProfileInternal>()

  recordExecution(result: ToolExecutionResult): void {
    const existing = this.profiles.get(result.toolId)
    const alpha = 0.3 // EMA smoothing factor

    if (existing) {
      existing.avgModelCalls = existing.avgModelCalls * (1 - alpha) + result.modelCalls * alpha
      existing.avgInputTokens = existing.avgInputTokens * (1 - alpha) + result.inputTokens * alpha
      existing.avgOutputTokens = existing.avgOutputTokens * (1 - alpha) + result.outputTokens * alpha
      existing.sampleCount++
      existing.lastUpdated = new Date().toISOString()
    } else {
      this.profiles.set(result.toolId, {
        avgModelCalls: result.modelCalls,
        avgInputTokens: result.inputTokens,
        avgOutputTokens: result.outputTokens,
        sampleCount: 1,
        lastUpdated: new Date().toISOString(),
      })
    }
  }

  getProfile(toolId: string): ToolTokenProfile {
    const internal = this.profiles.get(toolId)
    if (internal) {
      return {
        toolId,
        avgModelCalls: internal.avgModelCalls,
        avgInputTokens: internal.avgInputTokens,
        avgOutputTokens: internal.avgOutputTokens,
        lastUpdated: internal.lastUpdated,
        sampleCount: internal.sampleCount,
        estimated: false,
      }
    }

    return this.getDefaultProfile(toolId)
  }

  getDefaultProfile(toolId: string): ToolTokenProfile {
    const defaults = DEFAULT_PROFILES[toolId]
    return {
      toolId,
      avgModelCalls: defaults?.avgModelCalls ?? 1.0,
      avgInputTokens: defaults?.avgInputTokens ?? 500,
      avgOutputTokens: defaults?.avgOutputTokens ?? 300,
      lastUpdated: '',
      sampleCount: 0,
      estimated: true,
    }
  }

  getAllProfiles(): ToolTokenProfile[] {
    const result: ToolTokenProfile[] = []
    for (const [toolId] of this.profiles) {
      result.push(this.getProfile(toolId))
    }
    // Also include default profiles for known tools
    for (const toolId of Object.keys(DEFAULT_PROFILES)) {
      if (!this.profiles.has(toolId)) {
        result.push(this.getDefaultProfile(toolId))
      }
    }
    return result
  }

  getModelSuccessRate(_modelId: string, _skillId: string): number {
    return 0.5 // Default 50% success rate (no historical data yet)
  }

  persist(): Record<string, ToolProfileInternal> {
    const result: Record<string, ToolProfileInternal> = {}
    for (const [k, v] of this.profiles) {
      result[k] = { ...v }
    }
    return result
  }

  load(data: Record<string, ToolProfileInternal>): void {
    this.profiles.clear()
    for (const [k, v] of Object.entries(data)) {
      this.profiles.set(k, { ...v })
    }
  }

  reset(): void {
    this.profiles.clear()
  }
}
