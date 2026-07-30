import { BudgetAwarePruner, getUniversalTools } from './budget-pruner'
import { TokenProfiler } from './token-profiler'
import type { TaskBudget } from '../models/selector'
import { initSkillIndex } from '../solver/skills/loader'
import { getTechniqueRegistry } from '../skills/technique-registry'

export type { ToolInferenceRule } from '../skills/technique-registry'

/**
 * Dynamically selects tools based on task context, skill matching,
 * keyword inference, and budget constraints.
 */
export class DynamicToolSelector {
  private profiler: TokenProfiler
  private pruner: BudgetAwarePruner

  constructor(profiler?: TokenProfiler) {
    this.profiler = profiler ?? new TokenProfiler()
    this.pruner = new BudgetAwarePruner(this.profiler)
  }

  /**
   * Select tools for a task. If budget is provided, prunes to fit.
   */
  selectTools(
    taskDescription: string,
    skillIds: string[],
    budget?: TaskBudget,
  ): string[] {
    const tools = new Set<string>(getUniversalTools())

    // Add skill-specific tools
    const index = initSkillIndex()
    for (const skillId of skillIds) {
      const meta = index.get(skillId)
      if (meta) {
        for (const t of meta.toolRefs) {
          tools.add(t)
        }
      }
    }

    // Add inferred tools from task description (via registry)
    const inferred = this.inferToolsFromTask(taskDescription)
    for (const t of inferred) {
      tools.add(t)
    }

    let toolList = [...tools]

    // Prune to budget if provided
    if (budget) {
      const { kept, pruned } = this.pruner.pruneToBudget(toolList, budget)
      if (pruned.length > 0) {
        // Pruned tools are still available but lower priority
        toolList = [...kept, ...pruned]
      }
    }

    return toolList
  }

  inferToolsFromTask(taskDescription: string): string[] {
    return getTechniqueRegistry().inferToolsFromTask(taskDescription)
  }

  getUniversalTools(): string[] {
    return getUniversalTools()
  }

  getInferenceRules() {
    return getTechniqueRegistry().getConfig().toolInferenceRules
  }

  getProfiler(): TokenProfiler {
    return this.profiler
  }
}
