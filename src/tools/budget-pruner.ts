import { TokenProfiler } from './token-profiler'
import type { TaskBudget } from '../models/selector'

const ESSENTIAL_TOOLS = new Set([
  'updateGraph',
  'writeFinding',
  'recordEvidence',
  'askUser',
])

const UNIVERSAL_TOOLS = [
  'updateGraph',
  'writeFinding',
  'recordEvidence',
  'askUser',
  'queryGraph',
  'getTargetSummary',
  'encodeDecode',
]

/**
 * Prunes tool sets to fit within a token budget.
 * Essential tools (updateGraph, writeFinding, etc.) are never pruned.
 */
export class BudgetAwarePruner {
  private profiler: TokenProfiler

  constructor(profiler: TokenProfiler) {
    this.profiler = profiler
  }

  pruneToBudget(
    tools: string[],
    budget: TaskBudget,
  ): { kept: string[]; pruned: string[] } {
    const kept: string[] = []
    const pruned: string[] = []

    // Always keep essential tools first
    for (const tool of tools) {
      if (ESSENTIAL_TOOLS.has(tool)) {
        kept.push(tool)
      }
    }

    // Estimate cost for remaining tools
    let totalModelCalls = 0
    const nonEssential = tools.filter(t => !ESSENTIAL_TOOLS.has(t))

    // Sort: universal tools first, then by cost (cheapest first)
    nonEssential.sort((a, b) => {
      const aUniversal = UNIVERSAL_TOOLS.includes(a)
      const bUniversal = UNIVERSAL_TOOLS.includes(b)
      if (aUniversal && !bUniversal) return -1
      if (!aUniversal && bUniversal) return 1

      const aProfile = this.profiler.getProfile(a)
      const bProfile = this.profiler.getProfile(b)
      return aProfile.avgModelCalls - bProfile.avgModelCalls
    })

    for (const tool of nonEssential) {
      const profile = this.profiler.getProfile(tool)
      const projectedCalls = totalModelCalls + profile.avgModelCalls

      if (budget.maxAllowedModelCalls === Infinity || projectedCalls <= budget.maxAllowedModelCalls) {
        kept.push(tool)
        totalModelCalls = projectedCalls
      } else {
        pruned.push(tool)
      }
    }

    return { kept, pruned }
  }

  estimateModelCalls(tools: string[]): number {
    let total = 0
    for (const tool of tools) {
      total += this.profiler.getProfile(tool).avgModelCalls
    }
    return total
  }

  estimateTokens(tools: string[]): { input: number; output: number } {
    let input = 0
    let output = 0
    for (const tool of tools) {
      const profile = this.profiler.getProfile(tool)
      input += profile.avgInputTokens
      output += profile.avgOutputTokens
    }
    return { input, output }
  }
}

export function getUniversalTools(): string[] {
  return [...UNIVERSAL_TOOLS]
}

export function getEssentialTools(): string[] {
  return [...ESSENTIAL_TOOLS]
}
