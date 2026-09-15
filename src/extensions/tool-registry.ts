import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import type { ToolRegistry } from '../mastra/tools'
import { enforceAction, enforceScope, getScopeConfig } from '../safety/scope-guard'
import { defaultMcpClientFactory } from './mcp-client'
import { resolveEnvVars } from './resolve-env'
import type {
  ConnectorInfo,
  ConnectorState,
  LoadedPlugin,
  MastraTool,
  McpClient,
  McpClientFactory,
  McpServerConfig,
  ToolDescriptor,
  ToolInfo,
} from './types'

type PluginFactory = () => LoadedPlugin | Promise<LoadedPlugin>

interface McpEntry {
  config: McpServerConfig
  factory: McpClientFactory
  client?: McpClient
  specs?: Array<{ name: string; description?: string; inputSchema?: unknown }>
  state: ConnectorState
  error?: string
  connecting?: Promise<McpClient>
}

interface PluginEntry {
  id: string
  factory: PluginFactory
  env: Record<string, string>
  loaded?: LoadedPlugin
  state: ConnectorState
  error?: string
  loading?: Promise<LoadedPlugin>
}

interface LazyBuiltinEntry {
  descriptor: ToolDescriptor
  resolve: () => Promise<MastraTool>
  tool?: MastraTool
  loading?: Promise<MastraTool>
}

export class CapabilityActivationError extends Error {
  readonly code = 'CAPABILITY_INITIALIZATION_FAILED'
  readonly retryable = true

