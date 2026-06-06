// src/ci/formats.ts
//
// Output formatters for headless/CI mode. Three formats:
//   - json: structured machine-readable
//   - plain: human-readable, line-per-finding
//   - sarif: SARIF 2.1.0 for GitHub Code Scanning / GitLab Code Quality
//
// All formats are pure functions of the findings + summary.

import type { AppModelFinding } from '../core/app-model';

export interface CiOutputOpts {
  target: string;
  findings: AppModelFinding[];
  startedAt: number;
  endedAt: number;
  costUsd: number;
  exitCode: number;
}

export interface CiOutput {
  format: 'json' | 'plain' | 'sarif';
  body: string;
}

/** Map a free-form severity to a SARIF level. */
function severityToSarifLevel(severity: string): 'error' | 'warning' | 'note' | 'none' {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical' || s === 'high') return 'error';
  if (s === 'medium' || s === 'moderate') return 'warning';
  if (s === 'low' || s === 'info') return 'note';
  return 'none';
}

/** SARIF rule severity. */
function severityToSarifSecuritySeverity(severity: string): number {
  const s = (severity ?? '').toLowerCase();
  if (s === 'critical') return 9.5;
  if (s === 'high') return 8.0;
  if (s === 'medium' || s === 'moderate') return 5.5;
  if (s === 'low') return 3.0;
  if (s === 'info') return 1.0;
  return 0.0;
}

export function toJson(opts: CiOutputOpts): string {
  return JSON.stringify({
    target: opts.target,
    startedAt: new Date(opts.startedAt).toISOString(),
    endedAt: new Date(opts.endedAt).toISOString(),
    durationSeconds: Math.round((opts.endedAt - opts.startedAt) / 1000),
    costUsd: opts.costUsd,
    exitCode: opts.exitCode,
    findingsCount: opts.findings.length,
    findings: opts.findings.map((f) => ({
      id: f.id,
      type: f.type,
      endpoint: f.endpoint,
      param: f.param,
      method: f.method,
      payload: f.payload,
      severity: f.severity,
      confidence: f.confidence,
      confirmed: f.confirmed,
      evidence: f.evidence,
      description: f.description,
    })),
  }, null, 2);
}

export function toPlain(opts: CiOutputOpts): string {
  const lines: string[] = [];
  lines.push(`Ultimatrix hunt report`);
  lines.push(`Target: ${opts.target}`);
  lines.push(`Duration: ${Math.round((opts.endedAt - opts.startedAt) / 1000)}s`);
  lines.push(`Cost: $${opts.costUsd.toFixed(2)}`);
  lines.push(`Findings: ${opts.findings.length}`);
  lines.push('');
  if (opts.findings.length === 0) {
    lines.push('No findings.');
  } else {
    for (const f of opts.findings) {
      lines.push(`[${(f.severity ?? 'info').toUpperCase()}] ${f.type}`);
      lines.push(`  Endpoint: ${f.method ?? 'GET'} ${f.endpoint}${f.param ? '?' + f.param : ''}`);
      if (f.payload) lines.push(`  Payload: ${f.payload.slice(0, 200)}`);
      lines.push(`  Confidence: ${f.confidence}${f.confirmed ? ' (confirmed)' : ''}`);
      if (f.description) lines.push(`  ${f.description}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}

export function toSarif(opts: CiOutputOpts): string {
  const rules: Array<{ id: string; name: string; shortDescription: { text: string }; defaultConfiguration: { level: string } }> = [];
  const results: Array<{
    ruleId: string;
    level: string;
    message: { text: string };
    locations: Array<{ physicalLocation: { artifactLocation: { uri: string }; region?: { startLine?: number } } }>;
    properties?: Record<string, unknown>;
  }> = [];
  // Dedupe rules by type.
  const seen = new Set<string>();
  for (const f of opts.findings) {
    const ruleId = (f.type ?? 'unknown').toLowerCase().replace(/\s+/g, '-');
    if (!seen.has(ruleId)) {
      seen.add(ruleId);
      rules.push({
        id: ruleId,
        name: f.type ?? 'unknown',
        shortDescription: { text: f.type ?? 'Unknown finding type' },
        defaultConfiguration: { level: severityToSarifLevel(f.severity) },
      });
    }
    results.push({
      ruleId,
      level: severityToSarifLevel(f.severity),
      message: { text: f.description ?? f.type ?? 'Finding' },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: f.endpoint ?? opts.target },
            region: { startLine: 1 },
          },
        },
      ],
      properties: {
        'security-severity': severityToSarifSecuritySeverity(f.severity ?? 'low'),
        severity: f.severity,
        confidence: String(f.confidence),
        confirmed: f.confirmed,
        param: f.param,
        payload: f.payload,
        ...(f.evidence && typeof f.evidence === 'object' && !Array.isArray(f.evidence)
          ? (f.evidence as Record<string, unknown>)
          : {}),
      },
    });
  }
  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'ultimatrix',
            version: '2.0.0',
            informationUri: 'https://github.com/Msalways/Ultimatrix',
            rules,
          },
        },
        invocations: [
          {
            executionSuccessful: true,
            startTimeUtc: new Date(opts.startedAt).toISOString(),
            endTimeUtc: new Date(opts.endedAt).toISOString(),
            properties: {
              target: opts.target,
              costUsd: opts.costUsd,
            },
          },
        ],
        results,
      },
    ],
  };
  return JSON.stringify(sarif, null, 2);
}

export function formatCiOutput(format: 'json' | 'plain' | 'sarif', opts: CiOutputOpts): CiOutput {
  if (format === 'sarif') return { format, body: toSarif(opts) };
  if (format === 'plain') return { format, body: toPlain(opts) };
  return { format: 'json', body: toJson(opts) };
}
