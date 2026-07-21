import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary, defaultWordlistDir } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}
function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseArjun(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    // arjun reports: "Parameter(s) found: x,y,z" or "Valid parameter: x"
    const m = t.match(/parameter(?:\(s\))? found:?\s*(.+)/i) || t.match(/valid parameter:?\s*(\S+)/i)
    if (m) {
      findings.push({ url: undefined, severity: 'info', detail: `Hidden parameter(s): ${m[1]}`, raw: t })
    }
  }
  return findings
}

export const arjunAdapter: ToolAdapter = {
  id: 'arjun',
  description:
    'Hidden HTTP parameter discovery. Runs the local arjun binary to find unlinked GET/POST parameters on an endpoint. Requires arjun installed on PATH.',
  async isAvailable() {
    return isToolAvailable('arjun')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(scopeTarget(target))
    if (!scope.allowed) return skip('arjun', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('arjun'))) return skip('arjun', target, installHint('arjun'))

    const o = opts.options ?? {}
    const args = ['-u', target, '--quiet']
    if (typeof o.wordlist === 'string') args.push('-w', o.wordlist)
    else args.push('-w', `${defaultWordlistDir()}/params.txt`)

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('arjun', args, ((o.timeout as number) || 120) * 1000)
    const findings = parseArjun(stdout)
    return {
      tool: 'arjun',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} parameter finding(s)` : 'No hidden parameters found',
      findings: findings.map(f => ({ ...f, url: target })),
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
