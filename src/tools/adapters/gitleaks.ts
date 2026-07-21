import { isToolAvailable, installHint, runBinary, tempFile } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

interface GitleaksFinding {
  RuleID?: string
  File?: string
  StartLine?: number
  Author?: string
  Commit?: string
  Description?: string
}

function parseGitleaks(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const f = JSON.parse(t) as GitleaksFinding
      if (f.RuleID || f.Description) {
        findings.push({
          severity: 'high',
          detail: `Secret [${f.RuleID ?? 'unknown'}] in ${f.File ?? '?'}:${f.StartLine ?? '?'} ${f.Description ?? ''}`.trim(),
          raw: t,
        })
      }
    } catch {
      // non-JSON line; ignore
    }
  }
  return findings
}

export const gitleaksAdapter: ToolAdapter = {
  id: 'gitleaks',
  description:
    'Secret scanner. Runs the local gitleaks binary against a source path (cloned repo, downloaded JS bundle dir) to detect leaked keys/tokens. Requires gitleaks installed on PATH.',
  async isAvailable() {
    return isToolAvailable('gitleaks')
  },
  async run(opts): Promise<ToolResult> {
    const o = opts.options ?? {}
    const source = (o.source as string) || opts.target
    if (!source) return skip('gitleaks', source, 'A source path (options.source) is required for secret scanning')
    if (!(await isToolAvailable('gitleaks'))) return skip('gitleaks', source, installHint('gitleaks'))

    const outJson = tempFile('um-gitleaks.json')
    const args = ['detect', '--source', source, '--report-format', 'json', '--report-path', outJson, '--no-banner', '--redact']
    const start = Date.now()
    const { stdout, timedOut } = await runBinary('gitleaks', args, ((o.timeout as number) || 180) * 1000)
    const findings = parseGitleaks(stdout)
    return {
      tool: 'gitleaks',
      target: source,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} secret(s)` : 'No secrets found',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
