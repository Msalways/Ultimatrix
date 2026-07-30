import { isUrlInScope } from '../../safety/scope-guard'
import {isToolAvailable, installHint, runBinary, tempFile} from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}

function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

function parseSqlMap(stdout: string): AdapterFinding[] {
  const findings: AdapterFinding[] = []
  for (const line of stdout.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (/injectable|VULNERABLE/i.test(t)) {
      findings.push({ severity: 'high', detail: t, raw: t })
      continue
    }
    const m = t.match(/Type:\s*(\w[\w-]*)/i)
    if (m) {
      findings.push({ severity: 'high', detail: `SQL injection (${m[1]}): ${t}`, raw: t })
    }
  }
  return findings
}

export const sqlmapAdapter: ToolAdapter = {
  id: 'sqlmap',
  description:
    'Automated SQL injection testing. Runs the local sqlmap binary against a URL to detect and exploit SQL injection in parameters, POST data, and cookies. Requires sqlmap installed on PATH.',
  async isAvailable() {
    return isToolAvailable('sqlmap')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(scopeTarget(target))
    if (!scope.allowed) return skip('sqlmap', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('sqlmap')))
      return skip('sqlmap', target, installHint('sqlmap'))

    const o = opts.options ?? {}
    const requestFile = typeof o.requestFile === 'string' ? o.requestFile : null
    const args = ['--batch', '--flush-session', `--output-dir=${tempFile('um-sqli')}`]
    if (requestFile) {
      args.push('-r', requestFile)
    } else {
      args.push('-u', target)
    }
    if (typeof o.method === 'string') args.push('--method', o.method)
    if (typeof o.data === 'string') args.push('--data', o.data)
    if (typeof o.cookie === 'string') args.push('--cookie', o.cookie)
    if (o.headers && typeof o.headers === 'object') {
      for (const [k, v] of Object.entries(o.headers as Record<string, string>)) args.push('--header', `${k}: ${v}`)
    }
    if (typeof o.level === 'number') args.push('--level', String(o.level))
    if (typeof o.risk === 'number') args.push('--risk', String(o.risk))
    if (typeof o.threads === 'number') args.push('--threads', String(o.threads))
    if (Array.isArray(o.tamper)) args.push('--tamper', (o.tamper as string[]).join(','))

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('sqlmap', args, ((o.timeout as number) || 120) * 1000)
    const findings = parseSqlMap(stdout + '')
    return {
      tool: 'sqlmap',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} SQL injection point(s)` : 'No SQL injection found',
      findings: findings.map(f => ({ ...f, url: target })),
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
