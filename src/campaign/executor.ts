/**
 * Campaign Executor — Phase 2 / T2.4
 *
 * Executes a CampaignPlan with:
 *  - provider-keyed rate limiting via createProviderLimiter
 *  - budget guard from config.budgetPolicy (maxModelCallsPerTask / maxTokensPerSession)
 *  - bounded-concurrency slice execution
 *  - primitive execution through a caller-supplied runner
 *  - persistence of confirmed findings via the existing writeFinding tool
 */

import { DEFAULTS, type UltimatrixConfig, type BudgetPolicy } from '../config'
import { createProviderLimiter } from '../models/limiter-factory'
import type { ProviderAwareLimiter } from '../models/provider-limiter'
import type { GraphStore } from '../graph/store'
import { writeFinding } from '../tools/control-tools'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import { log } from '../utils/logger'
import { planCampaign } from './planner'
import type {
  CampaignPlan,
  CampaignResult,
  CampaignExecutorOptions,
  CampaignSlice,
  CoverageStats,
  Finding,
  PrimitiveRef,
  PrimitiveResult,
  PlanOptions,
  SliceOutcome,
  SliceExecContext,
  WriteFindingTool,
} from './types'

interface BudgetGuard {
  policy: BudgetPolicy
  callsUsed: number
  tokensUsed: number
  exceeded: boolean
}

function makeBudgetGuard(config: UltimatrixConfig): BudgetGuard {
  const policy: BudgetPolicy = config.budgetPolicy ?? (DEFAULTS.budgetPolicy as unknown as BudgetPolicy)
  return { policy, callsUsed: 0, tokensUsed: 0, exceeded: false }
}

/**
 * Execute a campaign plan. Returns a partial CampaignResult (budgetExceeded=true)
 * when the configured budget is exhausted mid-run.
 */
export async function runCampaign(
  plan: CampaignPlan,
  options: CampaignExecutorOptions,
): Promise<CampaignResult> {
  const { graphStore, config } = options
  const provider = options.provider ?? config.provider
  const limiter: ProviderAwareLimiter = createProviderLimiter(provider, config)
  const budget = makeBudgetGuard(config)
  const evidenceGate: EvidenceGate | undefined = options.evidenceGate

  const maxConcurrency =
    options.maxConcurrency ??
    config.rateLimit?.maxConcurrent ??
    DEFAULTS.rateLimit.maxConcurrent

  const findings: Finding[] = []
  const coverage: CoverageStats = { ...plan.coverage, slicesExecuted: 0, slicesConfirmed: 0 }
  let budgetExceeded = false
  let slicesRun = 0

  // Bounded-concurrency slice runner.
  let cursor = 0
  const worker = async (): Promise<void> => {
    while (cursor < plan.slices.length) {
      const slice = plan.slices[cursor++]
      if (budget.exceeded) {
        budgetExceeded = true
        continue
      }
      const outcome = await runSlice(slice, options, graphStore, config, provider, limiter, budget, evidenceGate)
      slicesRun++
      coverage.slicesExecuted++
      if (outcome.confirmed > 0) coverage.slicesConfirmed++
      for (const f of outcome.findings) findings.push(f)
      if (options.onSliceComplete) {
        await options.onSliceComplete(outcome)
      }
      if (budget.exceeded) budgetExceeded = true
    }
  }

  const pool: Promise<void>[] = []
  for (let i = 0; i < Math.max(1, maxConcurrency); i++) pool.push(worker())
  await Promise.all(pool)

  return {
    findings,
    coverage,
    budgetExceeded,
    slicesRun,
  }
}

async function runSlice(
  slice: CampaignSlice,
  options: CampaignExecutorOptions,
  graphStore: GraphStore,
  config: UltimatrixConfig,
  provider: string,
  limiter: ProviderAwareLimiter,
  budget: BudgetGuard,
  evidenceGate: EvidenceGate | undefined,
): Promise<SliceOutcome & { findings: Finding[] }> {
  const results: PrimitiveResult[] = []
  const confirmedFindings: Finding[] = []
  let confirmed = 0

  const ctx: SliceExecContext = {
    slice,
    graphStore,
    config,
    evidenceGate,
    provider,
  }

  for (const primitiveId of slice.techniqueIds) {
    if (budget.exceeded) break

    // Budget guard (scope 'turn'|'session' — a campaign runs as one batch).
    if (budget.policy.maxModelCallsPerTask > 0 && budget.callsUsed >= budget.policy.maxModelCallsPerTask) {
      budget.exceeded = true
      break
    }

    const release = await limiter.acquire()
    try {
      budget.callsUsed++
      const result = await options.executor(primitiveId, slice, ctx)
      if (result.tokensUsed && budget.policy.trackTokens) {
        budget.tokensUsed += result.tokensUsed
        if (budget.policy.maxTokensPerSession && budget.tokensUsed >= budget.policy.maxTokensPerSession) {
          budget.exceeded = true
        }
      }

      results.push(result)

      if (result.confirmed && (result.confidence ?? 0) >= 0.7) {
        confirmed++
        const finding = await persistFinding(slice, result, evidenceGate)
        if (finding) confirmedFindings.push(finding)
      }
    } catch (err) {
      log.warn(`[campaign] primitive ${primitiveId} failed on ${slice.endpoint.url}: ${(err as Error).message}`)
      results.push({
        primitiveId,
        confirmed: false,
        confidence: 0,
        description: `execution error: ${(err as Error).message}`,
      })
    } finally {
      release()
    }
  }

  return { slice, results, confirmed, findings: confirmedFindings, budgetExceeded: budget.exceeded }
}

async function persistFinding(
  slice: CampaignSlice,
  result: PrimitiveResult,
  evidenceGate: EvidenceGate | undefined,
): Promise<Finding | null> {
  if (evidenceGate && result.evidence) {
    for (const e of result.evidence) {
      evidenceGate.recordToolOutput(e.data)
    }
  }

  const args = {
    type: result.title || result.primitiveId,
    endpoint: slice.endpoint.url,
    param: slice.params[0],
    method: slice.endpoint.method,
    payload: result.payload,
    description: result.description,
    severity: result.severity ?? 'medium',
    confidence: result.confidence ?? 0,
    cwe: result.cwe,
  }

  try {
    const out = await (writeFinding as unknown as WriteFindingTool).execute(args as Record<string, unknown>)
    if (out?.ok && out.value) return out.value
  } catch (err) {
    log.warn(`[campaign] writeFinding failed for ${result.primitiveId}: ${(err as Error).message}`)
  }
  return null
}

/**
 * Convenience entry point tying planner + executor together for the solver
 * (Phase 2 / T2.6). Plans from the graph, then executes the plan.
 */
export async function executeCampaign(
  graphStore: GraphStore,
  config: UltimatrixConfig,
  deps: {
    executor: CampaignExecutorOptions['executor']
    primitives: PrimitiveRef[]
    evidenceGate?: EvidenceGate
    onSliceComplete?: CampaignExecutorOptions['onSliceComplete']
    provider?: string
    maxConcurrency?: number
    modelSelector?: CampaignExecutorOptions['modelSelector']
    planOptions?: Partial<PlanOptions>
  },
): Promise<CampaignResult> {
  const plan = planCampaign(graphStore, {
    primitives: deps.primitives,
    ...deps.planOptions,
  })
  return runCampaign(plan, {
    graphStore,
    config,
    executor: deps.executor,
    evidenceGate: deps.evidenceGate,
    onSliceComplete: deps.onSliceComplete,
    provider: deps.provider,
    maxConcurrency: deps.maxConcurrency,
    modelSelector: deps.modelSelector,
  })
}

