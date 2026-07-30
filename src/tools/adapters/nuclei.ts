import { isUrlInScope } from '../../safety/scope-guard'
import {isToolAvailable, installHint, runBinary, normalizeSeverity, extractUrl} from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}

function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseNuclei(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const data = JSON.parse(trimmed)
      const severity = normalizeSeverity(data?.info?.severity)
      const name = data['template-id'] || data?.info?.name || 'unknown'
      const url = data['matched-at'] || data.host || extractUrl(trimmed)
      findings.push({
        url,
        severity,
        detail: `[${severity.toUpperCase()}] ${name} @ ${url ?? trimmed}`,
        raw: trimmed,
      })
    } catch {
      if (/\[(critical|high|medium|low|info)\]/i.test(trimmed)) {
        findings.push({
          severity: normalizeSeverity(trimmed),
          detail: trimmed,
          raw: trimmed,
        })
      }
    }
  }
  return findings
}

export const nucleiAdapter: ToolAdapter = {
  id: 'nuclei',
  description:
    'Template-based vulnerability scanner. Runs the local nuclei binary against the target to check for known CVEs, misconfigurations, and exposed services. Requires nuclei installed on PATH.',
  async isAvailable() {
    return isToolAvailable('nuclei')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(scopeTarget(target))
    if (!scope.allowed) return skip('nuclei', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('nuclei')))
      return skip('nuclei', target, installHint('nuclei'))

    const o = opts.options ?? {}
    const args = ['-u', target, '-jsonl', '-silent']
    if (Array.isArray(o.templates)) (o.templates as string[]).forEach(t => args.push('-t', t))
    if (Array.isArray(o.severity)) args.push('-severity', (o.severity as string[]).join(','))
    if (Array.isArray(o.tags)) args.push('-tags', (o.tags as string[]).join(','))
    if (Array.isArray(o.excludeTags)) args.push('-exclude-tags', (o.excludeTags as string[]).join(','))
    if (typeof o.rateLimit === 'number') args.push('-rate-limit', String(o.rateLimit))

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('nuclei', args, ((o.timeout as number) || 300) * 1000)
    const findings = parseNuclei(stdout)
    return {
      tool: 'nuclei',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} issues` : 'No issues found',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
