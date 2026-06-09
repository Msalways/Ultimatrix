export interface McpServerConfig {
  transport: 'stdio' | 'sse'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

export interface HuntConfigValues {
  maxNodes: number
  techniqueBudget: number
  nodeDelayMs: number
  nodeTimeoutMs: number
  rateLimitBackoffMs: number
  maxConcurrency: number
  formWatchIntervalMs: number
}

export interface OutputConfig {
  dir: string
  format: string
  includeCoverage: boolean
}

export interface SarifConfig {
  severityScores: Record<string, number>
}

export interface FullConfig {
  provider: Record<string, any>
  scan: { target?: string; headless?: boolean; harPath?: string }
  hunt: HuntConfigValues
  output: OutputConfig
  mcp: McpConfig
  sarif: SarifConfig
}

export const DEFAULT_HUNT_CONFIG: HuntConfigValues = {
  maxNodes: 200,
  techniqueBudget: 3,
  nodeDelayMs: 100,
  nodeTimeoutMs: 120_000,
  rateLimitBackoffMs: 5_000,
  maxConcurrency: 4,
  formWatchIntervalMs: 1500,
}

export const DEFAULT_OUTPUT_CONFIG: OutputConfig = {
  dir: './output',
  format: 'html',
  includeCoverage: true,
}

export const DEFAULT_SARIF_CONFIG: SarifConfig = {
  severityScores: {
    critical: 9.5,
    high: 8.0,
    medium: 5.5,
    low: 3.0,
    info: 1.0,
  },
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
  servers: {},
}

export function buildHuntConfig(raw: Record<string, any>): HuntConfigValues {
  const h = raw?.hunt || {}
  return {
    maxNodes: h.maxNodes ?? DEFAULT_HUNT_CONFIG.maxNodes,
    techniqueBudget: h.techniqueBudget ?? DEFAULT_HUNT_CONFIG.techniqueBudget,
    nodeDelayMs: h.nodeDelayMs ?? DEFAULT_HUNT_CONFIG.nodeDelayMs,
    nodeTimeoutMs: h.nodeTimeoutMs ?? DEFAULT_HUNT_CONFIG.nodeTimeoutMs,
    rateLimitBackoffMs: h.rateLimitBackoffMs ?? DEFAULT_HUNT_CONFIG.rateLimitBackoffMs,
    maxConcurrency: h.maxConcurrency ?? DEFAULT_HUNT_CONFIG.maxConcurrency,
    formWatchIntervalMs: h.formWatchIntervalMs ?? DEFAULT_HUNT_CONFIG.formWatchIntervalMs,
  }
}

export function buildSarifConfig(raw: Record<string, any>): SarifConfig {
  const s = raw?.sarif || {}
  return {
    severityScores: {
      ...DEFAULT_SARIF_CONFIG.severityScores,
      ...(s.severityScores || {}),
    },
  }
}

export function buildMcpConfig(raw: Record<string, any>): McpConfig {
  const m = raw?.mcp || {}
  return {
    servers: { ...(m.servers || {}) },
  }
}
