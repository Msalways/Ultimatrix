import type { EvidenceItem } from '../intelligence/evidence-ledger'
import { isBountyProfile } from '../safety/bounty-policy'
import type { EvidenceOracle, ExperimentOutcome, ProofAssertion } from './types'
import { randomUUID } from 'node:crypto'

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/**
 * Whether a unique challenge marker appears anywhere in the recorded
 * response — body or headers. Header matching is case-insensitive on names
 * (transports vary) and covers redirect targets: a marker URL landing in
 * `Location` is the redirect analogue of a body echo. The marker is a
 * unique nonce, so any fresh appearance is unsanitized reflection.
 */
function responseContains(item: EvidenceItem, marker: string): boolean {
  if (typeof item.data === 'string' && item.data.includes(marker)) return true
  const headers = item.observed?.responseHeaders ?? {}
  return Object.values(headers).some(value => typeof value === 'string' && value.includes(marker))
}

function responseArraySize(item: EvidenceItem): number | undefined {
  const status = item.observed?.status
  if (status == null || status < 200 || status >= 300) return undefined
  try {
    const value: unknown = JSON.parse(item.observed?.responseBody ?? item.data)
    if (Array.isArray(value)) return value.length
    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>
      for (const key of ['data', 'products', 'results', 'items']) {
        if (Array.isArray(record[key])) return (record[key] as unknown[]).length
      }
    }
  } catch { /* non-JSON response cannot satisfy a structured result oracle */ }
  return undefined
}

const SQL_ERROR_SIGNATURES = [
  'you have an error in your sql syntax',
  'syntax error at or near',
  'syntax error in sql statement',
  'unclosed quotation mark after the character string',
  'unterminated quoted string',
  'sqlite_error',
  'sqlite3::syntaxerror',
  'ora-00933',
  'ora-00936',
  'ora-01756',
  'incorrect syntax near',
  'sqlstate[42000]',
  'psqlexception',
]

function hasDatabaseError(item: EvidenceItem): boolean {
  const body = (item.observed?.responseBody ?? item.data).toLowerCase()
  return SQL_ERROR_SIGNATURES.some(signature => body.includes(signature))
}

function sameObservedRoute(a: EvidenceItem, b: EvidenceItem): boolean {
  const methodA = a.observed?.method?.toUpperCase()
  const methodB = b.observed?.method?.toUpperCase()
  if (!methodA || methodA !== methodB || !a.observed?.url || !b.observed?.url) return false
  try {
    const urlA = new URL(a.observed.url)
    const urlB = new URL(b.observed.url)
    return urlA.origin === urlB.origin && urlA.pathname.replace(/\/+$/, '') === urlB.pathname.replace(/\/+$/, '')
  } catch {
    return false
  }
}

function sameObservedResource(a: EvidenceItem, b: EvidenceItem): boolean {
  if (a.observed?.method?.toUpperCase() !== b.observed?.method?.toUpperCase()) return false
  try {
    const urlA = new URL(a.observed?.url ?? '')
    const urlB = new URL(b.observed?.url ?? '')
    const query = (url: URL) => JSON.stringify([...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)))
    return urlA.origin === urlB.origin && urlA.pathname === urlB.pathname && query(urlA) === query(urlB)
  } catch {
    return false
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

function sortedPairsWithout(params: URLSearchParams, parameter: string): string[] {
  return [...params.entries()]
    .filter(([key]) => key !== parameter)
    .map(([key, value]) => JSON.stringify([key, value]))
    .sort()
}

/** Require the selected observed input to be the only query/body value changed. */
function changedOnlyObservedInput(
  baseline: EvidenceItem,
  mutation: EvidenceItem,
  inputLocation: 'query' | 'json' | 'form',
  parameter: string,
): boolean {
  if (!parameter.trim()) return false
  try {
    if (inputLocation === 'query') {
      const before = new URL(baseline.observed?.url ?? '').searchParams
      const after = new URL(mutation.observed?.url ?? '').searchParams
      const beforeValues = before.getAll(parameter).sort()
      const afterValues = after.getAll(parameter).sort()
      return beforeValues.length > 0 && afterValues.length > 0
        && stableJson(beforeValues) !== stableJson(afterValues)
        && stableJson(sortedPairsWithout(before, parameter)) === stableJson(sortedPairsWithout(after, parameter))
    }

    const beforeBody = baseline.observed?.requestBody
    const afterBody = mutation.observed?.requestBody
    if (beforeBody == null || afterBody == null) return false

    if (inputLocation === 'form') {
      const before = new URLSearchParams(beforeBody)
      const after = new URLSearchParams(afterBody)
      const beforeValues = before.getAll(parameter).sort()
      const afterValues = after.getAll(parameter).sort()
      return beforeValues.length > 0 && afterValues.length > 0
        && stableJson(beforeValues) !== stableJson(afterValues)
        && stableJson(sortedPairsWithout(before, parameter)) === stableJson(sortedPairsWithout(after, parameter))
    }

    const before = JSON.parse(beforeBody) as unknown
    const after = JSON.parse(afterBody) as unknown
    if (!before || typeof before !== 'object' || Array.isArray(before)
      || !after || typeof after !== 'object' || Array.isArray(after)) return false
    const beforeRecord = before as Record<string, unknown>
    const afterRecord = after as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(beforeRecord, parameter)
      || !Object.prototype.hasOwnProperty.call(afterRecord, parameter)
      || stableJson(beforeRecord[parameter]) === stableJson(afterRecord[parameter])) return false
    const beforeOther = { ...beforeRecord }
    const afterOther = { ...afterRecord }
    delete beforeOther[parameter]
    delete afterOther[parameter]
    return stableJson(beforeOther) === stableJson(afterOther)
  } catch {
    return false
  }
}

