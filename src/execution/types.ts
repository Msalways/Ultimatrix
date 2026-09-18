/**
 * Docker Sandbox types (Phase S — Execution Backend).
 *
 * Types for running security tools in isolated Docker containers
 * with auto-fallback from local execution to sandbox.
 */

/** Detected execution platform */
export type ExecutionPlatform = 'linux-native' | 'docker-desktop' | 'no-docker'

/** Docker network mode */
export type NetworkMode = 'host' | 'bridge' | 'none'

/** Sandbox configuration */
export interface SandboxConfig {
  /** Enable sandbox execution (default: false) */
  enabled: boolean
  /** Docker image to use (default: 'ultimatrix-sandbox:latest') */
  image: string
  /** Network mode (default: 'bridge' on Docker Desktop, 'host' on Linux native) */
  networkMode: NetworkMode
  /** Execution timeout in milliseconds (default: 300000 = 5 min) */
  timeoutMs: number
  /** Memory limit (default: '2g') */
  memoryLimit: string
  /** CPU quota (default: 2 = 2 cores) */
  cpuQuota: number
}

/** Default sandbox configuration per platform */
export const SANDBOX_DEFAULTS: Record<ExecutionPlatform, SandboxConfig> = {
  'linux-native': {
    enabled: false,
    image: 'ultimatrix-sandbox:latest',
    networkMode: 'host',
    timeoutMs: 300_000,
    memoryLimit: '2g',
    cpuQuota: 2,
  },
  'docker-desktop': {
    enabled: false,
    image: 'ultimatrix-sandbox:latest',
    networkMode: 'bridge',
    timeoutMs: 300_000,
    memoryLimit: '2g',
    cpuQuota: 2,
  },
  'no-docker': {
    enabled: false,
    image: 'ultimatrix-sandbox:latest',
    networkMode: 'bridge',
    timeoutMs: 300_000,
    memoryLimit: '2g',
    cpuQuota: 2,
  },
}

/** Current sandbox status */
export interface SandboxStatus {
  platform: ExecutionPlatform
  dockerAvailable: boolean
  containerRunning: boolean
  containerId?: string
  imageAvailable?: boolean
}

/** Result of executing a command in the sandbox */
export interface SandboxResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
  timedOut: boolean
}

/** Command to execute in the sandbox */
export interface SandboxCommand {
  /** Tool ID this command is for */
  toolId: string
  /** Command arguments (NOT a shell string — execFile arg-array) */
  args: string[]
  /** Working directory inside container */
  workdir?: string
  /** Environment variables */
  env?: Record<string, string>
  /** Timeout override */
  timeoutMs?: number
}

/** Tool-to-command mapping for sandbox execution */
export interface ToolCommandMap {
  [toolId: string]: (opts: {
    target?: string
    url?: string
    wordlist?: string
    extraArgs?: string[]
  }) => SandboxCommand
}

/** Platform-specific capabilities */
export interface PlatformCapabilities {
  /** Can use NET_RAW (raw sockets, packet capture) */
  netRaw: boolean
  /** Can use NET_ADMIN (network configuration) */
  netAdmin: boolean
  /** Can use host networking */
  hostNetwork: boolean
  /** Can access /proc/sys/kernel */
  procAccess: boolean
  /** Warning message for limited platforms */
  warning?: string
}
