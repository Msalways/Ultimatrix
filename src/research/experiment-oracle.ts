import type { EvidenceItem } from '../intelligence/evidence-ledger'
import type { EvidenceOracle, ExperimentOutcome, ProofAssertion } from './types'
import { randomUUID } from 'node:crypto'

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
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
      proven = oracle.marker.length > 0 && !baseline.data.includes(oracle.marker) && mutation.data.includes(oracle.marker)
      break
    }
    case 'cross-identity': {
      const victim = byId.get(oracle.victimEvidenceId)!
      const attacker = byId.get(oracle.attackerEvidenceId)!
      proven = oracle.marker.length > 0 && oracle.victimActorRef !== oracle.attackerActorRef &&
        victim.session === oracle.victimActorRef && attacker.session === oracle.attackerActorRef &&
        victim.data.includes(oracle.marker) && attacker.data.includes(oracle.marker)
      break
    }
    case 'state-transition': {
      const before = byId.get(oracle.beforeEvidenceId)!.observed?.state?.[oracle.stateKey]
      const after = byId.get(oracle.afterEvidenceId)!.observed?.state?.[oracle.stateKey]
      proven = oracle.beforeValue !== oracle.afterValue && before === oracle.beforeValue && after === oracle.afterValue
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
  const challengeReused =
    initialOracle.type === 'unique-marker' && retestOracle.type === 'unique-marker' && initialOracle.marker === retestOracle.marker ||
    initialOracle.type === 'cross-identity' && retestOracle.type === 'cross-identity' && initialOracle.marker === retestOracle.marker ||
    initialOracle.type === 'oast-callback' && retestOracle.type === 'oast-callback' && initialOracle.correlationToken === retestOracle.correlationToken
  if (challengeReused) {
    return { status: 'inconclusive', reason: 'Retest must use a fresh marker or correlation token', evidenceRefs: refs }
  }
  return evaluateExperimentOracle(experimentId, retestOracle, evidence, 'retest')
}
