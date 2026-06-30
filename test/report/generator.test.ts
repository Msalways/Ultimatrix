import { describe, it, expect } from 'vitest'
import { generateReport } from '../../src/report/generator'
import type { Finding } from '../../src/generation/test-generator'
import type { TestResult } from '../../src/replay/test-runner'
import type { ForensicEvent } from '../../src/logging/forensic-log'

const mockFindings: Finding[] = [
  {
    id: 'finding-001',
    title: 'SQL Injection on /api/users',
    severity: 'high',
    category: 'sql_injection',
    description: 'Parameter "id" is vulnerable to SQL injection via UNION-based technique.',
    evidence: [
      {
        request: {
          method: 'GET',
          url: 'https://api.example.com/users?id=1%27%20UNION%20SELECT%20NULL--',
          headers: { Authorization: 'Bearer token123' },
        },
        response: {
          status: 200,
          body: '{"users": [{"id": 1, "name": "admin"}]}',
        },
        description: 'UNION injection returns admin user data',
      },
    ],
    request: {
      method: 'GET',
      url: 'https://api.example.com/users?id=1%27',
      headers: { Authorization: 'Bearer token123' },
      body: '',
    },
    response: {
      status: 500,
      body: 'SQL syntax error near input',
    },
    firstSeen: new Date('2026-01-01'),
    lastSeen: new Date('2026-01-01'),
    status: 'open',
    cwe: 'CWE-89',
    remediation: 'Use parameterized queries for all database interactions.',
    impact: 'An attacker can extract all data from the database, including credentials.',
    screenshots: ['/screenshots/sqli-error.png'],
    reproductionSteps: [
      'Navigate to /api/users?id=1',
      'Replace 1 with 1 UNION SELECT NULL--',
      'Observe that admin data is returned',
    ],
  },
  {
    id: 'finding-002',
    title: 'XSS on /search',
    severity: 'medium',
    category: 'xss',
    description: 'Reflected XSS in search query parameter.',
    evidence: [],
    request: {
      method: 'GET',
      url: 'https://example.com/search?q=<script>alert(1)</script>',
    },
    firstSeen: new Date('2026-01-01'),
    lastSeen: new Date('2026-01-01'),
    status: 'open',
  },
  {
    id: 'finding-003',
    title: 'Info Disclosure on /version',
    severity: 'info',
    category: 'info_disclosure',
    description: 'Server version disclosed in response headers.',
    evidence: [],
    request: {
      method: 'GET',
      url: 'https://example.com/version',
    },
    firstSeen: new Date('2026-01-01'),
    lastSeen: new Date('2026-01-01'),
    status: 'open',
  },
]

const mockResults: TestResult[] = [
  { testFile: 'test-001.spec.ts', testName: 'SQLi detection', status: 'passed', duration: 1200 },
  { testFile: 'test-002.spec.ts', testName: 'XSS detection', status: 'failed', duration: 800 },
]

const mockForensicEvents: ForensicEvent[] = [
  {
    timestamp: Date.now() - 5000,
    type: 'tool-call',
    agent: 'supervisor',
    tool: 'httpRequest',
    duration: 200,
  },
  {
    timestamp: Date.now() - 3000,
    type: 'human-action',
    agent: 'human',
    tool: 'askUser',
    args: { type: 'click', selector: '#login-btn', url: 'https://example.com/login' },
  },
  {
    timestamp: Date.now() - 1000,
    type: 'screenshot',
    agent: 'supervisor',
    tool: 'writeFinding',
  },
]

