import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { McpServerConfig, McpConfig } from '../core/hunt-config'

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, any>
  serverName: string
}

export interface McpToolCallResult {
  ok: boolean
  data?: unknown
  error?: string
}

interface JsonRpcMessage {
  jsonrpc: '2.0'
  id: string | number
  method?: string
  params?: Record<string, any>
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export class McpClientConnection extends EventEmitter {
  private process: ChildProcess | null = null
  private pending = new Map<string | number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private msgId = 0
  private buffer = ''
  private _connected = false
  private serverName: string

  constructor(private config: McpServerConfig, serverName: string) {
    super()
    this.serverName = serverName
  }

  get connected(): boolean { return this._connected }
  get name(): string { return this.serverName }

  async connect(): Promise<void> {
    if (this._connected) return

    if (this.config.transport === 'stdio') {
      await this.connectStdio()
    } else if (this.config.transport === 'sse') {
      await this.connectSse()
    } else {
      throw new Error(`Unsupported MCP transport: ${this.config.transport}`)
    }
    this._connected = true
    this.emit('connected')
  }

  private async connectStdio(): Promise<void> {
    const cmd = this.config.command
    if (!cmd) throw new Error('MCP stdio transport requires "command"')
    const args = this.config.args || []

    this.process = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...this.config.env },
    })

    this.process.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString()
      this.processBuffer()
    })

    this.process.stderr?.on('data', (chunk: Buffer) => {
      this.emit('stderr', chunk.toString())
    })

    this.process.on('exit', (code) => {
      this._connected = false
      this.emit('disconnected', code)
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server ${this.serverName} exited with code ${code}`))
      }
      this.pending.clear()
    })

    this.process.on('error', (err) => {
      this._connected = false
      this.emit('error', err)
    })

    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ultimatrix', version: '2.0.0' },
    })
  }

  private async connectSse(): Promise<void> {
    const url = this.config.url
    if (!url) throw new Error('MCP SSE transport requires "url"')

    const resp = await fetch(url)
    if (!resp.ok || !resp.body) {
      throw new Error(`MCP SSE connection failed: ${resp.status}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let sseBuffer = ''

    const readLoop = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          this._connected = false
          this.emit('disconnected', 0)
          break
        }
        sseBuffer += decoder.decode(value, { stream: true })
        const lines = sseBuffer.split('\n')
        sseBuffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const msg: JsonRpcMessage = JSON.parse(line.slice(6))
              this.handleMessage(msg)
            } catch { }
          }
        }
      }
    }
    readLoop().catch((err) => this.emit('error', err))

    await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'ultimatrix', version: '2.0.0' },
    })
  }

  private processBuffer(): void {
    const lines = this.buffer.split('\n')
    this.buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const msg: JsonRpcMessage = JSON.parse(line)
        this.handleMessage(msg)
      } catch { }
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (msg.id !== undefined && msg.id !== null) {
      const pending = this.pending.get(msg.id)
      if (pending) {
        this.pending.delete(msg.id)
        if (msg.error) {
          pending.reject(new Error(msg.error.message))
        } else {
          pending.resolve(msg.result)
        }
      }
      return
    }
    this.emit('notification', msg)
  }

  async send(method: string, params?: Record<string, any>): Promise<any> {
    const id = ++this.msgId
    const msg: JsonRpcMessage = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`MCP request timed out: ${method}`))
      }, 30_000)

      const msgStr = JSON.stringify(msg) + '\n'
      if (this.config.transport === 'stdio') {
        this.process?.stdin?.write(msgStr)
      }
      // For SSE, POST to the endpoint
      if (this.config.transport === 'sse' && this.config.url) {
        fetch(this.config.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: msgStr,
        }).catch((err) => {
          clearTimeout(timeout)
          reject(err)
        })
      }

      const origResolve = this.pending.get(id)?.resolve
      if (origResolve) {
        this.pending.set(id, {
          resolve: (v: any) => { clearTimeout(timeout); origResolve(v) },
          reject: (e: Error) => { clearTimeout(timeout); reject(e) },
        })
      }
    })
  }

  async listTools(): Promise<McpToolDefinition[]> {
    const result = await this.send('tools/list') as { tools: Array<{ name: string; description?: string; inputSchema: Record<string, any> }> }
    return (result.tools || []).map((t) => ({
      name: `${this.serverName}__${t.name}`,
      description: t.description || '',
      inputSchema: t.inputSchema || {},
      serverName: this.serverName,
    }))
  }

  async callTool(toolName: string, args: Record<string, any>): Promise<McpToolCallResult> {
    try {
      const result = await this.send('tools/call', { name: toolName, arguments: args })
      return { ok: true, data: result }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  disconnect(): void {
    if (this.config.transport === 'stdio') {
      this.process?.kill()
    }
    this._connected = false
  }
}

export class McpClientManager {
  private connections = new Map<string, McpClientConnection>()
  private toolCache: McpToolDefinition[] | null = null

  async initialize(config: McpConfig): Promise<void> {
    for (const [name, serverConfig] of Object.entries(config.servers)) {
      const conn = new McpClientConnection(serverConfig, name)
      try {
        await conn.connect()
        this.connections.set(name, conn)
      } catch (e) {
        console.error(`[mcp] Failed to connect to server "${name}": ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    this.toolCache = null
  }

  async listAllTools(): Promise<McpToolDefinition[]> {
    if (this.toolCache) return this.toolCache
    const all: McpToolDefinition[] = []
    for (const [name, conn] of this.connections) {
      try {
        const tools = await conn.listTools()
        all.push(...tools)
      } catch (e) {
        console.error(`[mcp] Failed to list tools from "${name}": ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    this.toolCache = all
    return all
  }

  async callTool(fullName: string, args: Record<string, any>): Promise<McpToolCallResult> {
    const parts = fullName.split('__')
    const serverName = parts[0]
    const toolName = parts.slice(1).join('__')
    const conn = this.connections.get(serverName)
    if (!conn) return { ok: false, error: `Unknown MCP server: ${serverName}` }
    return conn.callTool(toolName, args)
  }

  getConnection(name: string): McpClientConnection | undefined {
    return this.connections.get(name)
  }

  getConnections(): McpClientConnection[] {
    return Array.from(this.connections.values())
  }

  disconnectAll(): void {
    for (const conn of this.connections.values()) {
      conn.disconnect()
    }
    this.connections.clear()
    this.toolCache = null
  }
}

let globalMcpManager: McpClientManager | null = null

export function getGlobalMcpManager(): McpClientManager {
  if (!globalMcpManager) globalMcpManager = new McpClientManager()
  return globalMcpManager
}

export function resetGlobalMcpManager(): void {
  globalMcpManager?.disconnectAll()
  globalMcpManager = null
}
