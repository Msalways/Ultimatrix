import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}
function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseCorsy(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/vulnerab|misconfig|reflect|wildcard|null origin|post|get|put|delete/i.test(t) && /cors/i.test(t)) {
      findings.push({ severity: 'medium', detail: t, raw: t })
    } else if (/vulnerab|exploitable/i.test(t)) {
      findings.push({ severity: 'medium', detail: t, raw: t })
    }
  }
  return findings
}

export const corsyAdapter: ToolAdapter = {
  id: 'corsy',
  description:
    'CORS misconfiguration scanner. Runs the local corsy binary to detect exploitable cross-origin resource sharing on a target URL. Requires corsy installed on PATH.',
  async isAvailable() {
    return isToolAvailable('corsy')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(scopeTarget(target))
    if (!scope.allowed) return skip('corsy', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('corsy'))) return skip('corsy', target, installHint('corsy'))

    const o = opts.options ?? {}
    const args = ['-u', target]
    if (typeof o.headers === 'string') args.push('-h', o.headers)

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('corsy', args, ((o.timeout as number) || 120) * 1000)
    const findings = parseCorsy(stdout)
    return {
      tool: 'corsy',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} CORS issue(s)` : 'No CORS misconfiguration found',
      findings: findings.map(f => ({ ...f, url: target })),
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
