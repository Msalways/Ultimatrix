/**
 * Shared types for the extensibility substrate (Phase 1–5).
 *
 * These describe MCP server configs, plugin configs, and the injectable
 * MCP client interface so the registry can be unit-tested with mock clients
 * (no real subprocesses / network).
 */

export type McpTransportType = 'stdio' | 'http' | 'sse'

export interface McpAuthConfig {
  /** 'oauth' → interactive browser OAuth 2.0 (RFC 9728). 'client-credentials' → M2M. */
  kind: 'oauth' | 'client-credentials'
  clientId?: string
  clientSecret?: string
  scope?: string
  /** Local port for the OAuth redirect listener (default 8765). */
  redirectPort?: number
}

export interface McpServerConfig {
  name: string
  /** stdio transport: command + args + env. */
  command?: string
  args?: string[]
  env?: Record<string, string>
  /** http/sse transport: server URL. */
  url?: string
  headers?: Record<string, string>
  type?: McpTransportType
  auth?: McpAuthConfig
}

export interface PluginConfig {
  id: string
  path: string
  env?: Record<string, string>
}

export interface McpToolSpec {
  name: string
  description?: string
  inputSchema?: unknown
}

/** Minimal MCP client surface used by DynamicToolRegistry. */
export interface McpClient {
  connect(): Promise<void>
  close(): Promise<void>
  listTools(): Promise<{ tools: McpToolSpec[] }>
  callTool(args: { name: string; arguments: unknown }): Promise<{
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }>
}

export type McpClientFactory = (config: McpServerConfig) => McpClient

export type ToolSource = 'builtin' | 'mcp' | 'plugin'

export interface ToolInfo {
  id: string
  description: string
  inputSchema?: unknown
  source: ToolSource
  server?: string
}

/** A loaded plugin exposes one or more tools keyed by local tool name. */
export interface LoadedPlugin {
  tools: Record<string, unknown>
}
