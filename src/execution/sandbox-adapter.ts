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
      if (sandboxManager.isAvailable()) {
        const command = commandBuilder(opts)
        const result = await sandboxManager.execute(command)

        return {
          tool: localAdapter.id,
          target: opts.target,
          status: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'success' : 'error',
          output: result.stdout,
          findings: [], // Findings are extracted by the bridge, not here
          duration: result.durationMs,
          rawOutput: result.stdout,
        }
      }

      // 3. Neither available — skip
      return {
        tool: localAdapter.id,
        target: opts.target,
        status: 'skip',
        output: `${localAdapter.id} not available locally and sandbox not configured`,
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
    args: ['ffuf', '-u', `${opts.target}/FUZZ`, '-w', '/usr/share/seclists/Discovery/Web-Content/common.txt', '-o', '/tmp/ffuf-out.json', '-of', 'json'],
  }),
  nmap: (opts) => ({
    toolId: 'nmap',
    args: ['nmap', '-sV', '-oX', '/tmp/nmap-out.xml', opts.target],
  }),
  gobuster: (opts) => ({
    toolId: 'gobuster',
    args: ['gobuster', 'dir', '-u', opts.target, '-w', '/usr/share/seclists/Discovery/Web-Content/common.txt'],
  }),
  nikto: (opts) => ({
    toolId: 'nikto',
    args: ['nikto', '-h', opts.target, '-Format', 'json', '-output', '/tmp/nikto-out.json'],
  }),
  hydra: (opts) => ({
    toolId: 'hydra',
    args: ['hydra', '-L', '/usr/share/seclists/Usernames/top-usernames-shortlist.txt', '-P', '/usr/share/seclists/Passwords/Common-Credentials/top-1000.txt', opts.target, 'ssh'],
  }),
  masscan: (opts) => ({
    toolId: 'masscan',
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
}
