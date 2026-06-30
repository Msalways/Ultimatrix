import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const execAsync = promisify(exec)


export interface ToolResult {
  tool: string
  target: string
  status: 'success' | 'error' | 'timeout'
  output: string
  findings: string[]
  duration: number
  rawOutput?: string
}

// ─── SQLMap ────────────────────────────────────────────
export interface SqlMapOptions {
  url: string
  method?: string
  data?: string
  cookie?: string
  level?: number
  risk?: number
  threads?: number
  timeout?: number
  tamper?: string[]
}

export async function runSqlMap(options: SqlMapOptions): Promise<ToolResult> {
  if (!options.url) {
    return { tool: 'sqlmap', target: '', status: 'error', output: 'URL is required', findings: [], duration: 0 }
  }
  const startTime = Date.now()
  const args: string[] = [
    '-u', `"${options.url}"`,
    '--batch',
    '--flush-session',
    '--output-dir="/tmp/ultimatrix-sqli"',
  ]

  if (options.method) args.push('--method', options.method)
  if (options.data) args.push('--data', `"${options.data}"`)
  if (options.cookie) args.push('--cookie', `"${options.cookie}"`)
  if (options.level) args.push('--level', String(options.level))
  if (options.risk) args.push('--risk', String(options.risk))
  if (options.threads) args.push('--threads', String(options.threads))
  if (options.tamper) args.push('--tamper', options.tamper.join(','))

  try {
    const { stdout, stderr } = await execAsync(
      `sqlmap ${args.join(' ')}`,
      { timeout: (options.timeout || 120) * 1000 }
    )

    const output = stdout + stderr
    const findings = parseSqlMapOutput(output)

    return {
      tool: 'sqlmap',
      target: options.url,
      status: 'success',
      output: findings.length > 0 ? `Found ${findings.length} SQL injection points` : 'No SQL injection found',
      findings,
      duration: Date.now() - startTime,
      rawOutput: output,
    }
  } catch (error: any) {
    return {
      tool: 'sqlmap',
      target: options.url,
      status: error.killed ? 'timeout' : 'error',
      output: error.message,
      findings: [],
      duration: Date.now() - startTime,
    }
  }
}

function parseSqlMapOutput(output: string): string[] {
  const findings: string[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    if (line.includes('injectable') || line.includes('VULNERABLE')) {
      findings.push(line.trim())
    }
    if (line.includes('Type:') && line.includes('boolean-based')) {
      findings.push(`Boolean-based blind: ${line.trim()}`)
    }
    if (line.includes('Type:') && line.includes('time-based')) {
      findings.push(`Time-based blind: ${line.trim()}`)
    }
    if (line.includes('Type:') && line.includes('UNION query')) {
      findings.push(`UNION query: ${line.trim()}`)
    }
  }

  return findings
}

// ─── ffuf ──────────────────────────────────────────────
export interface FfufOptions {
  url: string
  wordlist: string
  extensions?: string[]
  threads?: number
  timeout?: number
  filterStatus?: number[]
  matchStatus?: number[]
  headers?: Record<string, string>
}

export async function runFfuf(options: FfufOptions): Promise<ToolResult> {
  if (!options.url) {
    return { tool: 'ffuf', target: '', status: 'error', output: 'URL is required', findings: [], duration: 0 }
  }
  if (!options.wordlist) {
    return { tool: 'ffuf', target: options.url, status: 'error', output: 'Wordlist is required', findings: [], duration: 0 }
  }
  const startTime = Date.now()
  const args: string[] = [
    '-u', `"${options.url}"`,
    '-w', options.wordlist,
    '-o', '/tmp/ultimatrix-ffuf.json',
    '-of', 'json',
    '-s',
  ]

  if (options.extensions) args.push('-e', options.extensions.join(','))
  if (options.threads) args.push('-t', String(options.threads))
  if (options.filterStatus) args.push('-fc', options.filterStatus.join(','))
  if (options.matchStatus) args.push('-mc', options.matchStatus.join(','))
  if (options.headers) {
    for (const [name, value] of Object.entries(options.headers)) {
      args.push('-H', `"${name}: ${value}"`)
    }
  }

  try {
    const { stdout, stderr } = await execAsync(
      `ffuf ${args.join(' ')}`,
      { timeout: (options.timeout || 60) * 1000 }
    )

    const output = stdout + stderr
    let findings: string[] = []

    // Try to parse JSON output
    try {
      if (existsSync('/tmp/ultimatrix-ffuf.json')) {
        const jsonContent = await readFile('/tmp/ultimatrix-ffuf.json', 'utf-8')
        const data = JSON.parse(jsonContent)
        findings = (data.results || []).map((r: any) =>
          `${r.status} ${r.url} [Words:${r.words} Lines:${r.lines}]`
        )
        await rm('/tmp/ultimatrix-ffuf.json', { force: true })
      }
    } catch {
      // Fall back to stdout parsing
      findings = parseFfufOutput(output)
    }

    return {
      tool: 'ffuf',
      target: options.url,
      status: 'success',
      output: findings.length > 0 ? `Found ${findings.length} endpoints` : 'No endpoints found',
      findings,
      duration: Date.now() - startTime,
      rawOutput: output,
    }
  } catch (error: any) {
    return {
      tool: 'ffuf',
      target: options.url,
      status: error.killed ? 'timeout' : 'error',
      output: error.message,
      findings: [],
      duration: Date.now() - startTime,
    }
  }
}

