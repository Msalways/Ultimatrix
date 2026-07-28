import type { Finding } from '../generation/test-generator'
import type { TestResult } from '../replay/test-runner'
import type { ForensicEvent } from '../logging/forensic-log'

export interface ReportOptions {
  format: 'json' | 'html' | 'markdown'
  title?: string
  includeEvidence?: boolean
  forensicEvents?: ForensicEvent[]
  forensicSummary?: string
  target?: string
  model?: string
  engine?: string
}

export function generateReport(findings: Finding[], results: TestResult[], options: ReportOptions): string {
  switch (options.format) {
    case 'json':
      return generateJson(findings, results, options)
    case 'html':
      return generateHtml(findings, results, options)
    case 'markdown':
      return generateMarkdown(findings, results, options)
  }
}

function severityCounts(findings: Finding[]) {
  return {
    critical: findings.filter(f => f.severity === 'critical').length,
    high: findings.filter(f => f.severity === 'high').length,
    medium: findings.filter(f => f.severity === 'medium').length,
    low: findings.filter(f => f.severity === 'low').length,
    info: findings.filter(f => f.severity === 'info').length,
  }
}

function generateJson(findings: Finding[], results: TestResult[], options: ReportOptions): string {
  const counts = severityCounts(findings)
  const report = {
    title: options.title || 'Ultimatrix Security Report',
    generatedAt: new Date().toISOString(),
    target: options.target,
    model: options.model,
    engine: options.engine,
    summary: {
      totalFindings: findings.length,
      ...counts,
      testsRun: results.length,
      testsPassed: results.filter(r => r.status === 'passed').length,
      testsFailed: results.filter(r => r.status === 'failed').length,
    },
    findings: findings.map(f => ({
      id: f.id,
      title: f.title,
      severity: f.severity,
      category: f.category,
      description: f.description,
      status: f.status,
      cwe: f.cwe,
      remediation: f.remediation,
      impact: f.impact,
      screenshots: f.screenshots,
      reproductionSteps: f.reproductionSteps,
      request: f.request,
      response: f.response,
      evidence: options.includeEvidence ? f.evidence : undefined,
    })),
    results: results.map(r => ({
      testFile: r.testFile,
      testName: r.testName,
      status: r.status,
      duration: r.duration,
    })),
    ...(options.forensicSummary ? { forensicSummary: options.forensicSummary } : {}),
    ...(options.forensicEvents && options.forensicEvents.length > 0
      ? {
          forensicTimeline: options.forensicEvents.map(e => ({
            timestamp: new Date(e.timestamp).toISOString(),
            type: e.type,
            agent: e.agent,
            tool: e.tool,
            duration: e.duration,
            error: e.error,
          })),
        }
      : {}),
  }

  return JSON.stringify(report, null, 2)
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function severityBadge(severity: string): string {
  return `<span class="badge badge-${severity}">${severity.toUpperCase()}</span>`
}

function renderEvidenceSection(evidence: Finding['evidence']): string {
  if (!evidence || evidence.length === 0) return ''

  let html = '<div class="evidence"><h4>Evidence Chain</h4>'
  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i]
    html += `<div class="evidence-item">`
    html += `<h5>${escapeHtml(e.description || `Evidence ${i + 1}`)}</h5>`

    if (e.request) {
      html += `<div class="evidence-section"><h6>Request</h6>`
      html += `<pre>${escapeHtml(e.request.method)} ${escapeHtml(e.request.url)}`
      if (e.request.headers) {
        for (const [k, v] of Object.entries(e.request.headers)) {
          html += `\n${escapeHtml(k)}: ${escapeHtml(v)}`
        }
      }
      if (e.request.body) {
        html += `\n\n${escapeHtml(e.request.body)}`
      }
      html += `</pre></div>`
    }

    if (e.response) {
      html += `<div class="evidence-section"><h6>Response (${e.response.status})</h6>`
      html += `<pre>${escapeHtml(e.response.body || '')}</pre></div>`
    }

    if (e.screenshot) {
      html += `<div class="evidence-section"><h6>Screenshot</h6>`
      html += `<img src="${escapeHtml(e.screenshot)}" class="screenshot" loading="lazy" /></div>`
    }

    html += `</div>`
  }
  html += `</div>`
  return html
}

