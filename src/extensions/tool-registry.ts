/**
 * DynamicToolRegistry — the Phase 1 registry.
 *
 * Wraps the built-in Mastra ToolRegistry and adds lazily-resolved:
 *  - MCP servers (stdio / http / sse) → tools named `mcp__<server>__<tool>`
 *  - code plugins → tools named `plugin__<id>__<tool>`
 *
 * Safety (scope guard, evidence gate, rate limiting) is injected at the tool
 * layer, so extension tools inherit the same guards as built-ins. The MCP
 * client factory is injectable so the registry can be unit-tested with mocks.
 */

import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ToolRegistry } from '../mastra/tools'
import type {
  LoadedPlugin,
  McpClient,
  McpClientFactory,
  McpServerConfig,
  ToolInfo,
} from './types'
import { defaultMcpClientFactory } from './mcp-client'
import { resolveEnvVars } from './resolve-env'

type PluginFactory = () => LoadedPlugin | Promise<LoadedPlugin>

interface McpEntry {
  config: McpServerConfig
  factory: McpClientFactory
  client?: McpClient
  specs?: Array<{ name: string; description?: string; inputSchema?: unknown }>
}

interface PluginEntry {
  id: string
  factory: PluginFactory
  env: Record<string, string>
  loaded?: LoadedPlugin
}

function wrapSchema(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== 'object') return z.object({}).passthrough()
  const props = (schema as { properties?: Record<string, unknown> }).properties
  if (!props) return z.object({}).passthrough()
  return z.object({}).passthrough()
}

export class DynamicToolRegistry {
  private builtin?: ToolRegistry
  private mcp = new Map<string, McpEntry>()
  private plugins = new Map<string, PluginEntry>()
  private clientFactory: McpClientFactory

  constructor(clientFactory: McpClientFactory = defaultMcpClientFactory) {
    this.clientFactory = clientFactory
  }

  /** Inject the built-in Mastra ToolRegistry (Phase 1.2). */
  registerBuiltins(reg: ToolRegistry): void {
    this.builtin = reg
  }

  registerMcp(config: McpServerConfig, factory?: McpClientFactory): void {
    const cfg = resolveEnvVars(config)
    this.mcp.set(cfg.name, { config: cfg, factory: factory ?? this.clientFactory })
  }

  registerPlugin(id: string, factory: PluginFactory, env: Record<string, string> = {}): void {
    this.plugins.set(id, { id, factory, env: resolveEnvVars(env) })
  }

  async registerPluginFromPath(id: string, path: string, env: Record<string, string> = {}): Promise<void> {
    // Dynamic plugin loading — runtime path resolution, not static analysis
    const mod = await import(/* webpackIgnore: true */ path) as Record<string, unknown>
    const factory: PluginFactory = () => (typeof mod.register === 'function' ? mod.register() : (mod.tools as LoadedPlugin))
    this.registerPlugin(id, factory, env)
  }

  private isMcp(id: string): [string, string] | null {
    const m = id.match(/^mcp__([^_]+)__(.+)$/)
    return m ? [m[1], m[2]] : null
  }

  private isPlugin(id: string): [string, string] | null {
    const m = id.match(/^plugin__([^_]+)__(.+)$/)
    return m ? [m[1], m[2]] : null
  }

  private builtinGet(id: string): unknown {
    if (!this.builtin) return undefined
    return (this.builtin as Record<string, unknown>)[id]
  }

  async resolve(id: string): Promise<unknown> {
    const bi = this.builtinGet(id)
    if (bi) return bi

    const mcp = this.isMcp(id)
    if (mcp) {
      const [server, tool] = mcp
      const entry = this.mcp.get(server)
      if (!entry) return undefined
      const client = await this.connectMcp(entry)
      const spec = entry.specs?.find((s) => s.name === tool)
      if (!spec) return undefined
      return wrapMcpTool(id, entry, spec, client)
    }

    const plugin = this.isPlugin(id)
    if (plugin) {
      const [pid, tool] = plugin
      const entry = this.plugins.get(pid)
      if (!entry) return undefined
      const loaded = await this.loadPlugin(entry)
      const def = (loaded.tools as Record<string, unknown>)[tool]
      if (!def) return undefined
      return wrapPluginTool(id, def)
    }

    return undefined
  }