function parseFfufOutput(output: string): string[] {
  const findings: string[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    // ffuf output lines typically: [Status: 200, Size: 1234, Words: 56, Lines: 12, URL: http://...]
    const match = line.match(/\[Status:\s*(\d+).*?URL:\s*(.+?)\]/)
    if (match) {
      findings.push(`Status ${match[1]}: ${match[2]}`)
    }
  }

  return findings
}

// ─── Nuclei ────────────────────────────────────────────
export interface NucleiOptions {
  url: string
  templates?: string[]
  severity?: string[]
  rateLimit?: number
  timeout?: number
  tags?: string[]
  excludeTags?: string[]
}

export async function runNuclei(options: NucleiOptions): Promise<ToolResult> {
  if (!options.url) {
    return { tool: 'nuclei', target: '', status: 'error', output: 'URL is required', findings: [], duration: 0 }
  }
  const startTime = Date.now()
  const args: string[] = [
    '-u', options.url,
    '-jsonl',
    '-silent',
  ]

  if (options.templates) {
    for (const t of options.templates) {
      args.push('-t', t)
    }
  }
  if (options.severity) args.push('-severity', options.severity.join(','))
  if (options.rateLimit) args.push('-rate-limit', String(options.rateLimit))
  if (options.tags) args.push('-tags', options.tags.join(','))
  if (options.excludeTags) args.push('-exclude-tags', options.excludeTags.join(','))

  try {
    const { stdout, stderr } = await execAsync(
      `nuclei ${args.join(' ')}`,
      { timeout: (options.timeout || 300) * 1000 }
    )

    const output = stdout + stderr
    const findings = parseNucleiOutput(output)

    return {
      tool: 'nuclei',
      target: options.url,
      status: 'success',
      output: findings.length > 0 ? `Found ${findings.length} vulnerabilities` : 'No vulnerabilities found',
      findings,
      duration: Date.now() - startTime,
      rawOutput: output,
    }
  } catch (error: any) {
    return {
      tool: 'nuclei',
      target: options.url,
      status: error.killed ? 'timeout' : 'error',
      output: error.message,
      findings: [],
      duration: Date.now() - startTime,
    }
  }
}

function parseNucleiOutput(output: string): string[] {
  const findings: string[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    try {
      const data = JSON.parse(line)
      if (data['template-id'] || data.info) {
        const severity = data.info?.severity || 'unknown'
        const name = data['template-id'] || data.name || 'unknown'
        findings.push(`[${severity.toUpperCase()}] ${name}: ${data['matched-at'] || data.host || ''}`)
      }
    } catch {
      // Not JSON, try plain text parsing
      if (line.includes('[critical]') || line.includes('[high]') || line.includes('[medium]') || line.includes('[low]')) {
        findings.push(line.trim())
      }
    }
  }

  return findings
}

// ─── Nmap ──────────────────────────────────────────────
export interface NmapOptions {
  host: string
  ports?: string
  scripts?: string[]
  timing?: number
  timeout?: number
  serviceVersion?: boolean
}

export async function runNmap(options: NmapOptions): Promise<ToolResult> {
  if (!options.host) {
    return { tool: 'nmap', target: '', status: 'error', output: 'Host is required', findings: [], duration: 0 }
  }
  const startTime = Date.now()
  const args: string[] = [options.host]

  if (options.ports) args.push('-p', options.ports)
  if (options.scripts) args.push('--script', options.scripts.join(','))
  if (options.timing) args.push(`-T${options.timing}`)
  if (options.serviceVersion) args.push('-sV')
  args.push('-oX', '/tmp/ultimatrix-nmap.xml')

  try {
    const { stdout, stderr } = await execAsync(
      `nmap ${args.join(' ')}`,
      { timeout: (options.timeout || 300) * 1000 }
    )

    const output = stdout + stderr
    const findings = parseNmapOutput(output)

    return {
      tool: 'nmap',
      target: options.host,
      status: 'success',
      output: findings.length > 0 ? `Found ${findings.length} open ports/services` : 'Scan complete',
      findings,
      duration: Date.now() - startTime,
      rawOutput: output,
    }
  } catch (error: any) {
    return {
      tool: 'nmap',
      target: options.host,
      status: error.killed ? 'timeout' : 'error',
      output: error.message,
      findings: [],
      duration: Date.now() - startTime,
    }
  }
}

function parseNmapOutput(output: string): string[] {
  const findings: string[] = []
  const lines = output.split('\n')

  for (const line of lines) {
    // Match open port lines: 80/tcp open http Apache/2.4.41
    const match = line.match(/(\d+)\/(\w+)\s+open\s+(\S+)\s*(.*)?/)
    if (match) {
      findings.push(`Port ${match[1]}/${match[2]}: ${match[3]} ${match[4] || ''}`.trim())
    }
  }

  return findings
}
