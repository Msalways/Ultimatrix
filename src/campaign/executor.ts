/** Bounded, resumable execution for planned coverage units. */

import { createHash } from 'node:crypto'
import { DEFAULTS, type UltimatrixConfig } from '../config'
import { NodeType } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { EvidenceGate } from '../intelligence/evidence-gate'
import { writeFinding } from '../tools/control-tools'
import { log } from '../utils/logger'
import { getEngagementServices } from '../runtime/engagement-context'
import { planCampaign } from './planner'
import type {
  CampaignExecutorOptions,
  CampaignPlan,
  CampaignResult,
  CampaignSlice,
  CoverageStatus,
  CoverageUnitResult,
  DomainCoverageResult,
  Finding,
  PlanOptions,
  PrimitiveRef,
  PrimitiveResult,
  SliceExecContext,
  SliceOutcome,
  WriteFindingTool,
} from './types'

const PROGRESS_PREFIX = 'campaign-progress:'
type SavedStatus = Extract<CoverageStatus, 'tested' | 'confirmed' | 'candidate' | 'not_applicable'>
interface ProgressRecord { unitId: string; status: SavedStatus }

function readProgress(store: GraphStore): Map<string, ProgressRecord> {
  const records = new Map<string, ProgressRecord>()
  for (const node of store.queryNodes(NodeType.FACT)) {
    const properties = node.properties as { source?: unknown; description?: unknown }
    if (node.type !== NodeType.FACT || properties.source !== 'campaign' || typeof properties.description !== 'string' || !properties.description.startsWith(PROGRESS_PREFIX)) continue
    try {
      const record = JSON.parse(properties.description.slice(PROGRESS_PREFIX.length)) as ProgressRecord
      if (record.unitId && ['tested', 'confirmed', 'candidate', 'not_applicable'].includes(record.status)) records.set(record.unitId, record)
    } catch { /* A damaged marker is retried safely. */ }
  }
  return records
}

async function persistProgress(store: GraphStore, record: ProgressRecord): Promise<void> {
  const id = `campaign:${createHash('sha256').update(record.unitId).digest('hex').slice(0, 24)}`
  const now = Date.now()
  const prior = store.getNode(id)
  store.upsertNode({
    id,
    type: NodeType.FACT,
    label: `Campaign unit ${record.status}`,
    properties: { description: `${PROGRESS_PREFIX}${JSON.stringify(record)}`, source: 'campaign', confidence: 1 },
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  } as any)
  await store.save()
}

