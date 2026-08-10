import { describe, it, expect } from 'vitest'
import {
  checkProof,
  defaultProofFloor,
  findProofConflicts,
  resolveProofRule,
  registerProofRule,
  clearProofRules,
  combineFindingEvidence,
  type ProofCheckResult,
} from '../../src/intelligence/proof-rules'
import type { EvidenceItem } from '../../src/intelligence/evidence-ledger'
import { generateReport } from '../../src/report/generator'
import type { Finding } from '../../src/generation/test-generator'

function item(partial: Partial<EvidenceItem> & { id: string }): EvidenceItem {
  return {
    type: 'text',
    data: '',
    label: partial.label ?? 'ev',
    timestamp: Date.now(),
    ...partial,
  }
}

const baseFinding: Finding = {
  id: 'f1',
  title: 'XSS on /search',
  severity: 'high',
  category: 'xss',
  description: 'reflected xss',
  evidence: [],
  request: { method: 'GET', url: 'https://example.com/search' },
  firstSeen: new Date(),
  lastSeen: new Date(),
  status: 'open',
}

describe('proof-rules — default floors', () => {
  it('critical requires 2 independent structured captures', () => {
    const rule = defaultProofFloor('critical')
    expect(rule.minIndependentSources).toBe(2)
    expect(rule.allowConflicts).toBe(false)
  })

  it('high requires at least one non-text capture', () => {
    const rule = defaultProofFloor('high')
    expect(rule.minIndependentSources).toBe(1)
    expect(rule.requiredEvidenceKinds).toContain('raw_request')
    expect(rule.requiredEvidenceKinds).toContain('screenshot')
    expect(rule.requiredEvidenceKinds).not.toContain('text')
  })

  it('info has no floor', () => {
    const rule = defaultProofFloor('info')
    expect(rule.minIndependentSources).toBe(0)
    expect(rule.requiredEvidenceKinds).toHaveLength(0)
  })

  it('registerProofRule overrides severity floor for a finding class', () => {
    clearProofRules()
    registerProofRule({ id: 'rule-idor', findingType: 'idor', requiredEvidenceKinds: ['raw_request'], minIndependentSources: 3, allowConflicts: true })
    const resolved = resolveProofRule('idor', 'high')
    expect(resolved.id).toBe('rule-idor')
    expect(resolved.minIndependentSources).toBe(3)
    clearProofRules()
  })
})

describe('proof-rules — enough evidence passes', () => {
  it('high severity passes with a single raw_response for the endpoint', () => {
    const result = checkProof({
      findingType: 'sql_injection',
      endpoint: 'https://app.example.com/api/users',
      severity: 'high',
      observedStatus: 200,
      items: [item({ id: 'ev1', type: 'raw_response', observed: { url: 'https://app.example.com/api/users', status: 200, method: 'GET' } })],
    })
    expect(result.passed).toBe(true)
    expect(result.evidenceRefs).toEqual(['ev1'])
  })

  it('critical severity passes with two structured captures', () => {
    const result = checkProof({
      findingType: 'rce',
      endpoint: '/admin/exec',
      severity: 'critical',
      items: [
        item({ id: 'req', type: 'raw_request', observed: { url: '/admin/exec' } }),
        item({ id: 'res', type: 'raw_response', observed: { url: '/admin/exec', status: 200 } }),
      ],
    })
    expect(result.passed).toBe(true)
    expect(result.evidenceRefs.sort()).toEqual(['req', 'res'])
  })
})

describe('proof-rules — missing evidence fails CLOSED', () => {
  it('high severity with text-only evidence fails the floor', () => {
    const result = checkProof({
      findingType: 'info_leak',
      endpoint: '/api/debug',
      severity: 'high',
      items: [item({ id: 'ev1', type: 'text', observed: { url: '/api/debug' } })],
    })
    expect(result.passed).toBe(false)
    expect(result.missingEvidence.length).toBeGreaterThan(0)
    expect(result.missingEvidence[0]).toContain('need >= 1')
  })

  it('critical severity with a single capture fails the floor', () => {
    const result = checkProof({
      findingType: 'rce',
      endpoint: '/admin/exec',
      severity: 'critical',
      items: [item({ id: 'ev1', type: 'raw_response', observed: { url: '/admin/exec' } })],
    })
    expect(result.passed).toBe(false)
    expect(result.missingEvidence[0]).toContain('need >= 2')
  })

  it('no evidence at all fails the floor for medium', () => {
    const result = checkProof({ findingType: 'csrf', endpoint: '/transfer', severity: 'medium', items: [] })
    expect(result.passed).toBe(false)
    expect(result.missingEvidence.length).toBeGreaterThan(0)
  })

  it('unrelated evidence for another endpoint does not count', () => {
    const result = checkProof({
      findingType: 'xss',
      endpoint: '/search',
      severity: 'high',
      items: [item({ id: 'ev1', type: 'raw_response', observed: { url: '/other' } })],
    })
    expect(result.passed).toBe(false)
  })
})

