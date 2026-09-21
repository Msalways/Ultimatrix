import { isUrlInScope } from '../../safety/scope-guard'
import { isToolAvailable, installHint, runBinary } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

function skip(target: string, reason: string): ToolResult {
  return { tool: 'hydra', target, status: 'skip', output: reason, findings: [], duration: 0 }
}

/** Explicitly configured online credential testing. Never picks defaults. */
export const hydraAdapter: ToolAdapter = {
  id: 'hydra',
  description: 'Authorized online credential-audit tool. Requires explicit service, username list, and password list options; never chooses brute-force parameters implicitly.',
  async isAvailable() { return isToolAvailable('hydra') },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    const scope = isUrlInScope(/^https?:\/\//i.test(target) ? target : `http://${target}`)
    if (!scope.allowed) return skip(target, `Out of scope: ${scope.reason ?? 'denied'}`)
    if (!(await isToolAvailable('hydra'))) return skip(target, installHint('hydra'))
    const o = opts.options ?? {}
    const service = typeof o.service === 'string' ? o.service : ''
    const userList = typeof o.userList === 'string' ? o.userList : ''
    const passList = typeof o.passwordList === 'string' ? o.passwordList : ''
    if (!service || !userList || !passList) return skip(target, 'Hydra requires options.service, options.userList, and options.passwordList; refusing implicit guessing.')
    const args = ['-L', userList, '-P', passList, '-f', '-V', target, service]
    const start = Date.now()
    const result = await runBinary('hydra', args, ((o.timeout as number) || 120) * 1000)
    const lines = `${result.stdout}\n${result.stderr}`.split('\n').map(line => line.trim()).filter(Boolean)
    const findings: AdapterFinding[] = lines.filter(line => /login:|password:/i.test(line)).map(line => ({ severity: 'high', detail: line, raw: line }))
    return { tool: 'hydra', target, status: result.timedOut ? 'timeout' : 'success', output: result.stdout || result.stderr, findings, duration: Date.now() - start, rawOutput: `${result.stdout}\n${result.stderr}` }
  },
}
