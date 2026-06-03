// src/core/chain-report.ts
//
// Renders attack chains at the TOP of the report, before individual findings.
// This is the BIG differentiator — leads with "you have a kill chain" instead
// of "you have 10 XSS findings".

import type { AppModel, AttackChain, AppModelFinding } from './app-model';
import { calculateOverallRisk } from './app-model';

export interface ChainReportSection {
  title: string;
  body: string;
}

export function renderChainFirstReport(model: AppModel): ChainReportSection[] {
  const sections: ChainReportSection[] = [];

  // 1. Executive summary
  const risk = calculateOverallRisk(model);
  sections.push({
    title: 'Executive Summary',
    body: [
      `Target: ${model.target}`,
      `Risk Score: ${risk.score}/100 (${risk.level})`,
      `Findings: ${model.findings.length} (${risk.breakdown.critical} critical, ${risk.breakdown.high} high, ${risk.breakdown.medium} medium, ${risk.breakdown.low} low)`,
      `Attack chains: ${model.attackChains?.length || 0}`,
      ``,
      model.attackChains && model.attackChains.length > 0
        ? `**The critical findings form ${model.attackChains.length} attack chain(s) that lead to a full compromise. The most severe is a ${model.attackChains[0].severity} chain: ${model.attackChains[0].name}.**`
        : `No multi-step attack chains identified. Individual findings are listed below.`,
    ].join('\n'),
  });

  // 2. Attack chains (CHAIN-FIRST)
  if (model.attackChains && model.attackChains.length > 0) {
    sections.push({
      title: 'Attack Chains',
      body: model.attackChains.map((c, i) => renderChain(c, i + 1, model)).join('\n\n---\n\n'),
    });

    // 2b. Mermaid diagram of chains
    sections.push({
      title: 'Chain Diagram',
      body: renderChainsMermaid(model.attackChains),
    });
  }

  // 3. Findings (by severity, grouped)
  if (model.findings.length > 0) {
    sections.push({
      title: 'Individual Findings',
      body: renderFindingsBySeverity(model.findings),
    });
  }

  // 4. Recon results
  if ((model.oauthProviders || []).length > 0) {
    sections.push({
      title: 'Discovered OAuth Providers',
      body: model.oauthProviders.map(p =>
        `- **${p.issuer || p.discoveryUrl}** — authorize: \`${p.authorizationEndpoint}\`, client_ids: ${p.clientIds.length}`
      ).join('\n'),
    });
  }
  if ((model.graphqlEndpoints || []).length > 0) {
    sections.push({
      title: 'Discovered GraphQL Endpoints',
      body: model.graphqlEndpoints.map(e =>
        `- **${e.url}** — introspection: ${e.introspectionEnabled ? 'EXPOSED' : 'disabled'}, types: ${e.typeCount}, queries: ${e.queryCount}`
      ).join('\n'),
    });
  }
  if ((model.cloudProbes || []).length > 0) {
    sections.push({
      title: 'Cloud Metadata Probes',
      body: model.cloudProbes.map(p =>
        `- **${p.provider}** via ${p.metadataUrl} — status: ${p.status}, severity: ${p.severity}`
      ).join('\n'),
    });
  }
  if ((model.frameworks || []).length > 0) {
    sections.push({
      title: 'Detected Frameworks',
      body: model.frameworks.map(f => `- **${f.name}** — ${f.evidence}`).join('\n'),
    });
  }

  return sections;
}

function renderChain(chain: AttackChain, index: number, _model: AppModel): string {
  const lines: string[] = [];
  lines.push(`## ${index}. ${chain.name}`);
  lines.push(``);
  lines.push(`**Severity**: ${chain.severity.toUpperCase()}  `);
  lines.push(`**Confidence**: ${(chain.confidence * 100).toFixed(0)}%  `);
  lines.push(`**Exploitability**: ${chain.exploitability}`);
  lines.push(``);
  lines.push(`### Steps`);
  for (const step of chain.steps) {
    lines.push(`${step.step}. **${step.findingType}** at \`${step.endpoint}\``);
    lines.push(`   - Evidence: ${step.description || step.evidenceRef}`);
  }
  lines.push(``);
  lines.push(`### Narrative`);
  lines.push(chain.narrative);
  return lines.join('\n');
}

function renderChainsMermaid(chains: AttackChain[]): string {
  const lines: string[] = ['```mermaid', 'graph LR;'];
  for (const chain of chains) {
    const chainId = chain.id.replace(/[^a-zA-Z0-9]/g, '_');
    const chainLabel = chain.name.replace(/"/g, '\\"');
    lines.push(`  subgraph ${chainId}["${chainLabel} (${chain.severity})"]`);
    for (let i = 0; i < chain.steps.length; i++) {
      const step = chain.steps[i];
      const stepId = `${chainId}_step${i}`.replace(/[^a-zA-Z0-9]/g, '_');
      const stepLabel = `${step.findingType}\\n@ ${step.endpoint}`.replace(/"/g, '\\"');
      lines.push(`    ${stepId}["${stepLabel}"]`);
      if (i > 0) {
        const prevStepId = `${chainId}_step${i - 1}`.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`    ${prevStepId} --> ${stepId}`);
      }
    }
    lines.push(`  end`);
  }
  lines.push('```');
  return lines.join('\n');
}

function renderFindingsBySeverity(findings: AppModelFinding[]): string {
  const order: AppModelFinding['severity'][] = ['critical', 'high', 'medium', 'low', 'info'];
  const groups: Record<string, AppModelFinding[]> = {};
  for (const f of findings) {
    if (!groups[f.severity]) groups[f.severity] = [];
    groups[f.severity].push(f);
  }
  const lines: string[] = [];
  for (const sev of order) {
    const fs = groups[sev];
    if (!fs || fs.length === 0) continue;
    lines.push(`### ${sev.toUpperCase()} (${fs.length})`);
    for (const f of fs) {
      lines.push(`- **${f.type}** at \`${f.endpoint}\` (param: ${f.param}, confidence: ${f.confidence})`);
      if (f.evidence.length > 0) {
        lines.push(`  - ${f.evidence[0].data.slice(0, 200)}`);
      }
    }
    lines.push(``);
  }
  return lines.join('\n');
}

export function renderChainReportHtml(sections: ChainReportSection[]): string {
  const styles = `
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { color: #b91c1c; }
    h2 { color: #1e40af; border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
    h3 { color: #047857; }
    pre { background: #f3f4f6; padding: 1rem; border-radius: 4px; overflow-x: auto; }
    code { background: #f3f4f6; padding: 0.1rem 0.3rem; border-radius: 3px; font-size: 0.9em; }
    .critical { color: #b91c1c; font-weight: bold; }
    .high { color: #ea580c; font-weight: bold; }
    .medium { color: #ca8a04; }
    .low { color: #2563eb; }
    .chain { background: #fef2f2; border-left: 4px solid #b91c1c; padding: 1rem; margin: 1rem 0; }
  `.replace(/\s+/g, ' ').trim();

  const body = sections.map(s => {
    const htmlBody = s.body
      .replace(/```mermaid([\s\S]+?)```/g, '<pre class="mermaid">$1</pre>')
      .replace(/```(\w+)?\n?([\s\S]+?)```/g, '<pre><code>$2</code></pre>')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br/>');
    return `<section><h2>${s.title}</h2>${htmlBody}</section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ultimatrix Security Report</title>
  <style>${styles}</style>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <script>mermaid.initialize({startOnLoad: true});</script>
</head>
<body>
  <h1>Ultimatrix Security Report</h1>
  ${body}
</body>
</html>`;
}