  private async connectMcp(entry: McpEntry): Promise<McpClient> {
    if (entry.client) return entry.client
    const client = entry.factory(entry.config)
    await client.connect()
    const { tools } = await client.listTools()
    entry.specs = tools
    entry.client = client
    return client
  }

  private async loadPlugin(entry: PluginEntry): Promise<LoadedPlugin> {
    if (entry.loaded) return entry.loaded
    const loaded = await entry.factory()
    entry.loaded = loaded
    return loaded
  }

  async list(): Promise<ToolInfo[]> {
    const out: ToolInfo[] = []
    if (this.builtin) {
      for (const id of Object.keys(this.builtin)) {
        const t = (this.builtin as Record<string, unknown>)[id]
        out.push({ id, description: toolDescription(t, id), inputSchema: toolSchema(t), source: 'builtin' })
      }
    }
    for (const [server, entry] of this.mcp) {
      let resolved = entry.specs
      if (!resolved) {
        await this.connectMcp(entry)
        resolved = entry.specs
      }
      for (const s of resolved ?? []) {
        out.push({ id: `mcp__${server}__${s.name}`, description: s.description ?? '', inputSchema: s.inputSchema, source: 'mcp', server })
      }
    }
    for (const [pid, entry] of this.plugins) {
      const loaded = await this.loadPlugin(entry)
      for (const name of Object.keys(loaded.tools)) {
        out.push({ id: `plugin__${pid}__${name}`, description: toolDescription((loaded.tools as Record<string, unknown>)[name], name), source: 'plugin' })
      }
    }
    return out
  }

  async listByPrefix(prefix: string): Promise<ToolInfo[]> {
    return (await this.list()).filter((t) => t.id.startsWith(prefix))
  }

  async closeAll(): Promise<void> {
    for (const entry of this.mcp.values()) {
      if (entry.client) {
        try {
          await entry.client.close()
        } catch {
          /* ignore */
        }
      }
    }
    this.mcp.clear()
    this.plugins.clear()
  }
}

function toolDescription(t: unknown, fallback: string): string {
  if (t && typeof t === 'object' && 'description' in t) return String((t as { description: unknown }).description ?? fallback)
  return fallback
}

function toolSchema(t: unknown): unknown {
  if (t && typeof t === 'object' && 'inputSchema' in t) return (t as { inputSchema: unknown }).inputSchema
  return undefined
}

function wrapMcpTool(id: string, entry: McpEntry, spec: { name: string; description?: string; inputSchema?: unknown }, client: McpClient) {
  return createTool({
    id,
    description: spec.description ?? `MCP tool ${spec.name} from ${entry.config.name}`,
    inputSchema: wrapSchema(spec.inputSchema) as never,
    execute: async (input: Record<string, unknown>) => {
      const args = (input ?? {}) as Record<string, unknown>
      const res = await client.callTool({ name: spec.name, arguments: args })
      const text = res.content.map((c) => c.text).join('\n')
      return { content: { type: 'text', text }, isError: res.isError }
    },
  })
}

function wrapPluginTool(id: string, def: unknown) {
  if (def && typeof def === 'object' && 'execute' in def) {
    return createTool({
      id,
      description: (def as { description?: string }).description ?? id,
      inputSchema: wrapSchema((def as { inputSchema?: unknown }).inputSchema) as never,
      execute: async (inputData: never, _context: unknown) => (def as { execute: (input: Record<string, unknown>) => unknown }).execute(inputData as Record<string, unknown>),
    })
  }
  return createTool({
    id,
    description: id,
    inputSchema: z.object({}).passthrough() as never,
    execute: async () => ({ content: { type: 'text', text: JSON.stringify(def) } }),
  })
}

let singleton: DynamicToolRegistry | undefined

export function getGlobalToolRegistry(): DynamicToolRegistry {
  if (!singleton) singleton = new DynamicToolRegistry()
  return singleton
}
