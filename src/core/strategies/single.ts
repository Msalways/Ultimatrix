/**
 * Multi-model (single-agent) strategy on core.
 *
 * @deprecated This strategy is dead code. The REPL calls solve() directly
 * from session.ts, bypassing the runner entirely. Retained for backward
 * compatibility with any external callers of runSession().
 */

import type { ExecutionStrategy, StrategyContext, RunResult } from '../types'

export class SingleAgentStrategy implements ExecutionStrategy {
  async run(ctx: StrategyContext): Promise<RunResult> {
    const { goal, config, services, toolPack, onPhase, memory } = ctx

    // Dynamically import solve() to avoid circular deps at module load time.
    // solver.ts imports from blackboard, evidence-gate, etc. which are safe
    // but we keep the dynamic import for clean separation.
    const { solve } = await import('../../solver/solver')

    try {
      // Build a minimal agent-like object. The solver expects a Mastra Agent
      // with .generate(). For the strategy skeleton, we create a passthrough.
      // The full wiring (T3.2 session routing) creates the real agent.
      const agent = {
        id: 'ultimatrix-solver-brain',
        name: 'Ultimatrix Solver Brain',
        generate: async (prompt: string) => ({ text: prompt }),
      } as any

      const result = await solve(agent, {
        goal,
        origin: config.target ?? '',
        config,
        blackboard: services.blackboard,
        loopDetector: services.loopDetector,
        reflexion: services.reflexion,
        onPhase: onPhase ? (e: any) => onPhase({ phase: e.phase, round: e.step ?? 0, text: e.text }) : undefined,
        ultimatrixConfig: config,
      })

      return {
        completed: result.completed,
        reason: result.reason,
        facts: services.blackboard.facts.length,
        intents: services.blackboard.intents.length,
        planSummary: services.blackboard.planSummary(),
        text: result.text,
        toolCalls: services.blackboard.toolCalls.length,
      }
    } catch (err: any) {
      return {
        completed: false,
        reason: `Solver error: ${err.message}`,
        error: err.message,
      }
    }
  }
}
