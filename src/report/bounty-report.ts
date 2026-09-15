/**
 * Bounty Report Generator — structured output from graph findings.
 *
 * Generates bounty-ready reports in Markdown/JSON/HTML from:
 *   - FindingNode + severity + evidence
 *   - ExploitProofNode + PROVES edges
 *   - Endpoint context + auth info
 *
 * Purpose: Immediate value for bug bounty submissions.
 */

import { NodeType, type FindingNode, type ExploitProofNode, type EndpointNode } from '../graph/schema'

// ─── Types ──────────────────────────────────────────────────────────

export type ReportFormat = 'markdown' | 'json' | 'html'

export interface ReportConfig {
  format: ReportFormat
  title?: string
  author?: string
  targetUrl?: string
  scopeDescription?: string
  includeEvidence?: boolean
  includeReproduction?: boolean
}

export interface FindingReport {
  id: string
  title: string
  severity: string
  technique: string
  endpoint: string
  description: string
  evidence: string[]
  reproductionSteps: string[]
  impact: string
  remediation: string
  exploitProof?: {
    method: string
    url: string
    headers?: Record<string, string>
    body?: string
    reproSteps: string[]
  }
}

export interface Report {
  metadata: {
    title: string
    author?: string
    target: string
    scope: string
    generatedAt: string
    findingCount: number
    severityBreakdown: Record<string, number>
  }
  findings: FindingReport[]
}

// ─── Report Builder ─────────────────────────────────────────────────

export function buildReport(
  findings: FindingNode[],
  exploitProofs: ExploitProofNode[],
  endpoints: EndpointNode[],
  config: ReportConfig,
): Report {
  const severityBreakdown: Record<string, number> = {}
  const findingReports: FindingReport[] = []

  for (const finding of findings) {
    const props = finding.properties as Record<string, unknown>
    const severity = String(props.severity ?? 'unknown')
    severityBreakdown[severity] = (severityBreakdown[severity] ?? 0) + 1

    // Find linked exploit proof
    const proof = exploitProofs.find(p => {
      const pProps = p.properties as Record<string, unknown>
      return String(pProps.findingId ?? '') === finding.id
    })
    const proofProps = proof?.properties as Record<string, unknown> | undefined

    findingReports.push({
      id: finding.id,
      title: String(props.title ?? 'Untitled Finding'),
      severity,
      technique: String(props.technique ?? 'unknown'),
      endpoint: String(props.endpoint ?? 'unknown'),
      description: String(props.title ?? ''),
      evidence: Array.isArray(props.evidence) ? props.evidence.map(String) : [],
      reproductionSteps: proofProps
        ? Array.isArray(proofProps.reproSteps) ? proofProps.reproSteps.map(String) : []
        : [],
      impact: severity === 'critical' ? 'Full system compromise' :
              severity === 'high' ? 'Significant data exposure or access' :
              severity === 'medium' ? 'Limited data exposure' :
              'Low-impact information disclosure',
      remediation: generateRemediation(String(props.technique ?? '')),
      exploitProof: proofProps ? {
        method: String(proofProps.method ?? 'GET'),
        url: String(proofProps.url ?? ''),
        headers: typeof proofProps.headers === 'object' ? proofProps.headers as Record<string, string> : undefined,
        body: typeof proofProps.body === 'string' ? proofProps.body : undefined,
        reproSteps: Array.isArray(proofProps.reproSteps) ? proofProps.reproSteps.map(String) : [],
      } : undefined,
    })
  }

  return {
    metadata: {
      title: config.title ?? `Security Assessment Report`,
      author: config.author,
      target: config.targetUrl ?? 'Unknown',
      scope: config.scopeDescription ?? 'Full application scope',
      generatedAt: new Date().toISOString(),
      findingCount: findings.length,
      severityBreakdown,
    },
    findings: findingReports,
  }
}

// ─── Format Renderers ───────────────────────────────────────────────

