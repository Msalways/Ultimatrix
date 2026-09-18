/**
 * Sandbox Manager (Phase S — Execution Backend).
 *
 * Per-engagement container lifecycle: ensures the sandbox image is available,
 * creates/manages containers, and executes commands inside them.
 * Falls back gracefully when Docker is unavailable.
 */

import type {
  SandboxConfig,
  SandboxStatus,
  SandboxResult,
  SandboxCommand,
  ExecutionPlatform,
} from './types'
import { SANDBOX_DEFAULTS } from './types'
import { detectPlatform, getPlatformCapabilities } from './platform'
import {
  pullImage,
  createContainer,
  startContainer,
  stopContainer,
  removeContainer,
  execInContainer,
  listContainers,
  imageExists,
} from './docker-client'

const CONTAINER_PREFIX = 'ultimatrix-sandbox'

export class SandboxManager {
  private config: SandboxConfig
  private platform: ExecutionPlatform = 'no-docker'
  private containerId?: string
  private containerName: string
  private ready = false

  constructor(config?: Partial<SandboxConfig>) {
    this.platform = 'no-docker' // detected on ensureReady
    this.config = { ...SANDBOX_DEFAULTS['no-docker'], ...config }
    this.containerName = `${CONTAINER_PREFIX}-${Date.now()}`
  }

  /** Get current sandbox status */
  getStatus(): SandboxStatus {
    return {
      platform: this.platform,
      dockerAvailable: this.platform !== 'no-docker',
      containerRunning: !!this.containerId,
      containerId: this.containerId,
    }
  }

  /** Get platform capabilities (NET_RAW, etc.) */
  getCapabilities() {
    return getPlatformCapabilities(this.platform)
  }

  /**
   * Ensure the sandbox is ready for execution.
   * Detects platform, checks Docker, pulls image if needed, creates container.
   */
  async ensureReady(): Promise<boolean> {
    // 1. Detect platform
    this.platform = await detectPlatform()
    this.config = { ...SANDBOX_DEFAULTS[this.platform], ...this.config }

    if (this.platform === 'no-docker') {
      return false
    }

    // 2. Check image exists, pull if needed
    const hasImage = await imageExists(this.config.image)
    if (!hasImage) {
      const pulled = await pullImage(this.config.image)
      if (!pulled) return false
    }

    // 3. Check for existing container with our prefix
    const existing = await listContainers(CONTAINER_PREFIX)
    if (existing.length > 0) {
      this.containerId = existing[0].id
      this.ready = true
      return true
    }

    // 4. Create and start container
    try {
      this.containerId = await createContainer({
        image: this.config.image,
        name: this.containerName,
        networkMode: this.config.networkMode,
        memoryLimit: this.config.memoryLimit,
        cpuQuota: this.config.cpuQuota,
        readOnlyRoot: false,
      })
      await startContainer(this.containerId)
      this.ready = true
      return true
    } catch {
      this.ready = false
      return false
    }
  }

  /**
   * Execute a command in the sandbox.
   * Returns sandbox result or error if sandbox not available.
   */
  async execute(command: SandboxCommand): Promise<SandboxResult> {
    if (!this.ready || !this.containerId) {
      return {
        stdout: '',
        stderr: 'Sandbox not available',
        exitCode: -1,
        durationMs: 0,
        timedOut: false,
      }
    }

    return execInContainer(this.containerId, command, {
      timeoutMs: command.timeoutMs ?? this.config.timeoutMs,
    })
  }

  /**
   * Check if the sandbox is available for execution.
   */
  isAvailable(): boolean {
    return this.ready && !!this.containerId
  }

  /**
   * Shutdown and clean up the sandbox container.
   */
  async shutdown(): Promise<void> {
    if (this.containerId) {
      await stopContainer(this.containerId)
      await removeContainer(this.containerId)
      this.containerId = undefined
    }
    this.ready = false
  }
}

/** Global sandbox manager instance */
let globalManager: SandboxManager | undefined

export function getGlobalSandboxManager(config?: Partial<SandboxConfig>): SandboxManager {
  if (!globalManager) globalManager = new SandboxManager(config)
  return globalManager
}

export function resetGlobalSandboxManager(): void {
  if (globalManager) {
    globalManager.shutdown()
    globalManager = undefined
  }
}
