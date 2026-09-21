/**
 * Sandbox Adapter (Phase S — Execution Backend).
 *
 * Wraps any ToolAdapter with Docker sandbox fallback:
 * 1. Try local execution first
 * 2. If tool not available locally AND sandbox available → run in sandbox
 * 3. If neither available → skip with reason
 */

import type { ToolAdapter, AdapterOpts, ToolResult } from '../tools/adapters/types'
import type { SandboxManager } from './sandbox-manager'
import type { SandboxCommand } from './types'

/** Function that converts adapter opts to a sandbox command */
export type CommandBuilder = (opts: AdapterOpts) => SandboxCommand

/**
 * Create a sandbox-aware adapter that wraps a local adapter with Docker fallback.
 *
 * @param localAdapter - The original tool adapter (local execution)
 * @param sandboxManager - The sandbox manager for container execution
 * @param commandBuilder - Function to convert adapter opts to sandbox commands
 * @returns A new ToolAdapter that tries local first, then sandbox
 */
export function createSandboxAdapter(
  localAdapter: ToolAdapter,
  sandboxManager: SandboxManager,
  commandBuilder: CommandBuilder,
): ToolAdapter {
  return {
    id: localAdapter.id,
    description: localAdapter.description,

    async isAvailable(): Promise<boolean> {
      // Available if either local or sandbox can run it
      const localAvail = await localAdapter.isAvailable()
      if (localAvail) return true
      return sandboxManager.isAvailable()
    },

    async run(opts: AdapterOpts): Promise<ToolResult> {
      // 1. Try local execution first
      const localAvail = await localAdapter.isAvailable()
      if (localAvail) {
        return localAdapter.run(opts)
      }

      // 2. Try sandbox execution
      // Lazy startup keeps tool registration cheap, while making the Docker
      // backend real when an external tool is actually selected.
      if (!sandboxManager.isAvailable()) await sandboxManager.ensureReady()
      if (sandboxManager.isAvailable()) {
        const command = commandBuilder(opts)
        const result = await sandboxManager.execute(command)
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n')

        return {
          tool: localAdapter.id,
          target: opts.target,
          status: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'success' : 'error',
          output,
          findings: localAdapter.parseOutput?.(output, opts) ?? [],
          duration: result.durationMs,
          rawOutput: output,
        }
      }

      // 3. Neither available — skip
      return {
        tool: localAdapter.id,
        target: opts.target,
        status: 'skip',
        output: `${localAdapter.id} not available locally and sandbox is unavailable: ${sandboxManager.getStatus().diagnostic ?? 'sandbox is not configured or Docker is unavailable'}`,
        findings: [],
        duration: 0,
      }
    },
  }
}

/**
 * Pre-built command builders for common security tools.
 * Each returns a SandboxCommand with the correct arg-array for execFile.
 */
export const TOOL_COMMANDS: Record<string, CommandBuilder> = {
  nuclei: (opts) => ({
    toolId: 'nuclei',
    args: ['nuclei', '-target', opts.target, '-jsonl', ...(opts.options?.templates ? ['-t', String(opts.options.templates)] : [])],
  }),
  sqlmap: (opts) => ({
    toolId: 'sqlmap',
    args: ['python3', '-m', 'sqlmap', '-u', opts.target, '--batch', '--output-dir=/tmp/sqlmap-out'],
  }),
  ffuf: (opts) => ({
    toolId: 'ffuf',
    args: ['ffuf', '-u', `${opts.target}/FUZZ`, '-w', String(opts.options?.wordlist ?? '/usr/share/seclists/Discovery/Web-Content/common.txt'), '-o', '/dev/stdout', '-of', 'json'],
  }),
  nmap: (opts) => ({
    toolId: 'nmap',
    user: 'root',
    // Kali's /usr/bin/nmap wrapper attempts a second exec that Docker
    // Desktop's seccomp profile rejects. Invoke the verified binary directly.
    args: ['/usr/lib/nmap/nmap', '-sV', '-oX', '/tmp/nmap-out.xml', opts.target],
  }),
  gobuster: (opts) => ({
    toolId: 'gobuster',
    args: ['gobuster', 'dir', '-u', opts.target, '-w', '/usr/share/seclists/Discovery/Web-Content/common.txt'],
  }),
  nikto: (opts) => ({
    toolId: 'nikto',
    args: ['nikto', '-h', opts.target, '-Format', 'json', '-output', '/tmp/nikto-out.json'],
  }),
  masscan: (opts) => ({
    toolId: 'masscan',
    user: 'root',
    args: ['masscan', opts.target, '-p0-65535', '--rate=1000', '-oJ', '/tmp/masscan-out.json'],
  }),
  subfinder: (opts) => ({
    toolId: 'subfinder',
    args: ['subfinder', '-d', opts.target, '-o', '/tmp/subfinder-out.txt'],
  }),
  httpx: (opts) => ({
    toolId: 'httpx',
    args: ['httpx', '-l', '/dev/stdin', '-json', '-o', '/tmp/httpx-out.json'],
  }),
  jwttool: (opts) => {
    const token = String(opts.options?.token ?? opts.target)
    const modes = Array.isArray(opts.options?.modes) ? (opts.options?.modes as unknown[]).map(String) : ['-a', '-T', '-I', '-n', '-b']
    return { toolId: 'jwttool', args: ['jwt_tool', token, ...modes] }
  },
  arjun: (opts) => ({
    toolId: 'arjun',
    args: ['arjun', '-u', opts.target, '--quiet', '-w', String(opts.options?.wordlist ?? '/opt/wordlists/params.txt')],
  }),
  corsy: (opts) => ({
    toolId: 'corsy',
    args: ['corsy', '-u', opts.target, ...(typeof opts.options?.headers === 'string' ? ['-h', opts.options.headers] : [])],
  }),
  hydra: (opts) => {
    // Hydra requires a protocol/service positional argument. SSH is the
    // conservative default; callers can select another service explicitly.
    const service = String(opts.options?.service ?? 'ssh')
    const userList = String(opts.options?.userList ?? '')
    const passwordList = String(opts.options?.passwordList ?? '')
    return { toolId: 'hydra', args: ['hydra', '-L', userList, '-P', passwordList, '-f', '-V', opts.target, service] }
  },
  john: (opts) => ({
    toolId: 'john',
    args: ['john', String(opts.options?.hashFile ?? ''), ...(typeof opts.options?.wordlist === 'string' ? [`--wordlist=${opts.options.wordlist}`] : [])],
  }),
  gitleaks: (opts) => ({
    toolId: 'gitleaks',
    // stdout keeps the report available to the parent process; writing a
    // container-local temp file would otherwise discard every finding.
    args: ['gitleaks', 'detect', '--source', String(opts.options?.source ?? opts.target), '--report-format', 'json', '--report-path', '/dev/stdout', '--no-banner', '--redact'],
  }),
}
