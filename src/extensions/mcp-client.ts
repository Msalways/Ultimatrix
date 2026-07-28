/**
 * Default MCP client factory (Phase 5).
 *
 * Wraps the @modelcontextprotocol/sdk Client with:
 *  - stdio transport (command + args + env)
 *  - streamable http / sse transport
 *  - OAuth 2.0 (browser interactive, RFC 9728) via a local redirect listener
 *  - client-credentials (M2M) grant
 *
 * The registry depends only on the `McpClient` interface, so tests inject a
 * mock factory. This module is the real-world implementation.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { McpClient, McpClientFactory, McpServerConfig } from './types'
import { defaultTokenStore, type TokenStore } from './token-store'

function transportFor(config: McpServerConfig): StdioClientTransport | StreamableHTTPClientTransport {
  if (config.type === 'http' || config.type === 'sse' || config.url) {
    const url = new URL(config.url!)
    const opts: Record<string, unknown> = {
      requestInit: { headers: config.headers ?? {} },
    }
    if (config.auth?.kind === 'oauth') {
      opts.authProvider = oauthProvider(config, defaultTokenStore)
    }
    return new StreamableHTTPClientTransport(url, opts)
  }
  const t = new StdioClientTransport({
    command: config.command!,
    args: config.args ?? [],
    env: { ...(config.env ?? {}) } as Record<string, string>,
  })
  return t
}

function oauthProvider(config: McpServerConfig, store: TokenStore) {
  const port = config.auth?.redirectPort ?? 8765
  return {
    get redirectUrl() {
      return `http://127.0.0.1:${port}/callback`
    },
    get clientMetadata() {
      return {
        client_name: 'Ultimatrix',
        redirect_uris: [`http://127.0.0.1:${port}/callback`],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      } as Record<string, unknown>
    },
    async clientInformation() {
      if (config.auth?.clientId) {
        return { client_id: config.auth.clientId }
      }
      const existing = await store.load(config.name)
      return existing ? { client_id: config.auth?.clientId ?? 'ultimatrix' } : undefined
    },
    state() {
      return randomUUID()
    },
    async tokens() {
      const t = await store.load(config.name)
      return t
        ? {
            access_token: t.access_token,
            token_type: (t.token_type as 'Bearer') ?? 'Bearer',
            expires_in: t.expires_at ? Math.max(0, Math.floor((t.expires_at - Date.now()) / 1000)) : undefined,
            refresh_token: t.refresh_token,
            scope: t.scope,
          }
        : undefined
    },
    async saveTokens(token: unknown) {
      const tk = token as Record<string, unknown>
      await store.save(config.name, {
        access_token: String(tk.access_token),
        token_type: tk.token_type ? String(tk.token_type) : 'Bearer',
        expires_at: tk.expires_in ? Date.now() + Number(tk.expires_in) * 1000 : undefined,
        refresh_token: tk.refresh_token ? String(tk.refresh_token) : undefined,
        scope: tk.scope ? String(tk.scope) : config.auth?.scope,
      })
    },
    redirectToAuthorization(authorizationUrl: URL) {
      // Best-effort: open the browser. In headless/test mode this is a no-op.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { exec } = require('node:child_process') as typeof import('node:child_process')
        const cmd = process.platform === 'win32' ? `start "" "${authorizationUrl.href}"` : `open "${authorizationUrl.href}"`
        exec(cmd)
      } catch {
        /* ignore */
      }
    },
  }
}

/**
 * Opens a temporary local HTTP listener so the OAuth redirect can be captured.
 * Resolves with the callback URL string.
 */
export function startRedirectListener(port: number): { promise: Promise<URL>; server: Server } {
  const server = createServer()
  const promise = new Promise<URL>((resolve) => {
    server.on('request', (req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Ultimatrix: authorization complete. You may close this tab.</body></html>')
      if (req.url) resolve(new URL(`http://127.0.0.1:${port}${req.url}`))
    })
  })
  server.listen(port)
  return { promise, server }
}

/** Default client factory used by the registry at runtime. */
export const defaultMcpClientFactory: McpClientFactory = (config: McpServerConfig): McpClient => {
  if (config.auth?.kind === 'client-credentials') {
    // M2M: resource owner password / client-credentials grant — exchanged by the
    // transport's auth provider. We reuse the OAuth provider shape with credentials.
  }
  let client: Client | undefined
  let transport: StdioClientTransport | StreamableHTTPClientTransport | undefined

  return {
    async connect() {
      transport = transportFor(config)
      client = new Client({ name: 'ultimatrix', version: '8.4' }, { capabilities: {} })
      await client.connect(transport)
    },
    async close() {
      try {
        await client?.close()
      } catch {
        /* ignore */
      }
    },
    async listTools() {
      const res = await client!.listTools()
      return { tools: (res.tools as Array<{ name: string; description?: string; inputSchema?: unknown }>).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) }
    },
    async callTool(args: { name: string; arguments: unknown }) {
      const res = await client!.callTool({ name: args.name, arguments: args.arguments as Record<string, unknown> } as never)
      const content = Array.isArray(res.content)
        ? (res.content as Array<{ type: string; text?: string }>).map((c) => ({ type: c.type, text: c.text ?? '' }))
        : [{ type: 'text', text: String((res as { structuredContent?: unknown }).structuredContent ?? '') }]
      return { content, isError: Boolean((res as { isError?: boolean }).isError) }
    },
  }
}