describe('Report Generator', () => {
  describe('generateReport (JSON)', () => {
    it('generates valid JSON report', () => {
      const json = generateReport(mockFindings, mockResults, {
        format: 'json',
        title: 'Test Report',
        target: 'https://example.com',
        includeEvidence: true,
      })

      const report = JSON.parse(json)
      expect(report.title).toBe('Test Report')
      expect(report.target).toBe('https://example.com')
      expect(report.summary.totalFindings).toBe(3)
      expect(report.summary.critical).toBe(0)
      expect(report.summary.high).toBe(1)
      expect(report.summary.medium).toBe(1)
      expect(report.summary.info).toBe(1)
      expect(report.summary.testsRun).toBe(2)
      expect(report.summary.testsPassed).toBe(1)
      expect(report.summary.testsFailed).toBe(1)
    })

    it('includes all finding fields', () => {
      const json = generateReport(mockFindings, [], { format: 'json', includeEvidence: true })
      const report = JSON.parse(json)

      const sqli = report.findings[0]
      expect(sqli.cwe).toBe('CWE-89')
      expect(sqli.remediation).toBe('Use parameterized queries for all database interactions.')
      expect(sqli.impact).toBe('An attacker can extract all data from the database, including credentials.')
      expect(sqli.screenshots).toEqual(['/screenshots/sqli-error.png'])
      expect(sqli.reproductionSteps).toHaveLength(3)
    })

    it('excludes evidence when includeEvidence is false', () => {
      const json = generateReport(mockFindings, [], { format: 'json', includeEvidence: false })
      const report = JSON.parse(json)
      expect(report.findings[0].evidence).toBeUndefined()
    })

    it('includes forensic timeline', () => {
      const json = generateReport([], [], {
        format: 'json',
        forensicEvents: mockForensicEvents,
        forensicSummary: 'Test summary',
      })
      const report = JSON.parse(json)
      expect(report.forensicTimeline).toHaveLength(3)
      expect(report.forensicSummary).toBe('Test summary')
    })
  })

  describe('generateReport (HTML)', () => {
    it('generates HTML with executive summary', () => {
      const html = generateReport(mockFindings, mockResults, {
        format: 'html',
        title: 'Security Report',
        target: 'https://example.com',
        model: 'gpt-4',
        engine: 'solver',
      })

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Security Report')
      expect(html).toContain('Executive Summary')
      expect(html).toContain('https://example.com')
      expect(html).toContain('gpt-4')
      expect(html).toContain('solver')
    })

    it('includes severity badges', () => {
      const html = generateReport(mockFindings, [], { format: 'html' })
      expect(html).toContain('badge-high')
      expect(html).toContain('badge-medium')
      expect(html).toContain('badge-info')
    })

    it('includes table of contents', () => {
      const html = generateReport(mockFindings, [], { format: 'html' })
      expect(html).toContain('Table of Contents')
      expect(html).toContain('SQL Injection on /api/users')
      expect(html).toContain('XSS on /search')
    })

    it('renders finding with all sections', () => {
      const html = generateReport(mockFindings, [], { format: 'html' })
      // Description
      expect(html).toContain('Parameter &quot;id&quot; is vulnerable')
      // Request/Response
      expect(html).toContain('Request')
      expect(html).toContain('Response (500)')
      // Evidence
      expect(html).toContain('Evidence Chain')
      expect(html).toContain('UNION injection returns admin user data')
      // Screenshots
      expect(html).toContain('Screenshots')
      expect(html).toContain('sqli-error.png')
      // Reproduction Steps
      expect(html).toContain('Reproduction Steps')
      expect(html).toContain('Navigate to /api/users')
      // Impact
      expect(html).toContain('Impact')
      expect(html).toContain('extract all data')
      // Remediation
      expect(html).toContain('Remediation')
      expect(html).toContain('parameterized queries')
      // CWE
      expect(html).toContain('CWE-89')
    })

    it('includes human interaction log', () => {
      const html = generateReport([], [], {
        format: 'html',
        forensicEvents: mockForensicEvents,
      })
      expect(html).toContain('Human Interaction Log')
      expect(html).toContain('1 actions captured')
    })

    it('includes forensic timeline', () => {
      const html = generateReport([], [], {
        format: 'html',
        forensicEvents: mockForensicEvents,
      })
      expect(html).toContain('Forensic Timeline')
      expect(html).toContain('tool-call')
    })

    it('includes forensic summary', () => {
      const html = generateReport([], [], {
        format: 'html',
        forensicSummary: 'Total API calls: 15',
      })
      expect(html).toContain('Forensic Summary')
      expect(html).toContain('Total API calls: 15')
    })

    it('renders test results table', () => {
      const html = generateReport([], mockResults, { format: 'html' })
      expect(html).toContain('Test Results')
      expect(html).toContain('SQLi detection')
      expect(html).toContain('passed')
      expect(html).toContain('failed')
    })

    it('shows no findings message when empty', () => {
      const html = generateReport([], [], { format: 'html' })
      expect(html).toContain('No findings detected.')
    })
  })

  describe('generateReport (Markdown)', () => {
    it('generates markdown with title and summary', () => {
      const md = generateReport(mockFindings, mockResults, {
        format: 'markdown',
        title: 'Pentest Report',
        target: 'https://example.com',
      })

      expect(md).toContain('# Pentest Report')
      expect(md).toContain('Target: https://example.com')
      expect(md).toContain('## Executive Summary')
    })

    it('renders severity table', () => {
      const md = generateReport(mockFindings, [], { format: 'markdown' })
      expect(md).toContain('| Critical | 0 |')
      expect(md).toContain('| High | 1 |')
      expect(md).toContain('| Medium | 1 |')
      expect(md).toContain('| Info | 1 |')
      expect(md).toContain('| **Total** | **3** |')
    })

    it('renders each finding with all sections', () => {
      const md = generateReport(mockFindings, [], { format: 'markdown' })

      // Title with severity
      expect(md).toContain('### 1. SQL Injection on /api/users [HIGH]')
      // CWE
      expect(md).toContain('**CWE:** CWE-89')
      // Description
      expect(md).toContain('Parameter "id" is vulnerable')
      // Request
      expect(md).toContain('**Request:**')
      expect(md).toContain('GET https://api.example.com/users?id=1%27')
      // Response
      expect(md).toContain('**Response (500):**')
      expect(md).toContain('SQL syntax error')
      // Evidence
      expect(md).toContain('**Evidence Chain:**')
      expect(md).toContain('UNION injection returns admin user data')
      // Screenshots
      expect(md).toContain('**Screenshots:**')
      expect(md).toContain('sqli-error.png')
      // Reproduction
      expect(md).toContain('**Reproduction Steps:**')
      expect(md).toContain('1. Navigate to /api/users?id=1')
      // Impact
      expect(md).toContain('**Impact:** An attacker can extract')
      // Remediation
      expect(md).toContain('**Remediation:** Use parameterized queries')
    })

    it('renders test results table', () => {
      const md = generateReport([], mockResults, { format: 'markdown' })
      expect(md).toContain('## Test Results')
      expect(md).toContain('| SQLi detection | passed | 1200ms |')
    })

    it('includes forensic summary', () => {
      const md = generateReport([], [], {
        format: 'markdown',
        forensicSummary: '15 API calls used',
      })
      expect(md).toContain('## Forensic Summary')
      expect(md).toContain('15 API calls used')
    })

    it('includes forensic timeline table', () => {
      const md = generateReport([], [], {
        format: 'markdown',
        forensicEvents: mockForensicEvents,
      })
      expect(md).toContain('## Forensic Timeline')
      expect(md).toContain('tool-call')
    })
  })
})
