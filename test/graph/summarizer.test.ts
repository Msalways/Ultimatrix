import { describe, it, expect } from 'vitest'
import { summarizeGraph, formatGraphSummary } from '../../src/graph/summarizer'
import { NodeType, type EndpointNode, type FindingNode } from '../../src/graph/schema'

const makeEndpoint = (url: string, method = 'GET'): EndpointNode => ({
  id: `ep-${url}`,
  type: NodeType.ENDPOINT,
  label: url,
  properties: { url, method },
})

const makeFinding = (title: string, severity: string, technique: string, endpoint: string): FindingNode => ({
  id: `f-${title}`,
  type: NodeType.FINDING,
  label: title,
  properties: { title, severity, technique, endpoint },
})

describe('GraphSummarizer', () => {
  describe('summarizeGraph', () => {
    it('summarizes endpoints by path shape', () => {
      const endpoints = [
        makeEndpoint('https://api.com/api/users/123'),
        makeEndpoint('https://api.com/api/users/456'),
        makeEndpoint('https://api.com/api/posts/789'),
      ]
      const summary = summarizeGraph(endpoints, [], [])
      expect(summary.endpoints.total).toBe(3)
      expect(summary.endpoints.byShape).toHaveLength(2) // /api/users/:id and /api/posts/:id
    })

    it('groups findings by severity', () => {
      const findings = [
        makeFinding('SQLi', 'critical', 'classicInjection', '/api/users'),
        makeFinding('XSS', 'high', 'reflectedXSS', '/search'),
        makeFinding('IDOR', 'medium', 'idorSwapper', '/api/items'),
        makeFinding('Info', 'low', 'infoLeak', '/debug'),
      ]
      const summary = summarizeGraph([], findings, [])
      expect(summary.findings.total).toBe(4)
      expect(summary.findings.critical).toHaveLength(1)
      expect(summary.findings.highCount).toBe(1)
      expect(summary.findings.mediumLowCount).toBe(2)
    })

    it('counts attacks by technique', () => {
      const attacks = [
        { id: 'a1', type: NodeType.ATTACK, label: '', properties: { technique: 'classicInjection' } },
        { id: 'a2', type: NodeType.ATTACK, label: '', properties: { technique: 'classicInjection' } },
        { id: 'a3', type: NodeType.ATTACK, label: '', properties: { technique: 'ssrfOast' } },
      ]
      const summary = summarizeGraph([], [], attacks)
      expect(summary.attacks.total).toBe(3)
      expect(summary.attacks.byTechnique.classicInjection).toBe(2)
      expect(summary.attacks.byTechnique.ssrfOast).toBe(1)
    })

    it('estimates context tokens', () => {
      const summary = summarizeGraph(
        [makeEndpoint('https://a.com/api/1')],
        [makeFinding('SQLi', 'critical', 'classicInjection', '/api/1')],
        [],
      )
      expect(summary.contextTokens).toBeGreaterThan(0)
    })

    it('handles empty graph', () => {
      const summary = summarizeGraph([], [], [])
      expect(summary.endpoints.total).toBe(0)
      expect(summary.findings.total).toBe(0)
    })
  })

  describe('formatGraphSummary', () => {
    it('formats a readable summary', () => {
      const summary = summarizeGraph(
        [makeEndpoint('https://api.com/api/users/1'), makeEndpoint('https://api.com/api/users/2')],
        [makeFinding('SQLi', 'critical', 'classicInjection', '/api/users/1')],
        [],
      )
      const text = formatGraphSummary(summary)
      expect(text).toContain('Graph Summary')
      expect(text).toContain('/api/users/:id')
      expect(text).toContain('CRITICAL')
      expect(text).toContain('SQLi')
    })

    it('includes token estimate', () => {
      const summary = summarizeGraph([], [], [])
      expect(formatGraphSummary(summary)).toContain('tokens')
    })
  })
})
