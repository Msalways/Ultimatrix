import { BudgetAwarePruner, getUniversalTools } from './budget-pruner'
import { TokenProfiler } from './token-profiler'
import type { TaskBudget } from '../models/selector'
import { loadSkill, getAllSkills } from '../skills/loader'

interface ToolInferenceRule {
  keywords: string[]
  tools: string[]
  priority: 'high' | 'medium' | 'low'
}

const DEFAULT_INFERENCE_RULES: ToolInferenceRule[] = [
  { keywords: ['sqli', 'sql injection', 'blind'], tools: ['checkWaf', 'measureTiming'], priority: 'high' },
  { keywords: ['xss', 'cross-site'], tools: ['evaluateRendered', 'getDialogEvidence'], priority: 'high' },
  { keywords: ['idor', 'access control', 'authorization'], tools: ['findEndpointsInResponse', 'evaluateRendered'], priority: 'high' },
  { keywords: ['ssrf', 'server-side'], tools: ['httpRequest', 'evaluateRendered'], priority: 'medium' },
  { keywords: ['race', 'concurrent'], tools: ['measureTiming', 'compareResponses'], priority: 'medium' },
  { keywords: ['recon', 'reconnaissance', 'enumerate'], tools: ['queryGraph', 'getTargetSummary', 'getEndpointsWithParams'], priority: 'medium' },
  { keywords: ['jwt', 'token', 'auth'], tools: ['getCapturedHeaders', 'encodeDecode'], priority: 'low' },
  { keywords: ['graphql', 'introspection'], tools: ['httpRequest', 'queryGraph'], priority: 'low' },
]

/**
 * Dynamically selects tools based on task context, skill matching,
 * keyword inference, and budget constraints.
 */
export class DynamicToolSelector {
  private profiler: TokenProfiler
  private pruner: BudgetAwarePruner
  private inferenceRules: ToolInferenceRule[]

  constructor(profiler?: TokenProfiler) {
    this.profiler = profiler ?? new TokenProfiler()
    this.pruner = new BudgetAwarePruner(this.profiler)
    this.inferenceRules = DEFAULT_INFERENCE_RULES
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
    for (const skillId of skillIds) {
      const skill = loadSkill(skillId)
      if (skill) {
        for (const t of skill.toolRefs) {
          tools.add(t)
        }
      }
    }

    // Add inferred tools from task description
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
    const input = taskDescription.toLowerCase()
    const tools = new Set<string>()

    // Sort rules: high priority first
    const sorted = [...this.inferenceRules].sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      return priorityOrder[a.priority] - priorityOrder[b.priority]
    })

    for (const rule of sorted) {
      const matched = rule.keywords.some(kw => input.includes(kw))
      if (matched) {
        for (const tool of rule.tools) {
          tools.add(tool)
        }
      }
    }

    return [...tools]
  }

  getUniversalTools(): string[] {
    return getUniversalTools()
  }

  getInferenceRules(): ToolInferenceRule[] {
    return [...this.inferenceRules]
  }

  getProfiler(): TokenProfiler {
    return this.profiler
  }
}

export { DEFAULT_INFERENCE_RULES, type ToolInferenceRule }
