import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function domainOf(target: string): string {
  const t = target.replace(/^https?:\/\//, '')
  return t.split('/')[0] || t
}
function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

export const subfinderAdapter: ToolAdapter = {
  id: 'subfinder',
  description:
    'Passive subdomain enumeration. Runs the local subfinder binary to discover subdomains of a target domain from public sources. Requires subfinder installed on PATH.',
  async isAvailable() {
    return isToolAvailable('subfinder')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const domain = domainOf(target)
    const scope = isUrlInScope(`http://${domain}`)
    if (!scope.allowed) return skip('subfinder', domain, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('subfinder'))) return skip('subfinder', domain, installHint('subfinder'))

    const o = opts.options ?? {}
    const args = ['-d', domain, '-silent']
    if (Array.isArray(o.sources)) args.push('-s', (o.sources as string[]).join(','))

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('subfinder', args, ((o.timeout as number) || 180) * 1000)
    const findings: AdapterFinding[] = []
    for (const line of stdout.split('\n')) {
      const sub = line.trim()
      if (!sub || !sub.includes('.')) continue
      findings.push({ url: `https://${sub}`, severity: 'info', detail: `Subdomain: ${sub}`, raw: sub })
    }
    return {
      tool: 'subfinder',
      target: domain,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} subdomain(s)` : 'No subdomains found',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