function sameObservedActor(a: EvidenceItem, b: EvidenceItem): boolean {
  const actorA = a.observed?.actorFingerprint
  const actorB = b.observed?.actorFingerprint
  if (actorA || actorB) return !!actorA && actorA === actorB
  return a.session === b.session
}

function structuredStateValue(item: EvidenceItem, key: string): unknown {
  const observedState = item.observed?.state
  if (observedState && Object.prototype.hasOwnProperty.call(observedState, key)) return observedState[key]
  try {
    let value: unknown = JSON.parse(item.observed?.responseBody ?? item.data)
    for (const part of key.split('.').filter(Boolean)) {
      if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, part)) return undefined
      value = (value as Record<string, unknown>)[part]
    }
    return value
  } catch {
    return undefined
  }
}

function matchesStateValue(item: EvidenceItem, key: string, expected: string): boolean {
  if (!expected) return false
  if (key.startsWith('body:')) {
    const body = item.observed?.responseBody ?? item.data
    return body.includes(expected)
  }
  const value = structuredStateValue(item, key)
  return value !== undefined && (String(value) === expected || JSON.stringify(value) === expected)
}

export function evaluateExperimentOracle(
  experimentId: string,
  oracle: EvidenceOracle,
  evidence: EvidenceItem[],
  phase: ProofAssertion['phase'] = 'initial',
): ExperimentOutcome {
  const byId = new Map(evidence.map(item => [item.id, item]))
  const refs = getOracleEvidenceRefs(oracle)
  const missing = refs.filter(id => !byId.has(id))
  if (missing.length) {
    return { status: 'inconclusive', reason: `Missing evidence: ${missing.join(', ')}`, evidenceRefs: refs.filter(id => byId.has(id)) }
  }

  let proven = false
  switch (oracle.type) {
    case 'unique-marker': {
      const baseline = byId.get(oracle.baselineEvidenceId)!
      const mutation = byId.get(oracle.mutationEvidenceId)!
      proven = oracle.marker.length > 0 && !responseContains(baseline, oracle.marker) && responseContains(mutation, oracle.marker)
      break
    }
    case 'json-array-growth': {
      const baselineSize = responseArraySize(byId.get(oracle.baselineEvidenceId)!)
      const mutationSize = responseArraySize(byId.get(oracle.mutationEvidenceId)!)
      if (baselineSize == null || mutationSize == null) {
        return { status: 'inconclusive', reason: 'Both responses must be successful JSON collections for a result-growth oracle', evidenceRefs: refs }
      }
      proven = Number.isInteger(oracle.minimumGrowth) && oracle.minimumGrowth > 0
        && mutationSize >= baselineSize + oracle.minimumGrowth
      break
    }
    case 'database-error-differential': {
      const baseline = byId.get(oracle.baselineEvidenceId)!
      const mutation = byId.get(oracle.mutationEvidenceId)!
      if (!sameObservedRoute(baseline, mutation)) {
        return { status: 'inconclusive', reason: 'Database-error evidence must use the same observed HTTP method and route', evidenceRefs: refs }
      }
      if (!changedOnlyObservedInput(baseline, mutation, oracle.inputLocation, oracle.parameter)) {
        return { status: 'inconclusive', reason: 'Database-error evidence must change only the named observed input', evidenceRefs: refs }
      }
      if (!sameObservedActor(baseline, mutation)) {
        return { status: 'inconclusive', reason: 'Database-error evidence must use the same observed actor', evidenceRefs: refs }
      }
      proven = !hasDatabaseError(baseline) && hasDatabaseError(mutation)
      break
    }
    case 'cross-identity': {
      const victim = byId.get(oracle.victimEvidenceId)!
      const attacker = byId.get(oracle.attackerEvidenceId)!
      proven = oracle.marker.length > 0 && oracle.victimActorRef !== oracle.attackerActorRef &&
        victim.session === oracle.victimActorRef && attacker.session === oracle.attackerActorRef &&
        responseContains(victim, oracle.marker) && responseContains(attacker, oracle.marker)
      break
    }
    case 'state-transition': {
      const before = byId.get(oracle.beforeEvidenceId)!
      const after = byId.get(oracle.afterEvidenceId)!
      if ([before, after].some(item => item.observed?.status != null && (item.observed.status < 200 || item.observed.status >= 300))) {
        return { status: 'inconclusive', reason: 'State-transition evidence must come from successful responses', evidenceRefs: refs }
      }
      if ((before.observed?.method || before.observed?.url || after.observed?.method || after.observed?.url)
        && !sameObservedResource(before, after)) {
        return { status: 'inconclusive', reason: 'State-transition evidence must use the same observed read resource', evidenceRefs: refs }
      }
      if (!sameObservedActor(before, after)) {
        return { status: 'inconclusive', reason: 'State-transition evidence must use the same observed actor', evidenceRefs: refs }
      }
      proven = oracle.beforeValue !== oracle.afterValue &&
        matchesStateValue(before, oracle.stateKey, oracle.beforeValue) &&
        matchesStateValue(after, oracle.stateKey, oracle.afterValue)
      break
    }
    case 'oast-callback':
      proven = oracle.correlationToken.length > 0 && byId.get(oracle.evidenceId)!.observed?.correlationToken === oracle.correlationToken
      break
    case 'timing-differential': {
      const baseline = oracle.baselineEvidenceIds.map(id => byId.get(id)!.observed?.responseTimeMs)
      const mutation = oracle.mutationEvidenceIds.map(id => byId.get(id)!.observed?.responseTimeMs)
      if (baseline.some(v => v == null) || mutation.some(v => v == null) || baseline.length < oracle.minSamples || mutation.length < oracle.minSamples) {
        return { status: 'inconclusive', reason: 'Insufficient timing samples', evidenceRefs: refs }
      }
      proven = median(mutation as number[]) - median(baseline as number[]) >= oracle.minDeltaMs
      break
    }
    case 'browser-effect':
      proven = byId.get(oracle.evidenceId)!.observed?.browserEffects?.[oracle.effectKey] === oracle.expectedValue
      break
  }

  if (!proven) return { status: 'disproven', evidenceRefs: refs }
  const proof: ProofAssertion = {
    assertionId: `proof:${randomUUID()}`,
    experimentId,
    phase,
    oracleType: oracle.type,
    evidenceRefs: refs,
    verifiedAt: new Date().toISOString(),
  }
  return { status: 'proven', proof }
}

