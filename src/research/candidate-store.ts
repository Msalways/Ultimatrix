import { NodeType, type CandidateFindingNode } from '../graph/schema'
import type { GraphStore } from '../graph/store'
import type { DifferentialResult, FindingCandidate, ResearchExperiment } from './types'
import { stableId } from './utils'

export function candidateFromExperiment(
  experiment: ResearchExperiment,
  differential: DifferentialResult,
  evidence: string[] = [],
): FindingCandidate {
  const confidence = Math.min(0.95, differential.interesting ? 0.62 + differential.leakedFields.length * 0.06 : 0.3)
  const severity = differential.authorizationMismatch ? 'high' : differential.leakedFields.length > 0 ? 'medium' : 'low'
  return {
    id: stableId('candidate', [experiment.id, differential.statusDelta, differential.reason]),
    title: differential.authorizationMismatch
      ? `Potential authorization bypass in ${experiment.title}`
      : `Potential sensitive differential in ${experiment.title}`,
    signalType: differential.authorizationMismatch ? 'authorization-mismatch' : 'differential-signal',
    endpoint: experiment.baselineRequest?.url || 'unknown',
    evidence: [
      differential.reason,
      `status delta: ${differential.statusDelta}`,
      `body similarity: ${differential.bodySimilarity.toFixed(2)}`,
      ...evidence,
    ],
    experimentIds: [experiment.id],
    confidence,
    nextVerificationSteps: [
      'Repeat the experiment with a clean session.',
      'Capture raw request and raw response evidence.',
      'Confirm expected secure behavior with a denied or redacted comparison actor.',
      'Explain business impact in terms of exposed or modified object data.',
    ],
    blockers: [],
    status: confidence >= 0.7 ? 'candidate' : 'needs-more-evidence',
    severity,
  }
}

export function upsertCandidate(store: GraphStore, candidate: FindingCandidate): CandidateFindingNode {
  const node: CandidateFindingNode = {
    id: candidate.id,
    type: NodeType.CANDIDATE_FINDING,
    label: `Candidate: ${candidate.title}`,
    properties: {
      title: candidate.title,
      signalType: candidate.signalType,
      endpoint: candidate.endpoint,
      evidence: candidate.evidence,
      experimentIds: candidate.experimentIds,
      confidence: candidate.confidence,
      nextVerificationSteps: candidate.nextVerificationSteps,
      blockers: candidate.blockers,
      status: candidate.status,
      severity: candidate.severity,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  return store.upsertNode(node) as CandidateFindingNode
}

export function listCandidates(store: GraphStore): FindingCandidate[] {
  return (store.queryNodes(NodeType.CANDIDATE_FINDING) as CandidateFindingNode[]).map(node => ({
    id: node.id,
    title: node.properties.title,
    signalType: node.properties.signalType,
    endpoint: node.properties.endpoint,
    evidence: node.properties.evidence,
    experimentIds: node.properties.experimentIds,
    confidence: node.properties.confidence,
    nextVerificationSteps: node.properties.nextVerificationSteps,
    blockers: node.properties.blockers,
    status: node.properties.status,
    severity: node.properties.severity,
  }))
}