export function renderMarkdown(report: Report): string {
  const lines: string[] = []

  lines.push(`# ${report.metadata.title}`)
  lines.push('')
  lines.push(`**Target:** ${report.metadata.target}`)
  if (report.metadata.author) lines.push(`**Author:** ${report.metadata.author}`)
  lines.push(`**Date:** ${report.metadata.generatedAt.split('T')[0]}`)
  lines.push(`**Findings:** ${report.metadata.findingCount}`)
  lines.push('')

  // Severity breakdown
  lines.push('## Severity Breakdown')
  lines.push('')
  for (const [severity, count] of Object.entries(report.metadata.severityBreakdown)) {
    lines.push(`- **${severity.toUpperCase()}**: ${count}`)
  }
  lines.push('')

  // Findings
  for (const finding of report.findings) {
    lines.push(`## ${finding.title}`)
    lines.push('')
    lines.push(`| Field | Value |`)
    lines.push(`|-------|-------|`)
    lines.push(`| Severity | ${finding.severity.toUpperCase()} |`)
    lines.push(`| Technique | ${finding.technique} |`)
    lines.push(`| Endpoint | \`${finding.endpoint}\` |`)
    lines.push('')

    lines.push(`### Description`)
    lines.push(finding.description)
    lines.push('')

    if (finding.exploitProof) {
      lines.push(`### Reproduction Steps`)
      lines.push('```http')
      lines.push(`${finding.exploitProof.method} ${finding.exploitProof.url} HTTP/1.1`)
      if (finding.exploitProof.headers) {
        for (const [k, v] of Object.entries(finding.exploitProof.headers)) {
          lines.push(`${k}: ${v}`)
        }
      }
      if (finding.exploitProof.body) {
        lines.push('')
        lines.push(finding.exploitProof.body)
      }
      lines.push('```')
      lines.push('')
    }

    if (finding.reproductionSteps.length > 0) {
      lines.push('### Steps to Reproduce')
      for (let i = 0; i < finding.reproductionSteps.length; i++) {
        lines.push(`${i + 1}. ${finding.reproductionSteps[i]}`)
      }
      lines.push('')
    }

    lines.push(`### Impact`)
    lines.push(finding.impact)
    lines.push('')

    lines.push(`### Remediation`)
    lines.push(finding.remediation)
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  return lines.join('\n')
}

export function renderJSON(report: Report): string {
  return JSON.stringify(report, null, 2)
}

export function renderHTML(report: Report): string {
  const md = renderMarkdown(report)
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${report.metadata.title}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; }
    table { border-collapse: collapse; width: 100%; margin: 10px 0; }
    th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
    th { background: #f5f5f5; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 4px; overflow-x: auto; }
    h1 { border-bottom: 2px solid #333; padding-bottom: 8px; }
    h2 { color: #333; margin-top: 30px; }
  </style>
</head>
<body>
  <pre>${escapeHtml(md)}</pre>
</body>
</html>`
}

// ─── Helpers ────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function generateRemediation(technique: string): string {
  const remediations: Record<string, string> = {
    classicInjection: 'Use parameterized queries. Never concatenate user input into SQL.',
    reflectedXSS: 'HTML-encode all user input before rendering. Use Content-Security-Policy headers.',
    ssrfOast: 'Whitelist allowed outbound destinations. Block requests to internal networks.',
    workflowBypass: 'Enforce server-side state checks. Never trust client-side workflow state.',
    authzMatrix: 'Implement RBAC checks on every endpoint. Deny by default.',
    idorSwapper: 'Use indirect references (UUIDs) instead of sequential IDs. Validate ownership.',
    configTrust: 'Never expose sensitive config in responses. Remove debug endpoints in production.',
    concurrencyHarness: 'Implement optimistic locking or version checks on state-changing operations.',
    aiTrust: 'Validate LLM outputs server-side. Never trust AI-generated content without verification.',
  }
  return remediations[technique] ?? 'Follow OWASP guidelines for this vulnerability class.'
}

// ─── Format Dispatcher ──────────────────────────────────────────────

export function renderReport(report: Report, format: ReportFormat): string {
  switch (format) {
    case 'markdown': return renderMarkdown(report)
    case 'json': return renderJSON(report)
    case 'html': return renderHTML(report)
    default: return renderMarkdown(report)
  }
}