  constructor(readonly capabilityId: string, cause: unknown) {
    super(`Capability "${capabilityId}" failed to initialize: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'CapabilityActivationError'
  }
}

function wrapSchema(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== 'object') return z.object({}).passthrough()
  return z.object({}).passthrough()
}

/** Target-scoped catalog and turn-scoped native Mastra toolset. */
export class DynamicToolRegistry {
  private lazyBuiltins = new Map<string, LazyBuiltinEntry>()
  private activeToolset: Record<string, MastraTool> = {}
  private activationPolicy: (descriptor: ToolDescriptor) => boolean = () => true
  private activationObserver?: (descriptor: ToolDescriptor, tools: Record<string, MastraTool>) => void | Promise<void>
  private mcp = new Map<string, McpEntry>()
  private plugins = new Map<string, PluginEntry>()

  constructor(private clientFactory: McpClientFactory = defaultMcpClientFactory) {}

  /** Compatibility helper for static built-ins; registration remains metadata-first. */
  registerBuiltins(reg: ToolRegistry): void {
    for (const [id, tool] of Object.entries(reg)) {
      this.registerLazyBuiltin({
        id,
        description: toolDescription(tool, id),
        namespace: 'builtin',
        source: 'builtin',
        requirements: [],
      }, async () => tool as MastraTool)
    }
  }

  registerLazyBuiltin(descriptor: ToolDescriptor, resolve: () => Promise<MastraTool>): void {
    if (descriptor.source !== 'builtin') throw new Error(`Lazy builtin "${descriptor.id}" must use source "builtin"`)
    this.lazyBuiltins.set(descriptor.id, {
      descriptor: { ...descriptor, requirements: [...descriptor.requirements] },
      resolve,
    })
  }

  setActivationPolicy(policy?: (descriptor: ToolDescriptor) => boolean): void {
    this.activationPolicy = policy ?? (() => true)
  }

  setActivationObserver(observer?: (descriptor: ToolDescriptor, tools: Record<string, MastraTool>) => void | Promise<void>): void {
    this.activationObserver = observer
  }

  async activate(id: string): Promise<MastraTool> {
    const descriptor = await this.describe(id)
    if (!descriptor) throw new Error(`Capability not found: ${id}`)
    if (!this.activationPolicy(descriptor)) throw new Error(`Capability not permitted in this turn: ${id}`)
    try {
      const tool = await this.resolve(id) as MastraTool | undefined
      if (!tool) throw new Error('not found or not reachable')
      this.activeToolset[id] = tool
      await this.activationObserver?.(descriptor, this.activeToolset)
      return tool
    } catch (error) {
      if (error instanceof CapabilityActivationError) throw error
      throw new CapabilityActivationError(id, error)
    }
  }

  /** The returned object is intentionally stable and is mutated as tools activate. */
  getActiveToolset(): Record<string, MastraTool> {
    return this.activeToolset
  }

  resetTurn(): void {
    for (const id of Object.keys(this.activeToolset)) delete this.activeToolset[id]
    this.activationPolicy = () => true
    this.activationObserver = undefined
  }

  // Compatibility aliases for existing integrations.
  activateBuiltin(id: string): boolean {
    const entry = this.lazyBuiltins.get(id)
    if (!entry?.tool) return false
    this.activeToolset[id] = entry.tool
    return true
  }

  getActiveBuiltinIds(): string[] {
    return Object.keys(this.activeToolset).filter(id => this.lazyBuiltins.has(id))
  }

  resetActiveBuiltins(): void {
    this.resetTurn()
  }

  registerMcp(config: McpServerConfig, factory?: McpClientFactory): void {
    const resolved = resolveEnvVars(config)
    this.mcp.set(resolved.name, { config: resolved, factory: factory ?? this.clientFactory, state: 'registered' })
  }

  registerPlugin(id: string, factory: PluginFactory, env: Record<string, string> = {}): void {
    this.plugins.set(id, { id, factory, env: resolveEnvVars(env), state: 'registered' })
  }

  registerPluginFromPath(id: string, path: string, env: Record<string, string> = {}): void {
    this.registerPlugin(id, async () => {
      const mod = await import(/* webpackIgnore: true */ path) as Record<string, unknown>
      return typeof mod.register === 'function' ? mod.register() as LoadedPlugin : mod.tools as LoadedPlugin
    }, env)
  }

  async resolve(id: string): Promise<MastraTool | undefined> {
    const builtin = this.lazyBuiltins.get(id)
    if (builtin) return this.resolveBuiltin(builtin)

    const mcp = parseNamespacedId(id, 'mcp')
    if (mcp) {
      const [server, name] = mcp
      const entry = this.mcp.get(server)
      if (!entry) return undefined
      const client = await this.connectMcp(entry)
      const spec = entry.specs?.find(item => item.name === name)
      return spec ? wrapMcpTool(id, entry, spec, client) : undefined
    }

    const plugin = parseNamespacedId(id, 'plugin')
    if (plugin) {
      const [pluginId, name] = plugin
      const entry = this.plugins.get(pluginId)
      if (!entry) return undefined
      const loaded = await this.loadPlugin(entry)
      const definition = loaded.tools[name]
      return definition ? wrapPluginTool(id, definition) : undefined
    }
    return undefined
  }

  private async resolveBuiltin(entry: LazyBuiltinEntry): Promise<MastraTool> {
    if (entry.tool) return entry.tool
    if (entry.loading) return entry.loading
    entry.loading = Promise.resolve().then(entry.resolve).then(tool => {
      if (!tool || typeof tool !== 'object') throw new Error('resolver returned no Mastra tool')
      entry.tool = tool
      return tool
    }).finally(() => {
      entry.loading = undefined
    })
    return entry.loading
  }

  private async connectMcp(entry: McpEntry): Promise<McpClient> {
    if (entry.client) return entry.client
    if (entry.connecting) return entry.connecting
    entry.state = 'connecting'
    entry.connecting = (async () => {
      const client = entry.factory(entry.config)
      try {
        await client.connect()
        entry.specs = (await client.listTools()).tools
        entry.client = client
        entry.state = 'ready'
        entry.error = undefined
        return client
      } catch (error) {
        entry.state = 'failed'
        entry.error = error instanceof Error ? error.message : String(error)
        try { await client.close() } catch {}
        throw error
      } finally {
        entry.connecting = undefined
      }
    })()
    return entry.connecting
  }

  private async loadPlugin(entry: PluginEntry): Promise<LoadedPlugin> {
    if (entry.loaded) return entry.loaded
    if (entry.loading) return entry.loading
    entry.state = 'connecting'
    entry.loading = Promise.resolve(entry.factory()).then(loaded => {
      entry.loaded = loaded
      entry.state = 'ready'
      entry.error = undefined
      return loaded
    }, error => {
      entry.state = 'failed'
      entry.error = error instanceof Error ? error.message : String(error)
      throw error
    }).finally(() => {
      entry.loading = undefined
    })
    return entry.loading
  }

  /** List metadata only. Registered connectors are never opened here. */
  async list(): Promise<ToolInfo[]> {
    const tools: ToolInfo[] = []
    for (const entry of this.lazyBuiltins.values()) {
      tools.push({ ...entry.descriptor, ...(entry.tool?.inputSchema ? { inputSchema: entry.tool.inputSchema } : {}) })
    }
    for (const [server, entry] of this.mcp) {
      for (const spec of entry.specs ?? []) {
        tools.push({
          id: `mcp__${server}__${spec.name}`,
          description: spec.description ?? '',
          inputSchema: spec.inputSchema,
          namespace: server,
          source: 'mcp',
          requirements: [`connector:${server}`],
          server,
        })
      }
    }
    for (const [pluginId, entry] of this.plugins) {
      for (const [name, definition] of Object.entries(entry.loaded?.tools ?? {})) {
        tools.push({
          id: `plugin__${pluginId}__${name}`,
          description: toolDescription(definition, name),
          namespace: pluginId,
          source: 'plugin',
          requirements: [`plugin:${pluginId}`],
        })
      }
    }
    return tools
  }

  async describe(id: string): Promise<ToolDescriptor | undefined> {
    const builtin = this.lazyBuiltins.get(id)
    if (builtin) return { ...builtin.descriptor, requirements: [...builtin.descriptor.requirements] }
    const known = (await this.list()).find(tool => tool.id === id)
    if (known) return {
        id: known.id,
        description: known.description,
        namespace: known.namespace,
        source: known.source,
        requirements: [...known.requirements],
        activity: known.activity,
        readOnly: known.readOnly,
      }
    const mcp = parseNamespacedId(id, 'mcp')
    if (mcp && this.mcp.has(mcp[0])) return {
      id,
      description: `MCP capability ${mcp[1]} from ${mcp[0]}`,
      namespace: mcp[0],
      source: 'mcp',
      requirements: [`connector:${mcp[0]}`],
    }
    const plugin = parseNamespacedId(id, 'plugin')
    if (plugin && this.plugins.has(plugin[0])) return {
      id,
      description: `Plugin capability ${plugin[1]} from ${plugin[0]}`,
      namespace: plugin[0],
      source: 'plugin',
      requirements: [`plugin:${plugin[0]}`],
    }
    return undefined
  }

  listConnectors(): ConnectorInfo[] {
    return [
      ...[...this.mcp.entries()].map(([id, entry]) => ({ id: `mcp:${id}`, source: 'mcp' as const, state: entry.state, ...(entry.error ? { error: entry.error } : {}) })),
      ...[...this.plugins.entries()].map(([id, entry]) => ({ id: `plugin:${id}`, source: 'plugin' as const, state: entry.state, ...(entry.error ? { error: entry.error } : {}) })),
    ]
  }

  async discover(connectorId: string): Promise<ToolInfo[]> {
    const separator = connectorId.indexOf(':')
    const source = connectorId.slice(0, separator)
    const id = connectorId.slice(separator + 1)
    if (source === 'mcp') {
      const entry = this.mcp.get(id)
      if (!entry) throw new Error(`Connector not found: ${connectorId}`)
      await this.connectMcp(entry)
      return this.listByPrefix(`mcp__${id}__`)
    }
    if (source === 'plugin') {
      const entry = this.plugins.get(id)
      if (!entry) throw new Error(`Connector not found: ${connectorId}`)
      await this.loadPlugin(entry)
      return this.listByPrefix(`plugin__${id}__`)
    }
    throw new Error(`Invalid connector id: ${connectorId}`)
  }

  async listByPrefix(prefix: string): Promise<ToolInfo[]> {
    return (await this.list()).filter(tool => tool.id.startsWith(prefix))
  }

  async closeAll(): Promise<void> {
    for (const entry of this.mcp.values()) {
      if (entry.client) try { await entry.client.close() } catch {}
      entry.state = 'closed'
    }
    for (const entry of this.plugins.values()) entry.state = 'closed'
    this.resetTurn()
    this.mcp.clear()
    this.plugins.clear()
    this.lazyBuiltins.clear()
  }
}

function parseNamespacedId(id: string, source: 'mcp' | 'plugin'): [string, string] | undefined {
  const prefix = `${source}__`
  if (!id.startsWith(prefix)) return undefined
  const separator = id.indexOf('__', prefix.length)
  return separator < 0 ? undefined : [id.slice(prefix.length, separator), id.slice(separator + 2)]
}

function toolDescription(tool: unknown, fallback: string): string {
  return tool && typeof tool === 'object' && 'description' in tool
    ? String((tool as { description?: unknown }).description ?? fallback)
    : fallback
}

function wrapMcpTool(id: string, entry: McpEntry, spec: { name: string; description?: string; inputSchema?: unknown }, client: McpClient): MastraTool {
  return createTool({
    id,
    description: spec.description ?? `MCP tool ${spec.name} from ${entry.config.name}`,
    inputSchema: wrapSchema(spec.inputSchema) as any,
    execute: async (input: unknown) => {
      const args = asRecord(input)
      enforceExtensionPolicy(id, args)
      const result = await client.callTool({ name: spec.name, arguments: args })
      return { content: { type: 'text', text: result.content.map(item => item.text).join('\n') }, isError: result.isError }
    },
  }) as unknown as MastraTool
}

function wrapPluginTool(id: string, definition: unknown): MastraTool {
  if (definition && typeof definition === 'object' && 'execute' in definition) {
    const executable = definition as { description?: string; inputSchema?: unknown; execute: (input: Record<string, unknown>, context?: unknown) => unknown }
    return {
      ...(definition as Record<string, unknown>),
      id,
      description: executable.description ?? id,
      execute: async (input: unknown, context?: unknown) => {
        const args = asRecord(input)
        enforceExtensionPolicy(id, args)
        return executable.execute(args, context)
      },
    }
  }
  return createTool({
    id,
    description: id,
    inputSchema: z.object({}).passthrough() as any,
    execute: async (input: unknown) => {
      const args = asRecord(input)
      enforceExtensionPolicy(id, args)
      return { content: { type: 'text', text: JSON.stringify(definition) } }
    },
  }) as unknown as MastraTool
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}

function enforceExtensionPolicy(id: string, input: Record<string, unknown>): void {
  enforceAction('external_tool', { toolId: id })
  enforceNestedScope(input)
}

function enforceNestedScope(value: unknown, key = ''): void {
  if (typeof value === 'string') {
    if (key === 'url' || key.endsWith('Url') || key.endsWith('URL')) enforceScope(value, getScopeConfig())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) enforceNestedScope(item, key)
    return
  }
  if (!value || typeof value !== 'object') return
  for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
    enforceNestedScope(childValue, childKey)
  }
}