/** Executes real requests with independent request and wall-clock limits. */
export async function runCampaign(plan: CampaignPlan, options: CampaignExecutorOptions): Promise<CampaignResult> {
  const { graphStore, config } = options
  const provider = options.provider ?? config.provider
  const maxRequests = options.maxRequests ?? config.campaign?.maxRequests ?? DEFAULTS.campaign.maxRequests
  const durationMs = options.maxDurationMs ?? config.campaign?.maxDurationMs ?? DEFAULTS.campaign.maxDurationMs
  const startedAt = Date.now()
  const deadline = startedAt + Math.max(1, durationMs)
  let requestsUsed = 0
  let requestLimitReached = false
  let durationLimitReached = false
  let targetBudgetReached = false
  // Slices can share authenticated sessions and mutate application state. Keep
  // their requests ordered; independent discovery workers are parallelized upstream.
  const maxConcurrency = 1
  const savedProgress = readProgress(graphStore)
  const planAlreadyComplete = plan.slices.length > 0 && plan.slices.every(slice => savedProgress.has(slice.id))
  const prior = planAlreadyComplete ? new Map<string, ProgressRecord>() : savedProgress
  const pendingAtStart = plan.slices.filter(slice => !prior.has(slice.id))
  const maxSlices = plan.options.maxSlices && plan.options.maxSlices > 0 ? plan.options.maxSlices : pendingAtStart.length
  const work = pendingAtStart.slice(0, maxSlices)
  const sliceLimitReached = work.length < pendingAtStart.length
  const outcomes = new Map<string, SliceOutcome>()
  const findings: Finding[] = []
  const coverage = { ...plan.coverage, slicesExecuted: 0, slicesConfirmed: 0 }
  let next = 0

  const consumeRequest = (): boolean => {
    if (Date.now() >= deadline) { durationLimitReached = true; return false }
    if (requestsUsed >= maxRequests) { requestLimitReached = true; return false }
    requestsUsed++
    return true
  }
  const hasRequestBudget = () => Date.now() < deadline && requestsUsed < maxRequests
  const remainingMs = () => Math.max(1, deadline - Date.now())
  const onTargetBudgetReached = () => { targetBudgetReached = true; requestLimitReached = true }
  const stop = () => {
    if (Date.now() >= deadline) durationLimitReached = true
    if (requestsUsed >= maxRequests && next < work.length) requestLimitReached = true
    return durationLimitReached || requestLimitReached || targetBudgetReached
  }

  const worker = async (): Promise<void> => {
    while (!stop()) {
      const index = next++
      if (index >= work.length) return
      const slice = work[index]
      const outcome = await runSlice(slice, options, graphStore, config, provider, consumeRequest, hasRequestBudget, remainingMs, onTargetBudgetReached)
      outcomes.set(slice.id, outcome)
      coverage.slicesExecuted++
      if (outcome.confirmed) coverage.slicesConfirmed++
      findings.push(...(outcome.findings ?? []))

      const result = outcome.results[0]
      const status: CoverageStatus = outcome.confirmed
        ? 'confirmed'
        : result?.confirmed
          ? 'candidate'
          : result?.coverageStatus ?? (outcome.budgetExceeded ? 'blocked' : 'tested')
      if (!outcome.budgetExceeded && ['tested', 'confirmed', 'candidate', 'not_applicable'].includes(status)) {
        await persistProgress(graphStore, { unitId: slice.id, status: status as SavedStatus })
      }
      try { await options.onSliceComplete?.(outcome) } catch (error) {
        log.warn(`[campaign] completion feedback failed for ${slice.id}: ${(error as Error).message}`)
      }
    }
  }
  const services = getEngagementServices()
  const previousBudget = services?.campaignRequestBudget
  if (services) services.campaignRequestBudget = consumeRequest
  try {
    await Promise.all(Array.from({ length: maxConcurrency }, () => worker()))
  } finally {
    if (services?.campaignRequestBudget === consumeRequest) services.campaignRequestBudget = previousBudget
  }

  const units = buildUnits(plan.slices, outcomes, prior, requestLimitReached || durationLimitReached || sliceLimitReached)
  const remainingSlices = plan.slices.filter(slice => !prior.has(slice.id) && !isTerminal(outcomes.get(slice.id)))
  const domains = aggregateDomains(plan.domains ?? [], plan.slices, units)
  const budgetExceeded = remainingSlices.length > 0 && (requestLimitReached || durationLimitReached || sliceLimitReached)
  const status = remainingSlices.length > 0 || domains.some(domain => ['blocked', 'skipped', 'candidate'].includes(domain.status))
    ? 'partial'
    : 'complete'
  return { findings, coverage, budgetExceeded, slicesRun: coverage.slicesExecuted, status, requestsUsed, remainingSlices, domains, units }
}

async function runSlice(
  slice: CampaignSlice,
  options: CampaignExecutorOptions,
  graphStore: GraphStore,
  config: UltimatrixConfig,
  provider: string,
  consumeRequest: () => boolean,
  hasRequestBudget: () => boolean,
  remainingMs: () => number,
  onTargetBudgetReached: () => void,
): Promise<SliceOutcome> {
  const results: PrimitiveResult[] = []
  const findings: Finding[] = []
  const persistedPrimitiveIds: string[] = []
  let confirmed = 0
  const ctx: SliceExecContext = {
    slice, graphStore, config, evidenceGate: options.evidenceGate, provider, consumeRequest, hasRequestBudget, remainingMs,
    onTargetBudgetReached,
  }

  for (const primitiveId of slice.techniqueIds) {
    try {
      const result = await options.executor(primitiveId, slice, ctx)
      results.push(result)
      if (!result.confirmed || (result.confidence ?? 0) < 0.7) continue
      const finding = await persistFinding(slice, result, options.evidenceGate)
      if (finding) {
        confirmed++
        findings.push(finding)
        persistedPrimitiveIds.push(primitiveId)
      }
    } catch (error) {
      const reason = `execution error: ${(error as Error).message}`
      log.warn(`[campaign] primitive ${primitiveId} failed on ${slice.endpoint.url}: ${(error as Error).message}`)
      results.push({ primitiveId, confirmed: false, confidence: 0, description: reason, coverageStatus: 'blocked' })
    }
  }
  const budgetExceeded = results.some(result => result.coverageStatus === 'blocked' && /budget|limit/i.test(result.description ?? ''))
  return { slice, results, confirmed, findings, persistedPrimitiveIds, budgetExceeded }
}

function isTerminal(outcome: SliceOutcome | undefined): boolean {
  if (!outcome || outcome.budgetExceeded) return false
  return !outcome.results.some(result => result.coverageStatus === 'blocked' || result.coverageStatus === 'skipped')
}

