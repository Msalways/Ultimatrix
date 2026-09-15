import { describe, it, expect } from 'vitest'
import { buildReport, renderMarkdown, renderJSON, renderHTML, renderReport } from '../../src/report/bounty-report'
import { NodeType } from '../../src/graph/schema'
import type { FindingNode, ExploitProofNode } from '../../src/graph/schema'

const makeFinding = (id: string, title: string, severity: string, technique: string, endpoint: string): FindingNode => ({
  id,
  type: NodeType.FINDING,
  label: title,
  properties: {
    title,
    severity,
    technique,
    endpoint,
    evidence: ['GET /api/users → 200 with SQL error'],
    lifecycleStatus: 'verified',
  },
})

const makeProof = (id: string, findingId: string, method: string, url: string): ExploitProofNode => ({
  id,
  type: NodeType.EXPLOIT_PROOF,
  label: `Proof for ${findingId}`,
  properties: {
    findingId,
    title: `Exploit proof`,
    method,
    url,
    body: "' OR 1=1 --",
    reproSteps: ['Send crafted payload', 'Observe SQL error in response'],
    replayable: true,
    status: 'verified',
  },
})

describe('BountyReport', () => {
  const findings = [
    makeFinding('f1', 'SQL Injection in /api/users', 'critical', 'classicInjection', '/api/users'),
    makeFinding('f2', 'XSS in search parameter', 'high', 'reflectedXSS', '/search'),
    makeFinding('f3', 'Open redirect on login', 'low', 'openRedirect', '/login'),
  ]

  const proofs = [
    makeProof('p1', 'f1', 'POST', 'https://target.com/api/users'),
  ]

  const config = {
    format: 'markdown' as const,
    title: 'Bug Bounty Report',
    author: 'Ultimatrix',
    targetUrl: 'https://target.com',
  }

  describe('buildReport', () => {
    it('builds a report from findings', () => {
      const report = buildReport(findings, proofs, [], config)
      expect(report.metadata.findingCount).toBe(3)
      expect(report.findings).toHaveLength(3)
    })

    it('counts severity breakdown', () => {
      const report = buildReport(findings, proofs, [], config)
      expect(report.metadata.severityBreakdown.critical).toBe(1)
      expect(report.metadata.severityBreakdown.high).toBe(1)
      expect(report.metadata.severityBreakdown.low).toBe(1)
    })

    it('links exploit proofs to findings', () => {
      const report = buildReport(findings, proofs, [], config)
      const sqlFinding = report.findings.find(f => f.id === 'f1')
      expect(sqlFinding?.exploitProof).toBeDefined()
      expect(sqlFinding?.exploitProof?.method).toBe('POST')
    })

    it('generates remediation per technique', () => {
      const report = buildReport(findings, proofs, [], config)
      const sqlFinding = report.findings.find(f => f.id === 'f1')
      expect(sqlFinding?.remediation).toContain('parameterized queries')
    })
  })

  describe('renderMarkdown', () => {
    it('renders a full markdown report', () => {
      const report = buildReport(findings, proofs, [], config)
      const md = renderMarkdown(report)
      expect(md).toContain('# Bug Bounty Report')
      expect(md).toContain('## SQL Injection')
      expect(md).toContain('CRITICAL')
      expect(md).toContain('## Severity Breakdown')
    })

    it('includes reproduction steps from proof', () => {
      const report = buildReport(findings, proofs, [], config)
      const md = renderMarkdown(report)
      expect(md).toContain('POST https://target.com/api/users')
      expect(md).toContain('Reproduction Steps')
    })
  })

  describe('renderJSON', () => {
    it('renders valid JSON', () => {
      const report = buildReport(findings, proofs, [], config)
      const json = renderJSON(report)
      const parsed = JSON.parse(json)
      expect(parsed.metadata.findingCount).toBe(3)
    })
  })

  describe('renderHTML', () => {
    it('renders valid HTML', () => {
      const report = buildReport(findings, proofs, [], config)
      const html = renderHTML(report)
      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Bug Bounty Report')
    })
  })

  describe('renderReport', () => {
    it('dispatches to correct renderer', () => {
      const report = buildReport(findings, proofs, [], config)
      expect(renderReport(report, 'markdown')).toContain('#')
      expect(renderReport(report, 'json')).toContain('{')
      expect(renderReport(report, 'html')).toContain('<!DOCTYPE')
    })
  })
})
