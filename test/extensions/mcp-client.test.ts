import { describe, it, expect } from 'vitest'
import { startRedirectListener, defaultMcpClientFactory } from '../../src/extensions/mcp-client'
import type { McpServerConfig } from '../../src/extensions/types'

describe('mcp-client', () => {
  it('defaultMcpClientFactory returns a client shape', () => {
    const client = defaultMcpClientFactory({ name: 'x', command: 'echo' })
    expect(typeof client.connect).toBe('function')
    expect(typeof client.close).toBe('function')
    expect(typeof client.listTools).toBe('function')
    expect(typeof client.callTool).toBe('function')
  })

  it('startRedirectListener captures the OAuth callback URL', async () => {
    const { promise, server } = startRedirectListener(8799)
    const captured = promise
    // Simulate the provider redirecting the browser to the local callback.
    const http = await import('node:http')
    await new Promise<void>((resolve) => {
      http
        .get('http://127.0.0.1:8799/callback?code=abc&state=xyz', (res) => {
          res.resume()
          res.on('end', () => resolve())
        })
        .on('error', () => resolve())
    })
    const url = await captured
    expect(url.searchParams.get('code')).toBe('abc')
    server.close()
  })
})