function buildUnits(
  slices: CampaignSlice[],
  outcomes: Map<string, SliceOutcome>,
  prior: Map<string, ProgressRecord>,
  stopped: boolean,
): CoverageUnitResult[] {
  const units: CoverageUnitResult[] = []
  for (const slice of slices) {
    const outcome = outcomes.get(slice.id)
    const saved = prior.get(slice.id)
    const result = outcome?.results[0]
    const status: CoverageStatus = outcome?.confirmed
      ? 'confirmed'
      : result?.confirmed
        ? 'candidate'
        : result?.coverageStatus
          ?? saved?.status
          ?? (outcome?.budgetExceeded || (!outcome && stopped) ? 'blocked' : outcome ? 'tested' : 'blocked')
    const reason = result?.description ?? (status === 'blocked' ? 'Campaign request or time cap reached before this unit completed.' : undefined)
    for (const domain of slice.domains?.length ? slice.domains : ['unmapped']) {
      units.push({
        id: slice.id,
        domain,
        endpoint: slice.endpoint.url,
        input: { name: slice.input?.name ?? '', location: slice.input?.location ?? 'endpoint' },
        actor: slice.actor ?? slice.role,
        ...(slice.sessionRef ? { sessionRef: slice.sessionRef } : {}),
        state: slice.state,
        technique: slice.techniqueIds[0] ?? 'unknown',
        status,
        ...(reason ? { reason } : {}),
      })
    }
  }
  return units
}

function aggregateDomains(
  initial: DomainCoverageResult[],
  slices: CampaignSlice[],
  units: CoverageUnitResult[],
): DomainCoverageResult[] {
  return initial.map(domain => {
    const domainUnits = units.filter(unit => unit.domain === domain.domain)
    if (!domainUnits.length) return domain
    const statuses = domainUnits.map(unit => unit.status)
    const blocked = statuses.includes('blocked')
    const candidate = statuses.includes('candidate')
    const confirmed = statuses.includes('confirmed')
    const tested = statuses.includes('tested')
    const notApplicable = statuses.every(value => value === 'not_applicable')
    const skipped = statuses.every(value => value === 'skipped')
    const status: CoverageStatus = blocked ? 'blocked' : candidate ? 'candidate' : confirmed ? 'confirmed' : tested ? 'tested' : notApplicable ? 'not_applicable' : skipped ? 'skipped' : 'tested'
    return {
      domain: domain.domain,
      status,
      unitsPlanned: slices.filter(slice => slice.domains?.includes(domain.domain)).length,
      unitsCompleted: statuses.filter(value => ['tested', 'confirmed', 'candidate'].includes(value)).length,
      ...(blocked
        ? { reason: domainUnits.find(unit => unit.status === 'blocked')?.reason ?? 'One or more coverage prerequisites are missing.' }
        : candidate
          ? { reason: 'Positive signal remains a candidate pending proven experiment and independent retest.' }
          : notApplicable
            ? { reason: 'All planned units were not applicable to the discovered target surface.' }
            : skipped
              ? { reason: 'All planned units were skipped before testing.' }
              : undefined),
    }
  })
}

async function persistFinding(slice: CampaignSlice, result: PrimitiveResult, evidenceGate?: EvidenceGate): Promise<Finding | null> {
  if (evidenceGate && result.evidence) for (const evidence of result.evidence) evidenceGate.recordToolOutput(evidence.data)
  const args = {
    type: result.title || result.primitiveId,
    endpoint: slice.endpoint.url,
    param: slice.input?.name || slice.params[0],
    method: slice.endpoint.method,
    payload: result.payload,
    description: result.description,
    severity: result.severity ?? 'medium',
    confidence: result.confidence ?? 0,
    cwe: result.cwe,
    ...(Array.isArray((result as any).experimentIds) ? { experimentIds: (result as any).experimentIds } : {}),
  }
  try {
    const out = await (writeFinding as unknown as WriteFindingTool).execute(args as Record<string, unknown>)
    return out?.ok ? out.value ?? null : null
  } catch (error) {
    log.warn(`[campaign] writeFinding failed for ${result.primitiveId}: ${(error as Error).message}`)
    return null
  }
}

/** Plan and execute a campaign from the current graph. */
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
    maxRequests?: number
    maxDurationMs?: number
    modelSelector?: CampaignExecutorOptions['modelSelector']
    planOptions?: Partial<PlanOptions>
  },
): Promise<CampaignResult> {
  const plan = planCampaign(graphStore, { primitives: deps.primitives, ...deps.planOptions })
  return runCampaign(plan, {
    graphStore,
    config,
    executor: deps.executor,
    evidenceGate: deps.evidenceGate,
    onSliceComplete: deps.onSliceComplete,
    provider: deps.provider,
    maxConcurrency: deps.maxConcurrency,
    maxRequests: deps.maxRequests,
    maxDurationMs: deps.maxDurationMs,
    modelSelector: deps.modelSelector,
  })
}
