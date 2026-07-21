import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary, tempFile, defaultWordlistDir, extractUrl } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function scopeTarget(target: string): string {
  return /^https?:\/\//i.test(target) ? target : `http://${target}`
}

function skip(tool: string, target: string, reason: string): ToolResult {
  return { tool, target, status: 'skip', output: reason, findings: [], duration: 0 }
}

export const ffufAdapter: ToolAdapter = {
  id: 'ffuf',
  description:
    'Fast web fuzzer. Runs the local ffuf binary to discover hidden endpoints, files, and directories by brute-forcing with a wordlist. Requires ffuf installed on PATH.',
  async isAvailable() {
    return isToolAvailable('ffuf')
  },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(scopeTarget(target))
    if (!scope.allowed) return skip('ffuf', target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('ffuf'))) return skip('ffuf', target, installHint('ffuf'))

    const o = opts.options ?? {}
    const wordlist = (o.wordlist as string) || `${defaultWordlistDir()}/common.txt`

    const outJson = tempFile('um-ffuf.json')
    const args = ['-u', target, '-w', wordlist, '-o', outJson, '-of', 'json', '-s']
    if (Array.isArray(o.extensions)) args.push('-e', (o.extensions as string[]).join(','))
    if (typeof o.threads === 'number') args.push('-t', String(o.threads))
    if (Array.isArray(o.filterStatus)) args.push('-fc', (o.filterStatus as number[]).join(','))
    if (Array.isArray(o.matchStatus)) args.push('-mc', (o.matchStatus as number[]).join(','))
    if (o.headers && typeof o.headers === 'object') {
      for (const [k, v] of Object.entries(o.headers as Record<string, string>)) args.push('-H', `${k}: ${v}`)
    }

    const start = Date.now()
    const { stdout, timedOut } = await runBinary('ffuf', args, ((o.timeout as number) || 60) * 1000)

    let findings: AdapterFinding[] = []
    try {
      if (existsSync(outJson)) {
        const data = JSON.parse(await readFile(outJson, 'utf-8')) as { results?: Array<{ status: number; url: string; words?: number; lines?: number }> }
        findings = (data.results || []).map(r => ({
          url: r.url,
          severity: 'info',
          detail: `Status ${r.status} ${r.url} [Words:${r.words ?? '?'} Lines:${r.lines ?? '?'}]`,
          raw: JSON.stringify(r),
        }))
        await rm(outJson, { force: true })
      }
    } catch {
      findings = []
    }
    if (findings.length === 0) {
      for (const line of stdout.split('\n')) {
        const m = line.match(/\[Status:\s*(\d+).*?URL:\s*(\S+?)\]/)
        if (m) findings.push({ url: m[2], severity: 'info', detail: `Status ${m[1]}: ${m[2]}`, raw: line })
      }
    }

    return {
      tool: 'ffuf',
      target,
      status: timedOut ? 'timeout' : 'success',
      output: findings.length ? `Found ${findings.length} endpoint(s)` : 'No endpoints found',
      findings,
      duration: Date.now() - start,
      rawOutput: stdout,
    }
  },
}
