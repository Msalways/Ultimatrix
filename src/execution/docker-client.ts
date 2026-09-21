/**
 * Docker Client (Phase S — Execution Backend).
 *
 * Thin wrapper around Docker CLI using execFile arg-arrays.
 * NO shell string interpolation — every argument is a separate array element.
 * This prevents command injection through crafted targets/options.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { SandboxResult, SandboxCommand } from './types'

const execFileAsync = promisify(execFile)

/** Options for executing a command in a container */
export interface ExecOptions {
  timeoutMs?: number
  workdir?: string
  env?: Record<string, string>
}

/**
 * Pull a Docker image.
 * Returns true on success, false on failure.
 */
export async function pullImage(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['pull', image], { timeout: 300_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Create a container with resource limits.
 * Returns the container ID on success.
 */
export async function createContainer(opts: {
  image: string
  name: string
  networkMode?: string
  memoryLimit?: string
  cpuQuota?: number
  readOnlyRoot?: boolean
  capabilities?: string[]
}): Promise<string> {
  const args = ['create', '--name', opts.name]

  if (opts.networkMode) args.push('--network', opts.networkMode)
  if (opts.memoryLimit) args.push('--memory', opts.memoryLimit)
  if (opts.cpuQuota) args.push('--cpus', String(opts.cpuQuota))
  if (opts.readOnlyRoot) args.push('--read-only')
  // Network scanners need raw sockets even as the unprivileged sandbox user.
  // Grant only explicit capabilities; never use Docker's --privileged mode.
  for (const capability of opts.capabilities ?? []) args.push('--cap-add', capability)

  // Keep container running
  args.push('--entrypoint', '/bin/sh', opts.image, '-c', 'sleep infinity')

  const { stdout } = await execFileAsync('docker', args)
  return stdout.trim()
}

/**
 * Start a container.
 */
export async function startContainer(containerId: string): Promise<void> {
  await execFileAsync('docker', ['start', containerId])
}

/**
 * Stop a container with timeout.
 */
export async function stopContainer(containerId: string, timeoutSec = 10): Promise<void> {
  try {
    await execFileAsync('docker', ['stop', '-t', String(timeoutSec), containerId], {
      timeout: (timeoutSec + 5) * 1000,
    })
  } catch {
    // Container may already be stopped
  }
}

/**
 * Remove a container (force remove).
 */
export async function removeContainer(containerId: string): Promise<void> {
  try {
    await execFileAsync('docker', ['rm', '-f', containerId])
  } catch {
    // Container may already be removed
  }
}

/**
 * Execute a command inside a running container.
 * Uses execFile arg-arrays — NO shell interpolation.
 */
export async function execInContainer(
  containerId: string,
  command: SandboxCommand,
  opts: ExecOptions = {},
): Promise<SandboxResult> {
  const startMs = Date.now()
  const timeoutMs = command.timeoutMs ?? opts.timeoutMs ?? 300_000

  const execArgs = ['exec']

  if (opts.workdir || command.workdir) {
    execArgs.push('-w', opts.workdir ?? command.workdir!)
  }

  if (command.user) execArgs.push('-u', command.user)

  if (command.env || opts.env) {
    const env = { ...opts.env, ...command.env }
    for (const [key, value] of Object.entries(env)) {
      execArgs.push('-e', `${key}=${value}`)
    }
  }

  execArgs.push(containerId, ...command.args)

  try {
    const { stdout, stderr } = await execFileAsync('docker', execArgs, {
      timeout: timeoutMs,
    })
    return {
      stdout,
      stderr: stderr ?? '',
      exitCode: 0,
      durationMs: Date.now() - startMs,
      timedOut: false,
    }
  } catch (err: any) {
    const timedOut = err.killed === true || err.code === 'ETIMEDOUT'
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      exitCode: err.code === 'ETIMEDOUT' ? -1 : (err.status ?? 1),
      durationMs: Date.now() - startMs,
      timedOut,
    }
  }
}

/**
 * List running containers matching a name filter.
 */
export async function listContainers(nameFilter?: string): Promise<Array<{ id: string; name: string; image: string; status: string }>> {
  const args = ['ps', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}']
  if (nameFilter) args.push('--filter', `name=${nameFilter}`)

  const { stdout } = await execFileAsync('docker', args)
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [id, name, image, status] = line.split('\t')
      return { id, name, image, status }
    })
}

/**
 * Check if a specific image exists locally.
 */
export async function imageExists(image: string): Promise<boolean> {
  try {
    await execFileAsync('docker', ['image', 'inspect', image])
    return true
  } catch {
    return false
  }
}
