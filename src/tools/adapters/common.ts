/**
 * Shared helpers for external-tool adapters.
 *
 * - `isToolAvailable`: cross-platform PATH check (cached), graceful skip when
 *   the binary is not installed.
 * - `runBinary`: `execFile` with an arg ARRAY (never string interpolation) so a
 *   crafted target/option cannot inject shell metacharacters. This is a
 *   deliberate security control — the binaries operate on user-supplied,
 *   in-scope targets, but defense-in-depth forbids shell expansion.
 * - `recordConfirmation`: issues a confirming request for a reported URL and
 *   records it into the structured evidence ledger so the finding can be
 *   evidence-gated before it becomes a Finding.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir, tmpdir, platform } from 'node:os'
import { verifyClaimStructured } from '../control-tools'
import { coreEvidenceLedger } from '../../core/evidence'
import { isUrlInScope } from '../../safety/scope-guard'
import type { AdapterFinding, AdapterSeverity, BridgeReport } from './types'

const execFileAsync = promisify(execFile)

const availabilityCache = new Map<string, boolean>()

/** Check whether an external binary is installed and on PATH (cached). */
export async function isToolAvailable(toolName: string): Promise<boolean> {
  if (availabilityCache.has(toolName)) return availabilityCache.get(toolName)!
  const cmd = platform() === 'win32' ? `where ${toolName}` : `which ${toolName}`
  try {
    await execFileAsync(platform() === 'win32' ? 'where' : 'which', [toolName])
    availabilityCache.set(toolName, true)
    return true
  } catch {
    availabilityCache.set(toolName, false)
    return false
  }
}

export function installHint(toolName: string): string {
  const hints: Record<string, string> = {
    nmap: 'Install nmap: https://nmap.org/download.html or `apt install nmap` / `brew install nmap`',
    sqlmap: 'Install sqlmap: `pip install sqlmap` or https://sqlmap.org',
    ffuf: 'Install ffuf: `go install github.com/ffuf/ffuf/v2@latest` or https://github.com/ffuf/ffuf',
    nuclei: 'Install nuclei: `go install github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest` or https://github.com/projectdiscovery/nuclei',
    jwttool: 'Install jwt_tool: `pip install jwt-tool` or https://github.com/ticarpi/jwt_tool',
    arjun: 'Install arjun: `pip install arjun` or https://github.com/s0md3v/Arjun',
    corsy: 'Install corsy: `pip install corsy` or https://github.com/sopheroo/Corsy',
    subfinder: 'Install subfinder: `go install github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest`',
    gitleaks: 'Install gitleaks: `go install github.com/gitleaks/gitleaks@latest` or https://github.com/gitleaks/gitleaks',
  }
  return `${toolName} is not installed or not on PATH. ${hints[toolName] ?? `Install ${toolName} and ensure it is on your PATH.`}`
}

export function defaultWordlistDir(): string {
  return join(homedir(), '.config', 'ultimatrix', 'wordlists')
}

export function tempFile(name: string): string {
  return join(tmpdir(), name)
}

export interface RunBinaryResult {
  stdout: string
  stderr: string
  timedOut: boolean
  error?: Error
}

/**
 * Run a binary with an arg ARRAY. `timeoutMs` kills the process on overrun.
 * Never build a shell command string from user input.
 */
export async function runBinary(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<RunBinaryResult> {
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    })
    return { stdout, stderr, timedOut: false }
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; killed?: boolean; message?: string }
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? String(error),
      timedOut: !!err.killed,
      error: error as Error,
    }
  }
}

/** Extract the first absolute URL from a free-text string (structured locator). */
export function extractUrl(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s"'<>)\]]+/i)
  return match ? match[0].replace(/[.,;]+$/, '') : undefined
}

export function normalizeSeverity(s: string | undefined): AdapterSeverity {
  const v = (s || '').toLowerCase()
  if (v.includes('critical')) return 'critical'
  if (v.includes('high')) return 'high'
  if (v.includes('medium') || v.includes('warn')) return 'medium'
  if (v.includes('low') || v.includes('info')) return 'info'
  return 'info'
}

/**
 * Re-verify a single external-tool finding against real evidence:
 *  1. If it carries a URL, confirm it is in scope.
 *  2. Issue a confirming request; record the observed response into the
 *     structured evidence ledger.
 *  3. Run verifyClaimStructured. Verified => confirmed; otherwise candidate.
 *
 * Returns the updated BridgeReport slices so callers can aggregate.
 */
export async function verifyFinding(
  finding: AdapterFinding,
): Promise<{ report: Pick<BridgeReport, 'confirmed' | 'candidates' | 'skipped' | 'evidenceIds'> }> {
  const empty = { confirmed: [] as AdapterFinding[], candidates: [] as AdapterFinding[], skipped: [] as AdapterFinding[], evidenceIds: [] as string[] }

  const url = finding.url ?? extractUrl(finding.detail)
  if (!url) {
    // No locatable target -> cannot independently confirm; keep as candidate.
    return { report: { ...empty, candidates: [finding] } }
  }

  const scope = isUrlInScope(url)
  if (!scope.allowed) {
    return { report: { ...empty, skipped: [{ ...finding, detail: `${finding.detail} [out of scope: ${scope.reason ?? 'denied'}]` }] } }
  }

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal })
    clearTimeout(timer)

    const body = await res.text().catch(() => '')
    const item = coreEvidenceLedger.record({
      type: 'raw_response',
      data: body.slice(0, 4000),
      label: `adapter confirmation ${url}`,
      observed: { method: 'GET', url, status: res.status },
    })

    const verification = verifyClaimStructured({
      type: finding.severity ?? 'external',
      endpoint: url,
      method: 'GET',
      observed: { status: res.status },
    })

    if (verification.verified) {
      return { report: { confirmed: [finding], candidates: [], skipped: [], evidenceIds: [item.id] } }
    }
    return { report: { confirmed: [], candidates: [finding], skipped: [], evidenceIds: [item.id] } }
  } catch {
    // Could not reach the target ourselves -> cannot confirm.
    return { report: { confirmed: [], candidates: [finding], skipped: [], evidenceIds: [] } }
  }
}