export function getOracleEvidenceRefs(oracle: EvidenceOracle): string[] {
  return Object.entries(oracle)
    .filter(([key]) => key === 'evidenceId' || key.endsWith('EvidenceId') || key.endsWith('EvidenceIds'))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]) as string[]
}

export function evaluateIndependentRetest(
  experimentId: string,
  initialOracle: EvidenceOracle,
  initialProof: ProofAssertion,
  retestOracle: EvidenceOracle,
  evidence: EvidenceItem[],
): ExperimentOutcome {
  const refs = getOracleEvidenceRefs(retestOracle)
  if (refs.some(ref => initialProof.evidenceRefs.includes(ref))) {
    return { status: 'inconclusive', reason: 'Retest must use independent evidence', evidenceRefs: refs }
  }
  const byId = new Map(evidence.map(item => [item.id, item]))
  const initialItems = initialProof.evidenceRefs.map(id => byId.get(id)).filter((item): item is EvidenceItem => !!item)
  const retestItems = refs.map(id => byId.get(id)).filter((item): item is EvidenceItem => !!item)
  const initialExecutions = new Set(initialItems.map(item => item.observed?.executionId).filter((id): id is string => !!id))
  if (retestItems.some(item => item.observed?.executionId && initialExecutions.has(item.observed.executionId))) {
    return { status: 'inconclusive', reason: 'Retest reused an initial execution', evidenceRefs: refs }
  }
  if (isBountyProfile()) {
    const initialContexts = new Set(initialItems.map(item => item.observed?.browserContextId).filter((id): id is string => !!id))
    if (retestItems.some(item => !item.observed?.executionId || (item.observed.browserContextId && initialContexts.has(item.observed.browserContextId)))) {
      return { status: 'inconclusive', reason: 'Bounty retest requires a fresh execution and browser context', evidenceRefs: refs }
    }
  }
  const challengeReused =
    initialOracle.type === 'unique-marker' && retestOracle.type === 'unique-marker' && initialOracle.marker === retestOracle.marker ||
    initialOracle.type === 'cross-identity' && retestOracle.type === 'cross-identity' && initialOracle.marker === retestOracle.marker ||
    initialOracle.type === 'oast-callback' && retestOracle.type === 'oast-callback' && initialOracle.correlationToken === retestOracle.correlationToken
  if (challengeReused) {
    return { status: 'inconclusive', reason: 'Retest must use a fresh marker or correlation token', evidenceRefs: refs }
  }
  return evaluateExperimentOracle(experimentId, retestOracle, evidence, 'retest')
}