function generateHtml(findings: Finding[], results: TestResult[], options: ReportOptions): string {
  const title = options.title || 'Ultimatrix Security Report'
  const counts = severityCounts(findings)
  const humanActions = options.forensicEvents?.filter(e => e.type === 'human-action') || []
  const screenshots = options.forensicEvents?.filter(e => e.type === 'screenshot') || []

  const tocHtml = findings.map((f, i) =>
    `<li><a href="#finding-${i}">${escapeHtml(f.title)} ${severityBadge(f.severity)}</a></li>`
  ).join('\n')

  const findingsHtml = findings.map((f, i) => {
    let section = `
    <div class="finding" id="finding-${i}">
      <h3>${escapeHtml(f.title)} ${severityBadge(f.severity)}</h3>
      <div class="finding-meta">
        ${f.cwe ? `CWE: ${escapeHtml(f.cwe)} | ` : ''}
        Confidence: ${((f as any).confidence || 0).toFixed(2)} | Status: ${f.status}
      </div>

      <div class="description">
        <h4>Description</h4>
        <p>${escapeHtml(f.description || 'No description provided')}</p>
      </div>`

    if (f.request) {
      section += `
      <div class="request-response">
        <h4>Request</h4>
        <pre>${escapeHtml(f.request.method)} ${escapeHtml(f.request.url)}
${f.request.headers ? Object.entries(f.request.headers).map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(v)}`).join('\n') : ''}
${f.request.body ? '\n' + escapeHtml(f.request.body) : ''}</pre>
      </div>`
    }

    if (f.response) {
      section += `
      <div class="request-response">
        <h4>Response (${f.response.status})</h4>
        <pre>${escapeHtml(f.response.body || '(empty)')}</pre>
      </div>`
    }

    section += renderEvidenceSection(f.evidence)

    if (f.screenshots && f.screenshots.length > 0) {
      section += `
      <div class="screenshots">
        <h4>Screenshots</h4>
        ${f.screenshots.map(s => `<img src="${escapeHtml(s)}" class="screenshot" loading="lazy" />`).join('\n')}
      </div>`
    }

    if (f.reproductionSteps && f.reproductionSteps.length > 0) {
      section += `
      <div class="reproduction">
        <h4>Reproduction Steps</h4>
        <ol>
          ${f.reproductionSteps.map(s => `<li>${escapeHtml(s)}</li>`).join('\n')}
        </ol>
      </div>`
    }

    if (f.impact) {
      section += `
      <div class="impact">
        <h4>Impact</h4>
        <p>${escapeHtml(f.impact)}</p>
      </div>`
    }

    if (f.remediation) {
      section += `
      <div class="remediation">
        <h4>Remediation</h4>
        <p>${escapeHtml(f.remediation)}</p>
      </div>`
    }

    section += `</div>`
    return section
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; margin: 0; padding: 40px; background: #f5f5f5; color: #333; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    h1 { color: #1a1a2e; border-bottom: 3px solid #007bff; padding-bottom: 12px; margin-bottom: 8px; }
    h2 { color: #16213e; margin-top: 40px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
    h3 { color: #1a1a2e; margin-top: 30px; }
    h4 { color: #444; margin-top: 20px; margin-bottom: 8px; }
    .meta { color: #666; font-size: 0.9em; margin-bottom: 30px; }
    .meta span { margin-right: 20px; }

    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin: 24px 0; }
    .stat { text-align: center; padding: 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #dee2e6; }
    .stat-value { font-size: 2.2em; font-weight: 700; }
    .stat-label { color: #666; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat.critical { border-left-color: #dc3545; }
    .stat.high { border-left-color: #fd7e14; }
    .stat.medium { border-left-color: #ffc107; }
    .stat.low { border-left-color: #28a745; }
    .stat.info { border-left-color: #17a2b8; }
    .stat.critical .stat-value { color: #dc3545; }
    .stat.high .stat-value { color: #fd7e14; }
    .stat.medium .stat-value { color: #e0a800; }
    .stat.low .stat-value { color: #28a745; }
    .stat.info .stat-value { color: #17a2b8; }

    .badge { display: inline-block; padding: 3px 10px; border-radius: 4px; color: white; font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
    .badge-critical { background: #dc3545; }
    .badge-high { background: #fd7e14; }
    .badge-medium { background: #ffc107; color: #333; }
    .badge-low { background: #28a745; }
    .badge-info { background: #17a2b8; }

    .finding { margin: 30px 0; padding: 24px; background: #fafafa; border-radius: 8px; border: 1px solid #eee; }
    .finding h3 { margin-top: 0; }
    .finding-meta { color: #666; font-size: 0.85em; margin-bottom: 16px; }

    pre { background: #1a1a2e; color: #e0e0e0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 0.85em; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
    .screenshot { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; margin: 8px 0; }
    .evidence-item { margin: 12px 0; padding: 12px; background: white; border-radius: 4px; border: 1px solid #eee; }
    .evidence-section { margin: 8px 0; }
    .evidence-section h6 { margin: 8px 0 4px; color: #555; font-size: 0.85em; text-transform: uppercase; }

    ol { padding-left: 24px; }
    li { margin: 4px 0; }

    .toc { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .toc ol { margin: 0; padding-left: 20px; }
    .toc li { margin: 6px 0; }
    .toc a { color: #007bff; text-decoration: none; }
    .toc a:hover { text-decoration: underline; }

    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; }
    th { background: #f8f9fa; font-weight: 600; font-size: 0.85em; text-transform: uppercase; letter-spacing: 0.03em; }

    .timeline-entry { display: flex; gap: 12px; padding: 6px 0; border-bottom: 1px solid #f0f0f0; font-size: 0.85em; }
    .timeline-ts { color: #999; font-family: monospace; white-space: nowrap; }
    .timeline-type { font-weight: 600; min-width: 100px; }
    .timeline-tool { color: #007bff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      <span>Generated: ${new Date().toLocaleString()}</span>
      ${options.target ? `<span>Target: ${escapeHtml(options.target)}</span>` : ''}
      ${options.model ? `<span>Model: ${escapeHtml(options.model)}</span>` : ''}
      ${options.engine ? `<span>Engine: ${escapeHtml(options.engine)}</span>` : ''}
    </div>

    <h2>Executive Summary</h2>
    <div class="summary">
      <div class="stat"><div class="stat-value">${findings.length}</div><div class="stat-label">Total</div></div>
      <div class="stat critical"><div class="stat-value">${counts.critical}</div><div class="stat-label">Critical</div></div>
      <div class="stat high"><div class="stat-value">${counts.high}</div><div class="stat-label">High</div></div>
      <div class="stat medium"><div class="stat-value">${counts.medium}</div><div class="stat-label">Medium</div></div>
      <div class="stat low"><div class="stat-value">${counts.low}</div><div class="stat-label">Low</div></div>
      <div class="stat info"><div class="stat-value">${counts.info}</div><div class="stat-label">Info</div></div>
    </div>

    ${findings.length > 0 ? `
    <h2>Table of Contents</h2>
    <div class="toc"><ol>${tocHtml}</ol></div>

    <h2>Findings</h2>
    ${findingsHtml}
    ` : '<p>No findings detected.</p>'}

    ${results.length > 0 ? `
    <h2>Test Results</h2>
    <table>
      <thead><tr><th>Test</th><th>Status</th><th>Duration</th></tr></thead>
      <tbody>
        ${results.map(r => `<tr><td>${escapeHtml(r.testName)}</td><td>${r.status}</td><td>${r.duration}ms</td></tr>`).join('')}
      </tbody>
    </table>` : ''}

    ${(humanActions.length > 0 || screenshots.length > 0) ? `
    <h2>Human Interaction Log</h2>
    <p>${humanActions.length} actions captured from the human operator.</p>
    <table>
      <thead><tr><th>Time</th><th>Type</th><th>Selector</th><th>URL</th></tr></thead>
      <tbody>
        ${humanActions.map(e => {
          const args = e.args as any || {}
          return `<tr><td>${new Date(e.timestamp).toLocaleTimeString()}</td><td>${args.type || '-'}</td><td>${escapeHtml(args.selector || '-')}</td><td>${escapeHtml(args.url || '-')}</td></tr>`
        }).join('')}
      </tbody>
    </table>` : ''}

    ${options.forensicSummary ? `
    <h2>Forensic Summary</h2>
    <pre>${escapeHtml(options.forensicSummary)}</pre>` : ''}

    ${options.forensicEvents && options.forensicEvents.length > 0 ? `
    <h2>Forensic Timeline</h2>
    ${options.forensicEvents.slice(-200).map(e => `
    <div class="timeline-entry">
      <span class="timeline-ts">${new Date(e.timestamp).toLocaleTimeString()}</span>
      <span class="timeline-type">${e.type}</span>
      <span class="timeline-tool">${e.tool || ''}</span>
      <span>${e.duration ? e.duration + 'ms' : ''}</span>
      <span style="color:red">${e.error || ''}</span>
    </div>`).join('')}` : ''}

  </div>
</body>
</html>`
}

function generateMarkdown(findings: Finding[], results: TestResult[], options: ReportOptions): string {
  const title = options.title || 'Ultimatrix Security Report'
  const counts = severityCounts(findings)
  const lines: string[] = []

  lines.push(`# ${title}`)
  lines.push('')
  lines.push(`Generated: ${new Date().toLocaleString()}`)
  if (options.target) lines.push(`Target: ${options.target}`)
  if (options.model) lines.push(`Model: ${options.model}`)
  lines.push('')

  lines.push('## Executive Summary')
  lines.push('')
  lines.push(`| Severity | Count |`)
  lines.push(`|----------|-------|`)
  lines.push(`| Critical | ${counts.critical} |`)
  lines.push(`| High | ${counts.high} |`)
  lines.push(`| Medium | ${counts.medium} |`)
  lines.push(`| Low | ${counts.low} |`)
  lines.push(`| Info | ${counts.info} |`)
  lines.push(`| **Total** | **${findings.length}** |`)
  lines.push('')

  if (findings.length > 0) {
    lines.push('## Findings')
    lines.push('')

    findings.forEach((f, i) => {
      lines.push(`### ${i + 1}. ${f.title} [${f.severity.toUpperCase()}]`)
      lines.push('')
      if (f.cwe) lines.push(`**CWE:** ${f.cwe}`)
      lines.push(`**Confidence:** ${((f as any).confidence || 0).toFixed(2)} | **Status:** ${f.status}`)
      lines.push('')
      lines.push(f.description || 'No description provided.')
      lines.push('')

      if (f.request) {
        lines.push('**Request:**')
        lines.push('```')
        lines.push(`${f.request.method} ${f.request.url}`)
        if (f.request.headers) {
          for (const [k, v] of Object.entries(f.request.headers)) {
            lines.push(`${k}: ${v}`)
          }
        }
        if (f.request.body) lines.push(f.request.body)
        lines.push('```')
        lines.push('')
      }

      if (f.response) {
        lines.push(`**Response (${f.response.status}):**`)
        lines.push('```')
        lines.push(f.response.body || '(empty)')
        lines.push('```')
        lines.push('')
      }

      if (f.evidence && f.evidence.length > 0) {
        lines.push('**Evidence Chain:**')
        f.evidence.forEach((e, j) => {
          lines.push(`${j + 1}. ${e.description}`)
          if (e.screenshot) lines.push(`   Screenshot: ${e.screenshot}`)
        })
        lines.push('')
      }

      if (f.screenshots && f.screenshots.length > 0) {
        lines.push('**Screenshots:**')
        f.screenshots.forEach(s => lines.push(`- ![${s}](${s})`))
        lines.push('')
      }

      if (f.reproductionSteps && f.reproductionSteps.length > 0) {
        lines.push('**Reproduction Steps:**')
        f.reproductionSteps.forEach((s, j) => lines.push(`${j + 1}. ${s}`))
        lines.push('')
      }

      if (f.impact) {
        lines.push(`**Impact:** ${f.impact}`)
        lines.push('')
      }

      if (f.remediation) {
        lines.push(`**Remediation:** ${f.remediation}`)
        lines.push('')
      }

      lines.push('---')
      lines.push('')
    })
  }

  if (results.length > 0) {
    lines.push('## Test Results')
    lines.push('')
    lines.push('| Test | Status | Duration |')
    lines.push('|------|--------|----------|')
    for (const r of results) {
      lines.push(`| ${r.testName} | ${r.status} | ${r.duration}ms |`)
    }
    lines.push('')
  }

  if (options.forensicSummary) {
    lines.push('## Forensic Summary')
    lines.push('```')
    lines.push(options.forensicSummary)
    lines.push('```')
    lines.push('')
  }

  if (options.forensicEvents && options.forensicEvents.length > 0) {
    lines.push('## Forensic Timeline')
    lines.push('')
    lines.push('| Time | Type | Tool | Duration | Error |')
    lines.push('|------|------|------|----------|-------|')
    for (const e of options.forensicEvents.slice(-100)) {
      const ts = new Date(e.timestamp).toLocaleTimeString()
      const dur = e.duration ? `${e.duration}ms` : '-'
      const err = e.error || '-'
      lines.push(`| ${ts} | ${e.type} | ${e.tool || '-'} | ${dur} | ${err} |`)
    }
  }

  return lines.join('\n')
}
