import { isToolAvailable, installHint, runBinary } from './common'
import type { AdapterFinding, ToolAdapter, ToolResult } from './types'

export const johnAdapter: ToolAdapter = {
  id: 'john',
  description: 'Authorized offline password-hash audit. Requires an explicit hash file path and optional wordlist; never attacks a live service.',
  async isAvailable() { return isToolAvailable('john') },
  async run(opts): Promise<ToolResult> {
    const target = opts.target
    if (!(await isToolAvailable('john'))) return { tool: 'john', target, status: 'skip', output: installHint('john'), findings: [], duration: 0 }
    const o = opts.options ?? {}
    const hashFile = typeof o.hashFile === 'string' ? o.hashFile : ''
    if (!hashFile) return { tool: 'john', target, status: 'skip', output: 'John requires options.hashFile; refusing implicit file selection.', findings: [], duration: 0 }
    const args = [hashFile]
    if (typeof o.wordlist === 'string') args.push(`--wordlist=${o.wordlist}`)
    const start = Date.now()
    const result = await runBinary('john', args, ((o.timeout as number) || 180) * 1000)
    const output = `${result.stdout}\n${result.stderr}`
    const findings: AdapterFinding[] = output.split('\n').filter(line => /password hash cracked|\(.+\)/i.test(line)).map(line => ({ severity: 'high', detail: line.trim(), raw: line.trim() }))
    return { tool: 'john', target, status: result.timedOut ? 'timeout' : 'success', output, findings, duration: Date.now() - start, rawOutput: output }
  },
}
