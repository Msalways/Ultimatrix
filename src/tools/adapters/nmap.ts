import { isUrlInScope } from '../../safety/scope-guard'
import {isToolAvailable, installHint, runBinary} from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseNmap(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const m = line.match(/(\d+)\/(\w+)\s+open\s+(\S+)\s*(.*)?/)
    if (m) {
      findings.push({
        severity: 'info',
        detail: `Port ${m[1]}/${m[2]}: ${m[3]} ${(m[4] || '').trim()}`,
        raw: line,
      })
    }
  }
  return findings
}

export const nmapAdapter: ToolAdapter = {
  id: 'nmap',
  description:
    'Network port/service scanner. Runs the local nmap binary to discover open ports, services, and versions on a target host. Requires nmap installed on PATH.',
  async isAvailable() {
    return isToolAvailable('nmap')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    // nmap targets a host, not a URL; scope-check via an http:// prefix.
    const scope = isUrlInScope(`http://${target.replace(/^https?:\/\//, '')}`)
    if (!scope.allowed) return skip('nmap', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('nmap'))) return skip('nmap', target, installHint('nmap'))

    const o = opts.options ?? {}
    const args = [target]
    if (typeof o.ports === 'string') args.push('-p', o.ports)
    if (Array.isArray(o.scripts)) args.push('--script', (o.scripts as string[]).join(','))
    if (typeof o.timing === 'number') args.push(`-T${o.timing}`)
    if (o.serviceVersion) args.push('-sV')

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('nmap', args, ((o.timeout as number) || 300) * 1000)
    const findings = parseNmap(stdout)
    return {
      tool: 'nmap',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} open port(s)/service(s)` : 'Scan complete',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