describe('proof-rules — conflicting evidence', () => {
  it('detects a status conflict when evidence contradicts the asserted status', () => {
    const conflicts = findProofConflicts(
      'https://app.example.com/api/users',
      200,
      [
        item({ id: 'good', type: 'raw_response', observed: { url: 'https://app.example.com/api/users', status: 200 } }),
        item({ id: 'bad', type: 'raw_response', observed: { url: 'https://app.example.com/api/users', status: 500 } }),
      ],
    )
    expect(conflicts.length).toBe(1)
    expect(conflicts[0]).toContain('500')
  })

  it('fails CLOSED on conflict for high severity', () => {
    const result = checkProof({
      findingType: 'idor',
      endpoint: 'https://app.example.com/api/users',
      severity: 'high',
      observedStatus: 200,
      items: [
        item({ id: 'good', type: 'raw_response', observed: { url: 'https://app.example.com/api/users', status: 200 } }),
        item({ id: 'bad', type: 'raw_response', observed: { url: 'https://app.example.com/api/users', status: 500 } }),
      ],
    })
    expect(result.passed).toBe(false)
    expect(result.conflicts.length).toBe(1)
  })

  it('low severity tolerates conflicts (allowConflicts)', () => {
    const result = checkProof({
      findingType: 'version_disclosure',
      endpoint: 'https://app.example.com/version',
      severity: 'low',
      observedStatus: 200,
      items: [
        item({ id: 'a', type: 'text', observed: { url: 'https://app.example.com/version', status: 200 } }),
        item({ id: 'b', type: 'text', observed: { url: 'https://app.example.com/version', status: 404 } }),
      ],
    })
    expect(result.passed).toBe(true)
  })

  it('no conflicts when the claim does not assert a status', () => {
    const result = checkProof({
      findingType: 'xss',
      endpoint: '/search',
      severity: 'high',
      items: [
        item({ id: 'a', type: 'raw_response', observed: { url: '/search', status: 200 } }),
        item({ id: 'b', type: 'raw_response', observed: { url: '/search', status: 500 } }),
      ],
    })
    expect(result.conflicts).toHaveLength(0)
    expect(result.passed).toBe(true)
  })
})

describe('proof-rules — evidence combining', () => {
  it('combines attached + ledger evidence deduped by id, endpoint-filtered', () => {
    const attached: EvidenceItem[] = [
      item({ id: 'attached1', type: 'raw_request', observed: { url: '/api' } }),
    ]
    const ledger: EvidenceItem[] = [
      item({ id: 'ledger1', type: 'raw_response', observed: { url: '/api' } }),
      item({ id: 'ledger2', type: 'raw_response', observed: { url: '/other' } }),
    ]
    const combined = combineFindingEvidence('/api', attached, ledger)
    expect(combined.map(c => c.id).sort()).toEqual(['attached1', 'ledger1'])
  })
})

describe('proof-rules — report generator gate', () => {
  it('excludes findings with a failed proof check from reports', () => {
    const failed: ProofCheckResult = {
      ruleId: 'floor-high',
      findingId: 'f1',
      passed: false,
      missingEvidence: ['need >= 1 non-text capture'],
      conflicts: [],
      evidenceRefs: [],
    }
    const passed: ProofCheckResult = {
      ruleId: 'floor-high',
      findingId: 'f2',
      passed: true,
      missingEvidence: [],
      conflicts: [],
      evidenceRefs: ['ev1'],
    }
    const findings: Finding[] = [
      { ...baseFinding, id: 'f1', proofCheck: failed },
      { ...baseFinding, id: 'f2', severity: 'high', proofCheck: passed },
      { ...baseFinding, id: 'f3', severity: 'info', proofCheck: undefined },
    ]
    const json = generateReport(findings, [], { format: 'json' })
    const report = JSON.parse(json)
    expect(report.summary.totalFindings).toBe(2)
    const ids = report.findings.map((f: any) => f.id)
    expect(ids).not.toContain('f1')
    expect(ids).toEqual(['f2', 'f3'])
  })

  it('includes proof-check metadata on reported findings', () => {
    const passed: ProofCheckResult = {
      ruleId: 'floor-high',
      findingId: 'f2',
      passed: true,
      missingEvidence: [],
      conflicts: [],
      evidenceRefs: ['ev1'],
    }
    const json = generateReport([{ ...baseFinding, id: 'f2', proofCheck: passed }], [], { format: 'json' })
    const report = JSON.parse(json)
    expect(report.findings[0].proof).toEqual(passed)
  })
})
