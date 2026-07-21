import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}
function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseJwtTool(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/SUCCESSFULLY|Forged|VULNERABILITY|weak (secret|key)|key confusion|alg.*none/i.test(t)) {
      findings.push({ severity: 'high', detail: t, raw: t })
    }
  }
  return findings
}

export const jwtToolAdapter: ToolAdapter = {
  id: 'jwttool',
  description:
    'JWT attack toolkit. Runs the local jwt_tool binary against a supplied token to test alg:none forgery, RSA->HMAC key confusion, and weak-secret cracking. Requires jwt-tool installed on PATH.',
  async isAvailable() {
    return isToolAvailable('jwttool')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const o = opts.options ?? {}
    const token = (o.token as string) || target
    if (!token || !token.includes('.')) return skip('jwttool', target, 'A JWT token is required (options.token)')
    const scope = isUrlInScope(scopeTarget(target || 'http://local'))
    if (!scope.allowed) return skip('jwttool', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('jwttool'))) return skip('jwttool', target, installHint('jwttool'))

    const args = [token]
    if (Array.isArray(o.modes)) args.push(...(o.modes as string[]))
    else args.push('-a', '-T', '-I', '-n', '-b')
    if (typeof o.wordlist === 'string') args.push('-w', o.wordlist)

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('jwttool', args, ((o.timeout as number) || 120) * 1000)
    const findings = parseJwtTool(stdout)
    return {
      tool: 'jwttool',
      target: token,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} JWT weakness(es)` : 'No JWT weakness found',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
