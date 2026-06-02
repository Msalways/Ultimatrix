import fs from 'fs';
import path from 'path';
import type { PipelineResult, Finding, Severity } from '../core/types';

function escapeHTML(value: string | undefined | null): string {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class ReportGenerator {
  private result: PipelineResult;

  constructor(result: PipelineResult) {
    this.result = result;
  }

  generateHTML(): string {
    const severityColors: Record<Severity, string> = {
      critical: '#dc2626',
      high: '#ea580c',
      medium: '#ca8a04',
      low: '#16a34a',
      info: '#6b7280',
    };

    const riskColor = this.result.riskScore >= 75 ? '#dc2626' :
      this.result.riskScore >= 50 ? '#ea580c' :
      this.result.riskScore >= 25 ? '#ca8a04' : '#16a34a';

    const findingsHTML = this.result.findings.map((f) => {
      const title = escapeHTML(f.title);
      const description = escapeHTML(f.description);
      const location = escapeHTML(f.location);
      const category = escapeHTML(f.category);
      const agent = escapeHTML(f.agent);
      const cweId = escapeHTML(f.cweId);
      const evidence = escapeHTML(f.evidence);
      const remediation = escapeHTML(f.remediation);
      return `
      <div class="finding" style="border-left: 4px solid ${severityColors[f.severity]}; padding: 16px; margin: 12px 0; background: #fff; border-radius: 4px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0;">${title}</h3>
          <span class="badge" style="background: ${severityColors[f.severity]}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: bold;">${escapeHTML(f.severity.toUpperCase())}</span>
        </div>
        <p style="color: #666; margin: 8px 0;">${description}</p>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 13px;">
          <div><strong>Location:</strong> ${location}</div>
          <div><strong>Category:</strong> ${category}</div>
          <div><strong>Agent:</strong> ${agent}</div>
          ${f.cweId ? `<div><strong>CWE:</strong> ${cweId}</div>` : ''}
        </div>
        <div style="margin-top: 12px; padding: 8px; background: #f8f9fa; border-radius: 4px;">
          <strong>Evidence:</strong><br><code>${evidence}</code>
        </div>
        <div style="margin-top: 8px; padding: 8px; background: #ecfdf5; border-radius: 4px;">
          <strong>Remediation:</strong> ${remediation}
        </div>
      </div>
    `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ultimatrix Security Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
    .header { background: linear-gradient(135deg, #1e3a5f, #2d5a87); color: white; padding: 32px; border-radius: 8px; margin-bottom: 24px; }
    .header h1 { font-size: 28px; margin-bottom: 8px; }
    .header p { opacity: 0.8; }
    .dashboard { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card h3 { font-size: 14px; color: #666; margin-bottom: 8px; }
    .card .value { font-size: 32px; font-weight: bold; }
    .risk-score { color: ${riskColor}; }
    .findings-section { margin-top: 24px; }
    .findings-section h2 { margin-bottom: 16px; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 24px; }
    .footer { text-align: center; padding: 24px; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🛡️ Ultimatrix - Security Report</h1>
      <p>Generated: ${escapeHTML(this.result.metadata.completedAt)} | Model: ${escapeHTML(this.result.metadata.modelUsed)}</p>
    </div>

    <div class="dashboard">
      <div class="card">
        <h3>Risk Score</h3>
        <div class="value risk-score">${this.result.riskScore}/100</div>
        <div style="color: ${riskColor}; font-weight: bold;">${escapeHTML(this.result.riskLevel.toUpperCase())}</div>
      </div>
      <div class="card">
        <h3>Total Findings</h3>
        <div class="value">${this.result.findings.length}</div>
      </div>
      <div class="card">
        <h3>Critical</h3>
        <div class="value" style="color: #dc2626;">${this.result.findings.filter((f) => f.severity === 'critical').length}</div>
      </div>
      <div class="card">
        <h3>High</h3>
        <div class="value" style="color: #ea580c;">${this.result.findings.filter((f) => f.severity === 'high').length}</div>
      </div>
      <div class="card">
        <h3>Agents Used</h3>
        <div class="value" style="font-size: 18px;">${this.result.metadata.agentsUsed.length}</div>
      </div>
    </div>

    <div class="summary">
      <h2>Summary</h2>
      <p>${escapeHTML(this.result.summary)}</p>
    </div>

    <div class="findings-section">
      <h2>Findings (${this.result.findings.length})</h2>
      ${findingsHTML || '<p style="color: #16a34a;">No vulnerabilities found. Great job!</p>'}
    </div>

    <div class="footer">
      Generated by Ultimatrix v2.0.0 | Microsoft Build AI Hackathon 2026
    </div>
  </div>
</body>
</html>`;
  }

  generateJSON(): string {
    return JSON.stringify(this.result, null, 2);
  }

  generateMarkdown(): string {
    const lines: string[] = [
      '# 🛡️ Ultimatrix - Security Report',
      '',
      `Generated: ${this.result.metadata.completedAt}`,
      `Model: ${this.result.metadata.modelUsed}`,
      '',
      '## Summary',
      '',
      this.result.summary,
      '',
      '## Risk Assessment',
      '',
      `| Metric | Value |`,
      `|--------|-------|`,
      `| Risk Score | ${this.result.riskScore}/100 |`,
      `| Risk Level | ${this.result.riskLevel.toUpperCase()} |`,
      `| Total Findings | ${this.result.findings.length} |`,
      `| Critical | ${this.result.findings.filter((f) => f.severity === 'critical').length} |`,
      `| High | ${this.result.findings.filter((f) => f.severity === 'high').length} |`,
      `| Medium | ${this.result.findings.filter((f) => f.severity === 'medium').length} |`,
      `| Low | ${this.result.findings.filter((f) => f.severity === 'low').length} |`,
      '',
      '## Findings',
      '',
    ];

    for (const finding of this.result.findings) {
      lines.push(`### ${finding.title}`);
      lines.push('');
      lines.push(`- **Severity:** ${finding.severity.toUpperCase()}`);
      lines.push(`- **Category:** ${finding.category}`);
      lines.push(`- **Location:** ${finding.location}`);
      lines.push(`- **Agent:** ${finding.agent}`);
      lines.push('');
      lines.push(finding.description);
      lines.push('');
      if (finding.evidence) {
        lines.push('**Evidence:**');
        lines.push('```');
        lines.push(finding.evidence);
        lines.push('```');
        lines.push('');
      }
      if (finding.remediation) {
        lines.push(`**Remediation:** ${finding.remediation}`);
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  save(outputDir: string, format: 'html' | 'json' | 'markdown'): string {
    const timestamp = Date.now();
    const ext = format === 'html' ? 'html' : format === 'json' ? 'json' : 'md';
    const filename = `ultimatrix-report-${timestamp}.${ext}`;
    const filePath = path.join(outputDir, filename);

    let content: string;
    switch (format) {
      case 'html':
        content = this.generateHTML();
        break;
      case 'json':
        content = this.generateJSON();
        break;
      case 'markdown':
        content = this.generateMarkdown();
        break;
    }

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(filePath, content);
    return filePath;
  }
}
