/**
 * Council strategy on core — wraps the council orchestrator behind the
 * ExecutionStrategy interface so the runner can invoke it like any other engine.
 *
 * @deprecated This strategy is dead code. The REPL calls debateOnce() directly
 * from session.ts, bypassing the runner entirely.保留 for backward compatibility
 * with any external callers of runSession().
 */

import type { ExecutionStrategy, StrategyContext, RunResult } from '../types'
import { debateOnce } from '../../council/orchestrator'
import { SharedBlackboard } from '../../council/blackboard-shared'
import { ConversationBus } from '../../council/bus'
import type { CouncilMember } from '../../council/types'

export class CouncilStrategy implements ExecutionStrategy {
  async run(ctx: StrategyContext): Promise<RunResult> {
    const { goal, config, services, toolPack, humanApprove, onPhase } = ctx
    const councilConfig = config.council ?? { enabled: true, members: ['strategist', 'operator', 'skeptic', 'analyst', 'human'] as any, maxRounds: 5, budgetPerRound: 20000, approvalMode: 'both' as const }

    // Build council members — the operator gets spawnWorker via extraTools in factory.
    // Stub members are replaced with real factory-created members when the session
    // lifecycle calls createCouncil(). This strategy skeleton proves the interface
    // contract and works with stubs for backward compatibility.
    const blackboard = new SharedBlackboard()
    const bus = new ConversationBus()

    // If the caller passes council members via toolPack, use them.
    // Otherwise fall back to stubs (backward compat).
    const members: CouncilMember[] = (toolPack as any)?.councilMembers ?? [
      {
        role: 'strategist', id: 'council-strategist', tier: 'balanced' as const,
        respond: async () => ({ text: '', intent: 'propose' as const }),
      },
      {
        role: 'operator', id: 'council-operator', tier: 'balanced' as const,
        respond: async () => ({ text: '', intent: 'propose' as const }),
      },
      {
        role: 'skeptic', id: 'council-skeptic', tier: 'balanced' as const,
        respond: async () => ({ text: '', intent: 'propose' as const }),
      },
      {
        role: 'analyst', id: 'council-analyst', tier: 'balanced' as const,
        respond: async () => ({ text: '', intent: 'propose' as const }),
      },
      {
        role: 'human', id: 'council-human', tier: 'balanced' as const,
        respond: async () => ({ text: '', intent: 'propose' as const }),
      },
    ]

    let lastResult: { proposedTasks: any[]; summary: string; complete: boolean } | null = null

    try {
      // Run debate cycles — one per turn, not a blocking loop.
      // The runner calls this once per goal; maxRounds controls how many cycles.
      for (let round = 0; round < (councilConfig.maxRounds ?? 5); round++) {
        lastResult = await debateOnce({
          members,
          bus,
          blackboard,
          goal,
          config: councilConfig,
          ledger: services.evidence,
          humanApprove,
          onPhase: (phase, r, text) => onPhase?.({ phase, round: r, text }),
        })

        if (lastResult.complete) break
      }

      const approved = lastResult?.proposedTasks.length ?? 0
      const rejected = bus.all().filter(m => m.type === 'reject').length

      return {
        completed: true,
        reason: `Council completed (${approved} approved, ${rejected} rejected)`,
        rounds: bus.all().length > 0 ? Math.max(...bus.all().map(m => m.round)) : 0,
        approved,
        rejected,
        facts: services.blackboard.facts.length,
        intents: services.blackboard.intents.length,
        transcript: bus.transcript(),
        messages: bus.all(),
      }
    } catch (err: any) {
      return {
        completed: false,
        reason: `Council error: ${err.message}`,
        error: err.message,
      }
    }
  }
}
