/**
 * Platform Detection (Phase S — Execution Backend).
 *
 * Detects the execution platform (Linux native, Docker Desktop, no Docker)
 * and provides appropriate sandbox configuration defaults.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  ExecutionPlatform,
  SandboxConfig,
  PlatformCapabilities,
} from './types'
import { SANDBOX_DEFAULTS } from './types'

const execFileAsync = promisify(execFile)

/** Cached platform detection result */
let cachedPlatform: ExecutionPlatform | undefined

/**
 * Detect the execution platform by checking Docker availability and type.
 *
 * - Linux + Docker native → 'linux-native' (NET_RAW available)
 * - Windows/macOS + Docker Desktop → 'docker-desktop' (limited networking)
 * - No Docker → 'no-docker' (local-only execution)
 */
export async function detectPlatform(): Promise<ExecutionPlatform> {
  if (cachedPlatform) return cachedPlatform

  try {
    const { stdout } = await execFileAsync('docker', ['info', '--format', '{{.OperatingSystem}}'], {
      timeout: 5000,
    })

    const osInfo = stdout.trim().toLowerCase()

    // Docker Desktop on Windows/macOS
    if (osInfo.includes('windows') || osInfo.includes('macos') || osInfo.includes('docker desktop')) {
      cachedPlatform = 'docker-desktop'
      return cachedPlatform
    }

    // Native Docker on Linux
    cachedPlatform = 'linux-native'
    return cachedPlatform
  } catch {
    cachedPlatform = 'no-docker'
    return cachedPlatform
  }
}

/**
 * Check if Docker is available (lightweight ping).
 */
export async function checkDockerAvailable(): Promise<boolean> {
  try {
    await execFileAsync('docker', ['version', '--format', '{{.Server.Version}}'], {
      timeout: 5000,
    })
    return true
  } catch {
    return false
  }
}

/**
 * Get platform-specific capabilities.
 */
export function getPlatformCapabilities(platform: ExecutionPlatform): PlatformCapabilities {
  switch (platform) {
    case 'linux-native':
      return {
        netRaw: true,
        netAdmin: true,
        hostNetwork: true,
        procAccess: true,
      }
    case 'docker-desktop':
      return {
        netRaw: false,
        netAdmin: false,
        hostNetwork: false,
        procAccess: false,
        warning: 'Docker Desktop detected. Network capabilities limited (no NET_RAW). Web-app tools (nuclei, sqlmap, ffuf) work normally. Raw packet tools (masscan, tshark) may be limited.',
      }
    case 'no-docker':
      return {
        netRaw: false,
        netAdmin: false,
        hostNetwork: false,
        procAccess: false,
        warning: 'Docker not available. Using local-only execution. Install Docker for sandbox support.',
      }
  }
}

/**
 * Get the default sandbox configuration for the detected platform.
 */
export function getDefaultConfig(platform: ExecutionPlatform): SandboxConfig {
  return { ...SANDBOX_DEFAULTS[platform] }
}

/**
 * Reset cached platform detection (for tests).
 */
export function resetPlatformCache(): void {
  cachedPlatform = undefined
}
