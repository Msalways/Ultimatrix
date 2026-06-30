import { runSqlMap, runFfuf, runNuclei, runNmap } from './traditional-tools'
import type {
  SqlMapOptions,
  FfufOptions,
  NucleiOptions,
  NmapOptions,
  ToolResult,
} from './traditional-tools'

export type ToolName = 'sqlmap' | 'ffuf' | 'nuclei' | 'nmap'

export interface DelegationRequest {
  tool: ToolName
  target: string
  options: Record<string, unknown>
}

export interface DelegationResult {
  tool: ToolName
  result: ToolResult
  suggestedNext: ToolName[]
}

const TOOL_SUGGESTIONS: Record<ToolName, ToolName[]> = {
  sqlmap: ['nuclei', 'ffuf'],
  ffuf: ['nuclei', 'sqlmap'],
  nuclei: ['sqlmap', 'ffuf'],
  nmap: ['nuclei', 'ffuf'],
}

export async function delegate(request: DelegationRequest): Promise<DelegationResult> {
  let result: ToolResult

  try {
    switch (request.tool) {
      case 'sqlmap': {
        const opts: SqlMapOptions = { url: request.target, ...request.options } as SqlMapOptions
        result = await runSqlMap(opts)
        break
      }
      case 'ffuf': {
        const opts: FfufOptions = { url: request.target, wordlist: (request.options.wordlist as string) || '/usr/share/wordlists/common.txt', ...request.options } as FfufOptions
        result = await runFfuf(opts)
        break
      }
      case 'nuclei': {
        const opts: NucleiOptions = { url: request.target, ...request.options } as NucleiOptions
        result = await runNuclei(opts)
        break
      }
      case 'nmap': {
        const opts: NmapOptions = { host: request.target, ...request.options } as NmapOptions
        result = await runNmap(opts)
        break
      }
      default:
        result = {
          tool: request.tool,
          target: request.target,
          status: 'error',
          output: `Unknown tool: ${request.tool}`,
          findings: [],
          duration: 0,
        }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    result = {
      tool: request.tool,
      target: request.target,
      status: 'error',
      output: `Delegation failed: ${msg}`,
      findings: [],
      duration: 0,
    }
  }

  return {
    tool: request.tool,
    result,
    suggestedNext: TOOL_SUGGESTIONS[request.tool] || [],
  }
}

export function getAvailableTools(): ToolName[] {
  return ['sqlmap', 'ffuf', 'nuclei', 'nmap']
}

export function getToolDescription(tool: ToolName): string {
  const descriptions: Record<ToolName, string> = {
    sqlmap: 'Automated SQL injection testing. Tests URL parameters, POST data, and cookies for SQL injection vulnerabilities.',
    ffuf: 'Fast web fuzzer. Discovers hidden endpoints, files, and directories by brute-forcing with a wordlist.',
    nuclei: 'Template-based vulnerability scanner. Checks for known CVEs, misconfigurations, and common vulnerabilities.',
    nmap: 'Network port scanner. Discovers open ports, services, and versions on target hosts.',
  }
  return descriptions[tool]
}

export function shouldDelegate(hypothesis: string): { tool: ToolName; reason: string } | null {
  const lower = hypothesis.toLowerCase()

  if (lower.includes('sql injection') || lower.includes('sqli') || lower.includes('database')) {
    return { tool: 'sqlmap', reason: 'SQL injection hypothesis detected' }
  }

  if (lower.includes('directory') || lower.includes('file') || lower.includes('hidden') || lower.includes('endpoint')) {
    return { tool: 'ffuf', reason: 'Directory/file discovery hypothesis detected' }
  }

  if (lower.includes('cve') || lower.includes('known vulnerability') || lower.includes('misconfiguration')) {
    return { tool: 'nuclei', reason: 'Known vulnerability hypothesis detected' }
  }

  if (lower.includes('port') || lower.includes('service') || lower.includes('host')) {
    return { tool: 'nmap', reason: 'Port/service discovery hypothesis detected' }
  }

  return null
}
