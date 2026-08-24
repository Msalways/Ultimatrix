import { describe, expect, it } from 'vitest'
import { generateCaseFile, validateCaseFile } from '../../src/report/case-file'
import { NodeType } from '../../src/graph/schema'

function store(options: { complete?: boolean; sharedRetestEvidence?: boolean } = {}): any {
  const complete = options.complete ?? true
  const finding = {
    id: 'finding-node', type: NodeType.FINDING,
    properties: {
      findingId: 'finding-1', technique: 'authorization', endpoint: 'https://target.example/item?token=secret-value',
      severity: 'high', confidence: 0.9, evidence: ['observed response'], lifecycleStatus: 'verified', evidenceLevel: 'L3',
      verifiedAt: '2026-08-15T00:00:00.000Z', experimentIds: ['experiment-1'],
      proofCheck: { ruleId: 'rule', findingId: 'finding-1', passed: true, missingEvidence: [], conflicts: [], evidenceRefs: ['e1'] },
    },
  }
  const experiment = {
    id: 'experiment-1', type: NodeType.EXPERIMENT,
    properties: {
      hypothesisId: 'h1', title: 'comparison', setup: ['actor A', 'actor B'],
      baselineRequest: { method: 'GET', url: 'https://target.example/item' }, mutation: 'change actor',
      expectedSecureBehavior: 'denied', insecureSignal: 'marker visible', requiredActors: ['a', 'b'], tools: ['http'], status: 'proven',
      oracle: { type: 'unique-marker', baselineEvidenceId: 'e1', mutationEvidenceId: 'e2', marker: 'unique-marker' },
      outcome: { status: 'proven', proof: { assertionId: 'a1', experimentId: 'experiment-1', phase: 'initial', oracleType: 'unique-marker', evidenceRefs: ['e1', 'e2'], verifiedAt: '2026-08-15T00:00:00.000Z' } },
      retest: { oracle: { type: 'unique-marker', baselineEvidenceId: 'e3', mutationEvidenceId: 'e4', marker: 'fresh-marker' }, outcome: { status: 'proven', proof: { assertionId: 'a2', experimentId: 'experiment-1', phase: 'retest', oracleType: 'unique-marker', evidenceRefs: options.sharedRetestEvidence ? ['e2'] : ['e3', 'e4'], verifiedAt: '2026-08-15T00:01:00.000Z' } }, evaluatedAt: '2026-08-15T00:01:00.000Z' },
    },
  }
  const proof = {
    id: 'proof-1', type: NodeType.EXPLOIT_PROOF,
    properties: { findingId: 'finding-1', title: 'proof', method: 'GET', url: 'https://target.example/item', headers: { Authorization: 'Bearer abcdefghijk' }, reproSteps: ['send request'], replayable: true, status: 'confirmed', expectedVulnerableResponse: 'unique-marker' },
  }
  return {
    queryNodes: (type: NodeType) => type === NodeType.FINDING ? [finding] : type === NodeType.ENDPOINT ? [] : [],
    getNode: (id: string) => complete && id === experiment.id ? experiment : undefined,
    getExploitProof: () => complete ? [proof] : [],
  }
}

describe('case-file contract', () => {
  it('exports only self-contained verified findings and redacts secrets', () => {
    const result = generateCaseFile(store(), 'https://target.example?token=secret-value')
    expect(result.schemaVersion).toBe(1)
    expect(result.findings).toHaveLength(1)
    expect(result.incompleteCandidates).toEqual([])
    expect(result.findings[0].replay.headers?.Authorization).not.toContain('abcdefghijk')
    expect(validateCaseFile(result)).toEqual({ valid: true, errors: [] })
  })

  it('excludes findings with missing proof material or reused retest evidence', () => {
    const missing = generateCaseFile(store({ complete: false }), 'https://target.example')
    const reused = generateCaseFile(store({ sharedRetestEvidence: true }), 'https://target.example')
    expect(missing.findings).toEqual([])
    expect(missing.incompleteCandidates[0].reasons).toContain('replayable exploit proof is missing')
    expect(reused.findings).toEqual([])
    expect(reused.incompleteCandidates[0].reasons).toContain('experiment experiment-1 retest reuses initial evidence')
  })

  it('fails closed on malformed untrusted JSON', () => {
    expect(validateCaseFile(null)).toEqual({ valid: false, errors: ['case file must be an object'] })
    expect(validateCaseFile({ schemaVersion: 1, findings: {} }).valid).toBe(false)
  })
})
